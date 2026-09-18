const express = require("express");
const ctrl = require("../controllers/fleetController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/permission");

const router = express.Router();

// Every route below requires a valid login token, and the caller's role
// must have the matching Fleet permission (view/create/edit/delete, derived
// from the HTTP method) in the Role & Permission grid.
router.use(requireAuth);
router.use(requirePermission("Fleet"));

router.get("/", ctrl.list);              // GET    /api/fleet
router.post("/", ctrl.create);           // POST   /api/fleet
router.put("/:plate", ctrl.update);      // PUT    /api/fleet/:plate
router.delete("/:plate", ctrl.remove);   // DELETE /api/fleet/:plate

module.exports = router;
