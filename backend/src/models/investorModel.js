// Data-access layer for investors — one row per investor (their profile). The
// money movements live in investor_transactions (investorTxModel.js).
const db = require("../config/db");

function toInvestor(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    investorSince: r.investor_since,
    pan: r.pan,
    email: r.email,
    phone: r.phone,
    notes: r.notes,
  };
}

async function getAll() {
  const { rows } = await db.query("SELECT * FROM investors ORDER BY created_at ASC");
  return rows.map(toInvestor);
}

async function getById(id) {
  const { rows } = await db.query("SELECT * FROM investors WHERE id = $1", [id]);
  return toInvestor(rows[0]);
}

async function create(i) {
  const { rows } = await db.query(
    `INSERT INTO investors (id, name, status, investor_since, pan, email, phone, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      i.id, i.name, i.status ?? "Active", i.investorSince ?? null,
      i.pan ?? null, i.email ?? null, i.phone ?? null, i.notes ?? null,
    ]
  );
  return toInvestor(rows[0]);
}

// Read-merge-write so a partial update changes only what was sent.
async function update(id, updates) {
  const current = await getById(id);
  if (!current) return null;
  const i = { ...current, ...updates };
  const { rows } = await db.query(
    `UPDATE investors SET
       name = $2, status = $3, investor_since = $4, pan = $5,
       email = $6, phone = $7, notes = $8
     WHERE id = $1
     RETURNING *`,
    [
      id, i.name, i.status ?? "Active", i.investorSince ?? null,
      i.pan ?? null, i.email ?? null, i.phone ?? null, i.notes ?? null,
    ]
  );
  return toInvestor(rows[0]);
}

async function remove(id) {
  // investor_transactions cascade-delete via the FK.
  const { rowCount } = await db.query("DELETE FROM investors WHERE id = $1", [id]);
  return rowCount > 0;
}

module.exports = { getAll, getById, create, update, remove };
