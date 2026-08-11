const express = require("express");
const ctrl = require("../controllers/auditLogController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", ctrl.list); // GET /api/audit-logs

module.exports = router;
