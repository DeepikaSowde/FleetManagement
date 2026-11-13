import { useEffect, useMemo, useState } from "react";
import api from "./services/api";
import { C, TRANSACTION_METHODS } from "./theme";
import { Btn, Badge, Modal, Input, Pagination } from "./components";
import { validatePaymentReference, REFERENCE_LABEL, referencePlaceholder, referenceMaxLength, referenceRequired } from "./paymentReference";
import PaymentRefError from "./PaymentRefError";

/* =====================================================================================
   COMPANY LOANS — Investors module → Company Loans tab (Admin only)
   -------------------------------------------------------------------------------------
   Money the business borrows from a lender and pays back: principal only, no
   interest. Lenders are their own list, separate from investors, and nothing
   here touches investments, ownership, dividends, exits, P&L or expenses.

   The server owns every figure and rule (outstanding = borrowed − repaid; a
   repayment can't exceed what's owed; a loan closes itself when nothing is
   owed; closed loans are read-only until reopened with a reason). This page
   shows what the server returns and its refusal messages. Each loan received
   and each repayment also appears in the Ledger (cash in / cash out).
   ===================================================================================== */

const money = (n) => `SGD ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtWhen = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d) ? v : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const today = () => new Date().toLocaleDateString("en-CA");
const newClientRef = () => (crypto.randomUUID ? crypto.randomUUID() : `cl-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const cardStyle = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 };
const labelStyle = { fontSize: 10.5, fontWeight: 700, color: C.textMuted, letterSpacing: 0.4, textTransform: "uppercase" };
const inputStyle = { width: "100%", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: C.surface, color: C.textPri };
const th = { textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
const td = { padding: "10px 12px", fontSize: 12.5, color: C.textPri, borderBottom: `1px solid ${C.border}` };
const num = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ ...cardStyle, padding: "16px 18px", flex: 1, minWidth: 160 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.navy, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const Field = ({ label, required, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: C.textPri }}>
      {label}{required && <span style={{ color: C.red }}> *</span>}
    </label>
    {children}
  </div>
);

const ErrorBox = ({ message }) => (message ? (
  <div role="alert" style={{ background: C.redFaint, color: C.red, border: `1px solid ${C.red}33`, borderRadius: 8, padding: "9px 12px", fontSize: 12.5, marginBottom: 12 }}>{message}</div>
) : null);

const StatusBadge = ({ loan }) => (loan.status === "Open"
  ? <Badge color={C.green} bg={C.greenFaint}>Open</Badge>
  : <Badge color={C.textSec} bg={C.linen}>{loan.outstanding > 0 ? "Closed · balance owed" : "Closed"}</Badge>);

