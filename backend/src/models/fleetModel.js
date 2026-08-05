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
    fuelType: r.fuel_type,
    transmission: r.transmission,
    purchase: r.purchase === null ? null : Number(r.purchase),
    insurance: r.insurance === null ? null : Number(r.insurance),
    reg: r.reg === null ? null : Number(r.reg),
    otherCharges: r.other_charges === null ? null : Number(r.other_charges),
    purchaseDate: r.purchase_date,
    insuranceExpiry: r.insurance_expiry,
    ltaTransferDate: r.lta_transfer_date,
    roadTaxExpiry: r.road_tax_expiry,
    inspectionExpiry: r.inspection_expiry,
    maint: r.maint === null ? null : Number(r.maint),
    coe: r.coe,
    status: r.status,
    minRate: r.min_rate === null ? null : Number(r.min_rate),
    maxRate: r.max_rate === null ? null : Number(r.max_rate),
    targetRate: r.target_rate === null ? null : Number(r.target_rate),
    runningDaysTarget: r.running_days_target === null ? null : Number(r.running_days_target),
    profitPctTarget: r.profit_pct_target === null ? null : Number(r.profit_pct_target),
    monthlyForecast: r.monthly_forecast === null ? null : Number(r.monthly_forecast),
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
       plate, make, model, year, color, fuel_type, transmission, purchase, insurance,
       reg, other_charges, purchase_date, insurance_expiry, lta_transfer_date,
       road_tax_expiry, inspection_expiry, maint, coe, status, min_rate, max_rate,
       target_rate, running_days_target, profit_pct_target, monthly_forecast, maintenance_start_date,
       maintenance_completed_at, maintenance_auto_released
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
     )
     RETURNING *`,
    [
      car.plate, car.make, car.model, car.year, car.color, car.fuelType ?? null,
      car.transmission ?? null, car.purchase, car.insurance, car.reg,
      car.otherCharges ?? 0, car.purchaseDate, car.insuranceExpiry ?? null,
      car.ltaTransferDate ?? null, car.roadTaxExpiry ?? null, car.inspectionExpiry ?? null,
      car.maint, car.coe, car.status || "Available", car.minRate ?? null, car.maxRate ?? null,
      car.targetRate ?? null, car.runningDaysTarget ?? null, car.profitPctTarget ?? null,
      car.monthlyForecast ?? null,
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
       make = $2, model = $3, year = $4, color = $5, fuel_type = $6, transmission = $7,
       purchase = $8, insurance = $9, reg = $10, other_charges = $11, purchase_date = $12,
       insurance_expiry = $13, lta_transfer_date = $14, road_tax_expiry = $15,
       inspection_expiry = $16, maint = $17, coe = $18, status = $19, min_rate = $20,
       max_rate = $21, target_rate = $22, running_days_target = $23, profit_pct_target = $24,
       monthly_forecast = $25, maintenance_start_date = $26, maintenance_completed_at = $27,
       maintenance_auto_released = $28
     WHERE plate = $1
     RETURNING *`,
    [
      plate, c.make, c.model, c.year, c.color, c.fuelType ?? null, c.transmission ?? null,
      c.purchase, c.insurance, c.reg, c.otherCharges ?? 0, c.purchaseDate,
      c.insuranceExpiry ?? null, c.ltaTransferDate ?? null, c.roadTaxExpiry ?? null,
      c.inspectionExpiry ?? null, c.maint, c.coe, c.status ?? "Available",
      c.minRate ?? null, c.maxRate ?? null, c.targetRate ?? null,
      c.runningDaysTarget ?? null, c.profitPctTarget ?? null, c.monthlyForecast ?? null,
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
