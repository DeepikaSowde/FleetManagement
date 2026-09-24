// Auth middleware — runs BEFORE protected controllers.
// Reads the "Authorization: Bearer <token>" header, verifies the JWT, and
// attaches the decoded user to req.user. If the token is missing or invalid,
// the request is rejected with 401 and the controller never runs.
const jwt = require("jsonwebtoken");
const db = require("../config/db");

// The JWT carries the role from login time, so on its own a role change (or a
// deleted account) would not take effect until the token expired. Re-reading
// the role from the users table — the same source the Role & Permission grid
// and /auth/me use — keeps backend authorization in step with what the
// frontend shows. Cached briefly to avoid a query per request; user
// create/update/delete call invalidateUserCache() so changes apply at once.
const USER_CACHE_MS = 5000;
const userCache = new Map(); // id -> { row, at }

function invalidateUserCache(id) {
  if (id === undefined) userCache.clear();
  else userCache.delete(Number(id));
}

async function freshUser(decoded) {
  const now = Date.now();
  const hit = userCache.get(decoded.id);
  if (hit && now - hit.at < USER_CACHE_MS) return hit.row;
  try {
    const { rows } = await db.query("SELECT role, investor_id FROM users WHERE id = $1", [decoded.id]);
    const row = rows[0] || null; // null = account no longer exists
    userCache.set(decoded.id, { row, at: now });
    return row;
  } catch {
    return undefined; // DB hiccup: fall back to the token's own claims
  }
}

async function resolveUser(decoded) {
  const row = await freshUser(decoded);
  if (row === undefined) return decoded;
  if (row === null) return null;
  return { ...decoded, role: row.role, investorId: row.investor_id ?? null };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, role }
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// Best-effort decode, used by the app-level investor scope gate so it has a
// role to look at before any router runs. Never rejects — requireAuth on each
// route is still what enforces authentication.
function attachUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      // Leave req.user unset; the route's own requireAuth will return 401.
    }
  }
  next();
}

// Optional role gate, e.g. requireRole("admin"). Use after requireAuth.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Not authorized" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, attachUser, invalidateUserCache };
