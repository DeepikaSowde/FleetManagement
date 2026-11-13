const express = require("express");
const ctrl = require("../controllers/companyLoanController");
const { requireAuth } = require("../middleware/auth");
const { hasPermission } = require("../middleware/permission");

// Company Loans are Admin-only — managed from Investors → Company Loans, and
// deliberately NOT gated by the "Investors" permission (which Staff can be
// given). Investor logins never reach here (middleware/investorScope.js).
// The one exception is GET /ledger: the loan received / repayment entries that
// the Ledger and Cash Flow show, readable by anyone allowed to view either.
const isAdmin = (req) => String(req.user?.role || "").toLowerCase() === "admin";

const adminOnly = (req, res, next) =>
  isAdmin(req) ? next() : res.status(403).json({ message: "Only an Admin can manage Company Loans." });

const ledgerViewers = async (req, res, next) => {
  try {
    if (isAdmin(req)) return next();
    const role = req.user?.role;
    if ((await hasPermission(role, "Ledger")) || (await hasPermission(role, "Cash Flow"))) return next();
    return res.status(403).json({ message: "Your role does not have view access to the Ledger." });
  } catch (err) { next(err); }
};

const router = express.Router();
router.use(requireAuth);

router.get("/ledger", ledgerViewers, ctrl.ledger);                       // GET    /api/company-loans/ledger

router.use(adminOnly);
router.get("/", ctrl.list);                                              // GET    /api/company-loans  → { loans, lenders }
router.post("/lenders", ctrl.createLender);                              // POST   /api/company-loans/lenders
router.put("/lenders/:lenderId", ctrl.updateLender);                     // PUT    /api/company-loans/lenders/:lenderId
router.post("/", ctrl.create);                                           // POST   /api/company-loans
router.get("/:id", ctrl.detail);                                         // GET    /api/company-loans/:id  (with repayments + history)
router.put("/:id", ctrl.update);                                         // PUT    /api/company-loans/:id
router.delete("/:id", ctrl.remove);                                      // DELETE /api/company-loans/:id  { reason }
router.post("/:id/repayments", ctrl.addRepayment);                       // POST   /api/company-loans/:id/repayments
router.put("/:id/repayments/:repaymentId", ctrl.updateRepayment);        // PUT    …/repayments/:repaymentId
router.delete("/:id/repayments/:repaymentId", ctrl.removeRepayment);     // DELETE …/repayments/:repaymentId  { reason }
router.post("/:id/close", ctrl.close);                                   // POST   /api/company-loans/:id/close  { acknowledgeOutstanding, note }
router.post("/:id/reopen", ctrl.reopen);                                 // POST   /api/company-loans/:id/reopen { reason }

module.exports = router;
