// Auth middleware — runs BEFORE protected controllers.
// Reads the "Authorization: Bearer <token>" header, verifies the JWT, and
// attaches the decoded user to req.user. If the token is missing or invalid,
// the request is rejected with 401 and the controller never runs.
const jwt = require("jsonwebtoken");

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

// Optional role gate, e.g. requireRole("admin"). Use after requireAuth.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Not authorized" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
