const express = require("express");
const ctrl = require("../controllers/earningController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", ctrl.list);           // GET    /api/earnings
router.post("/", ctrl.create);        // POST   /api/earnings
router.put("/:id", ctrl.update);      // PUT    /api/earnings/:id
router.delete("/:id", ctrl.remove);   // DELETE /api/earnings/:id

module.exports = router;
