// One-time migration: import historical bookings from the client's filled
// "Old Booking Data" Excel template into the bookings table.
//
// Usage:
//   node scripts/importOldBookings.js "<path to .xlsx>"              (dry run — prints what would be inserted)
//   node scripts/importOldBookings.js "<path to .xlsx>" --commit     (actually inserts)
//
// Field-mapping assumptions (confirmed with the business owner while building
// this script — not guesses):
//   - Daily Rate: used as-is when the cell is a number; when it's text (e.g.
//     "Weekly Rent"), the effective daily rate is Total Rental Amount ÷ the
//     number of days between Pickup Date and Original Return Date.
//   - "NA" in Starting Mileage / Final Odometer / Fuel Charge is treated as
//     blank, not a literal value.
//   - Extended Return Date has no time column of its own -> reuses Original
//     Return Time. Deposit Collected Date has no time column -> reuses
//     Pickup Time. Any other date-only column with no time of its own
//     (Deposit Refund Date, Payment Date, Extension Payment Date) also
//     reuses Pickup Time, for consistency.
//   - Actual Return Date/Time, if blank, defaults to the Extended Return
//     Date/Time (if extended) or otherwise the Original Return Date/Time.
//   - "Was It Extended?" = Yes adds an origin:"extension" charge (Extension
//     Amount Charged) and, if any amount was collected, an origin:"extension"
//     payment — the exact same tagging Booking.jsx's own Extend Booking flow
//     uses, so the app's existing balance/ledger math treats it identically.
//   - Booking Status "Completed" -> forceCompleted: true (matches "Confirm
//     Return" in the live app). "Cancelled" -> cancelled: true. Blank is left
//     as a still-open booking and is flagged as a warning, since old records
//     should generally be one or the other.
//   - Deposit Collected?/Refunded? = Yes is assumed to be the FULL deposit
//     amount (the template has no partial-amount column for either).
//
// Every row is validated before anything is written: required fields present,
// the plate already exists in `cars` (bookings.plate is a foreign key), and
// no two rows produce the same booking id. A dry run always just prints its
// findings; --commit only runs if every row is issue-free.

const path = require("path");
const ExcelJS = require("exceljs");
const db = require("../src/config/db");
const bookingModel = require("../src/models/bookingModel");
const customerModel = require("../src/models/customerModel");

const SHEET_NAME = "Bookings";

function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === "";
}

function isNA(v) {
  return isBlank(v) || String(v).trim().toUpperCase() === "NA";
}

function excelDateToYMD(v) {
  if (isBlank(v)) return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear(), m = v.getUTCMonth() + 1, d = v.getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null; // the template only ever hands us real Date cells for date columns
}

