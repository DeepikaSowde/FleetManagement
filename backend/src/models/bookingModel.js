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
  const merged = { ...current, ...updates, id };
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
