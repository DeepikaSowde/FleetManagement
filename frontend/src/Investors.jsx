import { useState, useMemo } from "react";
import { C } from "./theme";
import { Btn, Badge, Modal, Input, Select, StatusTag } from "./components";

/* =====================================================================================
   INVESTOR MODULE - calculation engine
   -------------------------------------------------------------------------------------
   Every screen in this module (Overview Dashboard, Investor List, Investor Detail ->
   Overview/Investments/Transactions/Dividends/Exit-Withdrawals/Calculations) reads
   numbers from the SAME set of functions below. Nothing is hardcoded - every figure is
   derived from the investor's actual transaction log, so if the formulas below are
   correct, every screen that uses them is automatically consistent.

   RULES (as specified):
   - Total Invested        = First Investment + all Reinvestments            (IN)
   - Total Dividends       = sum of all Dividend transactions                (OUT)
   - Total Exit/Withdrawal = sum of all Exit/Withdrawal transactions         (OUT)
   - Current Value         = Total Invested - Total Dividends - Total Exit
   - Net Cash Flow         = Total Cash IN - Total Cash OUT
   - Holding %             = Investor Current Value / Total Current Value (all
                             investors) x 100
   - XIRR                  = solved from every actual transaction date & signed cash flow,
                             plus the investor's Latest Current Value added as one final
                             positive cash flow dated today. Captures realized + unrealized.

   PERSISTENCE: this component is prop-driven. `investors` (each with an embedded
   `transactions` array) comes from useFleetData, backed by the /api/investors and
   /api/investor-transactions endpoints. Creating an investor / transaction calls back
   up so the change is written to the database and survives a refresh.
   ===================================================================================== */

export const TXN_TYPES = {
  FIRST_INVESTMENT: "First Investment",
  REINVESTMENT: "Reinvestment",
  DIVIDEND: "Dividend",
  EXIT: "Exit / Withdrawal",
};

const IN_TYPES = [TXN_TYPES.FIRST_INVESTMENT, TXN_TYPES.REINVESTMENT];
const OUT_TYPES = [TXN_TYPES.DIVIDEND, TXN_TYPES.EXIT];

export function flowForType(type) {
  return OUT_TYPES.includes(type) ? "OUT" : "IN";
}

const sumByType = (txns, types) =>
  txns.filter((t) => types.includes(t.type)).reduce((s, t) => s + Number(t.amount || 0), 0);

// ---- Per-investor metrics - the single source of truth for one investor ----
export function computeInvestorMetrics(investor) {
  const txns = investor?.transactions || [];

  const firstInvestment = sumByType(txns, [TXN_TYPES.FIRST_INVESTMENT]);
  const reinvestment = sumByType(txns, [TXN_TYPES.REINVESTMENT]);
  const totalDividends = sumByType(txns, [TXN_TYPES.DIVIDEND]);
  const totalExit = sumByType(txns, [TXN_TYPES.EXIT]);

  const totalInvested = firstInvestment + reinvestment;
  const currentValue = totalInvested - totalDividends - totalExit;

  const totalCashIn = firstInvestment + reinvestment;
  const totalCashOut = totalDividends + totalExit;
  const netCashFlow = totalCashIn - totalCashOut;

  return {
    firstInvestment,
    reinvestment,
    totalInvested,
    totalDividends,
    totalExit,
    currentValue,
    totalCashIn,
    totalCashOut,
    netCashFlow,
  };
}

// ---- Holding % needs the whole pool, so it's computed across all investors at once ----
export function computeHoldingPercents(investors) {
  const metricsById = {};
  let totalCurrentValue = 0;
  (investors || []).forEach((inv) => {
    const m = computeInvestorMetrics(inv);
    metricsById[inv.id] = m;
    totalCurrentValue += m.currentValue;
  });
  (investors || []).forEach((inv) => {
    const m = metricsById[inv.id];
    m.holdingPct = totalCurrentValue > 0 ? (m.currentValue / totalCurrentValue) * 100 : 0;
  });
  return { metricsById, totalCurrentValue };
}

// ---- XIRR solver: Excel-XIRR-equivalent, solves for r such that
//      sum( CF_i / (1+r)^((date_i - date0)/365) ) = 0 ----
function xnpv(rate, cashflows) {
  const t0 = cashflows[0].date;
  return cashflows.reduce((sum, cf) => {
    const days = (cf.date - t0) / (1000 * 60 * 60 * 24);
    return sum + cf.amount / Math.pow(1 + rate, days / 365);
  }, 0);
}

