// Request handling for /api/investor-transactions.
const InvestorTx = require("../models/investorTxModel");

async function list(req, res, next) {
  try {
    res.json(await InvestorTx.getAll());
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    if (!req.body.id) return res.status(400).json({ message: "id is required" });
    if (!req.body.investorId) return res.status(400).json({ message: "investorId is required" });
    if (!req.body.type) return res.status(400).json({ message: "type is required" });
    res.status(201).json(await InvestorTx.create(req.body));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const tx = await InvestorTx.update(req.params.id, req.body);
    if (!tx) return res.status(404).json({ message: "Transaction not found" });
    res.json(tx);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const ok = await InvestorTx.remove(req.params.id);
    if (!ok) return res.status(404).json({ message: "Transaction not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
