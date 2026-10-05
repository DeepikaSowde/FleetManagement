// Request handling for /api/investor-transactions.
const InvestorTx = require("../models/investorTxModel");
const Investor = require("../models/investorModel");
const Ownership = require("../models/ownershipModel");

// A frozen Opening investor's First Investment is part of the confirmed
// Opening Ownership — it can't be edited or deleted afterwards.
async function lockedOpeningTx(id) {
  const tx = await InvestorTx.getById(id);
  return !!tx && tx.type === "First Investment" && (await Ownership.isFrozenOpeningInvestor(tx.investorId));
}
const OPENING_TX_LOCKED = "This is a confirmed Opening investment — it is frozen and cannot be changed";

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

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "amount must be a number greater than 0" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date ?? "")) || isNaN(new Date(req.body.date + "T00:00:00Z"))) {
      return res.status(400).json({ message: "date must be a valid date" });
    }
    // First Investment date can't be in the future (one day of slack: the server
    // clock is UTC while staff may already be on tomorrow's date).
    if (req.body.type === "First Investment" && req.body.date > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) {
      return res.status(400).json({ message: "First Investment date cannot be in the future" });
    }

    const tx = await InvestorTx.create(req.body);
    // Completing an Exit / Withdrawal retires the investor: Active -> Inactive.
    // All their investment and exit history stays exactly where it is.
    if (tx.type === "Exit / Withdrawal") {
      await Investor.update(tx.investorId, { status: "Inactive" });
    }
    res.status(201).json(tx);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    if (await lockedOpeningTx(req.params.id)) return res.status(409).json({ message: OPENING_TX_LOCKED });
    const tx = await InvestorTx.update(req.params.id, req.body);
    if (!tx) return res.status(404).json({ message: "Transaction not found" });
    res.json(tx);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    if (await lockedOpeningTx(req.params.id)) return res.status(409).json({ message: OPENING_TX_LOCKED });
    const ok = await InvestorTx.remove(req.params.id);
    if (!ok) return res.status(404).json({ message: "Transaction not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
