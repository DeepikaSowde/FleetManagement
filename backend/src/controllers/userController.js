// User Management — admin CRUD over the real `users` table (managed users are
// the same rows used for login). Roles are stored lowercase ("admin"/"staff")
// to match auth/JWT, and mapped to the UI's "Admin"/"Staff" on the way out.
const bcrypt = require("bcryptjs");
const User = require("../models/userModel");
const audit = require("../models/auditLogModel");
const { validateName, validateUsername, validatePassword, validateRole } = require("../utils/userValidation");
const { invalidateUserCache } = require("../middleware/auth");

const TAKEN = "This username is already taken";

const toDbRole = (r) => {
  const s = String(r || "").toLowerCase();
  if (s === "admin") return "admin";
  if (s === "investor") return "investor";
  return "staff";
};
const toUiRole = (r) => (r === "admin" ? "Admin" : r === "investor" ? "Investor" : "Staff");

function fmtLastLogin(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d)) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(h)}:${pad(d.getMinutes())} ${ampm}`;
}

function toUiUser(u, req) {
  return {
    id: u.id,
    name: u.name,
    username: u.username || "",
    role: toUiRole(u.role),
    status: u.status || "Active",
    investorId: u.investor_id ?? null,
    lastLogin: fmtLastLogin(u.last_login),
    isYou: !!(req.user && u.id === req.user.id),
  };
}

async function list(req, res, next) {
  try {
    const users = await User.listUsers();
    res.json(users.map((u) => toUiUser(u, req)));
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const { name: rawName, username: rawUsername, role, password, investorId } = req.body;
    // Every field is validated here regardless of what the client already
    // checked — the frontend rules are only for instant feedback.
    const n = validateName(rawName), u = validateUsername(rawUsername), p = validatePassword(password), r = validateRole(role);
    const bad = [n, u, p, r].find((v) => v.error);
    if (bad) return res.status(400).json({ message: bad.error });
    // The username IS the login handle, unique across users, case-insensitively.
    if (await User.findByUsername(u.value)) return res.status(409).json({ message: TAKEN });
    const dbRole = r.value;
    // An Investor login is a view onto one investor's record, so it is
    // meaningless — and is refused — without that link.
    if (dbRole === "investor" && !investorId) {
      return res.status(400).json({ message: "An Investor login must be linked to an investor" });
    }
    const passwordHash = await bcrypt.hash(p.value, 10);
    const created = await User.createUser({
      name: n.value, username: u.value, passwordHash, role: dbRole, status: "Active",
      investorId: dbRole === "investor" ? investorId : null,
    });
    audit.record(req, { module: "User Management", action: "Added", description: `Added ${toUiRole(created.role)} user - ${n.value}` });
    res.status(201).json(toUiUser(created, req));
  } catch (err) {
    // The lower(username) unique index is the backstop for a race between two
    // simultaneous creates that both passed the lookup above.
    if (err.code === "23505") return res.status(409).json({ message: TAKEN });
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { name, username, role, status, password, investorId } = req.body;
    const existing = await User.findById(id);
    if (!existing) return res.status(404).json({ message: "User not found" });
    const updates = {};
    if (name !== undefined) {
      const n = validateName(name);
      if (n.error) return res.status(400).json({ message: n.error });
      updates.name = n.value;
    }
    if (username !== undefined) {
      const handle = String(username).trim();
      // An unchanged handle is left alone so accounts created before these
      // rules existed (e.g. one containing "@") can still be edited; any
      // new or changed handle must satisfy the current rules.
      if (handle !== existing.username) {
        const u = validateUsername(handle);
        if (u.error) return res.status(400).json({ message: u.error });
        const clash = await User.findByUsername(u.value);
        if (clash && clash.id !== id) return res.status(409).json({ message: TAKEN });
        updates.username = u.value;
      }
    }
    if (role !== undefined) {
      const r = validateRole(role);
      if (r.error) return res.status(400).json({ message: r.error });
      if (r.value === "investor" && !investorId) {
        return res.status(400).json({ message: "An Investor login must be linked to an investor" });
      }
      updates.role = r.value;
      updates.investorId = r.value === "investor" ? investorId : null;
    } else if (investorId !== undefined) {
      updates.investorId = investorId;
    }
    if (status !== undefined) updates.status = status;
    if (password) {
      const p = validatePassword(password);
      if (p.error) return res.status(400).json({ message: p.error });
      updates.passwordHash = await bcrypt.hash(p.value, 10);
    }
    const updated = await User.updateUser(id, updates);
    if (!updated) return res.status(404).json({ message: "User not found" });
    invalidateUserCache(id);
    audit.record(req, { module: "User Management", action: "Updated", description: `Updated user - ${updated.name}` });
    res.json(toUiUser(updated, req));
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ message: TAKEN });
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (req.user && id === req.user.id) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }
    const ok = await User.deleteUser(id);
    invalidateUserCache(id);
    if (!ok) return res.status(404).json({ message: "User not found" });
    audit.record(req, { module: "User Management", action: "Deleted", description: `Deleted user #${id}` });
    res.status(204).end();
  } catch (err) { next(err); }
}

module.exports = { list, create, update, remove };
