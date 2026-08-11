const express = require("express");
const ctrl = require("../controllers/rolePermissionController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", ctrl.getAll);                             // GET  /api/role-permissions
router.put("/toggle", requireRole("admin"), ctrl.toggle); // PUT  /api/role-permissions/toggle

module.exports = router;
