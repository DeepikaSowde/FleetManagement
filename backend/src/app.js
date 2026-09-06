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
const userRoutes = require("./routes/userRoutes");
const rolePermissionRoutes = require("./routes/rolePermissionRoutes");
const auditLogRoutes = require("./routes/auditLogRoutes");
const investorRoutes = require("./routes/investorRoutes");
const investorTxRoutes = require("./routes/investorTxRoutes");
const ownershipRoutes = require("./routes/ownershipRoutes");
const { errorHandler, notFound } = require("./middleware/errorHandler");
const { attachUser } = require("./middleware/auth");
const { investorScope } = require("./middleware/investorScope");

const app = express();

// ── Global middleware ───────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "2mb" })); // parse JSON request bodies

// Identify the caller once, then confine investor logins to their own record
// before any router runs — deny-by-default, so a route added later is covered
// without anyone having to remember to guard it.
app.use(attachUser);
app.use(investorScope);

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
app.use("/api/users", userRoutes);
app.use("/api/role-permissions", rolePermissionRoutes);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/investors", investorRoutes);
app.use("/api/investor-transactions", investorTxRoutes);
app.use("/api/ownership", ownershipRoutes);

// ── Fallbacks (must be last) ────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