// The app's existing payment method + "Transaction ID / Reference Number" pair.
const PaymentFields = ({ method, setMethod, reference, setReference, methodLabel = "Payment Method" }) => (
  <>
    <Field label={methodLabel} required>
      <select value={method} onChange={(e) => setMethod(e.target.value)} style={inputStyle}>
        {TRANSACTION_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </Field>
    <Field label={REFERENCE_LABEL} required={referenceRequired(method)}>
      <input value={reference} maxLength={referenceMaxLength(method)} placeholder={referencePlaceholder(method)} onChange={(e) => setReference(e.target.value)} style={inputStyle} />
      <PaymentRefError method={method} value={reference} />
    </Field>
  </>
);

/* ---------------------------------------------------------------- Add / edit loan */
function LoanModal({ loan, lenders, onClose, onSaved }) {
  const editing = !!loan;
  const [lenderMode, setLenderMode] = useState(editing || lenders.length ? "existing" : "new");
  const [lenderId, setLenderId] = useState(loan?.lenderId || "");
  const [newLender, setNewLender] = useState({ name: "", phone: "", notes: "" });
  const [amount, setAmount] = useState(loan ? String(loan.amount) : "");
  const [borrowedDate, setBorrowedDate] = useState(loan?.borrowedDate || today());
  const [method, setMethod] = useState(loan?.paymentMethod || "Cash");
  const [reference, setReference] = useState(loan?.paymentReference || "");
  const [notes, setNotes] = useState(loan?.notes || "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const n = Number(amount);
    if (lenderMode === "existing" && !lenderId) return setError("Choose a lender, or add a new one.");
    if (lenderMode === "new" && !newLender.name.trim()) return setError("Enter the new lender's name.");
    if (!(n > 0)) return setError("Borrowed amount must be greater than zero.");
    if (editing && n < loan.repaid) return setError(`The loan amount can't be less than what has already been repaid (${money(loan.repaid)}).`);
    if (!borrowedDate) return setError("Enter the borrowed date.");
    const refMsg = validatePaymentReference(method, reference);
    if (refMsg) return setError(refMsg);
    setBusy(true);
    setError("");
    try {
      const body = { amount: n, borrowedDate, paymentMethod: method, paymentReference: reference, notes };
      if (lenderMode === "new") body.newLender = newLender;
      else body.lenderId = lenderId;
      const saved = editing
        ? await api.put(`/company-loans/${loan.id}`, { ...body, reason })
        : await api.post("/company-loans", body);
      onSaved(saved, editing ? `Loan ${saved.id} updated.` : `Loan ${saved.id} added — ${money(saved.amount)} from ${saved.lenderName}.`);
    } catch (err) {
      setError(err?.message || "The loan couldn't be saved.");
      setBusy(false);
    }
  };

  return (
    <Modal open title={editing ? `Edit Loan — ${loan.id}` : "Add Company Loan"} onClose={onClose} onSubmit={submit}
      submitText={busy ? "Saving…" : editing ? "Save Changes" : "Add Loan"} submitDisabled={busy} testId="company-loan">
      <ErrorBox message={error} />
      <Field label="Lender" required>
        {lenderMode === "existing" ? (
          <>
            <select value={lenderId} onChange={(e) => setLenderId(e.target.value)} style={inputStyle}>
              <option value="">-- Select lender --</option>
              {lenders.map((l) => <option key={l.id} value={l.id}>{l.name}{l.phone ? ` · ${l.phone}` : ""}</option>)}
            </select>
            {!editing && (
              <button type="button" onClick={() => setLenderMode("new")} style={{ marginTop: 6, background: "none", border: "none", color: C.teal, fontWeight: 700, fontSize: 12, cursor: "pointer", padding: 0 }}>
                + Add a new lender
              </button>
            )}
          </>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 12px 0" }}>
            <Input label="Lender Name *" value={newLender.name} onChange={(e) => setNewLender({ ...newLender, name: e.target.value })} placeholder="Full name" maxLength={160} />
            <Input label="Phone Number" value={newLender.phone} onChange={(e) => setNewLender({ ...newLender, phone: e.target.value })} placeholder="+65 9123 4567" maxLength={40} />
            <Input label="Notes" value={newLender.notes} onChange={(e) => setNewLender({ ...newLender, notes: e.target.value })} placeholder="Optional" maxLength={2000} />
            {lenders.length > 0 && (
              <button type="button" onClick={() => setLenderMode("existing")} style={{ margin: "-6px 0 12px", background: "none", border: "none", color: C.teal, fontWeight: 700, fontSize: 12, cursor: "pointer", padding: 0 }}>
                ← Choose an existing lender instead
              </button>
            )}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 4 }}>Lenders are a separate list — not the investors.</div>
      </Field>
      <Field label="Borrowed Amount (SGD)" required>
        <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} placeholder="0.00" />
        {editing && loan.repaid > 0 && <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 4 }}>Already repaid: {money(loan.repaid)} — the amount can't go below this.</div>}
      </Field>
      <Field label="Borrowed Date" required>
        <input type="date" value={borrowedDate} max={today()} onChange={(e) => setBorrowedDate(e.target.value)} style={inputStyle} />
      </Field>
      <PaymentFields method={method} setMethod={setMethod} reference={reference} setReference={setReference} methodLabel="Payment Method (how the money was received)" />
      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} style={{ ...inputStyle, resize: "vertical" }} placeholder="Optional" />
      </Field>
      {editing && (
        <Field label="Reason for the change">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} style={inputStyle} placeholder="Optional — kept in the loan's history" />
        </Field>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------- Record / edit repayment */
function RepaymentModal({ loan, repayment, onClose, onSaved }) {
  const editing = !!repayment;
  const owedNow = editing ? Math.round((loan.outstanding + repayment.amount) * 100) / 100 : loan.outstanding;
  const [clientRef] = useState(newClientRef); // one per opening: a double click can't record twice
  const [amount, setAmount] = useState(repayment ? String(repayment.amount) : "");
  const [repaymentDate, setRepaymentDate] = useState(repayment?.repaymentDate || today());
  const [method, setMethod] = useState(repayment?.paymentMethod || "Cash");
  const [reference, setReference] = useState(repayment?.paymentReference || "");
  const [notes, setNotes] = useState(repayment?.notes || "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const n = Number(amount);
  const after = n > 0 ? Math.round((owedNow - n) * 100) / 100 : owedNow;

  const submit = async () => {
    if (busy) return;
    if (!(n > 0)) return setError("Repayment amount must be greater than zero.");
    if (n > owedNow) return setError(`The repayment can't be more than the outstanding balance (${money(owedNow)}).`);
    if (!repaymentDate) return setError("Enter the repayment date.");
    if (repaymentDate < loan.borrowedDate) return setError(`The repayment date can't be before the loan was borrowed (${fmtDate(loan.borrowedDate)}).`);
    const refMsg = validatePaymentReference(method, reference);
    if (refMsg) return setError(refMsg);
    setBusy(true);
    setError("");
    try {
      const body = { amount: n, repaymentDate, paymentMethod: method, paymentReference: reference, notes };
      if (editing) {
        const saved = await api.put(`/company-loans/${loan.id}/repayments/${repayment.id}`, { ...body, reason });
        onSaved(`Repayment updated. Outstanding is now ${money(saved.outstanding)}.`);
      } else {
        const { loan: saved } = await api.post(`/company-loans/${loan.id}/repayments`, { ...body, clientRef });
        onSaved(`Repayment of ${money(n)} recorded. Outstanding is now ${money(saved.outstanding)}${saved.status === "Closed" ? " — fully repaid, the loan is now Closed." : "."}`);
      }
    } catch (err) {
      setError(err?.message || "The repayment couldn't be saved.");
      setBusy(false);
    }
  };

  return (
    <Modal open title={editing ? `Edit Repayment — ${repayment.id}` : `Record Repayment — ${loan.id}`} onClose={onClose} onSubmit={submit}
      submitText={busy ? "Saving…" : editing ? "Save Changes" : "Record Repayment"} submitDisabled={busy} testId="loan-repayment">
      <ErrorBox message={error} />
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, background: C.linen, borderRadius: 8, padding: "10px 12px" }}>
          <div style={labelStyle}>Outstanding now</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.navy, marginTop: 4 }}>{money(owedNow)}</div>
        </div>
        <div style={{ flex: 1, background: C.linen, borderRadius: 8, padding: "10px 12px" }}>
          <div style={labelStyle}>After this repayment</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: after < 0 ? C.red : after === 0 ? C.green : C.navy, marginTop: 4 }}>{after < 0 ? "More than owed" : money(after)}</div>
        </div>
      </div>
      <Field label="Repayment Amount (SGD)" required>
        <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} placeholder="0.00" />
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button type="button" onClick={() => setAmount(String(owedNow))} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 700, color: C.teal, cursor: "pointer" }}>
            Full repayment ({money(owedNow)})
          </button>
        </div>
      </Field>
      <Field label="Repayment Date" required>
        <input type="date" value={repaymentDate} min={loan.borrowedDate} max={today()} onChange={(e) => setRepaymentDate(e.target.value)} style={inputStyle} />
      </Field>
      <PaymentFields method={method} setMethod={setMethod} reference={reference} setReference={setReference} methodLabel="Payment Method (how it was paid back)" />
      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} style={{ ...inputStyle, resize: "vertical" }} placeholder="Optional" />
      </Field>
      {editing && (
        <Field label="Reason for the change">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} style={inputStyle} placeholder="Optional — kept in the loan's history" />
        </Field>
      )}
    </Modal>
  );
}

