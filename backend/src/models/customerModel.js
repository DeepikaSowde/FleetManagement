// Data-access layer for customers (master records keyed by IC/ID).
const db = require("../config/db");

function toCustomer(r) {
  if (!r) return null;
  return {
    id: r.id,
    ic: r.ic,
    name: r.name,
    contact: r.contact,
    license: r.license,
    customerType: r.customer_type,
    age: r.age,
    drivingExperience: r.driving_experience,
    address: r.address,
  };
}

async function getAll() {
  const { rows } = await db.query("SELECT * FROM customers ORDER BY created_at DESC");
  return rows.map(toCustomer);
}

async function getById(id) {
  const { rows } = await db.query("SELECT * FROM customers WHERE id = $1", [id]);
  return toCustomer(rows[0]);
}

// Upsert by IC — used both by "Add New Customer" and by booking creation. If a
// customer with this IC exists, their details are updated; otherwise created.
// COALESCE keeps an existing value when the incoming field is null, so a
// booking that only knows some fields never wipes richer data already on file.
async function upsert(c) {
  const { rows } = await db.query(
    `INSERT INTO customers (ic, name, contact, license, customer_type, age, driving_experience, address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (ic) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, customers.name),
       contact = COALESCE(EXCLUDED.contact, customers.contact),
       license = COALESCE(EXCLUDED.license, customers.license),
       customer_type = COALESCE(EXCLUDED.customer_type, customers.customer_type),
       age = COALESCE(EXCLUDED.age, customers.age),
       driving_experience = COALESCE(EXCLUDED.driving_experience, customers.driving_experience),
       address = COALESCE(EXCLUDED.address, customers.address)
     RETURNING *`,
    [
      c.ic, c.name, c.contact ?? null, c.license ?? null, c.customerType ?? null,
      c.age ?? null, c.drivingExperience ?? null, c.address ?? null,
    ]
  );
  return toCustomer(rows[0]);
}

// Full update by id (from the Edit form). Read-merge-write so partial updates
// only change what was sent.
async function update(id, updates) {
  const current = await getById(id);
  if (!current) return null;
  const c = { ...current, ...updates };
  const { rows } = await db.query(
    `UPDATE customers SET
       ic = $2, name = $3, contact = $4, license = $5, customer_type = $6,
       age = $7, driving_experience = $8, address = $9
     WHERE id = $1
     RETURNING *`,
    [
      id, c.ic, c.name, c.contact ?? null, c.license ?? null, c.customerType ?? null,
      c.age ?? null, c.drivingExperience ?? null, c.address ?? null,
    ]
  );
  return toCustomer(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.query("DELETE FROM customers WHERE id = $1", [id]);
  return rowCount > 0;
}

module.exports = { getAll, getById, upsert, update, remove };
