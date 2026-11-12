// Data-access layer for bookings.
//
// A booking has a handful of "core" fields the app filters and derives status
// on (plate, start, end, rate, cancelled, ...) plus a large, evolving set of
// wizard fields (pricing breakdown, license info, logistics, additional
// drivers...). The core fields are real columns; everything else is stored in
// a JSONB `details` column so the frontend can add fields without a migration.
const db = require("../config/db");

// The fields that live in dedicated columns. Anything on the booking object
// that ISN'T in this list gets folded into the JSONB `details` bag.
const CORE = [
  "id", "plate", "customer", "ic", "contact", "start", "end", "rate",
  "status", "cancelled", "forceCompleted", "maintenanceTriggered",
];

// The Customer Handover Odometer is Starting Mileage + the staff delivery
// leg — one addition, done once. staffToCustomerKm is that leg's own
// distance (e.g. 25 km), never itself a reading to be added again on top of
// the floor — the exact double-count this guards against.
//
// Only checked when a Customer Return Odometer is actually present: a
// booking mid-handover with no return recorded yet has nothing to validate.
// Runs on the merged record (current + incoming patch for an update, or the
// payload as given for a create), so a request that only sends
// customerReturnMileage still gets floored against startingMileage /
// staffToCustomerKm captured earlier at handover.
function validateMileage(record) {
  if (record.customerReturnMileage === undefined || record.customerReturnMileage === null || record.customerReturnMileage === "") {
    return;
  }
  const b = Number(record.customerReturnMileage);
  if (!Number.isFinite(b)) return;
  const startKm = Number(record.startingMileage) || 0;
  const staffKm = Number(record.staffToCustomerKm) || 0;
  const handoverOdo = startKm + staffKm;
  if (b < handoverOdo) {
    const err = new Error(
      `Customer Return ODO must be at least ${handoverOdo} km, which is the Customer Handover ODO ` +
      `(Starting Mileage ${startKm} km + Staff → Customer ${staffKm} km).`
    );
    err.status = 400;
    throw err;
  }
}

// A booking whose vehicle has already come back (or that's cancelled) can't
// have its return date pushed later — that's what extending does, and the
// car isn't with the customer to extend anything. Checked against the
// CURRENT stored record (never the client's own `status` string, which the
// frontend derives live and never reliably persists), so this can't be
// bypassed by calling the API directly instead of going through the UI's own
// Extend gate. Keyed off the date itself, not an "extension" charge, so it
// also catches an extend whose rental amount happens to be 0.
function validateExtend(current, updates) {
  if (updates.end === undefined) return;
  const newEnd = new Date(updates.end).getTime();
  const curEnd = new Date(current.end).getTime();
  if (!Number.isFinite(newEnd) || !Number.isFinite(curEnd) || newEnd <= curEnd) return;

  if (current.cancelled) {
    const err = new Error("Cannot extend a cancelled booking.");
    err.status = 400;
    throw err;
  }
  if (current.mileageIn || current.forceCompleted) {
    const err = new Error("Cannot extend a booking that has already been returned.");
    err.status = 400;
    throw err;
  }
}

const MAX_SANE_STAFF_KM = 500;

// Staff → Customer Mileage is a DISTANCE (the shed-to-customer delivery
// leg), never an odometer reading. Typing what the odometer shows instead of
// the leg's own distance doesn't look wrong at the point it's entered — it
// just quietly sets an impossible floor for Customer Return ODO later (see
// validateMileage above), which only surfaces as a confusing error at
// Vehicle Return, days afterward. Caught here, at the point the value is
// actually set — mirrors the same guard in FleetOpzApp.jsx/Booking.jsx, kept
// as a request-level check (on whatever's actually being written) rather
// than on the merged record, so it doesn't re-trip on an old booking's
// already-bad value every time some unrelated field gets edited.
function validateStaffToCustomerKm(patch) {
  if (patch.staffToCustomerKm === undefined || patch.staffToCustomerKm === null || patch.staffToCustomerKm === "") return;
  const km = Number(patch.staffToCustomerKm);
  if (!Number.isFinite(km) || km <= MAX_SANE_STAFF_KM) return;
  const err = new Error(
    `${km.toLocaleString()} km looks like an odometer reading, not a distance — Staff → Customer Mileage should be how far staff actually drove (e.g., 25), not the odometer value.`
  );
  err.status = 400;
  throw err;
}

