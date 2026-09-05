// Data-access layer for users. The only place that runs SQL against the
// `users` table — controllers call these functions, never write SQL directly.
const db = require("../config/db");

// Columns safe to return to the client (never the password hash).
const SAFE_COLS = "id, name, username, email, role, status, last_login, created_at";

async function createUser({ name, username, email = null, passwordHash, role, status = "Active" }) {
  const { rows } = await db.query(
    `INSERT INTO users (name, username, email, password, role, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${SAFE_COLS}`,
    [name, username, email, passwordHash, role || "admin", status]
  );
  return rows[0];
}

// Returns the full row INCLUDING the password hash — used only by login to
// verify the password. Never send this object straight to the client.
async function findByUsername(username) {
  const { rows } = await db.query("SELECT * FROM users WHERE username = $1", [username]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query(`SELECT ${SAFE_COLS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

// ── USER MANAGEMENT ──────────────────────────────────────────────────────────
async function listUsers() {
  const { rows } = await db.query(`SELECT ${SAFE_COLS} FROM users ORDER BY id ASC`);
  return rows;
}

// Partial update — only the whitelisted fields present in `updates` are
// changed. `password` (already hashed by the controller) maps to the password
// column. Returns the updated safe row, or null if the id doesn't exist.
async function updateUser(id, updates) {
  const map = { name: "name", username: "username", email: "email", role: "role", status: "status", passwordHash: "password" };
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [key, col] of Object.entries(map)) {
    if (updates[key] !== undefined) {
      sets.push(`${col} = $${i++}`);
      vals.push(updates[key]);
    }
  }
  if (sets.length === 0) return findById(id);
  vals.push(id);
  const { rows } = await db.query(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${SAFE_COLS}`,
    vals
  );
  return rows[0] || null;
}

async function deleteUser(id) {
  const { rowCount } = await db.query("DELETE FROM users WHERE id = $1", [id]);
  return rowCount > 0;
}

async function touchLastLogin(id) {
  await db.query("UPDATE users SET last_login = now() WHERE id = $1", [id]);
}

module.exports = {
  createUser, findByUsername, findById,
  listUsers, updateUser, deleteUser, touchLastLogin,
};