function excelTimeToHM(v) {
  if (isBlank(v)) return null;
  if (v instanceof Date) {
    const h = v.getUTCHours(), m = v.getUTCMinutes();
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return null;
}

function yesNo(v) {
  return !isBlank(v) && String(v).trim().toLowerCase() === "yes";
}

function toNumOrNull(v) {
  if (isNA(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function daysBetween(ymdA, ymdB) {
  const a = Date.parse(`${ymdA}T00:00:00Z`);
  const b = Date.parse(`${ymdB}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000));
}

// Maps one Excel row -> { booking, warnings, errors }. Never throws — every
// problem is collected so the dry run can show every row's issues at once,
// instead of stopping at the first row.
function mapRow(row, seq) {
  const warnings = [];
  const errors = [];
  const get = (key) => row[key];

  const customer = String(get("customer") || "").trim();
  const license = String(get("license") || "").trim();
  const contact = String(get("contact") || "").replace(/\D/g, "");
  const plate = String(get("plate") || "").trim();

  if (!customer) errors.push("Customer Name is required");
  if (!license) errors.push("Driving License No. / IC / Passport is required");
  if (contact.length !== 8) warnings.push(`Contact Number is ${contact.length} digits after stripping non-digits, expected 8 (raw: "${get("contact")}")`);
  if (!plate) errors.push("Vehicle Registration Number is required");

  const pickupDate = excelDateToYMD(get("pickupDate"));
  const pickupTime = excelTimeToHM(get("pickupTime")) || "12:00";
  if (!pickupDate) errors.push("Pickup Date is required");

  const pickupLocation = String(get("pickupLocation") || "").trim();
  const dropLocation = String(get("dropLocation") || "").trim();

  const handoverDate = excelDateToYMD(get("handoverDate")) || pickupDate;
  const handoverTime = excelTimeToHM(get("handoverTime")) || pickupTime;

  const origReturnDate = excelDateToYMD(get("returnDate"));
  const origReturnTime = excelTimeToHM(get("returnTime")) || pickupTime;
  if (!origReturnDate) errors.push("Original Return Date is required");

  const extended = yesNo(get("extended"));
  const extReturnDate = extended ? excelDateToYMD(get("extendedReturnDate")) : null;
  if (extended && !extReturnDate) errors.push("Was It Extended? is Yes but Extended Return Date is blank");
  const extReturnTime = origReturnTime; // confirmed default

  const committedEndDate = extended && extReturnDate ? extReturnDate : origReturnDate;
  const committedEndTime = extended && extReturnDate ? extReturnTime : origReturnTime;

  const actualReturnDate = excelDateToYMD(get("actualReturnDate")) || committedEndDate;
  const actualReturnTime = excelTimeToHM(get("actualReturnTime")) || committedEndTime;

  const startingMileage = toNumOrNull(get("startingMileage"));
  const finalOdometer = toNumOrNull(get("finalOdometer"));
  const fuelChargeAmt = toNumOrNull(get("fuelCharge")) || 0;

  const rentalAmount = Number(get("rentalAmount"));
  if (!Number.isFinite(rentalAmount) || rentalAmount <= 0) errors.push("Total Rental Amount must be a positive number");

  let rate = toNumOrNull(get("dailyRate"));
  let rateNote = null;
  if (rate === null) {
    const days = origReturnDate && pickupDate ? daysBetween(pickupDate, origReturnDate) : 1;
    rate = Number.isFinite(rentalAmount) ? Math.round((rentalAmount / days) * 100) / 100 : 0;
    rateNote = `Daily Rate was "${get("dailyRate")}" (not numeric) — computed effective rate ${rate} = ${rentalAmount} / ${days} day(s)`;
    warnings.push(rateNote);
  }

  const deductible = Number(get("deposit")) || 0;
  const depositCollected = yesNo(get("depositCollected"));
  const depositPaid = depositCollected ? deductible : 0;
  const depositCollectedDate = excelDateToYMD(get("depositCollectedDate")) || pickupDate;
  const depositCollectedTime = pickupTime; // confirmed default

  const depositRefunded = yesNo(get("depositRefunded"));
  const depositRefundedAmount = depositRefunded ? depositPaid : 0;
  const depositRefundDate = excelDateToYMD(get("depositRefundDate"));
  const depositRefundTime = pickupTime; // confirmed default
  if (depositRefunded && depositRefundDate && depositRefundDate < pickupDate) {
    warnings.push(`Deposit Refund Date (${depositRefundDate}) is before Pickup Date (${pickupDate}) — check this row`);
  }

  const amountCollected = Number(get("amountCollected")) || 0;
  const paymentMethod = String(get("paymentMethod") || "Cash").trim() || "Cash";
  const paymentDate = excelDateToYMD(get("paymentDate")) || pickupDate;
  const paymentTime = pickupTime; // confirmed default

  const extensionAmountCharged = extended ? (Number(get("extensionAmount")) || 0) : 0;
  const extensionAmountCollected = extended ? (Number(get("extensionCollected")) || 0) : 0;
  const extensionPaymentDate = extended ? (excelDateToYMD(get("extensionPaymentDate")) || committedEndDate) : null;
  const extensionPaymentTime = pickupTime; // confirmed default

  const statusRaw = String(get("status") || "").trim().toLowerCase();
  const cancelled = statusRaw === "cancelled";
  const forceCompleted = statusRaw === "completed";
  if (!statusRaw) warnings.push("Booking Status is blank — imported as a still-open booking");

  const receiptNumberRaw = get("receiptNumber");
  const receiptNumber = isBlank(receiptNumberRaw) ? undefined : String(receiptNumberRaw);

  const remarks = isBlank(get("remarks")) ? undefined : String(get("remarks"));

  const id = `BK-IMPORT-${String(seq).padStart(3, "0")}`; // replaced with the real next id just before insert

  const start = `${pickupDate}T${pickupTime}`;
  const end = committedEndDate ? `${committedEndDate}T${committedEndTime}` : null;
  const actualReturnAt = actualReturnDate ? `${actualReturnDate}T${actualReturnTime}` : null;
  const handoverAt = handoverDate ? `${handoverDate}T${handoverTime}` : null;

  const charges = [];
  if (fuelChargeAmt > 0) {
    charges.push({
      id: `fuel-import-${seq}`, type: "fuel_shortfall", label: "Fuel Charge",
      amount: fuelChargeAmt, taxable: true, origin: "return", addedAt: actualReturnAt, by: "Import",
    });
  }
  if (extended && extensionAmountCharged > 0) {
    const extraDays = origReturnDate && extReturnDate ? daysBetween(origReturnDate, extReturnDate) : null;
    charges.push({
      id: `ext-import-${seq}`, type: "extension_rental",
      label: `Extension Rental${extraDays ? ` (${extraDays} day${extraDays === 1 ? "" : "s"})` : ""}`,
      amount: extensionAmountCharged, taxable: true, origin: "extension", addedAt: extensionPaymentDate ? `${extensionPaymentDate}T${extensionPaymentTime}` : handoverAt, by: "Import",
    });
  }

  const payments = [];
  if (amountCollected > 0) {
    payments.push({
      id: `pay-import-${seq}`, amount: amountCollected, method: paymentMethod, reference: "",
      addedAt: `${paymentDate}T${paymentTime}`, by: "Import",
    });
  }
  if (extended && extensionAmountCollected > 0) {
    payments.push({
      id: `pay-import-ext-${seq}`, amount: extensionAmountCollected, method: paymentMethod, reference: "",
      addedAt: `${extensionPaymentDate}T${extensionPaymentTime}`, by: "Import", origin: "extension",
    });
  }

  const booking = {
    id, plate, customer, ic: license, license, contact, contactCountryCode: "+65",
    start, end, rate, status: cancelled ? "Cancelled" : (forceCompleted ? "Completed" : "Active"),
    cancelled, forceCompleted,
    pickup: pickupLocation, drop: dropLocation,
    handoverAt,
    ...(forceCompleted ? { actualReturnAt, returnedAt: actualReturnAt } : {}),
    startingMileage: startingMileage ?? undefined,
    mileageIn: finalOdometer ?? undefined,
    rentalAmount: String(rentalAmount),
    deductible,
    depositPaid,
    depositCollectedDate, depositCollectedTime, depositCollectedMethod: paymentMethod,
    depositRefunded, depositRefundedAmount,
    ...(depositRefundDate ? { depositRefundedAt: `${depositRefundDate}T${depositRefundTime}` } : {}),
    charges,
    payments,
    receiptNumber,
    comments: remarks,
    createdAt: new Date().toISOString(),
  };

  // The `customers` table (keyed by IC, upserted separately from bookings —
  // see customerModel.upsert) is what the Customers module actually reads.
  // bookingModel.create() only ever writes to `bookings`, so importing a
  // booking alone would leave the customer directory blank for every
  // imported row unless this is upserted too.
  const customerRecord = { ic: license, name: customer, contact };

  return { seq, sourceRow: get("sno"), customer, plate, booking, customerRecord, warnings, errors };
}

const COLUMN_KEYS = [
  "sno", "customer", "license", "contact", "plate", "vehicleBrand", "vehicleModel",
  "pickupDate", "pickupTime", "handoverDate", "handoverTime", "pickupLocation", "dropLocation",
  "returnDate", "returnTime",
  "startingMileage", "finalOdometer", "fuelCharge", "dailyRate", "rentalAmount", "deposit",
  "depositCollected", "depositCollectedDate", "depositRefunded", "depositRefundDate",
  "amountCollected", "paymentMethod", "paymentDate", "extended", "extendedReturnDate",
  "extensionAmount", "extensionCollected", "extensionPaymentDate", "actualReturnDate",
  "actualReturnTime", "status", "receiptNumber", "remarks",
];

async function main() {
  const filePath = process.argv[2];
  const commit = process.argv.includes("--commit");
  if (!filePath) {
    console.error("Usage: node scripts/importOldBookings.js <file.xlsx> [--commit]");
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(filePath));
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) { console.error(`Sheet "${SHEET_NAME}" not found in ${filePath}`); process.exit(1); }

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const raw = ws.getRow(r).values.slice(1);
    if (raw.every(v => v === undefined || v === null || String(v).trim() === "")) continue; // fully blank row
    const obj = {};
    COLUMN_KEYS.forEach((key, i) => { obj[key] = raw[i]; });
    rows.push(obj);
  }

  console.log(`Found ${rows.length} data row(s) in "${SHEET_NAME}".\n`);

  const mapped = rows.map((row, i) => mapRow(row, i + 1));

  // Cross-row checks: every referenced plate must already exist in `cars`.
  const { rows: carRows } = await db.query("SELECT plate FROM cars");
  const knownPlates = new Set(carRows.map(c => c.plate));
  mapped.forEach(m => {
    if (m.booking.plate && !knownPlates.has(m.booking.plate)) {
      m.errors.push(`Vehicle Registration Number "${m.booking.plate}" does not exist in the Fleet (cars table) — add it first`);
    }
  });

  let anyErrors = false;
  for (const m of mapped) {
    console.log(`--- Row ${m.sourceRow ?? "?"}: ${m.customer || "(no name)"} / ${m.plate || "(no plate)"} ---`);
    console.log(JSON.stringify(m.booking, null, 2));
    if (m.warnings.length) m.warnings.forEach(w => console.log(`  WARNING: ${w}`));
    if (m.errors.length) { anyErrors = true; m.errors.forEach(e => console.log(`  ERROR: ${e}`)); }
    console.log("");
  }

  if (anyErrors) {
    console.log("One or more rows have errors — fix them and re-run. Nothing was written.");
    process.exit(1);
  }

  if (!commit) {
    console.log(`Dry run only — ${mapped.length} row(s) look valid. Re-run with --commit to actually insert them.`);
    process.exit(0);
  }

  // Assign real sequential ids right before inserting, based on what's
  // actually in the table at commit time (not at dry-run time).
  const { rows: existing } = await db.query("SELECT id FROM bookings");
  let next = Math.max(0, ...existing.map(b => parseInt((b.id || "").replace(/\D/g, ""), 10) || 0)) + 1;

  for (const m of mapped) {
    m.booking.id = `BK-${String(next).padStart(3, "0")}`;
    next += 1;
    await customerModel.upsert(m.customerRecord);
    const created = await bookingModel.create(m.booking);
    console.log(`Inserted ${created.id} — ${created.customer} / ${created.plate} (customer record upserted)`);
  }

  console.log(`\nDone — inserted ${mapped.length} booking(s) and upserted ${mapped.length} customer record(s).`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
