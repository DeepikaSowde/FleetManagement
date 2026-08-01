// Request handling for /api/restricted-licenses (driving-license blocklist).
const RestrictedLicense = require("../models/restrictedLicenseModel");

async function list(req, res, next) {
  try {
    res.json(await RestrictedLicense.getAll());
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    if (!req.body.id) return res.status(400).json({ message: "id is required" });
    if (!req.body.licenseNumber) return res.status(400).json({ message: "licenseNumber is required" });
    res.status(201).json(await RestrictedLicense.create(req.body));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const entry = await RestrictedLicense.update(req.params.id, req.body);
    if (!entry) return res.status(404).json({ message: "Restricted license not found" });
    res.json(entry);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const ok = await RestrictedLicense.remove(req.params.id);
    if (!ok) return res.status(404).json({ message: "Restricted license not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
