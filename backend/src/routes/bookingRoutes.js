const express = require("express");
const ctrl = require("../controllers/bookingController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", ctrl.list);           // GET    /api/bookings
router.post("/", ctrl.create);        // POST   /api/bookings
router.put("/:id", ctrl.update);      // PUT    /api/bookings/:id
router.delete("/:id", ctrl.remove);   // DELETE /api/bookings/:id

module.exports = router;
