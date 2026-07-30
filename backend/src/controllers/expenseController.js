// Request handling for /api/expenses.
const Expense = require("../models/expenseModel");

async function list(req, res, next) {
  try {
    res.json(await Expense.getAll());
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    if (!req.body.id) return res.status(400).json({ message: "id is required" });
    res.status(201).json(await Expense.create(req.body));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const expense = await Expense.update(req.params.id, req.body);
    if (!expense) return res.status(404).json({ message: "Expense not found" });
    res.json(expense);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const ok = await Expense.remove(req.params.id);
    if (!ok) return res.status(404).json({ message: "Expense not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
