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

// Builds the unified, date-sorted ledger transaction list with a running
// balance from the data the app already tracks:
//   • Earnings          -> "Rental Income" credits
//   • Expenses          -> "Expense" debits
//   • Booking deposits  -> "Deposit IN" at pickup / "Deposit OUT" when refunded
//   • Investor capital  -> "Investment" credits, taken LIVE from the Investors
//                          module (every investor's First Investment +
//                          Reinvestment, i.e. their IN transactions).
// Shared by the Ledger page and the Ledger Dashboard so both show identical
// balances instead of each re-deriving them and drifting.
export const buildLedgerRows = (earnings = [], expenses = [], bookings = [], investors = []) => {
  const rows = [];

  earnings.forEach((e) => {
    rows.push({
      key: `E-${e.id}`,
      date: (e.end || e.start || "").slice(0, 10),
      plate: e.plate || "",
      type: "Rental Income",
      description: `Rental Income${e.days ? ` - ${e.days} Day${e.days > 1 ? "s" : ""}` : ""}`,
      remarks: e.customer || "—",
      credit: e.total || 0,
      debit: 0,
    });
  });

  expenses.forEach((x) => {
    rows.push({
      key: `X-${x.id}`,
      date: (x.date || "").slice(0, 10),
      plate: x.plate || "",
      type: "Expense",
      description: x.desc || x.category || "Expense",
      remarks: x.category || "—",
      credit: 0,
      debit: x.amount || 0,
    });
  });

  bookings.forEach((b) => {
    const deposit = Number(b.deductible) || 0;
    if (deposit > 0) {
      rows.push({
        key: `DI-${b.id}`,
        date: (b.start || "").slice(0, 10),
        plate: b.plate || "",
        type: "Deposit IN",
        description: "Security Deposit",
        remarks: b.customer || "—",
        credit: deposit,
        debit: 0,
      });
    }
    if (b.depositRefunded) {
      const back = b.depositRefundedAmount ?? deposit;   // cash actually returned to the customer
      const forfeited = Math.max(0, deposit - back);      // shortfall the business keeps
      const settledDate = (b.depositRefundedAt || b.end || b.start || "").slice(0, 10);
      if (back > 0) {
        rows.push({
          key: `DO-${b.id}`,
          date: settledDate,
          plate: b.plate || "",
          type: "Deposit OUT",
          description: `Deposit Returned${forfeited > 0 ? " (partial)" : ""}`,
          remarks: b.customer || "—",
          credit: 0,
          debit: back,
        });
      }
      // Whatever isn't returned is retained and recognized as income. Booked as
      // a reclassification: the kept amount leaves the deposit (debit) and enters
      // income (credit) on the same day, so the running balance is unchanged
      // while the ledger now surfaces it under "Deposit Income" instead of
      // leaving it silently inside the net Deposit IN/OUT.
      if (forfeited > 0) {
        rows.push({
          key: `DF-${b.id}`,
          date: settledDate,
          plate: b.plate || "",
          type: "Deposit OUT",
          description: "Deposit Retained (moved to income)",
          remarks: b.customer || "—",
          credit: 0,
          debit: forfeited,
        });
        rows.push({
          key: `DFI-${b.id}`,
          date: settledDate,
          plate: b.plate || "",
          type: "Deposit Income",
          description: `Forfeited Deposit — retained ${forfeited} of ${deposit}`,
          remarks: b.customer || "—",
          credit: forfeited,
          debit: 0,
        });
      }
    }
  });

  // Real investor capital: each investor's IN transactions (First Investment +
  // Reinvestment) become "Investment" credits. Dividends / exits (OUT) are the
  // investor module's own concern and are intentionally NOT posted here, so the
  // ledger's investment total stays the gross capital brought in.
  investors.forEach((inv) => {
    (inv.transactions || []).forEach((t) => {
      if (flowForType(t.type) !== "IN") return;
      rows.push({
        key: `IV-${t.id}`,
        date: (t.date || "").slice(0, 10),
        plate: "",
        type: "Investment",
        description: `${t.type} (${inv.name})`,
        remarks: inv.name,
        credit: Number(t.amount) || 0,
        debit: 0,
      });
    });
  });

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
  let bal = 0;
  rows.forEach((r) => {
    bal += r.credit - r.debit;
    r.balance = bal;
  });
  return rows;
};
