// Request handling for /api/earnings.
const Earning = require("../models/earningModel");

async function list(req, res, next) {
  try {
    res.json(await Earning.getAll());
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    if (!req.body.id) return res.status(400).json({ message: "id is required" });
    res.status(201).json(await Earning.create(req.body));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const earning = await Earning.update(req.params.id, req.body);
    if (!earning) return res.status(404).json({ message: "Earning not found" });
    res.json(earning);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const ok = await Earning.remove(req.params.id);
    if (!ok) return res.status(404).json({ message: "Earning not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
