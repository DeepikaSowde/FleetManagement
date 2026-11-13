// Data-access and rules for Company Loans: money borrowed from a lender and
// paid back (principal only). Kept apart from the Investors records.
//
// Rules (all enforced here, whatever the screen sends):
//   • Outstanding = loan amount − total repaid, always computed from the rows.
//   • A repayment must be > 0 and no more than what is outstanding.
//   • When nothing is outstanding the loan closes by itself. An admin may
//     also close it with money still owed — that amount stays owed.
//   • A closed loan is read-only until reopened, and reopening needs a reason.
//   • A loan's amount can't go below what has already been repaid, and a loan
//     can be deleted only while it has no repayments (with a reason).
//   • Every change is written to company_loan_history (old values, new values,
//     who, when, why) in the same transaction as the change itself, and each
//     write locks the loan row first, so two people can't over-repay it.
const db = require("../config/db");

const METHODS = ["Cash", "Card", "PayNow", "Bank Transfer", "Payment Gateway"];

// Same "Transaction ID / Reference Number" rules as the screens
// (frontend/src/paymentReference.js), checked again here.
const REF_RULES = {
  Card: { min: 6, max: 30, pattern: /^[A-Za-z0-9]+$/, chars: "letters and numbers" },
  "Bank Transfer": { min: 6, max: 35, pattern: /^[A-Za-z0-9]+$/, chars: "letters and numbers" },
  PayNow: { min: 6, max: 35, pattern: /^[A-Za-z0-9]+$/, chars: "letters and numbers" },
  "Payment Gateway": { min: 6, max: 50, pattern: /^[A-Za-z0-9_-]+$/, chars: "letters, numbers, _ and -" },
};
const REF_LABEL = "Transaction ID / Reference Number";

const badRequest = (message, status = 400) => Object.assign(new Error(message), { status });
const notFound = (what = "Loan") => badRequest(`${what} not found.`, 404);
const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const text = (v, max) => (isBlank(v) ? null : String(v).trim().slice(0, max));

function cleanAmount(value, label) {
  const n = Number(value);
  if (isBlank(value) || !Number.isFinite(n) || n <= 0) throw badRequest(`${label} must be greater than zero.`);
  if (round2(n) !== n) throw badRequest(`${label} can have at most 2 decimal places.`);
  if (n > 1e9) throw badRequest(`${label} is too large.`);
  return n;
}

// A real calendar date (YYYY-MM-DD), not later than tomorrow (a day of slack
// for time zones — the business is in Singapore, the server may run on UTC).
function cleanDate(value, label) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw badRequest(`Enter a valid ${label.toLowerCase()}.`);
  }
  const limit = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (s > limit) throw badRequest(`${label} can't be in the future.`);
  if (s < "2000-01-01") throw badRequest(`${label} is too far in the past.`);
  return s;
}

function cleanPayment(method, reference) {
  const m = String(method || "").trim();
  if (!METHODS.includes(m)) throw badRequest("Choose a payment method.");
  const ref = String(reference ?? "").trim();
  if (m === "Cash") {
    if (ref.length > 50) throw badRequest("Reference Number must be 50 characters or fewer.");
    return { method: m, reference: ref || null };
  }
  const r = REF_RULES[m];
  if (!ref) throw badRequest(`${REF_LABEL} is required for ${m}.`);
  if (!r.pattern.test(ref)) throw badRequest(`${REF_LABEL} can contain only ${r.chars} (no spaces or other symbols).`);
  if (ref.length < r.min || ref.length > r.max) throw badRequest(`${REF_LABEL} must be ${r.min}–${r.max} characters for ${m}.`);
  return { method: m, reference: ref };
}

function requireReason(reason, what) {
  const r = String(reason || "").trim();
  if (r.length < 3) throw badRequest(`Enter a reason for ${what}.`);
  return r.slice(0, 500);
}

