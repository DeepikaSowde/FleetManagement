// Server entry point. Loads env, initializes the PostgreSQL pool (via
// src/config/db.js, also used by every model), and starts the HTTP server.
require("dotenv").config();
const app = require("./src/app");
require("./src/config/db"); // opens the PostgreSQL connection pool

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`FleetOpz API running on http://localhost:${PORT}`);
});
