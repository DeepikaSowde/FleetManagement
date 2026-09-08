// User Management — admin CRUD over the real `users` table (managed users are
// the same rows used for login). Roles are stored lowercase ("admin"/"staff")
// to match auth/JWT, and mapped to the UI's "Admin"/"Staff" on the way out.
const bcrypt = require("bcryptjs");
const User = require("../models/userModel");
const audit = require("../models/auditLogModel");

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
    const { name, username: rawUsername, role, password, investorId } = req.body;
    const username = String(rawUsername || "").trim();
    if (!name || !username || !password) {
      return res.status(400).json({ message: "name, username and password are required" });
    }
    // The username IS the login handle, and it has to be unique across users.
    if (await User.findByUsername(username)) {
      return res.status(409).json({ message: "This username is already taken" });
    }
    const dbRole = toDbRole(role);
    // An Investor login is a view onto one investor's record, so it is
    // meaningless — and is refused — without that link.
    if (dbRole === "investor" && !investorId) {
      return res.status(400).json({ message: "An Investor login must be linked to an investor" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await User.createUser({
      name, username, passwordHash, role: dbRole, status: "Active",
      investorId: dbRole === "investor" ? investorId : null,
    });
    audit.record(req, { module: "User Management", action: "Added", description: `Added ${toUiRole(created.role)} user - ${name}` });
    res.status(201).json(toUiUser(created, req));
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { name, username, role, status, password, investorId } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (username !== undefined) {
      const handle = String(username).trim();
      if (!handle) return res.status(400).json({ message: "username cannot be empty" });
      // Renaming is fine as long as the handle isn't already on another user.
      const clash = await User.findByUsername(handle);
      if (clash && clash.id !== id) {
        return res.status(409).json({ message: "This username is already taken" });
      }
      updates.username = handle;
    }
    if (role !== undefined) {
      const dbRole = toDbRole(role);
      if (dbRole === "investor" && !investorId) {
        return res.status(400).json({ message: "An Investor login must be linked to an investor" });
      }
      updates.role = dbRole;
      updates.investorId = dbRole === "investor" ? investorId : null;
    } else if (investorId !== undefined) {
      updates.investorId = investorId;
    }
    if (status !== undefined) updates.status = status;
    if (password) updates.passwordHash = await bcrypt.hash(password, 10);
    const updated = await User.updateUser(id, updates);
    if (!updated) return res.status(404).json({ message: "User not found" });
    audit.record(req, { module: "User Management", action: "Updated", description: `Updated user - ${updated.name}` });
    res.json(toUiUser(updated, req));
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (req.user && id === req.user.id) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }
    const ok = await User.deleteUser(id);
    if (!ok) return res.status(404).json({ message: "User not found" });
    audit.record(req, { module: "User Management", action: "Deleted", description: `Deleted user #${id}` });
    res.status(204).end();
  } catch (err) { next(err); }
}

module.exports = { list, create, update, remove };
