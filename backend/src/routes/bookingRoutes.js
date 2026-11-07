const express = require("express");
const ctrl = require("../controllers/bookingController");
const { requireAuth } = require("../middleware/auth");
const { requirePermission } = require("../middleware/permission");

const router = express.Router();
router.use(requireAuth);

// Change Car follows the Bookings EDIT permission — anyone who can edit a
// booking can swap its car. Registered before the router-wide guard below,
// which would map this POST to "create" instead.
router.post("/:id/change-car", requirePermission("Bookings", "edit"), ctrl.changeCar); // POST /api/bookings/:id/change-car

router.use(requirePermission("Bookings"));

router.get("/", ctrl.list);           // GET    /api/bookings
router.post("/", ctrl.create);        // POST   /api/bookings
router.put("/:id", ctrl.update);      // PUT    /api/bookings/:id
router.delete("/:id", ctrl.remove);   // DELETE /api/bookings/:id

module.exports = router;
