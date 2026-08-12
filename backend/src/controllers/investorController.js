// Request handling for /api/investors.
const Investor = require("../models/investorModel");

async function list(req, res, next) {
  try {
    res.json(await Investor.getAll());
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    if (!req.body.id) return res.status(400).json({ message: "id is required" });
    if (!req.body.name) return res.status(400).json({ message: "name is required" });
    res.status(201).json(await Investor.create(req.body));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const investor = await Investor.update(req.params.id, req.body);
    if (!investor) return res.status(404).json({ message: "Investor not found" });
    res.json(investor);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const ok = await Investor.remove(req.params.id);
    if (!ok) return res.status(404).json({ message: "Investor not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