export function computeXIRR(rawCashflows) {
  if (!rawCashflows || rawCashflows.length < 2) return null;
  const cashflows = [...rawCashflows].sort((a, b) => a.date - b.date);
  const hasPositive = cashflows.some((c) => c.amount > 0);
  const hasNegative = cashflows.some((c) => c.amount < 0);
  if (!hasPositive || !hasNegative) return null; // undefined without both a cash-in and cash-out

  // If every cash flow falls on the same calendar day there's no elapsed time to
  // annualize over, so the discount factor collapses to 1 for every r and the search
  // would "converge" on an artifact of the bracket. Reporting undefined is honest.
  const t0 = cashflows[0].date;
  const spanDays = (cashflows[cashflows.length - 1].date - t0) / (1000 * 60 * 60 * 24);
  if (spanDays < 1) return null;

  // Tolerance scaled to the money actually moving, rather than a fixed absolute epsilon.
  const totalAbs = cashflows.reduce((s, c) => s + Math.abs(c.amount), 0);
  const tol = Math.max(1e-6, totalAbs * 1e-9);

  let low = -0.9999;
  let high = 10;
  let fLow = xnpv(low, cashflows);
  let fHigh = xnpv(high, cashflows);
  let tries = 0;
  while (fLow * fHigh > 0 && tries < 60) {
    high *= 2;
    fHigh = xnpv(high, cashflows);
    tries++;
  }
  if (fLow * fHigh > 0) return null; // no bracket found - not solvable

  let mid = 0;
  for (let i = 0; i < 200; i++) {
    mid = (low + high) / 2;
    const fMid = xnpv(mid, cashflows);
    if (Math.abs(fMid) < tol) break;
    if (fLow * fMid < 0) {
      high = mid;
      fHigh = fMid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }
  return mid * 100; // as a percentage
}

// Every actual transaction, real date, signed by direction - Investment/Reinvestment
// negative (money leaving the investor), Dividend/Exit-Withdrawal positive - plus the
// investor's Latest Current Value appended as a final positive cash flow dated today.
export function buildInvestorXIRRCashflows(investor) {
  const txns = investor?.transactions || [];
  const flows = txns.map((t) => ({
    date: new Date(t.date + "T00:00:00"),
    amount: flowForType(t.type) === "IN" ? -Number(t.amount || 0) : Number(t.amount || 0),
    label: t.type,
  }));
  if (txns.length > 0) {
    const { currentValue } = computeInvestorMetrics(investor);
    flows.push({
      date: new Date(todayISO() + "T00:00:00"),
      amount: currentValue,
      label: "Latest Current Value",
    });
  }
  return flows;
}

export function getInvestorXIRR(investor) {
  return computeXIRR(buildInvestorXIRRCashflows(investor));
}

// Portfolio-level XIRR: every transaction from every investor, plus the sum of every
// investor's Latest Current Value as one final positive cash flow dated today.
export function buildPortfolioXIRRCashflows(investors) {
  const flows = [];
  (investors || []).forEach((inv) => {
    (inv.transactions || []).forEach((t) => {
      flows.push({
        date: new Date(t.date + "T00:00:00"),
        amount: flowForType(t.type) === "IN" ? -Number(t.amount || 0) : Number(t.amount || 0),
        label: `${inv.name} - ${t.type}`,
      });
    });
  });
  if (flows.length > 0) {
    const totalCurrentValue = (investors || []).reduce(
      (sum, inv) => sum + computeInvestorMetrics(inv).currentValue,
      0
    );
    flows.push({
      date: new Date(todayISO() + "T00:00:00"),
      amount: totalCurrentValue,
      label: "Total Latest Current Value",
    });
  }
  return flows;
}

export function computePortfolioXIRR(investors) {
  return computeXIRR(buildPortfolioXIRRCashflows(investors));
}

// Period-bucketed IN-event series (First Investment + Reinvestment, across ALL
// investors) used to drive the "Value Progress" chart. Before/After are running totals
// of Total Invested. Periods with no activity are skipped.
export function buildValueProgressSeries(investors, granularity = "monthly") {
  const events = [];
  (investors || []).forEach((inv) => {
    (inv.transactions || []).forEach((t) => {
      if (IN_TYPES.includes(t.type)) {
        events.push({ date: t.date, amount: Number(t.amount || 0), investor: inv.name, type: t.type });
      }
    });
  });
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const periodKey = (iso) => (granularity === "yearly" ? iso.slice(0, 4) : iso.slice(0, 7));
  const periodLabel = (key) => {
    if (granularity === "yearly") return key;
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  };

  const buckets = new Map();
  events.forEach((e) => {
    const key = periodKey(e.date);
    if (!buckets.has(key)) buckets.set(key, { key, injected: 0, count: 0, investments: 0, reinvestments: 0 });
    const b = buckets.get(key);
    b.injected += e.amount;
    b.count += 1;
    if (e.type === TXN_TYPES.REINVESTMENT) b.reinvestments += e.amount;
    else b.investments += e.amount;
  });

  const sortedKeys = Array.from(buckets.keys()).sort();
  let running = 0;
  return sortedKeys.map((key, idx) => {
    const b = buckets.get(key);
    const before = running;
    running += b.injected;
    return { idx, key, label: periodLabel(key), before, injected: b.injected, after: running, count: b.count, investments: b.investments, reinvestments: b.reinvestments };
  });
}

/* =========================================================== formatting helpers === */
const fmtINR = (n) => {
  const num = Number(n || 0);
  const sign = num < 0 ? "-" : "";
  return `${sign}₹${Math.abs(num).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};
const fmtPct = (n, digits = 2) => (n === null || n === undefined || isNaN(n) ? "—" : `${Number(n).toFixed(digits)}%`);
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/* ============================================================ local color palette === */
const IC = {
  primary: C.teal,
  primaryLight: C.tealFaint || C.tealLight,
  green: "#16A34A",
  greenLight: "#DCFCE7",
  red: C.red || "#DC2626",
  redLight: "#FEE2E2",
  purple: "#7C3AED",
  purpleLight: "#EDE9FE",
  amber: C.amber || "#D97706",
  amberLight: "#FEF3C7",
  slate: "#94A3B8",
};

const TYPE_COLOR = {
  [TXN_TYPES.FIRST_INVESTMENT]: IC.green,
  [TXN_TYPES.REINVESTMENT]: IC.green,
  [TXN_TYPES.DIVIDEND]: IC.red,
  [TXN_TYPES.EXIT]: IC.red,
};

/* ==================================================================== UI atoms === */
const cardStyle = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 };
const labelStyle = { fontSize: 10.5, fontWeight: 700, color: C.textMuted, letterSpacing: 0.4, textTransform: "uppercase" };
const inputStyle = { width: "100%", padding: "9px 11px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: C.surface, color: C.textPri };

function StatCard({ label, value, valueColor, sub, subColor, icon }) {
  return (
    <div style={{ ...cardStyle, padding: "16px 18px", flex: 1, minWidth: 150 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {icon && <span style={{ fontSize: 15 }}>{icon}</span>}
        <span style={labelStyle}>{label}</span>
      </div>
      <div style={{ fontSize: 21, fontWeight: 800, color: valueColor || C.navy, lineHeight: 1.15 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: subColor || C.textMuted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function StatRow({ children }) {
  return <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>{children}</div>;
}

function EmptyState({ title, message, actionLabel, onAction }) {
  return (
    <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px", color: C.textMuted }}>
      <div style={{ fontSize: 30, marginBottom: 10 }}>💼</div>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: C.navy, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12.5, marginBottom: actionLabel ? 18 : 0 }}>{message}</div>
      {actionLabel && <Btn primary onClick={onAction}>{actionLabel}</Btn>}
    </div>
  );
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 18, flexWrap: "wrap" }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            padding: "10px 14px",
            fontSize: 12.5,
            fontWeight: 700,
            color: active === t.key ? IC.primary : C.textMuted,
            background: "none",
            border: "none",
            borderBottom: active === t.key ? `2px solid ${IC.primary}` : "2px solid transparent",
            cursor: "pointer",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function FlowPill({ flow }) {
  const isIn = flow === "IN";
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 800,
        padding: "3px 9px",
        borderRadius: 20,
        background: isIn ? IC.greenLight : IC.redLight,
        color: isIn ? IC.green : IC.red,
      }}
    >
      {flow}
    </span>
  );
}

const th = { textAlign: "left", padding: "10px 12px", fontSize: 10.5, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.3, borderBottom: `1px solid ${C.border}` };
const td = { padding: "11px 12px", fontSize: 12.5, color: C.textPri, borderBottom: `1px solid ${C.border}` };

function TxnTable({ rows, emptyMessage }) {
  if (!rows.length) {
    return <div style={{ padding: "28px 12px", textAlign: "center", color: C.textMuted, fontSize: 12.5 }}>{emptyMessage}</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Date</th>
            <th style={th}>Type</th>
            <th style={th}>Flow</th>
            <th style={{ ...th, textAlign: "right" }}>Amount</th>
            <th style={th}>Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td style={td}>{fmtDate(t.date)}</td>
              <td style={{ ...td, fontWeight: 600 }}>{t.type}</td>
              <td style={td}><FlowPill flow={flowForType(t.type)} /></td>
              <td style={{ ...td, textAlign: "right", fontWeight: 700, color: TYPE_COLOR[t.type] }}>
                {flowForType(t.type) === "OUT" ? "-" : "+"}{fmtINR(t.amount)}
              </td>
              <td style={{ ...td, color: C.textMuted }}>{t.description || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ========================================================================= charts === */
function DonutChart({ segments, size = 170, thickness = 26, centerTitle, centerValue }) {
  const total = segments.reduce((s, seg) => s + Math.max(seg.value, 0), 0);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`translate(${size / 2},${size / 2}) rotate(-90)`}>
        {total <= 0 ? (
          <circle r={r} fill="none" stroke={C.border} strokeWidth={thickness} />
        ) : (
          segments.map((seg, i) => {
            const value = Math.max(seg.value, 0);
            const frac = value / total;
            const len = frac * circumference;
            const dasharray = `${len} ${circumference - len}`;
            const dashoffset = -offset;
            offset += len;
            return <circle key={i} r={r} fill="none" stroke={seg.color} strokeWidth={thickness} strokeDasharray={dasharray} strokeDashoffset={dashoffset} />;
          })
        )}
      </g>
      <text x="50%" y="46%" textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: C.textMuted }}>{centerTitle}</text>
      <text x="50%" y="59%" textAnchor="middle" style={{ fontSize: 19, fontWeight: 800, fill: C.navy }}>{centerValue}</text>
    </svg>
  );
}

function roundedTopBarPath(x, y, w, h, r) {
  if (h <= 0) return "";
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + radius} Q${x},${y} ${x + radius},${y} L${x + w - radius},${y} Q${x + w},${y} ${x + w},${y + radius} L${x + w},${y + h} Z`;
}

function niceAxisMax(v) {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const norm = v / base;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return niceNorm * base;
}

// Compact rupee formatter for axis labels: K / L (Lakh) / Cr (Crore).
function fmtINRCompact(n) {
  const num = Number(n || 0);
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

// Grouped bar chart - three bars per event (Value Before / Investment-Reinvestment /
// Value After), using this app's own light theme colors.
function ValueProgressChart({ data, height = 300, granularity, onGranularityChange }) {
  const toggleBtn = (key, label) => (
    <button
      key={key}
      onClick={() => onGranularityChange(key)}
      style={{
        padding: "5px 12px",
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 20,
        cursor: "pointer",
        border: `1px solid ${granularity === key ? IC.primary : C.border}`,
        background: granularity === key ? IC.primaryLight : "transparent",
        color: granularity === key ? IC.primary : C.textMuted,
      }}
    >
      {label}
    </button>
  );

  const header = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 18, fontSize: 11, color: C.textMuted, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: "#3B82F6" }} />
          Value Before
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: IC.green }} />
          Investment / Reinvestment
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: IC.purple }} />
          Value After
        </span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {toggleBtn("monthly", "Monthly")}
        {toggleBtn("yearly", "Yearly")}
      </div>
    </div>
  );

  if (!data.length) {
    return (
      <div>
        {header}
        <div style={{ padding: "40px 12px", textAlign: "center", color: C.textMuted, fontSize: 12.5 }}>No investment or reinvestment activity yet.</div>
      </div>
    );
  }

  const barW = 26;
  const barGap = 7;
  const groupW = barW * 3 + barGap * 2;
  const groupGap = 34;
  const width = Math.max(560, data.length * (groupW + groupGap) + groupGap);
  const padL = 56, padR = 16, padT = 20, padB = 40;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxRaw = Math.max(1, ...data.map((d) => d.before), ...data.map((d) => d.injected), ...data.map((d) => d.after));
  const maxVal = niceAxisMax(maxRaw * 1.15);

  const yFor = (v) => padT + plotH - (Math.max(0, v) / maxVal) * plotH;
  const xForGroup = (i) => padL + groupGap / 2 + i * (groupW + groupGap);

  return (
    <div>
      {header}
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const y = padT + plotH * (1 - f);
          return (
            <g key={i}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke={C.border} strokeDasharray="4 4" />
              <text x={padL - 8} y={y + 3} textAnchor="end" style={{ fontSize: 10, fill: C.textMuted }}>
                {fmtINRCompact(maxVal * f)}
              </text>
            </g>
          );
        })}
        <line x1={padL} x2={width - padR} y1={padT + plotH} y2={padT + plotH} stroke={C.border} />

        {data.map((d, i) => {
          const gx = xForGroup(i);
          const bars = [
            { key: "before", value: d.before, color: "#3B82F6", label: "Value Before" },
            { key: "injected", value: d.injected, color: IC.green, label: "Investment / Reinvestment" },
            { key: "after", value: d.after, color: IC.purple, label: "Value After" },
          ];
          return (
            <g key={d.key}>
              {bars.map((b, bi) => {
                const bx = gx + bi * (barW + barGap);
                const by = yFor(b.value);
                const bh = padT + plotH - by;
                return (
                  <path key={b.key} d={roundedTopBarPath(bx, by, barW, bh, 5)} fill={b.color} opacity={0.88}>
                    <title>{`${b.label} - ${d.label}\n${fmtINR(b.value)}${b.key === "injected" ? ` (${d.count} txn${d.count === 1 ? "" : "s"})` : ""}`}</title>
                  </path>
                );
              })}
              <text x={gx + groupW / 2} y={height - 12} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 700, fill: C.navy }}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ========================================================================= modals === */
function InvestorFormModal({ open, investor, investors, onClose, onSave, onReinvestExisting }) {
  const isEdit = !!investor;
  const [form, setForm] = useState(() => ({
    name: investor?.name || "",
    investorId: investor?.investorId || "",
    status: investor?.status || "Active",
    firstAmount: "",
    firstDate: todayISO(),
  }));

  if (!open) return null;

  const duplicateMatch =
    !isEdit && form.name.trim()
      ? (investors || []).find((inv) => inv.name.trim().toLowerCase() === form.name.trim().toLowerCase())
      : null;

  const submit = () => {
    if (!form.name.trim()) { alert("Please enter the investor's name."); return; }
    if (!form.investorId.trim()) { alert("Please enter the investor ID."); return; }

    if (isEdit) {
      onSave({ name: form.name.trim(), investorId: form.investorId.trim(), status: form.status });
      return;
    }

    const amt = Number(form.firstAmount);
    if (!amt || amt <= 0) { alert("Please enter a valid first investment amount greater than 0."); return; }
    if (!form.firstDate) { alert("Please select the first investment date."); return; }

    onSave({
      name: form.name.trim(),
      investorId: form.investorId.trim(),
      status: form.status,
      since: form.firstDate,
      transactions: [{ id: uid("txn"), type: TXN_TYPES.FIRST_INVESTMENT, date: form.firstDate, amount: amt, description: "" }],
    });
  };

  return (
    <Modal open={open} title={investor ? "Edit Investor" : "Add Investor"} onClose={onClose} onSubmit={submit} submitText={investor ? "Save Changes" : "Add Investor"}>
      <Input label="Investor Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., Investor A" />
      {duplicateMatch && (
        <div style={{ fontSize: 11.5, color: C.textSec, background: IC.amberLight, border: `1px solid ${IC.amber}33`, borderRadius: 8, padding: "10px 12px", marginTop: -8, marginBottom: 14, lineHeight: 1.6 }}>
          <b>"{duplicateMatch.name}"</b> already exists as an investor. If this is the same person putting in more money, add it as a <b>Reinvestment</b> instead of a new investor.
          <div style={{ marginTop: 8 }}>
            <Btn onClick={() => onReinvestExisting(duplicateMatch.id)}>Add Reinvestment for {duplicateMatch.name}</Btn>
          </div>
        </div>
      )}
      <Input label="Investor ID" value={form.investorId} onChange={(e) => setForm({ ...form, investorId: e.target.value })} placeholder="e.g., INV-001" />
      {!isEdit && (
        <>
          <Input label="First Investment Amount (₹)" type="number" value={form.firstAmount} onChange={(e) => setForm({ ...form, firstAmount: e.target.value })} placeholder="e.g., 100000" />
          <Input label="First Investment Date" type="date" value={form.firstDate} onChange={(e) => setForm({ ...form, firstDate: e.target.value })} />
        </>
      )}
    </Modal>
  );
}

function TransactionFormModal({ open, investorName, presetType, editingTxn, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    type: editingTxn?.type || presetType || TXN_TYPES.FIRST_INVESTMENT,
    date: editingTxn?.date || todayISO(),
    amount: editingTxn?.amount ?? "",
    description: editingTxn?.description || "",
  }));

  if (!open) return null;

  const submit = () => {
    const amt = Number(form.amount);
    if (!amt || amt <= 0) { alert("Please enter a valid amount greater than 0."); return; }
    if (!form.date) { alert("Please select a date."); return; }
    onSave({ ...form, amount: amt });
  };

  return (
    <Modal
      open={open}
      title={editingTxn ? "Edit Transaction" : `Add Transaction${investorName ? " - " + investorName : ""}`}
      onClose={onClose}
      onSubmit={submit}
      submitText={editingTxn ? "Save Changes" : "Add Transaction"}
    >
      <Select
        label="Type"
        value={form.type}
        onChange={(e) => setForm({ ...form, type: e.target.value })}
        options={Object.values(TXN_TYPES).map((t) => ({ value: t, label: `${t} (${flowForType(t)})` }))}
      />
      <Input label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
      <Input label="Amount (₹)" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="e.g., 100000" />
      <Input label="Description / Reason" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g., Dividend FY 2025-26, Partial Exit, Reinvested returns" />
    </Modal>
  );
}

