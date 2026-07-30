const express = require("express");
const { register, login, me } = require("../controllers/authController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Registration is NOT public — this is an internal admin/staff tool. Only a
// logged-in admin can create new users (done from Settings → Add User). The
// very first admin is seeded directly into the database.
router.post("/register", requireAuth, requireRole("admin"), register);

router.post("/login", login);         // POST /api/auth/login
router.get("/me", requireAuth, me);   // GET  /api/auth/me  (needs token)

module.exports = router;
