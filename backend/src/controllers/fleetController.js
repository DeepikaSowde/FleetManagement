// Request handling for /api/fleet (cars). Thin layer: validate input, call the
// model, return JSON. All SQL lives in fleetModel.
const Fleet = require("../models/fleetModel");

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
    res.status(201).json(await Fleet.create(req.body));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
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
