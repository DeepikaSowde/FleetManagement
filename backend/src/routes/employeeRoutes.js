const express = require("express");
const ctrl = require("../controllers/employeeController");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Any signed-in user can READ the staff list (operations get assigned to them);
// only admins can add/edit/remove employees.
router.get("/", ctrl.list);                               // GET    /api/employees
router.post("/", requireRole("admin"), ctrl.create);      // POST   /api/employees
router.put("/:id", requireRole("admin"), ctrl.update);    // PUT    /api/employees/:id
router.delete("/:id", requireRole("admin"), ctrl.remove); // DELETE /api/employees/:id

module.exports = router;
