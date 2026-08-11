// Data-access for the audit trail. add() records one action; list() returns
// the newest entries. record() is a best-effort helper other controllers call
// so a logging failure never breaks the action being logged.
const db = require("../config/db");

async function add({ userName, module, action, description, ip }) {
  const { rows } = await db.query(
    `INSERT INTO audit_logs (user_name, module, action, description, ip)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_name, module, action, description, ip, created_at`,
    [userName || null, module || null, action || null, description || null, ip || null]
  );
  return rows[0];
}

async function list(limit = 500) {
  const { rows } = await db.query(
    `SELECT id, user_name, module, action, description, ip, created_at
     FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

// Fire-and-forget audit write. Never throws — logging must not break the
// operation it records. `req` supplies the actor name and client IP.
function record(req, { module, action, description }) {
  const userName = req.user?.name || req.user?.username || "System";
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null;
  add({ userName, module, action, description, ip }).catch((err) =>
    console.error("audit log write failed:", err.message)
  );
}

module.exports = { add, list, record };
