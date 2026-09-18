// Request handling for /api/fleet (cars). Thin layer: validate input, call the
// model, return JSON. All SQL lives in fleetModel.
const Fleet = require("../models/fleetModel");

// Money fields that must never be negative — enforced here as well as in the
// frontend forms, so the rule holds even if a request bypasses the UI.
const NON_NEGATIVE_FIELDS = [
  ["purchase", "Purchase Price"], ["purchaseAdvance", "Purchase Advance"],
  ["insurance", "Insurance"], ["reg", "Registration"], ["otherCharges", "Other Charges"],
];
function findNegativeFieldError(body) {
  for (const [key, label] of NON_NEGATIVE_FIELDS) {
    const v = body[key];
    if (v !== undefined && v !== null && v !== "" && Number(v) < 0) {
      return `${label} can't be negative`;
    }
  }
  return null;
}

const DECIMAL_AMOUNT_FIELDS = [
  ["purchase", "Purchase Price"], ["purchaseAdvance", "Purchase Advance"],
  ["insurance", "Insurance"], ["reg", "Registration"], ["otherCharges", "Other Charges"],
];
// Digits, with at most one decimal point and at least one digit on each side
// of it — matches what the Add Car / Edit Car forms already restrict typing
// to (see AddCarWizard.jsx/EditVehicleForm.jsx), so a request that bypasses
// the UI is held to the exact same rule. Rejects letters, symbols, multiple
// dots (e.g. "26.00.50"), and scientific notation.
const DECIMAL_AMOUNT_RE = /^\d+(\.\d+)?$/;
function findInvalidAmountFieldError(body) {
  for (const [key, label] of DECIMAL_AMOUNT_FIELDS) {
    const v = body[key];
    if (v !== undefined && v !== null && v !== "" && !DECIMAL_AMOUNT_RE.test(String(v).trim())) {
      return `${label} must be a valid amount (numbers and up to one decimal point only, e.g. 26000.50)`;
    }
  }
  return null;
}

// Year is exactly 4 digits — no sign, no decimal point, no letters. Kept in
// sync with AddCarWizard.jsx's and EditVehicleForm.jsx's copies of this rule.
const YEAR_RE = /^\d{4}$/;
function findInvalidYearError(body) {
  const v = body.year;
  if (v !== undefined && v !== null && v !== "" && !YEAR_RE.test(String(v).trim())) {
    return "Year must be a 4-digit number";
  }
  return null;
}

async function list(req, res, next) {
  try {
    res.json(await Fleet.getAll());
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { plate, make, model } = req.body;
    if (!plate || !make || !model) {
      return res.status(400).json({ message: "plate, make and model are required" });
    }
    // Singapore plates aren't a fixed digit count — 1-3 letters, 1-4 digits,
    // and an optional trailing check letter (e.g. SKR 2847 A, SGP 1234 X),
    // with or without the spaces shown on the physical plate. Kept in sync
    // with AddCarWizard.jsx's copy of this same check.
    if (!/^[A-Za-z]{1,3}\s?\d{1,4}\s?[A-Za-z]?$/.test(String(plate).trim())) {
      return res.status(400).json({ message: "Enter a valid Singapore plate — 1-3 letters, 1-4 digits, and an optional trailing letter (e.g. SKR 2847 A)" });
    }
    const negativeFieldError = findNegativeFieldError(req.body);
    if (negativeFieldError) {
      return res.status(400).json({ message: negativeFieldError });
    }
    const invalidAmountFieldError = findInvalidAmountFieldError(req.body);
    if (invalidAmountFieldError) {
      return res.status(400).json({ message: invalidAmountFieldError });
    }
    const invalidYearError = findInvalidYearError(req.body);
    if (invalidYearError) {
      return res.status(400).json({ message: invalidYearError });
    }
    // Case/space variations of an already-registered plate are the same
    // plate — the plate column's own uniqueness wouldn't catch that.
    if (await Fleet.findByNormalizedPlate(plate)) {
      return res.status(409).json({ message: "Car Plate already exists" });
    }
    res.status(201).json(await Fleet.create(req.body));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const negativeFieldError = findNegativeFieldError(req.body);
    if (negativeFieldError) {
      return res.status(400).json({ message: negativeFieldError });
    }
    const invalidAmountFieldError = findInvalidAmountFieldError(req.body);
    if (invalidAmountFieldError) {
      return res.status(400).json({ message: invalidAmountFieldError });
    }
    const invalidYearError = findInvalidYearError(req.body);
    if (invalidYearError) {
      return res.status(400).json({ message: invalidYearError });
    }
    const car = await Fleet.update(req.params.plate, req.body);
    if (!car) return res.status(404).json({ message: "Car not found" });
    res.json(car);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const ok = await Fleet.remove(req.params.plate);
    if (!ok) return res.status(404).json({ message: "Car not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