/* ================================================================ INVESTOR DETAIL === */
function InvestorDetail({ investor, allInvestors, metricsById, totalCurrentValue, onBack, onEditInvestor, onAddTransaction }) {
  const [tab, setTab] = useState("overview");
  const m = metricsById[investor.id];
  const xirr = getInvestorXIRR(investor);
  const xirrFlows = buildInvestorXIRRCashflows(investor);
  const txns = [...(investor.transactions || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const invTxns = txns.filter((t) => IN_TYPES.includes(t.type));
  const dividendTxns = txns.filter((t) => t.type === TXN_TYPES.DIVIDEND);
  const exitTxns = txns.filter((t) => t.type === TXN_TYPES.EXIT);

  return (
    <div>
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: IC.primary, fontWeight: 700, marginBottom: 14, cursor: "pointer", width: "fit-content" }}
        onClick={onBack}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>←</span> Back to Investors
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMuted, marginBottom: 10 }}>
        <span style={{ cursor: "pointer", color: IC.primary, fontWeight: 600 }} onClick={onBack}>Investors</span>
        <span>›</span>
        <span>{investor.name}</span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>{investor.name}</span>
            <StatusTag status={investor.status} />
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
            Investor ID: {investor.investorId || "—"} &nbsp;•&nbsp; Investor Since: {fmtDate(investor.since)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn onClick={() => onEditInvestor(investor)}>Edit Investor</Btn>
          <Btn primary onClick={() => onAddTransaction(investor.id, TXN_TYPES.FIRST_INVESTMENT)}>+ Add Transaction</Btn>
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "investments", label: "Investments" },
          { key: "transactions", label: "Transactions" },
          { key: "dividends", label: "Dividends" },
          { key: "exits", label: "Exit / Withdrawals" },
          { key: "calculations", label: "Calculations" },
        ]}
      />

      {tab === "overview" && (
        <>
          <StatRow>
            <StatCard label="Total Invested" value={fmtINR(m.totalInvested)} />
            <StatCard label="Current Value" value={fmtINR(m.currentValue)} valueColor={IC.primary} />
            <StatCard label="Holding %" value={fmtPct(m.holdingPct)} />
            <StatCard label="XIRR (Investor)" value={fmtPct(xirr)} valueColor={IC.purple} />
            <StatCard label="Total Dividends (OUT)" value={fmtINR(m.totalDividends)} valueColor={IC.red} />
            <StatCard label="Total Exit Paid (OUT)" value={fmtINR(m.totalExit)} valueColor={IC.red} />
          </StatRow>

          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginBottom: 16 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.navy, marginBottom: 12 }}>Investment Summary</div>
              <SummaryLine label="First Investment" value={fmtINR(m.firstInvestment)} />
              <SummaryLine label="Total Re-investments" value={fmtINR(m.reinvestment)} />
              <SummaryLine label="Total Invested (IN)" value={fmtINR(m.totalInvested)} bold />
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.navy, marginBottom: 12 }}>Holding Summary</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <DonutChart
                  size={130}
                  thickness={20}
                  segments={[
                    { value: Math.max(m.currentValue, 0), color: IC.purple },
                    { value: Math.max(totalCurrentValue - m.currentValue, 0), color: "#E5E7EB" },
                  ]}
                  centerTitle="Holding"
                  centerValue={fmtPct(m.holdingPct, 0)}
                />
                <div style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.6 }}>
                  Holding % = (Current Value ÷ Total Current Value) × 100<br />
                  = ({fmtINR(m.currentValue)} ÷ {fmtINR(totalCurrentValue)}) × 100<br />
                  <b style={{ color: C.navy }}>= {fmtPct(m.holdingPct)}</b>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.navy }}>Recent Transactions</div>
                <span style={{ fontSize: 11.5, color: IC.primary, fontWeight: 700, cursor: "pointer" }} onClick={() => setTab("transactions")}>View All Transactions</span>
              </div>
              <TxnTable rows={txns.slice(0, 5)} emptyMessage="No transactions recorded yet." />
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.navy, marginBottom: 12 }}>Cash Flow Summary (All Time)</div>
              <SummaryLine label="Total Cash In (IN)" value={fmtINR(m.totalCashIn)} valueColor={IC.green} />
              <SummaryLine label="Total Cash Out (OUT)" value={fmtINR(m.totalCashOut)} valueColor={IC.red} />
              <SummaryLine label="Net Cash Flow (IN - OUT)" value={fmtINR(m.netCashFlow)} bold />
            </div>
          </div>
        </>
      )}

      {tab === "investments" && (
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.navy }}>Investment History</div>
            <Btn primary onClick={() => onAddTransaction(investor.id, TXN_TYPES.REINVESTMENT)}>+ Add Investment</Btn>
          </div>
          <TxnTable rows={invTxns} emptyMessage="No investments recorded yet. Add the First Investment to get started." />
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: "flex", gap: 32, flexWrap: "wrap" }}>
            <SummaryLine label="First Investment" value={fmtINR(m.firstInvestment)} />
            <SummaryLine label="Total Re-investment" value={fmtINR(m.reinvestment)} />
            <SummaryLine label="Total Invested (IN)" value={fmtINR(m.totalInvested)} bold />
          </div>
        </div>
      )}

      {tab === "transactions" && (
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.navy }}>All Transactions</div>
            <Btn primary onClick={() => onAddTransaction(investor.id, TXN_TYPES.FIRST_INVESTMENT)}>+ Add Transaction</Btn>
          </div>
          <TxnTable rows={txns} emptyMessage="No transactions recorded yet." />
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <SummaryLine label="Net Cash Flow (IN - OUT)" value={fmtINR(m.netCashFlow)} bold />
          </div>
        </div>
      )}

      {tab === "dividends" && (
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.navy }}>Dividends</div>
            <Btn primary onClick={() => onAddTransaction(investor.id, TXN_TYPES.DIVIDEND)}>+ Add Dividend</Btn>
          </div>
          <TxnTable rows={dividendTxns} emptyMessage="No dividends recorded yet." />
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <SummaryLine label="Total Dividends" value={fmtINR(m.totalDividends)} bold valueColor={IC.red} />
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: C.textMuted, background: C.bg, borderRadius: 8, padding: "10px 12px" }}>
            Dividends are OUT transactions. They are deducted from Total Invested to calculate Current Value, so they reduce both Current Value and Holding %.
          </div>
        </div>
      )}

      {tab === "exits" && (
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.navy }}>Exit / Withdrawals</div>
            <Btn primary onClick={() => onAddTransaction(investor.id, TXN_TYPES.EXIT)}>+ Add Exit</Btn>
          </div>
          <TxnTable rows={exitTxns} emptyMessage="No exits or withdrawals recorded yet." />
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <SummaryLine label="Total Exit Paid" value={fmtINR(m.totalExit)} bold valueColor={IC.red} />
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: C.textMuted, background: C.bg, borderRadius: 8, padding: "10px 12px" }}>
            Exit / withdrawal amounts are OUT transactions and are deducted from Total Invested to calculate Current Value, reducing Holding % accordingly.
          </div>
        </div>
      )}

      {tab === "calculations" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.navy, marginBottom: 12 }}>Current Value Calculation</div>
            <SummaryLine label="First Investment" value={fmtINR(m.firstInvestment)} />
            <SummaryLine label="Reinvestment" value={fmtINR(m.reinvestment)} />
            <SummaryLine label="Total Invested (First Investment + Reinvestment)" value={fmtINR(m.totalInvested)} />
            <SummaryLine label="Less: Total Dividends (OUT)" value={`- ${fmtINR(m.totalDividends)}`} valueColor={IC.red} />
            <SummaryLine label="Less: Total Exit / Withdrawal (OUT)" value={`- ${fmtINR(m.totalExit)}`} valueColor={IC.red} />
            <div style={{ height: 1, background: C.border, margin: "10px 0" }} />
            <SummaryLine label="Current Value" value={fmtINR(m.currentValue)} bold valueColor={IC.primary} />
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.navy, marginBottom: 12 }}>Holding % Calculation</div>
            <SummaryLine label={`${investor.name} - Current Value`} value={fmtINR(m.currentValue)} />
            <SummaryLine label="Total Current Value (All Investors)" value={fmtINR(totalCurrentValue)} />
            <div style={{ height: 1, background: C.border, margin: "10px 0" }} />
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
              Holding % = (Current Value ÷ Total Current Value) × 100 = ({fmtINR(m.currentValue)} ÷ {fmtINR(totalCurrentValue)}) × 100
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: IC.primary }}>{fmtPct(m.holdingPct)}</div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.navy, marginBottom: 4 }}>XIRR Calculation (Since First Investment)</div>
            <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 12 }}>
              Uses every actual transaction's date and signed cash flow (investment = outflow, dividend/exit = inflow to the investor), plus the Latest Current Value as a final positive cash flow dated today.
            </div>
            {xirrFlows.length < 2 ? (
              <div style={{ fontSize: 12.5, color: C.textMuted }}>Add at least two transactions (an investment and a dividend or exit) to calculate XIRR.</div>
            ) : (
              <>
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
                  <thead>
                    <tr>
                      <th style={th}>Date</th>
                      <th style={th}>Particulars</th>
                      <th style={{ ...th, textAlign: "right" }}>Cash Flow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {xirrFlows.map((f, i) => (
                      <tr key={i}>
                        <td style={td}>{f.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
                        <td style={td}>{f.label}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 700, color: f.amount < 0 ? IC.red : IC.green }}>
                          {f.amount < 0 ? "-" : "+"}{fmtINR(Math.abs(f.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 4 }}>XIRR (Since First Investment)</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: IC.purple }}>{fmtPct(xirr)}</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryLine({ label, value, bold, valueColor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 12.5 }}>
      <span style={{ color: bold ? C.navy : C.textSec, fontWeight: bold ? 700 : 500 }}>{label}</span>
      <span style={{ color: valueColor || (bold ? C.navy : C.textPri), fontWeight: bold ? 800 : 600 }}>{value}</span>
    </div>
  );
}

/* ================================================================= INVESTOR LIST === */
function InvestorList({ investors, metricsById, totalCurrentValue, portfolioXIRR, onView, onAddInvestor, onReinvest, onExport }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortKey, setSortKey] = useState("currentValueDesc");

  const totals = useMemo(() => {
    return investors.reduce(
      (acc, inv) => {
        const m = metricsById[inv.id];
        acc.first += m.firstInvestment;
        acc.reinv += m.reinvestment;
        acc.current += m.currentValue;
        acc.dividends += m.totalDividends;
        acc.exit += m.totalExit;
        return acc;
      },
      { first: 0, reinv: 0, current: 0, dividends: 0, exit: 0 }
    );
  }, [investors, metricsById]);

  const filtered = useMemo(() => {
    let list = investors.filter((inv) => inv.name.toLowerCase().includes(search.toLowerCase()));
    if (statusFilter !== "All") list = list.filter((inv) => inv.status === statusFilter);
    const sorted = [...list].sort((a, b) => {
      const ma = metricsById[a.id], mb = metricsById[b.id];
      if (sortKey === "currentValueDesc") return mb.currentValue - ma.currentValue;
      if (sortKey === "currentValueAsc") return ma.currentValue - mb.currentValue;
      if (sortKey === "nameAsc") return a.name.localeCompare(b.name);
      return 0;
    });
    return sorted;
  }, [investors, search, statusFilter, sortKey, metricsById]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.navy }}>Investors - Main List</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>Quick summary of all investors</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn onClick={onExport}>Export</Btn>
          <Btn primary onClick={onAddInvestor}>+ Add Investor</Btn>
        </div>
      </div>

      <StatRow>
        <StatCard label="Total Investors" value={investors.length} icon="👥" />
        <StatCard label="Current Total Value" value={fmtINR(totalCurrentValue)} sub="After Reinvestment" icon="💰" />
        <StatCard label="Total Dividends (OUT)" value={fmtINR(totals.dividends)} sub="All Time" icon="🎁" valueColor={IC.red} />
        <StatCard label="Total Exit Paid (OUT)" value={fmtINR(totals.exit)} sub="All Time" icon="↩️" valueColor={IC.red} />
        <StatCard label="Portfolio XIRR" value={fmtPct(portfolioXIRR)} sub="All Investor (XIRR)" icon="🥧" valueColor={IC.purple} />
      </StatRow>

      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...inputStyle, maxWidth: 220 }} placeholder="Search investor..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ ...inputStyle, maxWidth: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">Status: All</option>
          <option value="Active">Status: Active</option>
          <option value="Inactive">Status: Inactive</option>
        </select>
        <select style={{ ...inputStyle, maxWidth: 220 }} value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
          <option value="currentValueDesc">Sort: Current Value (High to Low)</option>
          <option value="currentValueAsc">Sort: Current Value (Low to High)</option>
          <option value="nameAsc">Sort: Name (A-Z)</option>
        </select>
      </div>

      <div style={cardStyle}>
        {investors.length === 0 ? (
          <EmptyState title="No investors yet" message="Add your first investor to start tracking investments, dividends, exits and XIRR." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Investor</th>
                  <th style={{ ...th, textAlign: "right" }}>First Investment (₹)</th>
                  <th style={{ ...th, textAlign: "right" }}>Reinvestment (₹)</th>
                  <th style={{ ...th, textAlign: "right" }}>Current Value (₹)</th>
                  <th style={{ ...th, textAlign: "right" }}>Holding %</th>
                  <th style={{ ...th, textAlign: "right" }}>XIRR %</th>
                  <th style={th}>Status</th>
                  <th style={th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => {
                  const m = metricsById[inv.id];
                  const xirr = getInvestorXIRR(inv);
                  return (
                    <tr key={inv.id} data-testid="investor-row" data-investor-id={inv.id}>
                      <td style={{ ...td, fontWeight: 700, color: C.navy }}>{inv.name}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmtINR(m.firstInvestment)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmtINR(m.reinvestment)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: IC.primary }}>{fmtINR(m.currentValue)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmtPct(m.holdingPct)}</td>
                      <td style={{ ...td, textAlign: "right", color: IC.purple, fontWeight: 700 }}>{fmtPct(xirr)}</td>
                      <td style={td}><StatusTag status={inv.status} /></td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Btn onClick={() => onReinvest(inv.id)}>+ Reinvest</Btn>
                          <Btn primary data-testid="investor-row-view" onClick={() => onView(inv.id)}>View</Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ ...td, fontWeight: 800, color: C.navy, borderBottom: "none" }}>TOTAL</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none" }}>{fmtINR(totals.first)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none" }}>{fmtINR(totals.reinv)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none" }}>{fmtINR(totals.current)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none" }}>100.00%</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none" }}>{fmtPct(portfolioXIRR)}</td>
                  <td style={{ ...td, borderBottom: "none" }}>—</td>
                  <td style={{ ...td, borderBottom: "none" }}>—</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      {investors.length > 0 && (
        <div style={{ fontSize: 11, color: C.textMuted, background: C.bg, borderRadius: 8, padding: "10px 12px", marginTop: 12 }}>
          Current Value = (First Investment + Reinvestment) - Total Dividends - Total Exit / Withdrawal.
        </div>
      )}
    </div>
  );
}

