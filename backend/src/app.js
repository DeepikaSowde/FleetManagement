// Builds the Express app: middleware, then routes, then error handling.
// index.js imports this and starts listening.
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const fleetRoutes = require("./routes/fleetRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const earningRoutes = require("./routes/earningRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const customerRoutes = require("./routes/customerRoutes");
const employeeRoutes = require("./routes/employeeRoutes");
const restrictedLicenseRoutes = require("./routes/restrictedLicenseRoutes");
const { errorHandler, notFound } = require("./middleware/errorHandler");

const app = express();

// ── Global middleware ───────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "2mb" })); // parse JSON request bodies

// ── Routes ──────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/fleet", fleetRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/earnings", earningRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/restricted-licenses", restrictedLicenseRoutes);

// ── Fallbacks (must be last) ────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
