// Data-access layer for the driving-license blocklist. Maps the snake_case DB
// columns to the camelCase shape the frontend uses.
const db = require("../config/db");

function toEntry(r) {
  if (!r) return null;
  return {
    id: r.id,
    licenseNumber: r.license_number,
    reason: r.reason,
    addedDate: r.added_date,
  };
}

async function getAll() {
  const { rows } = await db.query("SELECT * FROM restricted_licenses ORDER BY created_at DESC");
  return rows.map(toEntry);
}

async function create(entry) {
  const { rows } = await db.query(
    `INSERT INTO restricted_licenses (id, license_number, reason, added_date)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [entry.id, entry.licenseNumber, entry.reason || null, entry.addedDate || null]
  );
  return toEntry(rows[0]);
}

// Partial update via read-merge-write, mirroring the fleet model's approach.
async function update(id, updates) {
  const { rows: cur } = await db.query("SELECT * FROM restricted_licenses WHERE id = $1", [id]);
  if (!cur.length) return null;
  const c = { ...toEntry(cur[0]), ...updates };
  const { rows } = await db.query(
    `UPDATE restricted_licenses
     SET license_number = $2, reason = $3, added_date = $4
     WHERE id = $1
     RETURNING *`,
    [id, c.licenseNumber, c.reason || null, c.addedDate || null]
  );
  return toEntry(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.query("DELETE FROM restricted_licenses WHERE id = $1", [id]);
  return rowCount > 0;
}

module.exports = { getAll, create, update, remove };
