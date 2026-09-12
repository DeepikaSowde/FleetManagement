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

async function getById(id) {
  const { rows } = await db.query("SELECT * FROM bookings WHERE id = $1", [id]);
  return toBooking(rows[0]);
}

async function create(b) {
  validateMileage(b);
  validateStaffToCustomerKm(b);
  const { details } = split(b);
  const { rows } = await db.query(
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

// Partial update: read the current booking, merge the incoming changes on top,
// and write the whole thing back. Simple and correct for both single-field
// flips (e.g. { cancelled: true }) and full-form edits.
async function update(id, updates) {
  const current = await getById(id);
  if (!current) return null;
  // Checked against the PRE-update record — whether this specific request is
  // allowed to push the return date out depends on the booking's state
  // before this patch, not after it.
  validateExtend(current, updates);
  // Checked on the incoming patch, not the merged record — see
  // validateStaffToCustomerKm's own comment for why.
  validateStaffToCustomerKm(updates);
  const merged = { ...current, ...updates, id };
  // Validated on the MERGED record, not just this patch — a request that
  // only sends customerReturnMileage is still floored against
  // startingMileage/staffToCustomerKm captured at handover, already on file.
  validateMileage(merged);
  const { details } = split(merged);
  const { rows } = await db.query(
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

async function remove(id) {
  const { rowCount } = await db.query("DELETE FROM bookings WHERE id = $1", [id]);
  return rowCount > 0;
}

module.exports = { getAll, getById, create, update, remove };
