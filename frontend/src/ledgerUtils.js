import { flowForType } from "./Investors";

// Income from forfeited security deposits — the part of a deposit that was NOT
// returned to the customer (deposit − returned). This is real income on top of
// rental earnings, so the P&L / income totals add it in. Optionally scoped by a
// date-string prefix (e.g. "2026" or "2026-08", matched on the settlement date)
// and/or a plate, so it composes with the same month/car filters earnings use.
export const forfeitedDepositIncome = (bookings = [], { prefix = "", plate = null } = {}) =>
  bookings.reduce((sum, b) => {
    if (!b.depositRefunded) return sum;
    if (plate && b.plate !== plate) return sum;
    const deposit = Number(b.deductible) || 0;
    const back = b.depositRefundedAmount ?? deposit;
    const forfeited = Math.max(0, deposit - back);
    if (forfeited <= 0) return sum;
    const date = (b.depositRefundedAt || b.end || b.start || "").slice(0, 10);
    if (prefix && !date.startsWith(prefix)) return sum;
    return sum + forfeited;
  }, 0);

// Booking payments, normalized the same way Booking.jsx / useFleetData.js
// treat legacy data: prefer the real `payments` array; for older bookings
// that only ever had the single `amountCollected` field, synthesize one
// payment entry from it so nothing is silently dropped from the ledger.
const normalizedPayments = (b) =>
  b.payments || (Number(b.amountCollected) > 0
    ? [{ id: "seed", amount: Number(b.amountCollected), method: b.paymentMethod || "Cash", reference: b.referenceCode || "", addedAt: b.createdAt || null }]
    : []);

