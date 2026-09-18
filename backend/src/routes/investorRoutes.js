const express = require("express");
const ctrl = require("../controllers/investorController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/permission");

const router = express.Router();
router.use(requireAuth);
router.use(requirePermission("Investors"));

router.get("/", ctrl.list);           // GET    /api/investors
router.post("/", ctrl.create);        // POST   /api/investors
router.put("/:id", ctrl.update);      // PUT    /api/investors/:id
router.delete("/:id", ctrl.remove);   // DELETE /api/investors/:id

module.exports = router;
