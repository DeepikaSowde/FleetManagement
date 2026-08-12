const express = require("express");
const ctrl = require("../controllers/investorTxController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", ctrl.list);           // GET    /api/investor-transactions
router.post("/", ctrl.create);        // POST   /api/investor-transactions
router.put("/:id", ctrl.update);      // PUT    /api/investor-transactions/:id
router.delete("/:id", ctrl.remove);   // DELETE /api/investor-transactions/:id

module.exports = router;
