// Handles registration, login, and "who am I". Controllers read the request,
// call the model, and shape the response — they don't run SQL themselves.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const audit = require("../models/auditLogModel");

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, investorId: user.investor_id ?? user.investorId ?? null },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

async function register(req, res, next) {
  try {
    const { name, username, password, role, investorId } = req.body;
    if (!name || !username || !password) {
      return res.status(400).json({ message: "name, username and password are required" });
    }
    const existing = await User.findByUsername(username);
    if (existing) {
      return res.status(409).json({ message: "Username already taken" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    // An investor login is meaningless without the investor it belongs to.
    if (String(role).toLowerCase() === "investor" && !investorId) {
      return res.status(400).json({ message: "An Investor login must be linked to an investor" });
    }
    const user = await User.createUser({ name, username, passwordHash, role, investorId: investorId ?? null });
    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "username and password are required" });
    }
    const user = await User.findByUsername(username);
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    // Stamp last login + record a login audit entry (both best-effort).
    User.touchLastLogin(user.id).catch(() => {});
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null;
    audit.add({ userName: user.name, module: "Login", action: "Login", description: "User logged in", ip }).catch(() => {});

    const safeUser = { id: user.id, name: user.name, username: user.username, role: user.role, investorId: user.investor_id ?? null };
    const token = signToken(safeUser);
    res.json({ token, user: safeUser });
  } catch (err) {
    next(err);
  }
}

// Returns the current user based on the JWT (requireAuth sets req.user).
async function me(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, me };
