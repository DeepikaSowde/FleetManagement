// Data-access layer for cars (the fleet). Maps between the snake_case DB
// columns and the camelCase field names the React frontend expects, so the
// rest of the app works with clean JS objects.
const db = require("../config/db");

// DB row (snake_case) -> frontend car object (camelCase).
function toCar(r) {
  if (!r) return null;
  return {
    plate: r.plate,
    make: r.make,
    model: r.model,
    year: r.year,
    color: r.color,
    purchase: r.purchase === null ? null : Number(r.purchase),
    insurance: r.insurance === null ? null : Number(r.insurance),
    reg: r.reg === null ? null : Number(r.reg),
    otherCharges: r.other_charges === null ? null : Number(r.other_charges),
    purchaseDate: r.purchase_date,
    maint: r.maint === null ? null : Number(r.maint),
    coe: r.coe,
    status: r.status,
    minRate: r.min_rate === null ? null : Number(r.min_rate),
    maxRate: r.max_rate === null ? null : Number(r.max_rate),
    targetRate: r.target_rate === null ? null : Number(r.target_rate),
    runningDaysTarget: r.running_days_target === null ? null : Number(r.running_days_target),
    profitPctTarget: r.profit_pct_target === null ? null : Number(r.profit_pct_target),
    maintenanceStartDate: r.maintenance_start_date,
    maintenanceCompletedAt: r.maintenance_completed_at,
    maintenanceAutoReleased: r.maintenance_auto_released,
  };
}

async function getAll() {
  const { rows } = await db.query("SELECT * FROM cars ORDER BY created_at DESC");
  return rows.map(toCar);
}

async function getByPlate(plate) {
  const { rows } = await db.query("SELECT * FROM cars WHERE plate = $1", [plate]);
  return toCar(rows[0]);
}

async function create(car) {
  const { rows } = await db.query(
    `INSERT INTO cars (
       plate, make, model, year, color, purchase, insurance, reg, other_charges,
       purchase_date, maint, coe, status, min_rate, max_rate, target_rate,
       running_days_target, profit_pct_target, maintenance_start_date,
       maintenance_completed_at, maintenance_auto_released
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
     )
     RETURNING *`,
    [
      car.plate, car.make, car.model, car.year, car.color, car.purchase,
      car.insurance, car.reg, car.otherCharges ?? 0, car.purchaseDate, car.maint,
      car.coe, car.status || "Available", car.minRate ?? null, car.maxRate ?? null,
      car.targetRate ?? null, car.runningDaysTarget ?? null, car.profitPctTarget ?? null,
      car.maintenanceStartDate ?? null, car.maintenanceCompletedAt ?? null,
      car.maintenanceAutoReleased ?? false,
    ]
  );
  return toCar(rows[0]);
}

// Partial update via read-merge-write: fetch the current car, overlay only the
// fields the caller sent, and write the whole row back. This means an update
// like { targetRate: 50 } changes ONLY that field and leaves maintenance dates
// etc. intact — while an explicit { maintenanceStartDate: null } can still
// clear a field on purpose. (A COALESCE-per-column approach can't do both.)
async function update(plate, updates) {
  const current = await getByPlate(plate);
  if (!current) return null;
  const c = { ...current, ...updates };
  const { rows } = await db.query(
    `UPDATE cars SET
       make = $2, model = $3, year = $4, color = $5, purchase = $6, insurance = $7,
       reg = $8, other_charges = $9, purchase_date = $10, maint = $11, coe = $12,
       status = $13, min_rate = $14, max_rate = $15, target_rate = $16,
       running_days_target = $17, profit_pct_target = $18, maintenance_start_date = $19,
       maintenance_completed_at = $20, maintenance_auto_released = $21
     WHERE plate = $1
     RETURNING *`,
    [
      plate, c.make, c.model, c.year, c.color, c.purchase, c.insurance, c.reg,
      c.otherCharges ?? 0, c.purchaseDate, c.maint, c.coe, c.status ?? "Available",
      c.minRate ?? null, c.maxRate ?? null, c.targetRate ?? null,
      c.runningDaysTarget ?? null, c.profitPctTarget ?? null,
      c.maintenanceStartDate ?? null, c.maintenanceCompletedAt ?? null,
      c.maintenanceAutoReleased ?? false,
    ]
  );
  return toCar(rows[0]);
}

async function remove(plate) {
  const { rowCount } = await db.query("DELETE FROM cars WHERE plate = $1", [plate]);
  return rowCount > 0;
}

module.exports = { getAll, getByPlate, create, update, remove, toCar };
