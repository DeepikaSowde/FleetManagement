import { INVESTMENTS } from "./data"; // TEMP: seeded investor capital from the RDK Excel

// Builds the unified, date-sorted ledger transaction list with a running
// balance from the data the app already tracks:
//   • Earnings          -> "Rental Income" credits
//   • Expenses          -> "Expense" debits
//   • Booking deposits  -> "Deposit IN" at pickup / "Deposit OUT" when refunded
//   • Investments       -> "Investment" credits (temp seed from the Excel)
// Shared by the Ledger page and the Ledger Dashboard so both show identical
// balances instead of each re-deriving them and drifting.
export const buildLedgerRows = (earnings = [], expenses = [], bookings = []) => {
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
      const back = b.depositRefundedAmount ?? deposit;
      if (back > 0) {
        rows.push({
          key: `DO-${b.id}`,
          date: (b.depositRefundedAt || b.end || b.start || "").slice(0, 10),
          plate: b.plate || "",
          type: "Deposit OUT",
          description: `Deposit Returned${back < deposit ? " (partial)" : ""}`,
          remarks: b.customer || "—",
          credit: 0,
          debit: back,
        });
      }
    }
  });

  INVESTMENTS.forEach((iv) => {
    rows.push({
      key: `IV-${iv.id}`,
      date: (iv.date || "").slice(0, 10),
      plate: "",
      type: "Investment",
      description: `Investment (${iv.investor})`,
      remarks: iv.investor,
      credit: iv.amount || 0,
      debit: 0,
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
