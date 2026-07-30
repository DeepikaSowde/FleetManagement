// Data-access layer for users. The only place that runs SQL against the
// `users` table — controllers call these functions, never write SQL directly.
const db = require("../config/db");

async function createUser({ name, username, passwordHash, role }) {
  const { rows } = await db.query(
    `INSERT INTO users (name, username, password, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, username, role, created_at`,
    [name, username, passwordHash, role || "admin"]
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
  const { rows } = await db.query(
    "SELECT id, name, username, role, created_at FROM users WHERE id = $1",
    [id]
  );
  return rows[0] || null;
}

module.exports = { createUser, findByUsername, findById };