/* ------------------------------------------------- Confirmations (reason / warning) */
function ReasonModal({ title, message, confirmText, reasonRequired = true, warning, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    if (reasonRequired && reason.trim().length < 3) return setError("Please enter a reason.");
    setBusy(true);
    setError("");
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err?.message || "That didn't work.");
      setBusy(false);
    }
  };
  return (
    <Modal open title={title} onClose={onClose} onSubmit={submit} submitText={busy ? "Please wait…" : confirmText} submitDisabled={busy} testId="loan-confirm">
      <ErrorBox message={error} />
      {warning && (
        <div style={{ background: C.amberFaint, borderLeft: `3px solid ${C.amber}`, borderRadius: "0 8px 8px 0", padding: "10px 14px", marginBottom: 14, fontSize: 12.5, color: C.textSec }}>{warning}</div>
      )}
      {message && <div style={{ fontSize: 13, color: C.textSec, marginBottom: 14, lineHeight: 1.5 }}>{message}</div>}
      <Field label={reasonRequired ? "Reason" : "Note"} required={reasonRequired}>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} style={{ ...inputStyle, resize: "vertical" }}
          placeholder={reasonRequired ? "Why is this needed?" : "Optional"} />
      </Field>
    </Modal>
  );
}

/* ----------------------------------------------------------------- Loan details */
const ACTION_COLOR = (a) => (/Deleted/.test(a) ? C.red : /Closed/.test(a) ? C.textSec : /Reopened/.test(a) ? C.amber : /Edited|Updated/.test(a) ? C.teal : C.green);
const changeLines = (h) => {
  const o = h.oldValues || {};
  const n = h.newValues || {};
  const label = { amount: "Amount", borrowedDate: "Borrowed date", repaymentDate: "Date", paymentMethod: "Method", paymentReference: "Reference", notes: "Notes", status: "Status", lenderName: "Lender", name: "Lender name", phone: "Phone", outstanding: "Outstanding", outstandingAfter: "Outstanding after" };
  const show = (k, v) => (v === null || v === undefined || v === "" ? "—" : /amount|outstanding/i.test(k) ? money(v) : String(v));
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => label[k] && k !== "lenderId");
  if (!h.oldValues) return keys.filter((k) => n[k] !== "" && n[k] !== null && n[k] !== undefined).map((k) => `${label[k]}: ${show(k, n[k])}`);
  if (!h.newValues) return keys.map((k) => `${label[k]}: ${show(k, o[k])}`);
  return keys.filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k])).map((k) => `${label[k]}: ${show(k, o[k])} → ${show(k, n[k])}`);
};

