// User Management — admin CRUD over the real `users` table (managed users are
// the same rows used for login). Roles are stored lowercase ("admin"/"staff")
// to match auth/JWT, and mapped to the UI's "Admin"/"Staff" on the way out.
const bcrypt = require("bcryptjs");
const User = require("../models/userModel");
const audit = require("../models/auditLogModel");

const toDbRole = (r) => (/admin/i.test(r || "") ? "admin" : "staff");
const toUiRole = (r) => (r === "admin" ? "Admin" : "Staff");

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
    email: u.email || u.username || "",
    role: toUiRole(u.role),
    status: u.status || "Active",
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
    const { name, email, role, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email and password are required" });
    }
    // Managed users log in with their email as the username handle.
    const username = String(email).trim();
    if (await User.findByUsername(username)) {
      return res.status(409).json({ message: "A user with this email already exists" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await User.createUser({
      name, username, email: username, passwordHash, role: toDbRole(role), status: "Active",
    });
    audit.record(req, { module: "User Management", action: "Added", description: `Added ${toUiRole(created.role)} user - ${name}` });
    res.status(201).json(toUiUser(created, req));
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { name, email, role, status, password } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = String(email).trim();
    if (role !== undefined) updates.role = toDbRole(role);
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
