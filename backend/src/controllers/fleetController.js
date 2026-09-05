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
    if (!/^[A-Za-z0-9]+$/.test(plate)) {
      return res.status(400).json({ message: "Car Plate can only contain letters and numbers" });
    }
    const negativeFieldError = findNegativeFieldError(req.body);
    if (negativeFieldError) {
      return res.status(400).json({ message: negativeFieldError });
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
