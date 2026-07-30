const express = require("express");
const ctrl = require("../controllers/expenseController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", ctrl.list);           // GET    /api/expenses
router.post("/", ctrl.create);        // POST   /api/expenses
router.put("/:id", ctrl.update);      // PUT    /api/expenses/:id
router.delete("/:id", ctrl.remove);   // DELETE /api/expenses/:id

module.exports = router;