// Sane bounds for any single odometer READING (Starting Mileage, Customer
// Return ODO, Final Odometer) — 0 to 999,999,999 km, a real 9-digit odometer
// display. Mirrors mileage.js's MAX_ODOMETER_KM on the frontend; kept as a
// separate literal here since the backend doesn't share ES module imports
// with the frontend bundle.
const MAX_ODOMETER_KM = 999999999;
const ODOMETER_FIELDS = [
  ["startingMileage", "Starting Mileage"],
  ["customerReturnMileage", "Customer Return ODO"],
  ["mileageIn", "Final Odometer"],
];
function validateOdometerBounds(patch) {
  for (const [key, label] of ODOMETER_FIELDS) {
    const v = patch[key];
    if (v === undefined || v === null || v === "") continue;
    const km = Number(v);
    if (!Number.isFinite(km)) continue;
    if (km < 0 || km > MAX_ODOMETER_KM) {
      const err = new Error(`${label} must be between 0 and ${MAX_ODOMETER_KM.toLocaleString()} km.`);
      err.status = 400;
      throw err;
    }
  }
}

// ── Double-booking guard ────────────────────────────────────────────────────
// The New/Edit/Extend Booking forms already check availability in the
// browser, but two staff saving at the same moment each see the car as free.
// So every write that can put a car on a booking re-checks here, inside one
// transaction that first locks the car row(s) (SELECT ... FOR UPDATE) — the
// second save waits for the first to commit and then sees its booking.
//
// A booking can use more than one car over its life (Change Car): the cars it
// used before live in details.carHistory as closed segments, and `plate` is
// the car it has now, from currentCarFrom (or start) onward. Same rules as
// findOverlappingBooking in frontend/src/useFleetData.js:
//   - a returned car frees up at its actual return time (actualReturnAt, or
//     the swap time for an earlier car on a changed booking);
//   - a car that is past its return date and still not back blocks
//     indefinitely, since nobody knows when it will be.
const FAR_FUTURE_MS = 8640000000000000;
const dateOnly = (v) => {
  const d = new Date(v);
  return isNaN(d) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
};

function carSegments(b) {
  const segs = (Array.isArray(b.carHistory) ? b.carHistory : []).map((s) => ({
    plate: s.plate, start: s.from, end: s.to, returned: true,
  }));
  segs.push({
    plate: b.plate,
    start: b.currentCarFrom || b.start,
    end: b.actualReturnAt || b.end,
    returned: !!b.actualReturnAt,
  });
  return segs;
}

function segmentBlockingEnd(seg) {
  if (!seg.end) return null;
  if (!seg.returned && new Date().toISOString().slice(0, 10) > dateOnly(seg.end)) return FAR_FUTURE_MS;
  return new Date(seg.end).getTime();
}

// Returns the first booking (other than excludeId) holding `plate` at any
// point inside [start, end), or null.
async function findConflict(client, plate, start, end, excludeId) {
  if (!plate || !start || !end) return null;
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const { rows } = await client.query(
    `SELECT * FROM bookings
      WHERE cancelled IS NOT TRUE AND id <> $2
        AND (plate = $1 OR details->'carHistory' @> $3::jsonb)`,
    [plate, excludeId || "", JSON.stringify([{ plate }])]
  );
  for (const b of rows.map(toBooking)) {
    for (const seg of carSegments(b)) {
      if (seg.plate !== plate || !seg.start) continue;
      const segEnd = segmentBlockingEnd(seg);
      if (segEnd !== null && from < segEnd && to > new Date(seg.start).getTime()) return b;
    }
  }
  return null;
}

