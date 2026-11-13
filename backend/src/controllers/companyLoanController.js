// HTTP handlers for Company Loans (Investors module → Company Loans tab).
// The rules live in models/companyLoanModel.js; each change is also written to
// the app-wide audit log (User Management → Audit Log) besides the loan's own
// history.
const Loans = require("../models/companyLoanModel");
const AuditLog = require("../models/auditLogModel");

const actorOf = (req) => req.user?.name || req.user?.username || "System";
const sgd = (n) => `SGD ${Number(n || 0).toFixed(2)}`;
// A DELETE carries its reason in the query string (the app's API helper sends
// no body with DELETE); a body works too.
const reasonOf = (req) => req.body?.reason ?? req.query?.reason;
const audit = (req, action, description) => AuditLog.record(req, { module: "Company Loans", action, description });

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

const list = handle(async (req, res) => {
  const [loans, lenders] = await Promise.all([Loans.listLoans(), Loans.listLenders()]);
  res.json({ loans, lenders });
});

const detail = handle(async (req, res) => {
  const loan = await Loans.getLoanDetail(req.params.id);
  if (!loan) return res.status(404).json({ message: "Loan not found." });
  res.json(loan);
});

const ledger = handle(async (req, res) => {
  res.json(await Loans.ledgerEntries());
});

const createLender = handle(async (req, res) => {
  const lender = await Loans.createLender(req.body || {}, actorOf(req));
  audit(req, "Create", `Added lender ${lender.id} (${lender.name})`);
  res.status(201).json(lender);
});

const updateLender = handle(async (req, res) => {
  const lender = await Loans.updateLender(req.params.lenderId, req.body || {}, actorOf(req));
  audit(req, "Update", `Updated lender ${lender.id} (${lender.name})`);
  res.json(lender);
});

const create = handle(async (req, res) => {
  const loan = await Loans.createLoan(req.body || {}, actorOf(req));
  audit(req, "Create", `Loan ${loan.id} received from ${loan.lenderName}: ${sgd(loan.amount)} on ${loan.borrowedDate} (${loan.paymentMethod})`);
  res.status(201).json(loan);
});

const update = handle(async (req, res) => {
  const loan = await Loans.updateLoan(req.params.id, req.body || {}, actorOf(req));
  audit(req, "Update", `Edited loan ${loan.id} (${loan.lenderName}) — now ${sgd(loan.amount)}, outstanding ${sgd(loan.outstanding)}`);
  res.json(loan);
});

const remove = handle(async (req, res) => {
  const loan = await Loans.deleteLoan(req.params.id, reasonOf(req), actorOf(req));
  audit(req, "Delete", `Deleted loan ${loan.id} (${loan.lenderName}, ${sgd(loan.amount)}) · Reason: ${reasonOf(req)}`);
  res.json({ id: loan.id, deleted: true });
});

const addRepayment = handle(async (req, res) => {
  const { loan, repaymentId, duplicate } = await Loans.addRepayment(req.params.id, req.body || {}, actorOf(req));
  if (!duplicate) {
    audit(req, "Create", `Repayment ${repaymentId} on ${loan.id} (${loan.lenderName}): ${sgd(req.body.amount)} on ${req.body.repaymentDate} — outstanding now ${sgd(loan.outstanding)}${loan.status === "Closed" ? " (loan closed)" : ""}`);
  }
  res.status(duplicate ? 200 : 201).json({ loan, repaymentId, duplicate });
});

const updateRepayment = handle(async (req, res) => {
  const loan = await Loans.updateRepayment(req.params.id, req.params.repaymentId, req.body || {}, actorOf(req));
  audit(req, "Update", `Edited repayment ${req.params.repaymentId} on ${loan.id} — outstanding now ${sgd(loan.outstanding)}`);
  res.json(loan);
});

const removeRepayment = handle(async (req, res) => {
  const loan = await Loans.deleteRepayment(req.params.id, req.params.repaymentId, reasonOf(req), actorOf(req));
  audit(req, "Delete", `Deleted repayment ${req.params.repaymentId} on ${loan.id} — outstanding now ${sgd(loan.outstanding)} · Reason: ${reasonOf(req)}`);
  res.json(loan);
});

const close = handle(async (req, res) => {
  const before = await Loans.getLoanDetail(req.params.id);
  const loan = await Loans.closeLoan(req.params.id, req.body || {}, actorOf(req));
  audit(req, "Update", `Closed loan ${loan.id} (${loan.lenderName})${before?.outstanding > 0 ? ` with ${sgd(before.outstanding)} still outstanding` : ""}`);
  res.json(loan);
});

const reopen = handle(async (req, res) => {
  const loan = await Loans.reopenLoan(req.params.id, req.body?.reason, actorOf(req));
  audit(req, "Update", `Reopened loan ${loan.id} (${loan.lenderName}) · Reason: ${req.body.reason}`);
  res.json(loan);
});

module.exports = {
  list, detail, ledger, createLender, updateLender, create, update, remove,
  addRepayment, updateRepayment, removeRepayment, close, reopen,
};
