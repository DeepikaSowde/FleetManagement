// Handles registration, login, and "who am I". Controllers read the request,
// call the model, and shape the response — they don't run SQL themselves.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const audit = require("../models/auditLogModel");
const { validateName, validateUsername, validatePassword, validateRole } = require("../utils/userValidation");

// Compared against when the username does not exist, so an unknown user costs
// the same bcrypt time as a wrong password (no timing tell).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);
const INVALID = "Invalid username or password.";

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, investorId: user.investor_id ?? user.investorId ?? null },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

async function register(req, res, next) {
  try {
    const { name: rawName, username: rawUsername, password, role: rawRole, investorId } = req.body;
    const n = validateName(rawName), u = validateUsername(rawUsername), p = validatePassword(password), r = validateRole(rawRole || "staff");
    const bad = [n, u, p, r].find((v) => v.error);
    if (bad) return res.status(400).json({ message: bad.error });
    if (await User.findByUsername(u.value)) {
      return res.status(409).json({ message: "This username is already taken" });
    }
    // An investor login is meaningless without the investor it belongs to.
    if (r.value === "investor" && !investorId) {
      return res.status(400).json({ message: "An Investor login must be linked to an investor" });
    }
    const passwordHash = await bcrypt.hash(p.value, 10);
    const user = await User.createUser({ name: n.value, username: u.value, passwordHash, role: r.value, investorId: investorId ?? null });
    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ message: "This username is already taken" });
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: INVALID });
    }
    const user = await User.findByUsername(String(username).trim());
    // Username match is case-insensitive (in the model); the password compare
    // is bcrypt, which is case-sensitive. Both failure paths return the same
    // message so a caller can't tell which half was wrong.
    const ok = await bcrypt.compare(String(password), user ? user.password : DUMMY_HASH);
    if (!user || !ok) {
      req.loginFailed?.();
      return res.status(401).json({ message: INVALID });
    }
    req.loginSucceeded?.();

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