// Builds the unified, date-sorted ledger transaction list with a running
// balance from the data the app already tracks:
//   • Booking payments  -> "Rental Income" credits, ONE ROW PER PAYMENT,
//                          dated to when that payment was actually received
//                          (`payment.addedAt`) — not per booking and not on
//                          an accrual/handover basis. This is intentionally
//                          different from the `earnings` records used by the
//                          Earnings tab / P&L, which still recognize the full
//                          rental total at handover; the Ledger instead
//                          reflects real cash movements as they happen, so a
//                          customer paying in installments shows up as
//                          separate, correctly-dated entries instead of one
//                          lump sum.
//   • Expenses          -> "Expense" debits
//   • Booking deposits  -> "Deposit IN" at pickup / "Deposit OUT" when refunded
//   • Investor capital  -> "Investment" credits, taken LIVE from the Investors
//                          module (every investor's First Investment +
//                          Reinvestment, i.e. their IN transactions).
// Shared by the Ledger page and the Ledger Dashboard so both show identical
// balances instead of each re-deriving them and drifting.
// `earnings` is accepted for interface stability with existing callers but is
// no longer used to build Rental Income rows — see above.
export const buildLedgerRows = (earnings = [], expenses = [], bookings = [], investors = []) => {
  const rows = [];
  // Insertion-order fallback for rows whose source data has no time
  // component (just a date) — e.g. an Expense's `date` field. Two such rows
  // on the same day fall back to the order they were added to their source
  // array (assumed chronological, since new items are appended), rather than
  // an arbitrary string-key comparison.
  let seq = 0;
  const push = (row, tsSource) => {
    seq += 1;
    row.ts = tsSource ? Date.parse(tsSource) : NaN;
    row.seq = seq;
    rows.push(row);
  };

  expenses.forEach((x) => {
    push({
      key: `X-${x.id}`,
      date: (x.date || "").slice(0, 10),
      plate: x.plate || "",
      type: "Expense",
      description: x.desc || x.category || "Expense",
      remarks: x.category || "—",
      credit: 0,
      debit: x.amount || 0,
    }, x.createdAt || x.date);
  });

  bookings.forEach((b) => {
    if (b.rentalType === "monthly") {
      // Long-term contract: rent income comes from the collected months in the
      // rent schedule, dated to when each month was actually collected — even
      // for a cancelled contract (the months paid before cancellation are real
      // income). Its `payments` array is intentionally ignored to avoid double
      // counting Month-1.
      (b.rentSchedule || []).forEach((row) => {
        if (!row.paid) return;
        const amt = Number(row.amount) || 0;
        if (amt <= 0) return;
        push({
          key: `RM-${b.id}-${row.month}`,
          date: (row.paidAt || row.dueDate || b.start || "").slice(0, 10),
          plate: b.plate || "",
          type: "Rental Income",
          description: `Month ${row.month} Rent (${row.method || "Cash"})`,
          remarks: b.customer || "—",
          credit: amt,
          debit: 0,
        }, row.paidAt || row.dueDate || b.start);
      });
    } else if (!b.cancelled) {
      normalizedPayments(b).forEach((p) => {
        const amt = Number(p.amount) || 0;
        if (amt <= 0) return;
        push({
          key: `RI-${b.id}-${p.id}`,
          date: (p.addedAt || b.start || "").slice(0, 10),
          plate: b.plate || "",
          type: "Rental Income",
          description: `Rental Payment (${p.method || "Cash"})`,
          remarks: b.customer || "—",
          credit: amt,
          debit: 0,
        }, p.addedAt || b.start);
      });
    }

    const deposit = Number(b.deductible) || 0;
    if (deposit > 0) {
      push({
        key: `DI-${b.id}`,
        date: (b.start || "").slice(0, 10),
        plate: b.plate || "",
        type: "Deposit IN",
        description: "Security Deposit",
        remarks: b.customer || "—",
        credit: deposit,
        debit: 0,
      }, b.createdAt || b.start);
    }
    if (b.depositRefunded) {
      const back = b.depositRefundedAmount ?? deposit;   // cash actually returned to the customer
      const forfeited = Math.max(0, deposit - back);      // shortfall the business keeps
      const settledDate = (b.depositRefundedAt || b.end || b.start || "").slice(0, 10);
      if (back > 0) {
        push({
          key: `DO-${b.id}`,
          date: settledDate,
          plate: b.plate || "",
          type: "Deposit OUT",
          description: `Deposit Returned${forfeited > 0 ? " (partial)" : ""}`,
          remarks: b.customer || "—",
          credit: 0,
          debit: back,
        }, b.depositRefundedAt);
      }
      // Whatever isn't returned is retained and recognized as income. Booked as
      // a reclassification: the kept amount leaves the deposit (debit) and enters
      // income (credit) on the same day, so the running balance is unchanged
      // while the ledger now surfaces it under "Deposit Income" instead of
      // leaving it silently inside the net Deposit IN/OUT.
      if (forfeited > 0) {
        push({
          key: `DF-${b.id}`,
          date: settledDate,
          plate: b.plate || "",
          type: "Deposit OUT",
          description: "Deposit Retained (moved to income)",
          remarks: b.customer || "—",
          credit: 0,
          debit: forfeited,
        }, b.depositRefundedAt);
        push({
          key: `DFI-${b.id}`,
          date: settledDate,
          plate: b.plate || "",
          type: "Deposit Income",
          description: `Forfeited Deposit — retained ${forfeited} of ${deposit}`,
          remarks: b.customer || "—",
          credit: forfeited,
          debit: 0,
        }, b.depositRefundedAt);
      }
    }

    // Cancelled long-term contract: the deposit returned to the customer is a
    // cash OUTFLOW (a returned liability), never revenue. Booked as Deposit OUT
    // on the cancellation date so it reduces the running cash balance without
    // touching income.
    if (b.cancelled && Number(b.depositOut) > 0) {
      push({
        key: `DOC-${b.id}`,
        date: (b.cancelledAt || b.end || b.start || "").slice(0, 10),
        plate: b.plate || "",
        type: "Deposit OUT",
        description: `Deposit Refund — contract cancelled${b.depositRefundRef ? ` · ${b.depositRefundRef}` : ""}`,
        remarks: b.customer || "—",
        credit: 0,
        debit: Number(b.depositOut) || 0,
      }, b.cancelledAt);
    }
  });

  // Real investor capital: each investor's IN transactions (First Investment +
  // Reinvestment) become "Investment" credits. Dividends / exits (OUT) are the
  // investor module's own concern and are intentionally NOT posted here, so the
  // ledger's investment total stays the gross capital brought in.
  investors.forEach((inv) => {
    (inv.transactions || []).forEach((t) => {
      if (flowForType(t.type) !== "IN") return;
      push({
        key: `IV-${t.id}`,
        date: (t.date || "").slice(0, 10),
        plate: "",
        type: "Investment",
        description: `${t.type} (${inv.name})`,
        remarks: inv.name,
        credit: Number(t.amount) || 0,
        debit: 0,
      }, t.date);
    });
  });

  // Sort ascending by date; within the same date, by the row's actual
  // recorded time when we have one (payment.addedAt, depositRefundedAt,
  // etc.), and finally by insertion sequence as a last-resort tie-break for
  // rows with only a bare date. The Ledger UI reverses this list for
  // display, so the item that sorts LAST here is the one shown at the very
  // top — i.e. the most recently recorded entry on a given day.
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const aTs = Number.isNaN(a.ts) ? -Infinity : a.ts;
    const bTs = Number.isNaN(b.ts) ? -Infinity : b.ts;
    if (aTs !== bTs) return aTs - bTs;
    return a.seq - b.seq;
  });
  let bal = 0;
  rows.forEach((r) => {
    bal += r.credit - r.debit;
    r.balance = bal;
  });
  return rows;
};