const express = require("express");
const ctrl = require("../controllers/customerController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", ctrl.list);           // GET    /api/customers
router.post("/", ctrl.create);        // POST   /api/customers  (upsert by IC)
router.put("/:id", ctrl.update);      // PUT    /api/customers/:id
router.delete("/:id", ctrl.remove);   // DELETE /api/customers/:id

module.exports = router;
