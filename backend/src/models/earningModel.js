// Data-access layer for earnings (revenue records auto-created when a booking
// completes, plus any manually added ones).
const db = require("../config/db");

function toEarning(r) {
  if (!r) return null;
  return {
    id: r.id,
    bookingId: r.booking_id,
    plate: r.plate,
    customer: r.customer,
    start: r.start,
    end: r.end,
    days: r.days,
    rate: r.rate === null ? null : Number(r.rate),
    total: r.total === null ? null : Number(r.total),
    locked: r.locked,
  };
}

async function getAll() {
  const { rows } = await db.query("SELECT * FROM earnings ORDER BY created_at ASC");
  return rows.map(toEarning);
}

async function getById(id) {
  const { rows } = await db.query("SELECT * FROM earnings WHERE id = $1", [id]);
  return toEarning(rows[0]);
}

async function create(e) {
  const { rows } = await db.query(
    `INSERT INTO earnings (id, booking_id, plate, customer, start, "end", days, rate, total, locked)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      e.id, e.bookingId ?? null, e.plate, e.customer, e.start, e.end,
      e.days ?? 0, e.rate ?? 0, e.total ?? 0, e.locked ?? false,
    ]
  );
  return toEarning(rows[0]);
}

// Read-merge-write so a partial update (e.g. { locked: true }) changes only
// what was sent and can still set a boolean back to false when intended.
async function update(id, updates) {
  const current = await getById(id);
  if (!current) return null;
  const e = { ...current, ...updates };
  const { rows } = await db.query(
    `UPDATE earnings SET
       booking_id = $2, plate = $3, customer = $4, start = $5, "end" = $6,
       days = $7, rate = $8, total = $9, locked = $10
     WHERE id = $1
     RETURNING *`,
    [
      id, e.bookingId ?? null, e.plate, e.customer, e.start, e.end,
      e.days ?? 0, e.rate ?? 0, e.total ?? 0, e.locked ?? false,
    ]
  );
  return toEarning(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.query("DELETE FROM earnings WHERE id = $1", [id]);
  return rowCount > 0;
}

module.exports = { getAll, getById, create, update, remove };
