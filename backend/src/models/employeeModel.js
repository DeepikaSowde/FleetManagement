// Data-access layer for employees (staff that operations get assigned to).
const db = require("../config/db");

function toEmployee(r) {
  if (!r) return null;
  return { id: r.id, name: r.name, phone: r.phone, role: r.role, active: r.active };
}

async function getAll() {
  const { rows } = await db.query("SELECT * FROM employees ORDER BY name ASC");
  return rows.map(toEmployee);
}

async function getById(id) {
  const { rows } = await db.query("SELECT * FROM employees WHERE id = $1", [id]);
  return toEmployee(rows[0]);
}

async function create(e) {
  const { rows } = await db.query(
    `INSERT INTO employees (name, phone, role, active) VALUES ($1,$2,$3,$4) RETURNING *`,
    [e.name, e.phone ?? null, e.role ?? null, e.active ?? true]
  );
  return toEmployee(rows[0]);
}

async function update(id, updates) {
  const current = await getById(id);
  if (!current) return null;
  const e = { ...current, ...updates };
  const { rows } = await db.query(
    `UPDATE employees SET name = $2, phone = $3, role = $4, active = $5 WHERE id = $1 RETURNING *`,
    [id, e.name, e.phone ?? null, e.role ?? null, e.active ?? true]
  );
  return toEmployee(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.query("DELETE FROM employees WHERE id = $1", [id]);
  return rowCount > 0;
}

module.exports = { getAll, getById, create, update, remove };