/* ============================================================== OVERVIEW DASHBOARD === */
function OverviewDashboard({ investors, metricsById, totalCurrentValue, portfolioXIRR, onAddInvestor, onView, onReinvest }) {
  const [progressGranularity, setProgressGranularity] = useState("monthly");

  const totals = useMemo(
    () =>
      investors.reduce(
        (acc, inv) => {
          const m = metricsById[inv.id];
          acc.first += m.firstInvestment;
          acc.reinv += m.reinvestment;
          acc.dividends += m.totalDividends;
          acc.exit += m.totalExit;
          acc.cashIn += m.totalCashIn;
          acc.cashOut += m.totalCashOut;
          return acc;
        },
        { first: 0, reinv: 0, dividends: 0, exit: 0, cashIn: 0, cashOut: 0 }
      ),
    [investors, metricsById]
  );

  const progressSeries = useMemo(() => buildValueProgressSeries(investors, progressGranularity), [investors, progressGranularity]);

  const donutSegments = investors.map((inv, i) => ({
    label: inv.name,
    value: Math.max(metricsById[inv.id].currentValue, 0),
    color: [IC.primary, IC.green, IC.purple, "#F97316", "#0EA5E9", "#DB2777"][i % 6],
  }));

  const exampleInvestor = investors.find((inv) => getInvestorXIRR(inv) !== null);
  const exampleFlows = exampleInvestor ? buildInvestorXIRRCashflows(exampleInvestor) : [];
  const exampleXIRR = exampleInvestor ? getInvestorXIRR(exampleInvestor) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>Investors Overview</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>Quick overview of investors, their investments, reinvestments, and current position.</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ ...inputStyle, width: "auto", padding: "8px 12px", color: C.textMuted, background: C.bg }}>All Time</span>
          <Btn primary id="investor-add" onClick={onAddInvestor}>+ Add Investor</Btn>
        </div>
      </div>

      <StatRow>
        <StatCard label="Total Investors" value={investors.length} sub="Active Investors" icon="👥" />
        <StatCard label="Current Total Value" value={fmtINR(totalCurrentValue)} sub="After Reinvestment" icon="💰" />
        <StatCard label="Total Dividends" value={fmtINR(totals.dividends)} sub="All Time" icon="🎁" valueColor={IC.red} />
        <StatCard label="Total Exit Paid" value={fmtINR(totals.exit)} sub="All Time" icon="↩️" valueColor={IC.red} />
        <StatCard label="Portfolio XIRR" value={fmtPct(portfolioXIRR)} sub="All Investor XIRR" icon="🥧" valueColor={IC.purple} />
      </StatRow>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.navy }}>Value Progress ({progressGranularity === "yearly" ? "Yearly" : "Monthly"})</div>
          </div>
          <ValueProgressChart data={progressSeries} granularity={progressGranularity} onGranularityChange={setProgressGranularity} />
          <div style={{ fontSize: 11, color: C.textMuted, background: C.bg, borderRadius: 8, padding: "8px 12px", marginTop: 10 }}>
            Current Total Value includes all investments &amp; reinvestments, and excludes dividends &amp; exits paid out. Hover any bar for full details.
          </div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.navy, marginBottom: 12 }}>Investment Composition (By Current Value)</div>
          {investors.length === 0 ? (
            <div style={{ padding: "24px 0", textAlign: "center", color: C.textMuted, fontSize: 12.5 }}>No investors yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <DonutChart size={170} thickness={26} segments={donutSegments} centerTitle="Total" centerValue={fmtINR(totalCurrentValue)} />
              <div style={{ width: "100%" }}>
                {investors.map((inv, i) => (
                  <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, padding: "4px 0" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, color: C.textSec }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: donutSegments[i].color, display: "inline-block" }} />
                      {inv.name}
                    </span>
                    <span style={{ fontWeight: 700, color: C.navy }}>{fmtINR(metricsById[inv.id].currentValue)} ({fmtPct(metricsById[inv.id].holdingPct, 1)})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.navy, marginBottom: 12 }}>Investor Summary</div>
        {investors.length === 0 ? (
          <EmptyState title="No investors yet" message="Add your first investor to see the summary here." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Investor</th>
                  <th style={{ ...th, textAlign: "right" }}>First Investment (₹)</th>
                  <th style={{ ...th, textAlign: "right" }}>Reinvestment (₹)</th>
                  <th style={{ ...th, textAlign: "right" }}>Current Value (₹)</th>
                  <th style={{ ...th, textAlign: "right" }}>Holding %</th>
                  <th style={{ ...th, textAlign: "right" }}>XIRR (Since 1st Inv.)</th>
                  <th style={th}>Status</th>
                  <th style={th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {investors.map((inv) => {
                  const m = metricsById[inv.id];
                  const xirr = getInvestorXIRR(inv);
                  return (
                    <tr key={inv.id} data-testid="investor-row" data-investor-id={inv.id}>
                      <td style={{ ...td, fontWeight: 700, color: C.navy }}>{inv.name}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmtINR(m.firstInvestment)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmtINR(m.reinvestment)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtINR(m.currentValue)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmtPct(m.holdingPct)}</td>
                      <td style={{ ...td, textAlign: "right", color: IC.purple, fontWeight: 700 }}>{fmtPct(xirr)}</td>
                      <td style={td}><StatusTag status={inv.status} /></td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Btn onClick={() => onReinvest(inv.id)}>+ Reinvest</Btn>
                          <Btn primary data-testid="investor-row-view" onClick={() => onView(inv.id)}>View</Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ ...td, fontWeight: 800, color: C.navy, borderBottom: "none" }}>TOTAL</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none" }}>{fmtINR(totals.first)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none" }}>{fmtINR(totals.reinv)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none" }}>{fmtINR(totalCurrentValue)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none" }}>100.00%</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none" }}>{fmtPct(portfolioXIRR)}</td>
                  <td style={{ ...td, borderBottom: "none" }}>—</td>
                  <td style={{ ...td, borderBottom: "none" }}>—</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {exampleInvestor && (
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.navy, marginBottom: 4 }}>XIRR Calculation (Example - {exampleInvestor.name})</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>Live example computed from {exampleInvestor.name}'s actual transaction dates and amounts - Investment/Reinvestment as negative, Dividend/Exit-Withdrawal as positive - plus Latest Current Value added as the final positive cash flow (dated today).</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Particulars</th>
                  <th style={{ ...th, textAlign: "right" }}>Cash Flow</th>
                </tr>
              </thead>
              <tbody>
                {exampleFlows.map((f, i) => (
                  <tr key={i}>
                    <td style={td}>{f.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td style={td}>{f.label}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: f.amount < 0 ? IC.red : IC.green }}>
                      {f.amount < 0 ? "-" : "+"}{fmtINR(Math.abs(f.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>XIRR (Since 1st Investment)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: IC.purple }}>{fmtPct(exampleXIRR)}</div>
        </div>
      )}
    </div>
  );
}