function conflictError(plate, other) {
  const err = new Error(
    `${plate} is not available for these dates — it is already on booking ${other.id}` +
    `${other.customer ? ` (${other.customer})` : ""}. Another user may have just booked it. ` +
    `Refresh and choose different dates or another car.`
  );
  err.status = 409;
  return err;
}

// Locks the given cars' rows for the rest of the transaction. Sorted so two
// transactions locking the same pair always take them in the same order and
// can never deadlock each other.
async function lockCars(client, plates) {
  const unique = [...new Set(plates.filter(Boolean))].sort();
  for (const p of unique) {
    await client.query("SELECT plate FROM cars WHERE plate = $1 FOR UPDATE", [p]);
  }
}

// The window a booking holds its CURRENT car for — from the later of its
// start and its last car change, to its scheduled end.
const currentCarWindow = (b) => [b.currentCarFrom || b.start, b.end];

// Frontend object -> { core values, details bag }
function split(booking) {
  const details = {};
  for (const [k, v] of Object.entries(booking)) {
    if (!CORE.includes(k)) details[k] = v;
  }
  return { details };
}

// DB row -> flat frontend booking object (core columns + spread details).
function toBooking(r) {
  if (!r) return null;
  return {
    id: r.id,
    plate: r.plate,
    customer: r.customer,
    ic: r.ic,
    contact: r.contact,
    start: r.start,
    end: r.end,
    rate: r.rate === null ? null : Number(r.rate),
    status: r.status,
    cancelled: r.cancelled,
    forceCompleted: r.force_completed,
    maintenanceTriggered: r.maintenance_triggered,
    ...(r.details || {}),
  };
}

async function getAll() {
  const { rows } = await db.query("SELECT * FROM bookings ORDER BY created_at ASC");
  return rows.map(toBooking);
}

