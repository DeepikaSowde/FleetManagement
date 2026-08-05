// Request handling for /api/employees.
const Employee = require("../models/employeeModel");

async function list(req, res, next) {
  try { res.json(await Employee.getAll()); } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    if (!req.body.name) return res.status(400).json({ message: "Employee name is required" });
    res.status(201).json(await Employee.create(req.body));
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const emp = await Employee.update(req.params.id, req.body);
    if (!emp) return res.status(404).json({ message: "Employee not found" });
    res.json(emp);
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const ok = await Employee.remove(req.params.id);
    if (!ok) return res.status(404).json({ message: "Employee not found" });
    res.status(204).send();
  } catch (err) { next(err); }
}

module.exports = { list, create, update, remove };
