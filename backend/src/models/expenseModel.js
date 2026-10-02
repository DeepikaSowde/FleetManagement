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

// `amount` distinguishes "explicitly unknown yet" (null — a Repairs &
// Maintenance expense logged before the actual cost is confirmed) from
// "never sent at all" (undefined — old/other callers that never included the
// field), defaulting only the latter to 0. toExpense() above already reads a
// stored null back out as null; these writes previously collapsed both cases
// to 0 via `?? 0`, which silently discarded a real pending amount on save.
async function create(e) {
  const { rows } = await db.query(
    `INSERT INTO expenses (id, plate, date, category, "desc", amount, receipt)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [e.id, e.plate, e.date, e.category, e.desc ?? "", e.amount === undefined ? 0 : e.amount, e.receipt ?? false]
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
    [id, e.plate, e.date, e.category, e.desc ?? "", e.amount === undefined ? 0 : e.amount, e.receipt ?? false]
  );
  return toExpense(rows[0]);
}

async function remove(id) {
  const { rowCount } = await db.query("DELETE FROM expenses WHERE id = $1", [id]);
  return rowCount > 0;
}

// ── Vehicle Purchase expense — one per car, owned by the server ─────────────
// Every car's all-in acquisition cost is recorded as a single "Vehicle
// Purchase" expense (matched by plate + category). It is written in the same
// transaction as the car itself, so it can't be lost to a failed second
// request or to the user lacking the Expenses permission (e.g. Staff can add
// cars but not expenses — previously the car saved and its expense didn't).
const PURCHASE_CATEGORY = "Vehicle Purchase";

const acquisitionCost = (c) =>
  (Number(c.purchase) || 0) + (Number(c.purchaseAdvance) || 0) +
  (Number(c.insurance) || 0) + (Number(c.reg) || 0) + (Number(c.otherCharges) || 0);

// Next "EX-001"-style id (same format the frontend generates). The advisory
// lock serializes server-side id allocation for the rest of the transaction.
async function nextId(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('expenses.id'))");
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(id, '\\D', '', 'g'), '')::int), 0) + 1 AS n FROM expenses`
  );
  return `EX-${String(rows[0].n).padStart(3, "0")}`;
}

// Creates the car's purchase expense if missing, otherwise brings its amount
// and date in line with the car. `car` is the camelCase car (fleetModel.toCar).
async function syncVehiclePurchase(client, car) {
  const amount = acquisitionCost(car);
  const date = car.purchaseDate || new Date().toISOString().slice(0, 10);
  const { rows } = await client.query(
    "SELECT id FROM expenses WHERE plate = $1 AND category = $2 ORDER BY created_at LIMIT 1",
    [car.plate, PURCHASE_CATEGORY]
  );
  if (rows[0]) {
    await client.query("UPDATE expenses SET amount = $2, date = $3 WHERE id = $1", [rows[0].id, amount, date]);
    return;
  }
  if (amount <= 0) return;
  const desc = `${car.make || ""} ${car.model || ""}`.trim() || "Vehicle acquisition";
  await client.query(
    `INSERT INTO expenses (id, plate, date, category, "desc", amount, receipt) VALUES ($1,$2,$3,$4,$5,$6,false)`,
    [await nextId(client), car.plate, date, PURCHASE_CATEGORY, desc, amount]
  );
}

async function removeVehiclePurchase(client, plate) {
  await client.query("DELETE FROM expenses WHERE plate = $1 AND category = $2", [plate, PURCHASE_CATEGORY]);
}

// Startup self-heal: any car with a cost but no purchase expense (cars added
// before this fix whose expense write failed) gets one. Idempotent.
async function backfillVehiclePurchases(toCar) {
  const { rows } = await db.query(
    `SELECT c.* FROM cars c
     WHERE NOT EXISTS (SELECT 1 FROM expenses e WHERE e.plate = c.plate AND e.category = $1)
     ORDER BY c.created_at`,
    [PURCHASE_CATEGORY]
  );
  for (const r of rows) {
    const car = toCar(r);
    if (acquisitionCost(car) <= 0) continue;
    await db.withTransaction((client) => syncVehiclePurchase(client, car));
    console.log(`Backfilled Vehicle Purchase expense for ${car.plate}`);
  }
}

module.exports = {
  getAll, getById, create, update, remove,
  syncVehiclePurchase, removeVehiclePurchase, backfillVehiclePurchases,
};