async function getById(id, client = db, { forUpdate = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM bookings WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
  return toBooking(rows[0]);
}

async function create(b) {
  validateMileage(b);
  validateStaffToCustomerKm(b);
  validateOdometerBounds(b);
  const { details } = split(b);
  return db.withTransaction(async (client) => {
    if (!b.cancelled) {
      await lockCars(client, [b.plate]);
      const [from, to] = currentCarWindow(b);
      const other = await findConflict(client, b.plate, from, to, b.id);
      if (other) throw conflictError(b.plate, other);
    }
    return insertBooking(client, b, details);
  });
}

async function insertBooking(client, b, details) {
  const { rows } = await client.query(
    `INSERT INTO bookings (
       id, plate, customer, ic, contact, start, "end", rate, status,
       cancelled, force_completed, maintenance_triggered, details
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      b.id, b.plate, b.customer, b.ic, b.contact, b.start, b.end, b.rate ?? 0,
      b.status || "Active", b.cancelled ?? false, b.forceCompleted ?? false,
      b.maintenanceTriggered ?? false, JSON.stringify(details),
    ]
  );
  return toBooking(rows[0]);
}

// Fields only Change Car may write — a plain update can't rewrite a booking's
// car history or move its car-change point.
const SWAP_ONLY_FIELDS = ["carHistory", "currentCarFrom"];

// Partial update: read the current booking, merge the incoming changes on top,
// and write the whole thing back. Simple and correct for both single-field
// flips (e.g. { cancelled: true }) and full-form edits.
async function update(id, updates) {
  // Validated up front, outside the transaction — they only look at the patch.
  validateStaffToCustomerKm(updates);
  validateOdometerBounds(updates);
  const patch = { ...updates };
  for (const f of SWAP_ONLY_FIELDS) delete patch[f];

  return db.withTransaction(async (client) => {
    // Lock the plates first (current one read without a lock, then re-read
    // under the booking lock below) so the lock order is always cars, then
    // booking — the same order changeCar uses.
    const peek = await getById(id, client);
    if (!peek) return null;
    await lockCars(client, [peek.plate, patch.plate]);
    const current = await getById(id, client, { forUpdate: true });
    if (!current) return null;
    // Checked against the PRE-update record — whether this specific request is
    // allowed to push the return date out depends on the booking's state
    // before this patch, not after it.
    validateExtend(current, patch);
    // The car is fixed once it's with the customer; swapping it is Change Car's
    // job, which records the return and handover readings for both cars.
    if (patch.plate !== undefined && patch.plate !== current.plate && current.handoverAt) {
      const err = new Error("The car can't be changed by editing a booking that has been handed over. Use Change Car instead.");
      err.status = 400;
      throw err;
    }
    const merged = { ...current, ...patch, id };
    // Validated on the MERGED record, not just this patch — a request that
    // only sends customerReturnMileage is still floored against
    // startingMileage/staffToCustomerKm captured at handover, already on file.
    validateMileage(merged);

    // Re-check availability only when this save moves the car or the dates
    // (or un-cancels) — an unrelated edit must never fail on an old clash.
    const movesCar = ["plate", "start", "end"].some((f) => patch[f] !== undefined && patch[f] !== current[f])
      || (current.cancelled && patch.cancelled === false);
    if (movesCar && !merged.cancelled && !merged.actualReturnAt) {
      const [from, to] = currentCarWindow(merged);
      const other = await findConflict(client, merged.plate, from, to, id);
      if (other) throw conflictError(merged.plate, other);
    }
    return writeBooking(client, id, merged);
  });
}

async function writeBooking(client, id, merged) {
  const { details } = split(merged);
  const { rows } = await client.query(
    `UPDATE bookings SET
       plate = $2, customer = $3, ic = $4, contact = $5, start = $6, "end" = $7,
       rate = $8, status = $9, cancelled = $10, force_completed = $11,
       maintenance_triggered = $12, details = $13
     WHERE id = $1
     RETURNING *`,
    [
      id, merged.plate, merged.customer, merged.ic, merged.contact, merged.start,
      merged.end, merged.rate ?? 0, merged.status, merged.cancelled ?? false,
      merged.forceCompleted ?? false, merged.maintenanceTriggered ?? false,
      JSON.stringify(details),
    ]
  );
  return toBooking(rows[0]);
}

// ── Change Car ──────────────────────────────────────────────────────────────
// Swaps the car on a booking that's out with the customer: the current car is
// returned (closed off as a carHistory segment, with its return readings), and
// the new car is handed over from `swapAt` to the booking's end. Everything —
// the history, the new car, any charges/payments/deposit top-up collected at
// the swap — is one write in one transaction, after locking both cars, so a
// half-done swap can't exist and nobody else can book the new car meanwhile.
//
// The prices themselves are worked out on the frontend (carSwap.js — the same
// screen shows them before saving); here they're only checked for shape.
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const num = (v) => (isBlank(v) ? NaN : Number(v));

function cleanSwapCharges(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw badRequest("charges must be a list.");
  return list.map((c) => {
    const amount = num(c?.amount);
    if (!Number.isFinite(amount) || amount === 0) throw badRequest("Each swap charge needs a non-zero amount.");
    if (isBlank(c.label)) throw badRequest("Each swap charge needs a label.");
    return { ...c, amount, taxable: !!c.taxable, origin: "swap" };
  });
}

function cleanSwapPayments(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw badRequest("payments must be a list.");
  return list.map((p) => {
    const amount = num(p?.amount);
    if (!Number.isFinite(amount) || amount === 0) throw badRequest("Each swap payment needs a non-zero amount.");
    if (isBlank(p.method)) throw badRequest("Each swap payment needs a payment method.");
    return { ...p, amount };
  });
}

// The real moment of a swap, for comparing with "now". swapAt is local
// wall-clock time with no zone ("2026-11-12T15:20", as every booking time is
// stored), and this server may run in a different zone (UTC on a cloud host),
// so reading it here would shift it by the zone difference — an afternoon
// swap in Singapore would look hours in the future. The browser sends the
// exact moment as swapAtUtc; it is used when it names the same wall-clock
// time give or take a time-zone offset (UTC−12 to UTC+14). Without it, the
// earliest moment that wall-clock time can be anywhere (UTC+14) is used, so
// a real past or present swap is never refused.
function swapInstantMs(swapAt, swapAtUtc) {
  const wallAsUtc = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(swapAt) ? swapAt : `${swapAt}Z`).getTime();
  const sent = isBlank(swapAtUtc) ? NaN : new Date(String(swapAtUtc)).getTime();
  const HOUR = 3600000;
  if (Number.isFinite(sent) && sent >= wallAsUtc - 14 * HOUR && sent <= wallAsUtc + 12 * HOUR) return sent;
  return wallAsUtc - 14 * HOUR;
}

async function changeCar(id, body, actor) {
  const newPlate = String(body.newPlate || "").trim();
  if (!newPlate) throw badRequest("Choose the new car.");
  const swapAt = String(body.swapAt || "");
  const swapMs = new Date(swapAt).getTime();
  if (!Number.isFinite(swapMs)) throw badRequest("Enter a valid swap date and time.");
  // No planned swaps: the swap is recorded when it happens (a few minutes'
  // grace for clock differences between the browser and the server).
  if (swapInstantMs(swapAt, body.swapAtUtc) > Date.now() + 15 * 60000) throw badRequest("The swap time can't be in the future.");

  const oldReturnOdo = num(body.oldReturnOdo);
  const newStartOdo = num(body.newStartOdo);
  if (!Number.isFinite(oldReturnOdo)) throw badRequest("Enter the old car's odometer at return.");
  if (!Number.isFinite(newStartOdo)) throw badRequest("Enter the new car's odometer at handover.");
  for (const km of [oldReturnOdo, newStartOdo]) {
    if (km < 0 || km > MAX_ODOMETER_KM) throw badRequest(`Odometer readings must be between 0 and ${MAX_ODOMETER_KM.toLocaleString()} km.`);
  }
  if (isBlank(body.oldReturnFuel)) throw badRequest("Enter the old car's fuel level at return.");
  if (isBlank(body.newStartFuel)) throw badRequest("Enter the new car's fuel level at handover.");
  const rateMode = body.rateMode === "new" ? "new" : "same";
  const newRate = num(body.newRate);
  if (rateMode === "new" && !(Number.isFinite(newRate) && newRate >= 0)) throw badRequest("Enter the new car's rate.");
  const charges = cleanSwapCharges(body.charges);
  const payments = cleanSwapPayments(body.payments);
  const topUp = isBlank(body.depositTopUp) ? 0 : num(body.depositTopUp);
  if (!Number.isFinite(topUp) || topUp < 0) throw badRequest("Deposit top-up can't be negative.");

  return db.withTransaction(async (client) => {
    const peek = await getById(id, client);
    if (!peek) return null;
    if (peek.plate === newPlate) throw badRequest("The new car must be different from the current car.");
    await lockCars(client, [peek.plate, newPlate]);
    const current = await getById(id, client, { forUpdate: true });
    if (!current) return null;
    if (current.plate !== peek.plate) {
      const err = new Error("This booking's car was just changed by someone else. Refresh and try again.");
      err.status = 409;
      throw err;
    }

    if (current.cancelled) throw badRequest("A cancelled booking can't change car.");
    if (!current.handoverAt) throw badRequest("The car can only be changed after Vehicle Handover. Before that, edit the booking instead.");
    if (current.actualReturnAt || current.forceCompleted || !isBlank(current.mileageIn)) {
      throw badRequest("This booking's car has already been returned.");
    }
    const segFrom = current.currentCarFrom || current.start;
    if (swapMs < new Date(segFrom).getTime()) {
      throw badRequest("The swap time can't be before the current car was handed over on this booking.");
    }
    if (swapMs >= new Date(current.end).getTime()) {
      throw badRequest("The swap time must be before the booking's return date. Extend the booking first.");
    }
    const handoverOdo = (Number(current.startingMileage) || 0) + (Number(current.staffToCustomerKm) || 0);
    if (oldReturnOdo < handoverOdo) {
      throw badRequest(`The old car's return odometer must be at least ${handoverOdo} km (its odometer at handover).`);
    }

    const { rows: carRows } = await client.query("SELECT plate, status, coe, insurance_expiry FROM cars WHERE plate = $1", [newPlate]);
    const car = carRows[0];
    if (!car) throw badRequest(`Car ${newPlate} doesn't exist.`);
    if (car.status === "Maintenance") throw badRequest(`${newPlate} is under maintenance.`);
    const today = new Date().toISOString().slice(0, 10);
    if ((car.coe && car.coe < today) || (car.insurance_expiry && car.insurance_expiry < today)) {
      throw badRequest(`${newPlate} can't be used because its COE/Insurance has expired.`);
    }
    const other = await findConflict(client, newPlate, swapAt, current.end, id);
    if (other) throw conflictError(newPlate, other);

    const segment = {
      swapId: isBlank(body.swapId) ? `SW-${Date.now()}` : String(body.swapId),
      plate: current.plate,
      from: segFrom,
      to: swapAt,
      startOdo: isBlank(current.startingMileage) ? null : Number(current.startingMileage),
      staffKm: Number(current.staffToCustomerKm) || 0,
      endOdo: oldReturnOdo,
      startFuel: current.fuelLevel || null,
      endFuel: body.oldReturnFuel,
      rate: Number(current.rate) || 0,
      days: Number.isFinite(num(body.oldDays)) ? num(body.oldDays) : null,
      rentalShare: Number.isFinite(num(body.oldRentalShare)) ? num(body.oldRentalShare) : null,
      rateMode,
      reason: isBlank(body.reason) ? null : String(body.reason).trim(),
      approvedBy: isBlank(body.approvedBy) ? null : String(body.approvedBy).trim(),
      depositTopUp: topUp > 0 ? topUp : null,
      depositTopUpMethod: topUp > 0 && !isBlank(body.depositTopUpMethod) ? String(body.depositTopUpMethod) : null,
      depositTopUpReference: topUp > 0 && !isBlank(body.depositTopUpReference) ? String(body.depositTopUpReference) : null,
      changedBy: actor || null,
      changedAt: new Date().toISOString(),
    };
    const merged = {
      ...current,
      plate: newPlate,
      currentCarFrom: swapAt,
      startingMileage: newStartOdo,
      staffToCustomerKm: 0,
      fuelLevel: body.newStartFuel,
      carHistory: [...(Array.isArray(current.carHistory) ? current.carHistory : []), segment],
      charges: [...(current.charges || []), ...charges],
      payments: payments.length ? [...(current.payments || []), ...payments] : current.payments,
      history: body.historyEntry ? [...(current.history || []), body.historyEntry] : current.history,
    };
    if (rateMode === "new") merged.rate = newRate;
    if (Array.isArray(body.rentSchedule)) merged.rentSchedule = body.rentSchedule;
    if (topUp > 0) {
      const agreed = Number(current.deductible) || 0;
      const paid = isBlank(current.depositPaid) ? (current.depositCollected ? agreed : 0) : Number(current.depositPaid) || 0;
      merged.deductible = agreed + topUp;
      merged.depositPaid = paid + topUp;
    }
    return writeBooking(client, id, merged);
  });
}

async function remove(id) {
  const { rowCount } = await db.query("DELETE FROM bookings WHERE id = $1", [id]);
  return rowCount > 0;
}

// True when any booking uses (or used) this car — deleting the car would
// otherwise take those bookings with it (ON DELETE CASCADE) or orphan their
// history.
async function plateHasBookings(client, plate) {
  const { rows } = await client.query(
    `SELECT 1 FROM bookings WHERE plate = $1 OR details->'carHistory' @> $2::jsonb LIMIT 1`,
    [plate, JSON.stringify([{ plate }])]
  );
  return rows.length > 0;
}

module.exports = { getAll, getById, create, update, changeCar, remove, plateHasBookings };
