// Request handling for /api/customers.
const Customer = require("../models/customerModel");

async function list(req, res, next) {
  try {
    res.json(await Customer.getAll());
  } catch (err) {
    next(err);
  }
}

// Create-or-update by IC (used by both "Add New Customer" and booking creation).
async function create(req, res, next) {
  try {
    if (!req.body.ic) return res.status(400).json({ message: "IC / ID is required" });
    if (!req.body.name) return res.status(400).json({ message: "Customer name is required" });
    res.status(201).json(await Customer.upsert(req.body));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const customer = await Customer.update(req.params.id, req.body);
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    res.json(customer);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const ok = await Customer.remove(req.params.id);
    if (!ok) return res.status(404).json({ message: "Customer not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
