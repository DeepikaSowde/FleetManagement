// Data-access layer for investor_transactions — the unified dated ledger of
// every money movement for an investor. `type` is Investment | Reinvestment |
// Dividend | Exit | Withdrawal; `flow` (IN|OUT) is derived from type on the
// frontend and stored here for cheap filtering. The six detail tabs in the UI
// are just filtered views of this one table.
const db = require("../config/db");

function toTx(r) {
  if (!r) return null;
  return {
    id: r.id,
    investorId: r.investor_id,
    date: r.date,
    type: r.type,
    flow: r.flow,
    amount: r.amount === null ? null : Number(r.amount),
    description: r.description,
    status: r.status,
  };
}

async function getAll() {
  const { rows } = await db.query("SELECT * FROM investor_transactions ORDER BY date ASC, created_at ASC");
  return rows.map(toTx);
}

async function getById(id) {
  const { rows } = await db.query("SELECT * FROM investor_transactions WHERE id = $1", [id]);
  return toTx(rows[0]);
}

async function create(t) {
  const { rows } = await db.query(
    `INSERT INTO investor_transactions (id, investor_id, date, type, flow, amount, description, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      t.id, t.investorId, t.date ?? null, t.type, t.flow ?? null,
      t.amount ?? 0, t.description ?? null, t.status ?? null,
    ]
  );
  return toTx(rows[0]);
}

// Read-merge-write so a partial update changes only what was sent.
async function update(id, updates) {
  const current = await getById(id);
  if (!current) return null;
  const t = { ...current, ...updates };
  const { rows } = await db.query(
    `UPDATE investor_transactions SET
       investor_id = $2, date = $3, type = $4, flow = $5,
       amount = $6, description = $7, status = $8
     WHERE id = $1
     RETURNING *`,
    [
      id, t.investorId, t.date ?? null, t.type, t.flow ?? null,
      t.amount ?? 0, t.description ?? null, t.status ?? null,
    ]
  );
  return toTx(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.query("DELETE FROM investor_transactions WHERE id = $1", [id]);
  return rowCount > 0;
}

module.exports = { getAll, getById, create, update, remove };
