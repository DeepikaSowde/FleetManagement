const express = require("express");
const ctrl = require("../controllers/userController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Any signed-in user can READ the user directory; only admins can
// create / edit / delete users (User Management is an admin tool).
router.get("/", ctrl.list);                               // GET    /api/users
router.post("/", requireRole("admin"), ctrl.create);      // POST   /api/users
router.put("/:id", requireRole("admin"), ctrl.update);    // PUT    /api/users/:id
router.delete("/:id", requireRole("admin"), ctrl.remove); // DELETE /api/users/:id

module.exports = router;
