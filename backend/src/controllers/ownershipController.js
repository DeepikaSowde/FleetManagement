// Request handling for /api/ownership — the cap table and its sign-off flow.
// Model-level validation failures already carry an HTTP status, so they fall
// through to the shared error handler with a usable message.
const Ownership = require("../models/ownershipModel");
const Settings = require("../models/settingsModel");
const AuditLog = require("../models/auditLogModel");

const todayIso = () => new Date().toISOString().slice(0, 10);

// Summarises a holdings table for the audit trail, e.g. "A 40%, B 24%".
function describeHoldings(holdings) {
  return (holdings || [])
    .map((h) => (h.investorName || h.investorId) + " " + Number(h.pct).toFixed(2) + "%")
    .join(", ");
}

async function list(req, res, next) {
  try {
    res.json(await Ownership.getAll());
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const evt = await Ownership.getById(req.params.id);
    if (!evt) return res.status(404).json({ message: "Ownership event not found" });
    res.json(evt);
  } catch (err) {
    next(err);
  }
}

// GET /api/ownership/holdings?asOf=YYYY-MM-DD — the table in force on a date.
// Dividend splits should always read this with the declaration's record date,
// so a payout is divided the way ownership stood then, not the way it stands
// today.
async function holdings(req, res, next) {
  try {
    const asOf = req.query.asOf || todayIso();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return res.status(400).json({ message: "asOf must be an ISO date (YYYY-MM-DD)" });
    }
    res.json(await Ownership.holdingsAsOf(asOf));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const actor = req.user?.name || req.user?.username || req.user?.email || null;
    const evt = await Ownership.create(req.body, actor);
    AuditLog.record(req, {
      module: "Investors",
      action: "Create",
      description:
        "Drafted " + evt.type + " ownership event " + evt.id + " effective " + evt.effectiveDate +
        " — " + describeHoldings(req.body.holdings),
    });
    res.status(201).json(await Ownership.getById(evt.id));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const evt = await Ownership.update(req.params.id, req.body);
    if (!evt) return res.status(404).json({ message: "Ownership event not found" });
    AuditLog.record(req, {
      module: "Investors",
      action: "Edit",
      description: "Edited draft ownership event " + evt.id,
    });
    res.json(await Ownership.getById(evt.id));
  } catch (err) {
    next(err);
  }
}

// Draft → Pending, seeding the approval list.
async function submit(req, res, next) {
  try {
    const evt = await Ownership.submit(req.params.id);
    if (!evt) return res.status(404).json({ message: "Ownership event not found" });
    AuditLog.record(req, {
      module: "Investors",
      action: "Edit",
      description: "Sent ownership event " + evt.id + " to investors for approval",
    });
    res.json(await Ownership.getById(evt.id));
  } catch (err) {
    next(err);
  }
}

// One investor accepting or rejecting a pending change.
async function decide(req, res, next) {
  try {
    const { investorId, decision, note } = req.body;
    if (!investorId) return res.status(400).json({ message: "investorId is required" });

    const evt = await Ownership.decide(req.params.id, investorId, decision, note);
    if (!evt) return res.status(404).json({ message: "Ownership event not found" });
    AuditLog.record(req, {
      module: "Investors",
      action: "Edit",
      description: investorId + " " + decision.toLowerCase() + " ownership event " + req.params.id,
    });
    res.json(evt);
  } catch (err) {
    next(err);
  }
}

// → Effective. From here the table is history and can only be superseded.
async function publish(req, res, next) {
  try {
    const evt = await Ownership.publish(req.params.id, { attestation: req.body?.attestation });
    if (!evt) return res.status(404).json({ message: "Ownership event not found" });

    const full = await Ownership.getById(evt.id);
    AuditLog.record(req, {
      module: "Investors",
      action: "Edit",
      description:
        "Published ownership event " + evt.id + " effective " + evt.effectiveDate +
        " — cap table now " + describeHoldings(full.holdings),
    });
    res.json(full);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const ok = await Ownership.remove(req.params.id);
    if (!ok) return res.status(404).json({ message: "Ownership event not found" });
    AuditLog.record(req, {
      module: "Investors",
      action: "Delete",
      description: "Discarded unpublished ownership event " + req.params.id,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// GET/PUT the approval mode, so a customer can run the module with no sign-off
// at all, with an offline attestation, or with full investor sign-off.
async function getSettings(req, res, next) {
  try {
    res.json({
      approvalMode: await Settings.get("ownership_approval_mode"),
      approvalModes: Ownership.APPROVAL_MODES,
      eventTypes: Ownership.EVENT_TYPES,
    });
  } catch (err) {
    next(err);
  }
}

async function updateSettings(req, res, next) {
  try {
    const { approvalMode } = req.body;
    if (!Ownership.APPROVAL_MODES.includes(approvalMode)) {
      return res.status(400).json({
        message: "approvalMode must be one of: " + Ownership.APPROVAL_MODES.join(", "),
      });
    }
    await Settings.set("ownership_approval_mode", approvalMode);
    AuditLog.record(req, {
      module: "Investors",
      action: "Edit",
      description: "Set ownership approval mode to " + approvalMode,
    });
    res.json({ approvalMode });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list, getOne, holdings, create, update, submit, decide, publish, remove,
  getSettings, updateSettings,
};
