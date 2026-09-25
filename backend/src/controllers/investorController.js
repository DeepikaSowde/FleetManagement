// Request handling for /api/investors.
const Investor = require("../models/investorModel");
const Ownership = require("../models/ownershipModel");

async function list(req, res, next) {
  try {
    // An Exit dated in the future takes effect on its date: flip anyone whose
    // Exit has now arrived to Inactive before the list goes out.
    await Ownership.applyDueExits();
    res.json(await Investor.getAll());
  } catch (err) {
    next(err);
  }
}

// Investor Name: letters and spaces only.
const NAME_RE = /^[A-Za-z ]+$/;

// A YYYY-MM-DD that is a real calendar date and not in the future. One day of
// slack is allowed because the server clock is UTC while staff may be ahead of
// it (Singapore is UTC+8), so "today" locally can already be tomorrow in UTC.
function dateError(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(new Date(value + "T00:00:00Z"))) {
    return label + " must be a valid date";
  }
  const limit = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (value > limit) return label + " cannot be in the future";
  return null;
}

function nameError(name) {
  if (!name) return "Investor Name is required";
  if (!NAME_RE.test(name)) return "Investor Name can contain letters and spaces only";
  return null;
}

// The next ID the form should display. It is only a preview — nothing is used
// up until the investor is actually saved.
async function nextId(req, res, next) {
  try {
    res.json({ id: await Investor.peekNextId() });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const name = String(req.body.name ?? "").trim();
    const problem =
      nameError(name) ||
      (req.body.investorSince ? dateError(req.body.investorSince, "Investor Since") : null) ||
      (req.body.status && !["Active", "Inactive"].includes(req.body.status) ? "status must be Active or Inactive" : null);
    if (problem) return res.status(400).json({ message: problem });
    // Any id / investorCode the client sent is ignored — the server assigns it.
    res.status(201).json(await Investor.create({ ...req.body, name }));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    // The Investor ID is permanent: it can never be changed after it's assigned.
    const { id: _id, investorCode: _code, ...changes } = req.body;
    if (changes.name !== undefined) {
      changes.name = String(changes.name).trim();
      const problem = nameError(changes.name);
      if (problem) return res.status(400).json({ message: problem });
    }
    const investor = await Investor.update(req.params.id, changes);
    if (!investor) return res.status(404).json({ message: "Investor not found" });
    res.json(investor);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    // Someone named in a published cap table is part of the ownership record.
    // Deleting them would leave past events unable to total 100%, so mark them
    // Inactive instead. (The FK would refuse anyway; this explains why.)
    if (await Ownership.investorIsInCapTable(req.params.id)) {
      return res.status(409).json({
        message:
          "This investor appears in a published cap table and cannot be deleted. " +
          "Set their status to Inactive, or record an Exit event first.",
      });
    }

    const ok = await Investor.remove(req.params.id);
    if (!ok) return res.status(404).json({ message: "Investor not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, nextId, create, update, remove };
