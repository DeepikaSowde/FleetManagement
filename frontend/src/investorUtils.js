// investorUtils.js — investor money math + XIRR. Business logic lives on the
// frontend (same pattern as ledgerUtils.js / useFleetData.js). Given the flat
// investor_transactions ledger, this derives every figure the Investors module
// shows: totals, holding %, current value, and annualized return.
//
// Decisions baked in (per the design spec's defaults — change here if needed):
//   • Currency is INR (₹) with Indian lakh/crore grouping.
//   • Current Value = capital in (Investments + Reinvestments). Dividends and
//     exits are tracked separately and do NOT reduce Current Value.
//   • XIRR uses every cash flow: IN negative, OUT positive, plus Current Value
//     as a positive terminal flow at the as-of date.

export const TX_TYPES = ["Investment", "Reinvestment", "Dividend", "Exit", "Withdrawal"];

const TYPE_FLOW = {
  Investment: "IN", Reinvestment: "IN",
  Dividend: "OUT", Exit: "OUT", Withdrawal: "OUT",
};
export const flowForType = (type) => TYPE_FLOW[type] || "IN";

// ── Formatting ──────────────────────────────────────────────────────────────
export const fmtINR = (n) => `₹ ${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
export const fmtPct = (x) => (x == null || !isFinite(x) ? "—" : `${(x * 100).toFixed(2)}%`);
export const fmtShortDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const num = (v) => Number(v) || 0;
const txFor = (transactions, investorId) => transactions.filter((t) => t.investorId === investorId);

// ── Per-investor aggregates ──────────────────────────────────────────────────
export function investorTotals(transactions, investorId) {
  const txs = txFor(transactions, investorId);
  const sumTypes = (...types) => txs.filter((t) => types.includes(t.type)).reduce((s, t) => s + num(t.amount), 0);

  const investments = txs
    .filter((t) => t.type === "Investment")
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const firstInvestment = investments.length ? num(investments[0].amount) : 0;
  const totalReinvestment = sumTypes("Reinvestment");
  const totalInvested = sumTypes("Investment", "Reinvestment");
  const totalDividends = sumTypes("Dividend");
  const totalExit = sumTypes("Exit", "Withdrawal");
  const currentValue = totalInvested; // capital in; dividends & exits excluded

  return { firstInvestment, totalReinvestment, totalInvested, totalDividends, totalExit, currentValue };
}

// ── XIRR — annualized return from dated, signed cash flows ────────────────────
// flows: [{ date: "YYYY-MM-DD", amount: signed number }]. Returns a decimal
// rate (0.1113 = 11.13%) or null when it can't be solved.
export function xirr(flows) {
  const valid = flows.filter((f) => f.date && isFinite(f.amount) && f.amount !== 0);
  if (valid.length < 2) return null;
  if (!valid.some((f) => f.amount > 0) || !valid.some((f) => f.amount < 0)) return null;

  const sorted = [...valid].sort((a, b) => new Date(a.date) - new Date(b.date));
  const t0 = new Date(sorted[0].date).getTime();
  const YEAR_MS = 365.25 * 24 * 3600 * 1000;
  const yrs = (d) => (new Date(d).getTime() - t0) / YEAR_MS;
  const npv = (r) => sorted.reduce((s, f) => s + f.amount / Math.pow(1 + r, yrs(f.date)), 0);

  // Newton–Raphson
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const f0 = npv(r);
    const deriv = (npv(r + 1e-6) - f0) / 1e-6;
    if (!isFinite(deriv) || deriv === 0) break;
    let next = r - f0 / deriv;
    if (!isFinite(next)) break;
    if (next <= -0.9999) next = -0.9999 + 1e-6;
    if (Math.abs(next - r) < 1e-7) return next;
    r = next;
  }

  // Bisection fallback on [-0.9999, 10]
  let lo = -0.9999, hi = 10, flo = npv(lo);
  if (!isFinite(flo)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (!isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-6) return mid;
    if ((flo < 0) === (fm < 0)) { lo = mid; flo = fm; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}

// Signed cash-flow series for one investor: IN negative (money leaves the
// investor), OUT positive (returned), plus Current Value as a positive terminal
// flow at the as-of date so an ongoing stake shows a return.
export function investorCashflows(transactions, investorId, asOfISO) {
  const flows = txFor(transactions, investorId).map((t) => ({
    date: t.date,
    amount: (flowForType(t.type) === "IN" ? -1 : 1) * num(t.amount),
  }));
  const { currentValue } = investorTotals(transactions, investorId);
  const asOf = asOfISO || new Date().toISOString().slice(0, 10);
  if (currentValue > 0) flows.push({ date: asOf, amount: currentValue });
  return flows;
}

export const investorXirr = (transactions, investorId, asOfISO) =>
  xirr(investorCashflows(transactions, investorId, asOfISO));

// ── Portfolio-level rollups ──────────────────────────────────────────────────
// One enriched row per investor + the pool total, for the summary table.
export function buildInvestorSummary(investors, transactions, asOfISO) {
  const rows = investors.map((inv) => ({
    ...inv,
    ...investorTotals(transactions, inv.id),
    xirr: investorXirr(transactions, inv.id, asOfISO),
  }));
  const totalCurrent = rows.reduce((s, r) => s + r.currentValue, 0);
  rows.forEach((r) => { r.holdingPct = totalCurrent > 0 ? (r.currentValue / totalCurrent) * 100 : 0; });
  return { rows, totalCurrent };
}

export function portfolioTotals(investors, transactions, asOfISO) {
  const { rows, totalCurrent } = buildInvestorSummary(investors, transactions, asOfISO);
  const allFlows = investors.flatMap((inv) => investorCashflows(transactions, inv.id, asOfISO));
  return {
    totalInvestors: investors.length,
    activeCount: investors.filter((i) => (i.status || "Active") === "Active").length,
    totalCurrent,
    totalInvested: rows.reduce((s, r) => s + r.totalInvested, 0),
    totalDividends: rows.reduce((s, r) => s + r.totalDividends, 0),
    totalExit: rows.reduce((s, r) => s + r.totalExit, 0),
    portXirr: xirr(allFlows),
  };
}

// Running invested value across all IN events over time — for the value
// progress chart (bars = amount added, line = value after).
export function valueProgressSeries(transactions) {
  const ins = transactions
    .filter((t) => flowForType(t.type) === "IN" && t.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  return ins.map((t) => {
    const before = running;
    running += num(t.amount);
    return { date: t.date, label: fmtShortDate(t.date), before, invested: num(t.amount), after: running };
  });
}
