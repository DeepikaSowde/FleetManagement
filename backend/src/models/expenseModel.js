// Data-access layer for expenses (fuel, servicing, fines, etc. per car).
const db = require("../config/db");

function toExpense(r) {
  if (!r) return null;
  return {
    id: r.id,
    plate: r.plate,
    date: r.date,
    category: r.category,
    desc: r.desc,
    amount: r.amount === null ? null : Number(r.amount),
    receipt: r.receipt,
  };
}

async function getAll() {
  const { rows } = await db.query("SELECT * FROM expenses ORDER BY created_at ASC");
  return rows.map(toExpense);
}

async function getById(id) {
  const { rows } = await db.query("SELECT * FROM expenses WHERE id = $1", [id]);
  return toExpense(rows[0]);
}

async function create(e) {
  const { rows } = await db.query(
    `INSERT INTO expenses (id, plate, date, category, "desc", amount, receipt)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [e.id, e.plate, e.date, e.category, e.desc ?? "", e.amount ?? 0, e.receipt ?? false]
  );
  return toExpense(rows[0]);
}

// Read-merge-write so partial updates change only what was sent.
async function update(id, updates) {
  const current = await getById(id);
  if (!current) return null;
  const e = { ...current, ...updates };
  const { rows } = await db.query(
    `UPDATE expenses SET
       plate = $2, date = $3, category = $4, "desc" = $5, amount = $6, receipt = $7
     WHERE id = $1
     RETURNING *`,
    [id, e.plate, e.date, e.category, e.desc ?? "", e.amount ?? 0, e.receipt ?? false]
  );
  return toExpense(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.query("DELETE FROM expenses WHERE id = $1", [id]);
  return rowCount > 0;
}

module.exports = { getAll, getById, create, update, remove };
