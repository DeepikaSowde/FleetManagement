const express = require("express");
const { register, login, me } = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/register", register);   // POST /api/auth/register
router.post("/login", login);         // POST /api/auth/login
router.get("/me", requireAuth, me);   // GET  /api/auth/me  (needs token)

module.exports = router;