/* ======================================================================= ROOT === */
// Prop-driven and backed by the database. `investors` (each with an embedded
// `transactions` array) comes from useFleetData; creating an investor or a
// transaction calls back up so it is persisted via the API.
export default function Investors({
  investors = [],
  onCreateInvestor,
  onUpdateInvestor,
  onCreateTransaction,
}) {
  const [view, setView] = useState("dashboard"); // 'dashboard' | 'list' | 'detail'
  const [selectedId, setSelectedId] = useState(null);

  const [showInvestorModal, setShowInvestorModal] = useState(false);
  const [editingInvestor, setEditingInvestor] = useState(null);

  const [showTxnModal, setShowTxnModal] = useState(false);
  const [txnTargetId, setTxnTargetId] = useState(null);
  const [txnPreset, setTxnPreset] = useState(TXN_TYPES.FIRST_INVESTMENT);

  const { metricsById, totalCurrentValue } = useMemo(() => computeHoldingPercents(investors), [investors]);
  const portfolioXIRR = useMemo(() => computePortfolioXIRR(investors), [investors]);
  const selectedInvestor = investors.find((i) => i.id === selectedId) || null;

  const openAddInvestor = () => { setEditingInvestor(null); setShowInvestorModal(true); };
  const openEditInvestor = (inv) => { setEditingInvestor(inv); setShowInvestorModal(true); };
  const saveInvestor = (data) => {
    if (editingInvestor) {
      onUpdateInvestor?.(editingInvestor.id, { name: data.name, investorId: data.investorId, status: data.status });
    } else {
      onCreateInvestor?.(data);
    }
    setShowInvestorModal(false);
    setEditingInvestor(null);
  };

  const openAddTransaction = (investorId, presetType) => {
    setTxnTargetId(investorId);
    setTxnPreset(presetType);
    setShowTxnModal(true);
  };
  const openReinvest = (investorId) => {
    setShowInvestorModal(false);
    setEditingInvestor(null);
    openAddTransaction(investorId, TXN_TYPES.REINVESTMENT);
  };
  const saveTransaction = (data) => {
    onCreateTransaction?.(txnTargetId, data);
    setShowTxnModal(false);
  };

  const viewInvestor = (id) => { setSelectedId(id); setView("detail"); };
  const backToList = () => { setView("list"); setSelectedId(null); };

  const exportCSV = () => {
    const header = ["Investor", "First Investment", "Reinvestment", "Total Invested", "Total Dividends", "Total Exit", "Current Value", "Holding %", "XIRR %", "Status"];
    const rows = investors.map((inv) => {
      const m = metricsById[inv.id];
      const xirr = getInvestorXIRR(inv);
      return [inv.name, m.firstInvestment, m.reinvestment, m.totalInvested, m.totalDividends, m.totalExit, m.currentValue, m.holdingPct.toFixed(2), xirr === null ? "" : xirr.toFixed(2), inv.status];
    });
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "investors_overview.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const targetInvestor = investors.find((i) => i.id === txnTargetId);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      {view !== "detail" && (
        <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: `1px solid ${C.border}` }}>
          {[
            { key: "dashboard", label: "Overview Dashboard" },
            { key: "list", label: "All Investors" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              style={{
                padding: "10px 16px",
                fontSize: 12.5,
                fontWeight: 700,
                color: view === t.key ? IC.primary : C.textMuted,
                background: "none",
                border: "none",
                borderBottom: view === t.key ? `2px solid ${IC.primary}` : "2px solid transparent",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {view === "dashboard" && (
        <OverviewDashboard
          investors={investors}
          metricsById={metricsById}
          totalCurrentValue={totalCurrentValue}
          portfolioXIRR={portfolioXIRR}
          onAddInvestor={openAddInvestor}
          onView={viewInvestor}
          onReinvest={openReinvest}
        />
      )}

      {view === "list" && (
        <InvestorList
          investors={investors}
          metricsById={metricsById}
          totalCurrentValue={totalCurrentValue}
          portfolioXIRR={portfolioXIRR}
          onView={viewInvestor}
          onAddInvestor={openAddInvestor}
          onReinvest={openReinvest}
          onExport={exportCSV}
        />
      )}

      {view === "detail" && selectedInvestor && (
        <InvestorDetail
          investor={selectedInvestor}
          allInvestors={investors}
          metricsById={metricsById}
          totalCurrentValue={totalCurrentValue}
          onBack={backToList}
          onEditInvestor={openEditInvestor}
          onAddTransaction={openAddTransaction}
        />
      )}

      <InvestorFormModal
        open={showInvestorModal}
        investor={editingInvestor}
        investors={investors}
        onClose={() => { setShowInvestorModal(false); setEditingInvestor(null); }}
        onSave={saveInvestor}
        onReinvestExisting={openReinvest}
      />

      <TransactionFormModal
        key={`${txnTargetId || "none"}-${txnPreset}`}
        open={showTxnModal}
        investorName={targetInvestor?.name}
        presetType={txnPreset}
        onClose={() => setShowTxnModal(false)}
        onSave={saveTransaction}
      />
    </div>
  );
}
