// Server entry point. Loads env, initializes the PostgreSQL pool (via
// src/config/db.js, also used by every model), ensures the schema is applied,
// then starts the HTTP server.
require("dotenv").config();
const app = require("./src/app");
require("./src/config/db"); // opens the PostgreSQL connection pool
const { initSchema } = require("./src/config/initDb");

const PORT = process.env.PORT || 5000;

// Apply the (idempotent) schema before accepting requests, so a fresh database
// is set up and existing ones pick up new columns automatically. If it fails
// (e.g. the DB is unreachable), log and exit rather than serve a broken API.
initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`FleetOpz API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database schema:", err);
    process.exit(1);
  });
