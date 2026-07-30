const express = require("express");
const ctrl = require("../controllers/fleetController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Every route below requires a valid login token.
router.use(requireAuth);

router.get("/", ctrl.list);              // GET    /api/fleet
router.post("/", ctrl.create);           // POST   /api/fleet
router.put("/:plate", ctrl.update);      // PUT    /api/fleet/:plate
router.delete("/:plate", ctrl.remove);   // DELETE /api/fleet/:plate

module.exports = router;
