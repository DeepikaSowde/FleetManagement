const express = require("express");
const ctrl = require("../controllers/restrictedLicenseController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Any signed-in user can READ the blocklist (booking creation needs it to block
// restricted licenses), but only admins can add/edit/remove entries.
router.get("/", ctrl.list);                              // GET    /api/restricted-licenses
router.post("/", requireRole("admin"), ctrl.create);    // POST   /api/restricted-licenses
router.put("/:id", requireRole("admin"), ctrl.update);  // PUT    /api/restricted-licenses/:id
router.delete("/:id", requireRole("admin"), ctrl.remove); // DELETE /api/restricted-licenses/:id

module.exports = router;
