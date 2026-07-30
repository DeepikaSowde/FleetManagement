const { Pool } = require("pg");
require("dotenv").config();

// Two ways to connect:
//   1) DATABASE_URL  — a single connection string (Neon, Render, Supabase, etc.).
//      Cloud Postgres requires SSL, so we enable it when using a URL.
//   2) DB_HOST/DB_PORT/... — separate fields, for a local PostgreSQL install.
// If DATABASE_URL is set it wins; otherwise we fall back to the local fields.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

pool.on("connect", () => {
  console.log("PostgreSQL connected");
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error", err);
  process.exit(1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