// ── Shapes ─────────────────────────────────────────────────────────────────
const LOAN_SELECT = `
  SELECT l.*, to_char(l.borrowed_date, 'YYYY-MM-DD') AS borrowed_on,
         d.name AS lender_name, d.phone AS lender_phone,
         COALESCE(r.repaid, 0) AS repaid, COALESCE(r.cnt, 0)::int AS repayment_count, r.last_date
    FROM company_loans l
    JOIN company_loan_lenders d ON d.id = l.lender_id
    LEFT JOIN (
      SELECT loan_id, SUM(amount) AS repaid, COUNT(*) AS cnt,
             to_char(MAX(repayment_date), 'YYYY-MM-DD') AS last_date
        FROM company_loan_repayments GROUP BY loan_id
    ) r ON r.loan_id = l.id`;

const mapLoan = (row) => {
  const amount = Number(row.amount);
  const repaid = round2(Number(row.repaid) || 0);
  return {
    id: row.id,
    lenderId: row.lender_id,
    lenderName: row.lender_name,
    lenderPhone: row.lender_phone || "",
    amount,
    borrowedDate: row.borrowed_on,
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference || "",
    notes: row.notes || "",
    status: row.status,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    repaid,
    outstanding: round2(amount - repaid),
    repaymentCount: row.repayment_count,
    lastRepaymentDate: row.last_date || null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapRepayment = (row) => ({
  id: row.id,
  loanId: row.loan_id,
  amount: Number(row.amount),
  repaymentDate: row.repaid_on,
  paymentMethod: row.payment_method,
  paymentReference: row.payment_reference || "",
  notes: row.notes || "",
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapLender = (row) => ({ id: row.id, name: row.name, phone: row.phone || "", notes: row.notes || "", createdAt: row.created_at });

const loanSnapshot = (l) => ({
  lenderId: l.lenderId, lenderName: l.lenderName, amount: l.amount, borrowedDate: l.borrowedDate,
  paymentMethod: l.paymentMethod, paymentReference: l.paymentReference, notes: l.notes, status: l.status,
});
const repaymentSnapshot = (r) => ({
  amount: r.amount, repaymentDate: r.repaymentDate, paymentMethod: r.paymentMethod,
  paymentReference: r.paymentReference, notes: r.notes,
});

// ── Reads ──────────────────────────────────────────────────────────────────
async function listLenders() {
  const { rows } = await db.query("SELECT * FROM company_loan_lenders ORDER BY lower(name), id");
  return rows.map(mapLender);
}

async function listLoans() {
  const { rows } = await db.query(`${LOAN_SELECT} ORDER BY l.borrowed_date DESC, l.id DESC`);
  return rows.map(mapLoan);
}

async function getLoan(id, client = db, { forUpdate = false } = {}) {
  if (forUpdate) {
    const lock = await client.query("SELECT id FROM company_loans WHERE id = $1 FOR UPDATE", [id]);
    if (!lock.rows[0]) return null;
  }
  const { rows } = await client.query(`${LOAN_SELECT} WHERE l.id = $1`, [id]);
  return rows[0] ? mapLoan(rows[0]) : null;
}

async function listRepayments(loanId, client = db) {
  const { rows } = await client.query(
    `SELECT *, to_char(repayment_date, 'YYYY-MM-DD') AS repaid_on
       FROM company_loan_repayments WHERE loan_id = $1 ORDER BY repayment_date, created_at, id`,
    [loanId]
  );
  return rows.map(mapRepayment);
}

async function listHistory(loanId) {
  const { rows } = await db.query(
    "SELECT * FROM company_loan_history WHERE loan_id = $1 ORDER BY changed_at, id",
    [loanId]
  );
  return rows.map((h) => ({
    id: h.id, repaymentId: h.repayment_id, action: h.action, oldValues: h.old_values, newValues: h.new_values,
    reason: h.reason, changedBy: h.changed_by, changedAt: h.changed_at,
  }));
}

async function getLoanDetail(id) {
  const loan = await getLoan(id);
  if (!loan) return null;
  const [repayments, history] = await Promise.all([listRepayments(id), listHistory(id)]);
  return { ...loan, repayments, history };
}

// What the Ledger and Cash Flow need: one entry per loan received and one per
// repayment, with nothing about the loan's internals beyond that.
async function ledgerEntries() {
  const loans = await db.query(
    `SELECT l.id, to_char(l.borrowed_date, 'YYYY-MM-DD') AS on_date, l.amount, l.payment_method,
            l.payment_reference, l.created_at, d.name AS lender_name
       FROM company_loans l JOIN company_loan_lenders d ON d.id = l.lender_id`
  );
  const repayments = await db.query(
    `SELECT r.id, r.loan_id, to_char(r.repayment_date, 'YYYY-MM-DD') AS on_date, r.amount, r.payment_method,
            r.payment_reference, r.created_at, d.name AS lender_name
       FROM company_loan_repayments r
       JOIN company_loans l ON l.id = r.loan_id
       JOIN company_loan_lenders d ON d.id = l.lender_id`
  );
  const entry = (kind) => (row) => ({
    id: row.id,
    kind,
    loanId: kind === "received" ? row.id : row.loan_id,
    lenderName: row.lender_name,
    date: row.on_date,
    amount: Number(row.amount),
    method: row.payment_method,
    reference: row.payment_reference || "",
    recordedAt: row.created_at,
  });
  return [...loans.rows.map(entry("received")), ...repayments.rows.map(entry("repayment"))];
}

// ── Writes ─────────────────────────────────────────────────────────────────
async function addHistory(client, { loanId, repaymentId = null, action, oldValues = null, newValues = null, reason = null, by }) {
  await client.query(
    `INSERT INTO company_loan_history (loan_id, repayment_id, action, old_values, new_values, reason, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [loanId, repaymentId, action, oldValues && JSON.stringify(oldValues), newValues && JSON.stringify(newValues), reason, by || null]
  );
}

async function createLenderIn(client, body, by) {
  const name = text(body?.name, 160);
  if (!name) throw badRequest("Enter the lender's name.");
  const phone = text(body?.phone, 40);
  if (phone && !/^[+()\d\s-]{6,40}$/.test(phone)) throw badRequest("Enter a valid phone number (digits, spaces, + and -).");
  const { rows: seq } = await client.query("SELECT nextval('company_loan_lender_seq') AS n");
  const id = `LND-${String(seq[0].n).padStart(4, "0")}`;
  const { rows } = await client.query(
    `INSERT INTO company_loan_lenders (id, name, phone, notes, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, name, phone, text(body?.notes, 2000), by || null]
  );
  return mapLender(rows[0]);
}

async function createLender(body, by) {
  return db.withTransaction((client) => createLenderIn(client, body, by));
}

async function updateLender(id, body, by) {
  return db.withTransaction(async (client) => {
    const { rows: cur } = await client.query("SELECT * FROM company_loan_lenders WHERE id = $1 FOR UPDATE", [id]);
    if (!cur[0]) throw notFound("Lender");
    const name = body.name === undefined ? cur[0].name : text(body.name, 160);
    if (!name) throw badRequest("Enter the lender's name.");
    const phone = body.phone === undefined ? cur[0].phone : text(body.phone, 40);
    if (phone && !/^[+()\d\s-]{6,40}$/.test(phone)) throw badRequest("Enter a valid phone number (digits, spaces, + and -).");
    const notes = body.notes === undefined ? cur[0].notes : text(body.notes, 2000);
    const { rows } = await client.query(
      "UPDATE company_loan_lenders SET name = $2, phone = $3, notes = $4, updated_at = now() WHERE id = $1 RETURNING *",
      [id, name, phone, notes]
    );
    const before = mapLender(cur[0]);
    const after = mapLender(rows[0]);
    // A lender's details show on every one of their loans, so note it on each.
    const { rows: loans } = await client.query("SELECT id FROM company_loans WHERE lender_id = $1", [id]);
    for (const l of loans) {
      await addHistory(client, { loanId: l.id, action: "Lender Updated", oldValues: before, newValues: after, by });
    }
    return after;
  });
}

// Closes a loan once nothing is outstanding (after a repayment or an edit).
async function autoClose(client, loanId, by) {
  const loan = await getLoan(loanId, client);
  if (loan.status === "Open" && loan.outstanding <= 0) {
    await client.query("UPDATE company_loans SET status = 'Closed', closed_at = now(), closed_by = $2, updated_at = now() WHERE id = $1", [loanId, by || null]);
    await addHistory(client, {
      loanId, action: "Closed (fully repaid)", oldValues: { status: "Open" },
      newValues: { status: "Closed", outstanding: 0 }, by,
    });
  }
}

async function createLoan(body, by) {
  const amount = cleanAmount(body.amount, "Borrowed amount");
  const borrowedDate = cleanDate(body.borrowedDate, "Borrowed date");
  const { method, reference } = cleanPayment(body.paymentMethod, body.paymentReference);
  const notes = text(body.notes, 2000);
  return db.withTransaction(async (client) => {
    let lenderId = text(body.lenderId, 20);
    if (body.newLender) {
      lenderId = (await createLenderIn(client, body.newLender, by)).id;
    } else {
      if (!lenderId) throw badRequest("Choose a lender or add a new one.");
      const { rows } = await client.query("SELECT id FROM company_loan_lenders WHERE id = $1", [lenderId]);
      if (!rows[0]) throw notFound("Lender");
    }
    const { rows: seq } = await client.query("SELECT nextval('company_loan_seq') AS n");
    const id = `CL-${String(seq[0].n).padStart(4, "0")}`;
    await client.query(
      `INSERT INTO company_loans (id, lender_id, amount, borrowed_date, payment_method, payment_reference, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, lenderId, amount, borrowedDate, method, reference, notes, by || null]
    );
    const loan = await getLoan(id, client);
    await addHistory(client, { loanId: id, action: "Loan Added", newValues: loanSnapshot(loan), by });
    return loan;
  });
}

async function updateLoan(id, body, by) {
  return db.withTransaction(async (client) => {
    const cur = await getLoan(id, client, { forUpdate: true });
    if (!cur) throw notFound();
    if (cur.status === "Closed") throw badRequest("This loan is closed. Reopen it (with a reason) before making changes.", 409);
    const amount = body.amount === undefined ? cur.amount : cleanAmount(body.amount, "Borrowed amount");
    if (amount < cur.repaid) {
      throw badRequest(`The loan amount can't be less than what has already been repaid (SGD ${cur.repaid.toFixed(2)}).`);
    }
    const borrowedDate = body.borrowedDate === undefined ? cur.borrowedDate : cleanDate(body.borrowedDate, "Borrowed date");
    const repayments = await listRepayments(id, client);
    const earliest = repayments[0]?.repaymentDate;
    if (earliest && borrowedDate > earliest) throw badRequest(`The borrowed date can't be after the first repayment (${earliest}).`);
    const pay = cleanPayment(body.paymentMethod ?? cur.paymentMethod, body.paymentReference ?? cur.paymentReference);
    let lenderId = body.lenderId === undefined ? cur.lenderId : text(body.lenderId, 20);
    if (lenderId !== cur.lenderId) {
      const { rows } = await client.query("SELECT id FROM company_loan_lenders WHERE id = $1", [lenderId]);
      if (!rows[0]) throw notFound("Lender");
    }
    const notes = body.notes === undefined ? cur.notes : text(body.notes, 2000);
    await client.query(
      `UPDATE company_loans SET lender_id = $2, amount = $3, borrowed_date = $4, payment_method = $5,
              payment_reference = $6, notes = $7, updated_at = now() WHERE id = $1`,
      [id, lenderId, amount, borrowedDate, pay.method, pay.reference, notes]
    );
    const after = await getLoan(id, client);
    await addHistory(client, {
      loanId: id, action: "Loan Edited", oldValues: loanSnapshot(cur), newValues: loanSnapshot(after),
      reason: text(body.reason, 500), by,
    });
    await autoClose(client, id, by);
    return getLoan(id, client);
  });
}

async function deleteLoan(id, reasonInput, by) {
  const reason = requireReason(reasonInput, "deleting this loan");
  return db.withTransaction(async (client) => {
    const cur = await getLoan(id, client, { forUpdate: true });
    if (!cur) throw notFound();
    if (cur.repaymentCount > 0) throw badRequest("This loan has repayments, so it can't be deleted.", 409);
    await addHistory(client, { loanId: id, action: "Loan Deleted", oldValues: loanSnapshot(cur), reason, by });
    await client.query("DELETE FROM company_loans WHERE id = $1", [id]);
    return cur;
  });
}

async function addRepayment(id, body, by) {
  const amount = cleanAmount(body.amount, "Repayment amount");
  const repaymentDate = cleanDate(body.repaymentDate, "Repayment date");
  const { method, reference } = cleanPayment(body.paymentMethod, body.paymentReference);
  const notes = text(body.notes, 2000);
  const clientRef = text(body.clientRef, 80);
  if (clientRef) {
    // The same Record Repayment submitted twice (double click, retry): hand
    // back the first one instead of recording the money twice.
    const { rows } = await db.query("SELECT id, loan_id FROM company_loan_repayments WHERE client_ref = $1", [clientRef]);
    if (rows[0]) {
      if (rows[0].loan_id !== id) throw badRequest("That request was already used for another loan.", 409);
      return { loan: await getLoan(id), repaymentId: rows[0].id, duplicate: true };
    }
  }
  return db.withTransaction(async (client) => {
    const loan = await getLoan(id, client, { forUpdate: true });
    if (!loan) throw notFound();
    if (loan.status === "Closed") throw badRequest("This loan is closed. Reopen it (with a reason) to record a repayment.", 409);
    if (loan.outstanding <= 0) throw badRequest("Nothing is outstanding on this loan.", 409);
    if (amount > loan.outstanding) {
      throw badRequest(`The repayment (SGD ${amount.toFixed(2)}) is more than the outstanding balance (SGD ${loan.outstanding.toFixed(2)}).`);
    }
    if (repaymentDate < loan.borrowedDate) throw badRequest(`The repayment date can't be before the loan was borrowed (${loan.borrowedDate}).`);
    if (reference && method !== "Cash") {
      const { rows } = await client.query(
        "SELECT id FROM company_loan_repayments WHERE loan_id = $1 AND lower(payment_reference) = lower($2)",
        [id, reference]
      );
      if (rows[0]) throw badRequest(`Reference ${reference} is already recorded on this loan (${rows[0].id}).`, 409);
    }
    const { rows: seq } = await client.query("SELECT nextval('company_loan_repayment_seq') AS n");
    const repaymentId = `CLR-${String(seq[0].n).padStart(5, "0")}`;
    await client.query(
      `INSERT INTO company_loan_repayments (id, loan_id, amount, repayment_date, payment_method, payment_reference, notes, client_ref, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [repaymentId, id, amount, repaymentDate, method, reference, notes, clientRef, by || null]
    );
    await addHistory(client, {
      loanId: id, repaymentId, action: "Repayment Recorded",
      newValues: { amount, repaymentDate, paymentMethod: method, paymentReference: reference || "", notes: notes || "", outstandingAfter: round2(loan.outstanding - amount) },
      by,
    });
    await autoClose(client, id, by);
    return { loan: await getLoan(id, client), repaymentId, duplicate: false };
  });
}

async function updateRepayment(id, repaymentId, body, by) {
  return db.withTransaction(async (client) => {
    const loan = await getLoan(id, client, { forUpdate: true });
    if (!loan) throw notFound();
    if (loan.status === "Closed") throw badRequest("This loan is closed. Reopen it (with a reason) before changing a repayment.", 409);
    const cur = (await listRepayments(id, client)).find((r) => r.id === repaymentId);
    if (!cur) throw notFound("Repayment");
    const amount = body.amount === undefined ? cur.amount : cleanAmount(body.amount, "Repayment amount");
    const allowed = round2(loan.outstanding + cur.amount);
    if (amount > allowed) throw badRequest(`The repayment (SGD ${amount.toFixed(2)}) is more than the outstanding balance (SGD ${allowed.toFixed(2)}).`);
    const repaymentDate = body.repaymentDate === undefined ? cur.repaymentDate : cleanDate(body.repaymentDate, "Repayment date");
    if (repaymentDate < loan.borrowedDate) throw badRequest(`The repayment date can't be before the loan was borrowed (${loan.borrowedDate}).`);
    const pay = cleanPayment(body.paymentMethod ?? cur.paymentMethod, body.paymentReference ?? cur.paymentReference);
    if (pay.reference && pay.method !== "Cash") {
      const { rows } = await client.query(
        "SELECT id FROM company_loan_repayments WHERE loan_id = $1 AND id <> $2 AND lower(payment_reference) = lower($3)",
        [id, repaymentId, pay.reference]
      );
      if (rows[0]) throw badRequest(`Reference ${pay.reference} is already recorded on this loan (${rows[0].id}).`, 409);
    }
    const notes = body.notes === undefined ? cur.notes : text(body.notes, 2000);
    await client.query(
      `UPDATE company_loan_repayments SET amount = $2, repayment_date = $3, payment_method = $4,
              payment_reference = $5, notes = $6, updated_at = now() WHERE id = $1`,
      [repaymentId, amount, repaymentDate, pay.method, pay.reference, notes]
    );
    const after = (await listRepayments(id, client)).find((r) => r.id === repaymentId);
    await addHistory(client, {
      loanId: id, repaymentId, action: "Repayment Edited", oldValues: repaymentSnapshot(cur),
      newValues: repaymentSnapshot(after), reason: text(body.reason, 500), by,
    });
    await autoClose(client, id, by);
    return getLoan(id, client);
  });
}

async function deleteRepayment(id, repaymentId, reasonInput, by) {
  const reason = requireReason(reasonInput, "deleting this repayment");
  return db.withTransaction(async (client) => {
    const loan = await getLoan(id, client, { forUpdate: true });
    if (!loan) throw notFound();
    if (loan.status === "Closed") throw badRequest("This loan is closed. Reopen it (with a reason) before changing a repayment.", 409);
    const cur = (await listRepayments(id, client)).find((r) => r.id === repaymentId);
    if (!cur) throw notFound("Repayment");
    await client.query("DELETE FROM company_loan_repayments WHERE id = $1", [repaymentId]);
    await addHistory(client, { loanId: id, repaymentId, action: "Repayment Deleted", oldValues: repaymentSnapshot(cur), reason, by });
    return getLoan(id, client);
  });
}

async function closeLoan(id, body, by) {
  return db.withTransaction(async (client) => {
    const loan = await getLoan(id, client, { forUpdate: true });
    if (!loan) throw notFound();
    if (loan.status === "Closed") throw badRequest("This loan is already closed.", 409);
    if (loan.outstanding > 0 && body.acknowledgeOutstanding !== true) {
      throw badRequest(`SGD ${loan.outstanding.toFixed(2)} is still unpaid. Confirm to close the loan with this amount still owed.`, 409);
    }
    await client.query("UPDATE company_loans SET status = 'Closed', closed_at = now(), closed_by = $2, updated_at = now() WHERE id = $1", [id, by || null]);
    await addHistory(client, {
      loanId: id,
      action: loan.outstanding > 0 ? "Closed with balance outstanding" : "Closed",
      oldValues: { status: "Open" },
      newValues: { status: "Closed", outstanding: loan.outstanding },
      reason: text(body.note, 500),
      by,
    });
    return getLoan(id, client);
  });
}

async function reopenLoan(id, reasonInput, by) {
  const reason = requireReason(reasonInput, "reopening this loan");
  return db.withTransaction(async (client) => {
    const loan = await getLoan(id, client, { forUpdate: true });
    if (!loan) throw notFound();
    if (loan.status !== "Closed") throw badRequest("This loan is already open.", 409);
    await client.query("UPDATE company_loans SET status = 'Open', closed_at = NULL, closed_by = NULL, updated_at = now() WHERE id = $1", [id]);
    await addHistory(client, { loanId: id, action: "Reopened", oldValues: { status: "Closed" }, newValues: { status: "Open", outstanding: loan.outstanding }, reason, by });
    return getLoan(id, client);
  });
}

module.exports = {
  METHODS,
  listLenders, createLender, updateLender,
  listLoans, getLoanDetail, createLoan, updateLoan, deleteLoan,
  addRepayment, updateRepayment, deleteRepayment,
  closeLoan, reopenLoan,
  ledgerEntries,
};