function LoanDetail({ loanId, lenders, onBack, onChanged }) {
  const [loan, setLoan] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState(null); // { kind, repayment? }

  const load = async () => {
    try {
      setLoan(await api.get(`/company-loans/${loanId}`));
      setError("");
    } catch (err) {
      setError(err?.message || "This loan couldn't be loaded.");
    }
  };
  useEffect(() => { load(); }, [loanId]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = async (message) => {
    setModal(null);
    setNotice(message);
    await load();
    onChanged();
  };

  if (error && !loan) return <div><Btn secondary small onClick={onBack}>← Back to Company Loans</Btn><div style={{ marginTop: 14 }}><ErrorBox message={error} /></div></div>;
  if (!loan) return <div style={{ padding: 30, textAlign: "center", color: C.textMuted, fontSize: 13 }}>Loading loan…</div>;

  const open = loan.status === "Open";
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Btn secondary small onClick={onBack}>← Back to Company Loans</Btn>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.navy }}>{loan.id} · {loan.lenderName}</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>
              Borrowed {fmtDate(loan.borrowedDate)} · {loan.paymentMethod}{loan.paymentReference ? ` · ${loan.paymentReference}` : ""}{loan.lenderPhone ? ` · ${loan.lenderPhone}` : ""}
            </div>
          </div>
          <StatusBadge loan={loan} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {open && <Btn primary small onClick={() => setModal({ kind: "repay" })} disabled={loan.outstanding <= 0}>+ Record Repayment</Btn>}
          {open && <Btn secondary small onClick={() => setModal({ kind: "edit" })}>Edit Loan</Btn>}
          {open && <Btn secondary small onClick={() => setModal({ kind: "close" })}>Close Loan</Btn>}
          {!open && <Btn secondary small onClick={() => setModal({ kind: "reopen" })}>Reopen</Btn>}
          {loan.repaymentCount === 0 && <Btn secondary small onClick={() => setModal({ kind: "delete" })} style={{ color: C.red }}>Delete Loan</Btn>}
        </div>
      </div>

      {notice && (
        <div role="status" style={{ background: C.greenFaint, color: C.green, borderRadius: 8, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, marginBottom: 14, display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span>{notice}</span>
          <span onClick={() => setNotice("")} style={{ cursor: "pointer" }}>✕</span>
        </div>
      )}
      {!open && (
        <div style={{ background: C.linen, borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: C.textSec, marginBottom: 14 }}>
          This loan is closed{loan.closedAt ? ` (${fmtWhen(loan.closedAt)}${loan.closedBy ? ` by ${loan.closedBy}` : ""})` : ""}.
          {loan.outstanding > 0 && <> <b>{money(loan.outstanding)}</b> is still owed and stays recorded as outstanding.</>}
          {" "}To change it, reopen it with a reason.
        </div>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <StatCard label="Borrowed" value={money(loan.amount)} sub={`Received ${fmtDate(loan.borrowedDate)}`} />
        <StatCard label="Repaid" value={money(loan.repaid)} sub={`${loan.repaymentCount} repayment${loan.repaymentCount === 1 ? "" : "s"}`} color={C.green} />
        <StatCard label="Outstanding" value={money(loan.outstanding)} sub={loan.outstanding > 0 ? "Still owed to the lender" : "Fully repaid"} color={loan.outstanding > 0 ? C.amber : C.green} />
      </div>

      <div style={{ ...cardStyle, padding: 0, marginBottom: 18 }}>
        <div style={{ padding: "14px 18px", fontSize: 14, fontWeight: 700, color: C.navy, borderBottom: `1px solid ${C.border}` }}>Repayment History</div>
        {loan.repayments.length === 0 ? (
          <div style={{ padding: 22, textAlign: "center", fontSize: 12.5, color: C.textMuted }}>No repayments yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>Repayment ID</th><th style={th}>Date</th><th style={{ ...th, textAlign: "right" }}>Amount</th>
                <th style={th}>Method</th><th style={th}>Reference</th><th style={th}>Notes</th><th style={th}>Recorded By</th>{open && <th style={th} />}
              </tr></thead>
              <tbody>
                {loan.repayments.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontWeight: 700 }}>{r.id}</td>
                    <td style={td}>{fmtDate(r.repaymentDate)}</td>
                    <td style={{ ...td, ...num, fontWeight: 700 }}>{money(r.amount)}</td>
                    <td style={td}>{r.paymentMethod}</td>
                    <td style={td}>{r.paymentReference || "—"}</td>
                    <td style={{ ...td, color: C.textSec }}>{r.notes || "—"}</td>
                    <td style={{ ...td, color: C.textSec }}>{r.createdBy || "—"}</td>
                    {open && (
                      <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                        <Btn secondary small onClick={() => setModal({ kind: "editRepayment", repayment: r })}>Edit</Btn>{" "}
                        <Btn secondary small style={{ color: C.red }} onClick={() => setModal({ kind: "deleteRepayment", repayment: r })}>Delete</Btn>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ ...cardStyle, padding: 0 }}>
        <div style={{ padding: "14px 18px", fontSize: 14, fontWeight: 700, color: C.navy, borderBottom: `1px solid ${C.border}` }}>Change History</div>
        <div style={{ padding: "6px 18px 12px" }}>
          {[...loan.history].reverse().map((h) => (
            <div key={h.id} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, color: ACTION_COLOR(h.action) }}>{h.action}{h.repaymentId ? ` · ${h.repaymentId}` : ""}</span>
                <span style={{ color: C.textMuted, fontSize: 11.5 }}>{fmtWhen(h.changedAt)} · {h.changedBy || "—"}</span>
              </div>
              {changeLines(h).length > 0 && <div style={{ color: C.textSec, marginTop: 3 }}>{changeLines(h).join(" · ")}</div>}
              {h.reason && <div style={{ color: C.textSec, marginTop: 3 }}>Reason: {h.reason}</div>}
            </div>
          ))}
        </div>
      </div>

      {modal?.kind === "repay" && <RepaymentModal loan={loan} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === "editRepayment" && <RepaymentModal loan={loan} repayment={modal.repayment} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === "edit" && <LoanModal loan={loan} lenders={lenders} onClose={() => setModal(null)} onSaved={(_, msg) => done(msg)} />}
      {modal?.kind === "deleteRepayment" && (
        <ReasonModal title={`Delete Repayment — ${modal.repayment.id}`} confirmText="Delete Repayment"
          message={`${money(modal.repayment.amount)} paid on ${fmtDate(modal.repayment.repaymentDate)} will be removed from this loan and from the Ledger. The outstanding balance goes back up by this amount.`}
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            const saved = await api.del(`/company-loans/${loan.id}/repayments/${modal.repayment.id}?reason=${encodeURIComponent(reason)}`);
            await done(`Repayment deleted. Outstanding is now ${money(saved.outstanding)}.`);
          }} />
      )}
      {modal?.kind === "close" && (
        <ReasonModal title={`Close Loan — ${loan.id}`} confirmText="Close Loan" reasonRequired={false}
          warning={loan.outstanding > 0 ? <><b>{money(loan.outstanding)} is still unpaid.</b> Closing keeps this amount as an outstanding liability in the records — nothing is written off.</> : null}
          message={loan.outstanding > 0 ? "Close this loan anyway?" : "This loan is fully repaid. Close it?"}
          onClose={() => setModal(null)}
          onConfirm={async (note) => {
            await api.post(`/company-loans/${loan.id}/close`, { acknowledgeOutstanding: true, note });
            await done(loan.outstanding > 0 ? `Loan closed with ${money(loan.outstanding)} still outstanding.` : "Loan closed.");
          }} />
      )}
      {modal?.kind === "reopen" && (
        <ReasonModal title={`Reopen Loan — ${loan.id}`} confirmText="Reopen Loan"
          message="Reopen this loan to correct a mistake. The reason is kept in the loan's history."
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            await api.post(`/company-loans/${loan.id}/reopen`, { reason });
            await done("Loan reopened.");
          }} />
      )}
      {modal?.kind === "delete" && (
        <ReasonModal title={`Delete Loan — ${loan.id}`} confirmText="Delete Loan"
          message={`${money(loan.amount)} from ${loan.lenderName} will be removed, including its Ledger entry. Its history is kept.`}
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            await api.del(`/company-loans/${loan.id}?reason=${encodeURIComponent(reason)}`);
            setModal(null);
            onChanged();
            onBack(`Loan ${loan.id} deleted.`);
          }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Main screen */
export default function CompanyLoans({ onChanged }) {
  const [data, setData] = useState({ loans: [], lenders: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("Open");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedId, setSelectedId] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try {
      setData(await api.get("/company-loans"));
      setError("");
    } catch (err) {
      setError(err?.message || "Company Loans couldn't be loaded.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const changed = () => {
    load();
    onChanged?.(); // Ledger / Cash Flow entries
  };

  const totals = useMemo(() => data.loans.reduce((t, l) => ({
    borrowed: t.borrowed + l.amount,
    repaid: t.repaid + l.repaid,
    outstanding: t.outstanding + Math.max(0, l.outstanding),
    open: t.open + (l.status === "Open" ? 1 : 0),
  }), { borrowed: 0, repaid: 0, outstanding: 0, open: 0 }), [data.loans]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.loans
      .filter((l) => filter === "All" || l.status === filter)
      .filter((l) => !q || l.lenderName.toLowerCase().includes(q));
  }, [data.loans, filter, search]);
  const pageRows = rows.slice((Math.max(1, page) - 1) * pageSize, Math.max(1, page) * pageSize);

  if (selectedId) {
    return (
      <LoanDetail loanId={selectedId} lenders={data.lenders} onChanged={changed}
        onBack={(message) => { setSelectedId(null); if (typeof message === "string") setNotice(message); }} />
    );
  }

  const chip = (key) => (
    <button key={key} onClick={() => { setFilter(key); setPage(1); }}
      style={{ padding: "6px 14px", borderRadius: 999, border: `1px solid ${filter === key ? C.teal : C.border}`, background: filter === key ? C.tealFaint : C.surface, color: filter === key ? C.teal : C.textSec, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
      {key}
    </button>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy }}>Company Loans</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2, maxWidth: 720 }}>
            Money borrowed from lenders and paid back (principal only). Each loan received and each repayment is recorded in the Ledger as cash in / cash out.
            Not counted as revenue or expense, and kept separate from investments, ownership, dividends and exits.
          </div>
        </div>
        <Btn primary onClick={() => setAdding(true)}>+ Add Company Loan</Btn>
      </div>

      {notice && (
        <div role="status" style={{ background: C.greenFaint, color: C.green, borderRadius: 8, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, marginBottom: 14, display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span>{notice}</span>
          <span onClick={() => setNotice("")} style={{ cursor: "pointer" }}>✕</span>
        </div>
      )}
      <ErrorBox message={error} />

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <StatCard label="Total Borrowed" value={money(totals.borrowed)} sub={`${data.loans.length} loan${data.loans.length === 1 ? "" : "s"}`} />
        <StatCard label="Total Repaid" value={money(totals.repaid)} color={C.green} />
        <StatCard label="Outstanding" value={money(totals.outstanding)} sub="Still owed to lenders" color={totals.outstanding > 0 ? C.amber : C.green} />
        <StatCard label="Open Loans" value={totals.open} />
      </div>

      <div style={{ ...cardStyle, padding: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", gap: 6 }}>{["Open", "Closed", "All"].map(chip)}</div>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="🔍 Search lender name" style={{ ...inputStyle, width: 240 }} />
        </div>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: C.textMuted, fontSize: 13 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
            {data.loans.length === 0 ? "No company loans yet. Use + Add Company Loan to record one." : "No loans match this filter."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>Loan ID</th><th style={th}>Lender Name</th><th style={th}>Borrowed Date</th>
                <th style={{ ...th, textAlign: "right" }}>Borrowed Amount</th><th style={{ ...th, textAlign: "right" }}>Repaid Amount</th>
                <th style={{ ...th, textAlign: "right" }}>Outstanding Amount</th><th style={th}>Status</th><th style={th} />
              </tr></thead>
              <tbody>
                {pageRows.map((l) => (
                  <tr key={l.id} onClick={() => { setNotice(""); setSelectedId(l.id); }} style={{ cursor: "pointer" }}>
                    <td style={{ ...td, fontWeight: 700 }}>{l.id}</td>
                    <td style={td}>{l.lenderName}</td>
                    <td style={td}>{fmtDate(l.borrowedDate)}</td>
                    <td style={{ ...td, ...num }}>{money(l.amount)}</td>
                    <td style={{ ...td, ...num, color: C.green }}>{money(l.repaid)}</td>
                    <td style={{ ...td, ...num, fontWeight: 700, color: l.outstanding > 0 ? C.amber : C.textMuted }}>{money(l.outstanding)}</td>
                    <td style={td}><StatusBadge loan={l} /></td>
                    <td style={{ ...td, color: C.teal, fontWeight: 700, textAlign: "right" }}>View ›</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <div style={{ padding: "0 16px 12px" }}>
            <Pagination page={page} pageSize={pageSize} totalCount={rows.length} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
          </div>
        )}
      </div>

      {adding && (
        <LoanModal lenders={data.lenders} onClose={() => setAdding(false)}
          onSaved={(saved, msg) => { setAdding(false); setNotice(msg); changed(); }} />
      )}
    </div>
  );
}
