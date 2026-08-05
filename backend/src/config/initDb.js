// Applies schema.sql on startup so the database schema is always in sync with
// the code — including newly added columns — without a manual `npm run db:init`.
// The whole schema file is idempotent (CREATE TABLE IF NOT EXISTS,
// ALTER TABLE ... ADD COLUMN IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING),
// so running it on every boot is safe and only fills in what's missing.
const fs = require("fs");
const path = require("path");
const db = require("./db");

async function initSchema() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  // pg runs a multi-statement string in one call via the simple query protocol
  // (no bound parameters), which is exactly what a schema file needs.
  await db.query(sql);
  console.log("Database schema ensured (schema.sql applied)");
}

module.exports = { initSchema };
