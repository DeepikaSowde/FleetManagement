const express = require("express");
const ctrl = require("../controllers/investorController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", ctrl.list);           // GET    /api/investors
router.post("/", ctrl.create);        // POST   /api/investors
router.put("/:id", ctrl.update);      // PUT    /api/investors/:id
router.delete("/:id", ctrl.remove);   // DELETE /api/investors/:id

module.exports = router;
