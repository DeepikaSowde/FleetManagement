const express = require("express");
const ctrl = require("../controllers/ownershipController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Fixed paths first, so they are not swallowed by /:id below.
router.get("/holdings", ctrl.holdings);          // GET    /api/ownership/holdings?asOf=YYYY-MM-DD
router.get("/me", ctrl.mine);                    // GET    /api/ownership/me   (investor's own record)
router.get("/settings", ctrl.getSettings);       // GET    /api/ownership/settings
router.put("/settings", ctrl.updateSettings);    // PUT    /api/ownership/settings

router.get("/", ctrl.list);                      // GET    /api/ownership
router.post("/", ctrl.create);                   // POST   /api/ownership
router.get("/:id", ctrl.getOne);                 // GET    /api/ownership/:id
router.put("/:id", ctrl.update);                 // PUT    /api/ownership/:id      (Draft only)
router.post("/:id/submit", ctrl.submit);         // POST   /api/ownership/:id/submit
router.post("/:id/decide", ctrl.decide);         // POST   /api/ownership/:id/decide
router.post("/:id/publish", ctrl.publish);       // POST   /api/ownership/:id/publish
router.delete("/:id", ctrl.remove);              // DELETE /api/ownership/:id      (not Effective)

module.exports = router;
