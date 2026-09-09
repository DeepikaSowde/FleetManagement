import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
} from "recharts";
import { C, mono, fmt, daysUntil } from "./theme";
import { Card, CardHeader, PlateBadge, Badge } from "./components";
import { buildLedgerRows } from "./ledgerUtils";

// Cash Flow Forecast — a rolling projection of cash on hand across future
// months (like the RDK "Cash Flow reference" sheet). Receipts can be forecast
// two ways (the "Forecast method" toggle):
//   • CAGR Targets — each car's saved CAGR tier (chosen when the vehicle was
//     added) drives its monthly receipt automatically = targetRate ×
//     runningDaysTarget. Read-only per car; the whole forecast can be nudged
//     with a global adjustment %.
//   • Manual Targets — the user sets/edits each car's monthly receipt directly
//     (persisted as car.monthlyForecast).
// The client model is receipts-only: nothing is subtracted (no maintenance/
// outflows); cash rolls up on the starting Ledger balance.
//
// Starting Cash is READ-ONLY here — always the live Ledger balance, never a
// manual override. If the Ledger balance moves, everything below recomputes
// from it automatically (it's a plain useMemo over the ledger rows, so any
// new booking/expense re-renders this whole page with the fresh number).

const VIZ = { blue: "#2a78d6", green: "#008300", amber: "#eda100", violet: "#4a3aa7", red: "#e34948", aqua: "#1baf7a" };
const tint = (h) => `${h}1A`;
const cardStyle = { background: "#fff", borderRadius: 14, border: "1px solid #ECECEC", boxShadow: "0 1px 2px rgba(16,24,40,0.06)" };
const selectStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid #E0E0E0", background: "#fff", fontSize: 12.5, fontFamily: "inherit", color: C.textPri, outline: "none" };
const field = { ...selectStyle, width: "100%", boxSizing: "border-box" };
const fieldWrap = { display: "flex", flexDirection: "column", gap: 6 };
const fieldLabel = { fontSize: 10.5, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4 };
const bulkBtn = { padding: "7px 10px", borderRadius: 8, border: "1px solid #E0E0E0", background: "#fff", fontSize: 11.5, fontWeight: 600, color: VIZ.blue, cursor: "pointer", fontFamily: "inherit" };

// ── Balance formatting — never a "-" sign; sign is communicated by colour +
// status word/badge instead, everywhere a cash balance is shown. ───────────
const fmtAbs = (n) => fmt(Math.round(Math.abs(Number(n) || 0)));
const balanceColor = (n) => (Number(n) > 0 ? VIZ.green : Number(n) < 0 ? VIZ.red : C.textMuted);
const statusOf = (n) => (Number(n) > 0 ? { label: "Positive", color: VIZ.green } : Number(n) < 0 ? { label: "Negative", color: VIZ.red } : { label: "Neutral", color: C.textMuted });
const BalanceCell = ({ value }) => <span style={{ ...mono, fontWeight: 700, color: balanceColor(value) }}>{fmtAbs(value)}</span>;

const pageBtn = (active, disabled) => ({
  minWidth: 28, height: 28, padding: "0 8px", borderRadius: 6,
  border: `1px solid ${active ? VIZ.blue : "#E0E0E0"}`,
  background: active ? VIZ.blue : "#fff",
  color: active ? "#fff" : disabled ? "#C7C7C7" : C.textSec,
  fontSize: 11.5, fontWeight: 700, cursor: disabled ? "default" : "pointer",
});
// Shared "Showing X to Y of Z" + Previous/numbers/Next footer, reused by both
// the Per-Car Forecast and Monthly Projection tables.
const Pager = ({ page, setPage, totalPages, totalCount, pageSize, noun }) => {
  if (totalCount === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "10px 16px", borderTop: "1px solid #F0F0F0" }}>
      <span style={{ fontSize: 11, color: C.textMuted }}>
        Showing <strong style={{ color: C.navy }}>{from}</strong> to <strong style={{ color: C.navy }}>{to}</strong> of {totalCount} {noun}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <button style={pageBtn(false, page === 1)} disabled={page === 1} onClick={() => setPage(page - 1)}>‹ Previous</button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
          <button key={p} style={pageBtn(p === page)} onClick={() => setPage(p)}>{p}</button>
        ))}
        <button style={pageBtn(false, page === totalPages)} disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next ›</button>
      </div>
    </div>
  );
};

// A car's saved CAGR tier is encoded in its runningDaysTarget (see theme.js
// TIERS): 25 → Conservative (8%), 22 → Balanced (11%), 18 → Aggressive (14%).
// This lets us show the tier + CAGR badge deterministically from saved data,
// without re-deriving it from profitPctTarget.
const CAGR_TIERS = {
  25: { label: "Conservative", cagr: 8, color: VIZ.aqua },
  22: { label: "Balanced", cagr: 11, color: VIZ.blue },
  18: { label: "Aggressive", cagr: 14, color: VIZ.amber },
};

const monthsFrom = (startYm, n) => {
  const [y, m] = startYm.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 + i, 1);
    return { ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }) };
  });
};

const TierBadge = ({ tier }) => tier ? (
  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 20, color: tier.color, background: tint(tier.color), whiteSpace: "nowrap" }}>
    {tier.cagr}% {tier.label}
  </span>
) : (
  <span style={{ fontSize: 10.5, color: C.textMuted }}>No CAGR target</span>
);

const CAR_PAGE_SIZE = 5;
const MONTH_PAGE_SIZE = 5;

const CashFlow = ({ fleet = [], earnings = [], expenses = [], bookings = [], onUpdateCar, calculateCarMonthlyTarget }) => {
  // Current cash position from the ledger — the ONLY source for starting
  // cash now (see header comment). Recomputes automatically whenever the
  // ledger's underlying data changes; there is no separate editable copy of
  // this number anywhere in the module.
  const currentBalance = useMemo(() => {
    const rows = buildLedgerRows(earnings, expenses, bookings);
    return Math.round(rows.reduce((s, r) => s + r.credit - r.debit, 0));
  }, [earnings, expenses, bookings]);

  const [startMonth, setStartMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [horizon, setHorizon] = useState(12);
  const [minBalance, setMinBalance] = useState(5000);
  const [edits, setEdits] = useState({}); // in-progress per-car receipt edits (plate -> string) — Manual method
  // Forecast method: CAGR (from saved vehicle targets) or Manual (per-car edits).
  const [forecastMethod, setForecastMethod] = useState("cagr");
  const [adjustmentPct, setAdjustmentPct] = useState(0); // CAGR global forecast adjustment %
  // Per-car list controls — search / sort / view, so the section stays usable
  // at 100+ cars instead of one giant wall of cards.
  const [viewOverride, setViewOverride] = useState(null); // null = auto by fleet size
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("receipt");
  const [sortDir, setSortDir] = useState("desc"); // highest receipt first by default
  const [uplift, setUplift] = useState("");
  const [carPage, setCarPage] = useState(1);
  const [monthPage, setMonthPage] = useState(1);

  const cagrTierOf = (car) => (car.runningDaysTarget != null ? CAGR_TIERS[car.runningDaysTarget] : null) || null;
  const hasCagrTarget = (car) => car.targetRate != null && car.runningDaysTarget != null;

  // Raw per-car monthly receipt for the ACTIVE forecast method (before the CAGR
  // global adjustment %).
  const rawReceiptOf = (car) => {
    if (forecastMethod === "cagr") {
      // Saved CAGR target monthly income = target daily rate × the tier's
      // target running days (both chosen when the car was added).
      if (hasCagrTarget(car)) return Math.round(Number(car.targetRate) * Number(car.runningDaysTarget));
      const t = Math.round(calculateCarMonthlyTarget?.(car.plate, startMonth) || 0);
      return t > 0 && t <= 15000 ? t : 0; // 0 → no saved CAGR target
    }
    // Manual: the user-saved figure wins, then sensible fallbacks.
    if (car.monthlyForecast != null) return Number(car.monthlyForecast);
    if (car.targetRate) return Math.round(Number(car.targetRate) * 26);
    const t = Math.round(calculateCarMonthlyTarget?.(car.plate, startMonth) || 0);
    return t > 0 && t <= 15000 ? t : 1500;
  };
  // CAGR mode supports a global forecast adjustment % that scales every car's
  // receipt WITHOUT touching its saved CAGR target.
  const cagrAdjFactor = forecastMethod === "cagr" ? 1 + (Number(adjustmentPct) || 0) / 100 : 1;
  const receiptOf = (car) => Math.round(rawReceiptOf(car) * cagrAdjFactor);
  const maxReceipt = Math.max(1, ...fleet.map((c) => receiptOf(c)));

  // Cards for small fleets, table for large — but only until the user picks one.
  const effectiveView = viewOverride ?? (fleet.length > 24 ? "table" : "cards");

  // One derived list feeds BOTH views, so search/sort behave identically
  // whichever is showing.
  const perCarRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = fleet.map((car) => {
      const receipt = receiptOf(car);
      const moToCoe = car.coe ? Math.max(0, Math.round(daysUntil(car.coe) / 30)) : null;
      return {
        car,
        plate: car.plate,
        model: [car.make, car.model].filter(Boolean).join(" ") || "—",
        receipt,
        moToCoe,
        twelveMo: receipt * horizon,
        tier: cagrTierOf(car),
        hasCagr: hasCagrTarget(car),
      };
    });
    if (q) list = list.filter((r) => r.plate.toLowerCase().includes(q) || r.model.toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === "plate") return a.plate < b.plate ? -dir : a.plate > b.plate ? dir : 0;
      const pick = { receipt: "receipt", twelveMo: "twelveMo", coe: "moToCoe" }[sortKey] || "receipt";
      const av = a[pick] ?? Infinity;
      const bv = b[pick] ?? Infinity;
      return (av - bv) * dir;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet, edits, query, sortKey, sortDir, horizon, startMonth, forecastMethod, adjustmentPct]);

  // Per-Car Forecast is paginated 5 at a time — never render all of
  // perCarRows directly (cards or table), only this page's slice.
  const carTotalPages = Math.max(1, Math.ceil(perCarRows.length / CAR_PAGE_SIZE));
  const carCurPage = Math.min(carPage, carTotalPages);
  const pagedCarRows = perCarRows.slice((carCurPage - 1) * CAR_PAGE_SIZE, carCurPage * CAR_PAGE_SIZE);
  useEffect(() => { setCarPage(1); }, [query, sortKey, sortDir, forecastMethod, effectiveView]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "plate" || key === "coe" ? "asc" : "desc"); }
  };

  const commitEdit = (plate) => {
    const v = edits[plate];
    if (v === undefined) return;
    const num = v === "" ? null : Number(v);
    onUpdateCar?.(plate, { monthlyForecast: num });
    setEdits((e) => { const n = { ...e }; delete n[plate]; return n; });
  };

  // Manual bulk edits apply to the CURRENTLY FILTERED rows only.
  const applyUplift = () => {
    const pct = Number(uplift);
    if (uplift === "" || Number.isNaN(pct)) return;
    perCarRows.forEach((r) => onUpdateCar?.(r.plate, { monthlyForecast: Math.round(r.receipt * (1 + pct / 100)) }));
    setUplift("");
  };
  const resetAllToTarget = () => {
    perCarRows.forEach((r) => onUpdateCar?.(r.plate, { monthlyForecast: null }));
  };

  // Per-car card — editable (Manual) or read-only (CAGR).
  const renderCard = (row) => {
    const { car, receipt, moToCoe, tier, hasCagr } = row;
    const barPct = Math.max(0, Math.min(100, (receipt / maxReceipt) * 100));
    const editVal = edits[car.plate] !== undefined ? edits[car.plate] : receipt;
    return (
      <div key={car.plate} style={{ border: "1px solid #ECECEC", borderRadius: 12, padding: 14, background: "#fff", boxShadow: "0 1px 2px rgba(16,24,40,0.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <PlateBadge plate={car.plate} small />
          {moToCoe != null && <span style={{ fontSize: 9.5, color: moToCoe <= 6 ? VIZ.red : C.textMuted }}>{moToCoe} mo to COE</span>}
        </div>
        {forecastMethod === "cagr" ? (
          <>
            <div style={{ marginBottom: 8 }}><TierBadge tier={tier} /></div>
            <div style={{ fontSize: 9.5, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 }}>Monthly Target Receipt</div>
            <div style={{ ...mono, fontSize: 18, fontWeight: 800, color: receipt > 0 ? C.navy : C.textMuted }}>{receipt > 0 ? fmtAbs(receipt) : "—"}</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 9.5, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Monthly Receipt</div>
            <input type="number" value={editVal}
              onChange={(e) => setEdits((s) => ({ ...s, [car.plate]: e.target.value }))}
              onBlur={() => commitEdit(car.plate)}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              style={{ ...mono, width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 8, border: `1px solid ${VIZ.blue}55`, background: tint(VIZ.blue), fontSize: 14, fontWeight: 700, color: C.navy, outline: "none" }} />
          </>
        )}
        <div style={{ height: 6, background: "#F0F0F0", borderRadius: 4, overflow: "hidden", marginTop: 10 }}>
          <div style={{ height: "100%", width: `${barPct}%`, background: VIZ.green, borderRadius: 4 }} />
        </div>
        <div style={{ fontSize: 9.5, color: C.textMuted, marginTop: 9, textAlign: "right" }}>
          {horizon}-mo contribution <strong style={{ color: C.navy }}>{fmtAbs(receipt * horizon)}</strong>
        </div>
      </div>
    );
  };

  const months = useMemo(() => monthsFrom(startMonth, horizon), [startMonth, horizon]);
  const totalReceiptsPerMonth = useMemo(
    () => fleet.reduce((s, c) => s + receiptOf(c), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fleet, edits, startMonth, forecastMethod, adjustmentPct]
  );

  // Build the month-by-month projection (receipts-only, rolling up). Same
  // formula as before — opening balance now always anchors on the live
  // Ledger figure rather than a user-editable copy of it.
  const projection = useMemo(() => {
    let opening = Number(currentBalance) || 0;
    return months.map((m) => {
      const receipts = totalReceiptsPerMonth;
      const closing = opening + receipts;
      const row = { ...m, opening, receipts, closing };
      opening = closing;
      return row;
    });
  }, [months, currentBalance, totalReceiptsPerMonth]);

  const monthTotalPages = Math.max(1, Math.ceil(projection.length / MONTH_PAGE_SIZE));
  const monthCurPage = Math.min(monthPage, monthTotalPages);
  const pagedMonths = projection.slice((monthCurPage - 1) * MONTH_PAGE_SIZE, monthCurPage * MONTH_PAGE_SIZE);
  useEffect(() => { setMonthPage(1); }, [horizon, startMonth]);

  const totalReceipts = projection.reduce((s, r) => s + r.receipts, 0);
  const closingCash = projection.length ? projection[projection.length - 1].closing : currentBalance;
  const lowest = projection.reduce((min, r) => Math.min(min, r.opening, r.closing), Number(currentBalance) || 0);
  const belowMin = lowest < Number(minBalance);
  const firstBreach = projection.find((r) => r.closing < Number(minBalance));

  const isCagr = forecastMethod === "cagr";
  const kpis = [
    { label: "Starting Cash (Ledger)", value: currentBalance, color: balanceColor(currentBalance), icon: "📗", sub: `${months[0]?.label || ""}` },
    { label: isCagr ? "Total Target Monthly Receipt" : "Monthly Receipts", value: totalReceiptsPerMonth, color: VIZ.green, icon: "📈", sub: isCagr ? "Sum of all cars' CAGR targets" : "Sum of all car receipts" },
    { label: `${horizon}-Month ${isCagr ? "Target " : ""}Receipts`, value: totalReceipts, color: VIZ.aqua, icon: "💰", sub: "Projected" },
    { label: `Total Cash Available (${horizon}mo)`, value: closingCash, color: balanceColor(closingCash), icon: "💵", sub: months[months.length - 1]?.label || "" },
    { label: "Lowest Balance", value: lowest, color: balanceColor(lowest), icon: belowMin ? "⚠️" : "🛡️", sub: belowMin ? "Below minimum!" : "Above minimum", flagBelowMin: belowMin },
  ];

  const th = { textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid #EFEFEF", whiteSpace: "nowrap", position: "sticky", top: 0, background: "#fff", zIndex: 1 };
  const numCell = { padding: "9px 12px", ...mono, fontSize: 11.5, textAlign: "right", whiteSpace: "nowrap" };

  const methods = [
    { id: "cagr", label: "CAGR Targets (from vehicles)", rec: true },
    { id: "manual", label: "Manual Targets", rec: false },
  ];

  // ── Chart: split colour at zero so the negative stretch reads red and the
  // positive stretch reads blue/green, in one continuous Area. Recharts has
  // no built-in "colour by sign" mode, so the standard trick is a gradient
  // whose stop offset lands exactly on the zero crossing of the Y domain. ──
  const chartValues = projection.flatMap((p) => [p.opening, p.closing]);
  const yMax = Math.max(0, Number(minBalance) || 0, ...chartValues);
  const yMin = Math.min(0, ...chartValues);
  const zeroOffset = yMax === yMin ? 1 : Math.max(0, Math.min(1, yMax / (yMax - yMin)));

  const ProjectionTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    const s = row.closing < Number(minBalance) ? { label: "Below minimum", color: VIZ.red } : statusOf(row.closing);
    return (
      <div style={{ background: "#fff", border: "1px solid #E5E5E5", borderRadius: 8, padding: "10px 12px", fontSize: 11.5, boxShadow: "0 4px 14px rgba(16,24,40,0.10)", minWidth: 170 }}>
        <div style={{ fontWeight: 700, color: C.navy, marginBottom: 6 }}>{label}</div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 2 }}>
          <span style={{ color: C.textMuted }}>Beginning Cash</span><span style={{ ...mono, fontWeight: 600 }}>{fmtAbs(row.opening)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 2 }}>
          <span style={{ color: C.textMuted }}>Target Receipts</span><span style={{ ...mono, fontWeight: 600, color: VIZ.green }}>{fmtAbs(row.receipts)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 6 }}>
          <span style={{ color: C.textMuted }}>Total Cash Available</span><span style={{ ...mono, fontWeight: 700, color: balanceColor(row.closing) }}>{fmtAbs(row.closing)}</span>
        </div>
        <div style={{ textAlign: "right" }}><Badge color={s.color} bg={tint(s.color)}>{s.label}</Badge></div>
      </div>
    );
  };

  const legendPayload = [
    { value: "Cash on Hand", type: "line", color: VIZ.blue },
    { value: "Minimum Balance", type: "line", color: VIZ.red },
    { value: "Target Receipts", type: "rect", color: VIZ.aqua },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Forecast assumptions */}
      <Card style={cardStyle}>
        <CardHeader
          title="Forecast Assumptions"
          subtitle="Adjust these and everything below recalculates live"
          right={
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: VIZ.green, background: tint(VIZ.green), padding: "5px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: VIZ.green, display: "inline-block" }} />
              Ledger Balance Connected
            </span>
          }
        />
        <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16, alignItems: "start" }}>
          {/* Starting Cash is a live, read-only readout — never a text field. */}
          <div style={fieldWrap}>
            <span style={fieldLabel}>Starting Cash on Hand</span>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 12px", borderRadius: 8, border: `1px solid ${VIZ.green}55`, background: tint(VIZ.green) }}>
              <span style={{ ...mono, fontSize: 14, fontWeight: 800, color: VIZ.green }}>{fmtAbs(currentBalance)}</span>
              <span title="Synced live from the Ledger" style={{ fontSize: 14, color: VIZ.green, lineHeight: 1 }}>🔄</span>
            </div>
            <span style={{ fontSize: 10, color: C.textMuted }}>Synced from Ledger (Current Balance)</span>
          </div>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Start month</span>
            <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} style={field} />
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Forecast horizon</span>
            <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} style={field}>
              <option value={6}>6 months</option><option value={12}>12 months</option><option value={24}>24 months</option>
            </select>
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Minimum balance alert</span>
            <input type="number" value={minBalance} onChange={(e) => setMinBalance(e.target.value)} style={field} />
          </label>

          {/* Forecast method selector — spans the full row */}
          <div style={{ ...fieldWrap, gridColumn: "1 / -1" }}>
            <span style={fieldLabel}>Forecast method</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {methods.map((m) => (
                <button key={m.id} type="button" onClick={() => setForecastMethod(m.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 10, cursor: "pointer",
                    border: `1.5px solid ${forecastMethod === m.id ? VIZ.blue : "#E0E0E0"}`,
                    background: forecastMethod === m.id ? tint(VIZ.blue) : "#fff",
                    fontSize: 12.5, fontWeight: 600, color: C.textPri, fontFamily: "inherit",
                  }}>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${forecastMethod === m.id ? VIZ.blue : "#C0C0C0"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {forecastMethod === m.id && <span style={{ width: 6, height: 6, borderRadius: "50%", background: VIZ.blue }} />}
                  </span>
                  {m.label}
                  {m.rec && <span style={{ fontSize: 9.5, fontWeight: 700, color: VIZ.green, background: tint(VIZ.green), padding: "1px 6px", borderRadius: 10 }}>Recommended</span>}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>
              {isCagr
                ? "CAGR tiers are chosen when a vehicle is added. Cash Flow uses those saved targets to forecast each car's monthly receipt from its investment, COE runway & target return — automatically."
                : "You set each car's monthly receipt below; it's saved per vehicle and used as-is."}
            </span>
          </div>
        </div>
      </Card>

      {/* Alert banner */}
      {belowMin && firstBreach && (
        <div style={{ padding: "12px 16px", borderRadius: 12, border: "1px solid #f59e0b66", background: "#f59e0b14", color: "#92400e", fontSize: 12.5, fontWeight: 600, display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span>Projected cash dips below your minimum ({fmtAbs(minBalance)}) in <strong>{firstBreach.label}</strong> (closing {fmtAbs(firstBreach.closing)}). Consider adding rentals or trimming costs before then.</span>
        </div>
      )}

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        {kpis.map((k) => (
          <Card key={k.label} style={{ ...cardStyle, borderLeft: `3px solid ${k.color}` }}>
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={fieldLabel}>{k.label}</span>
                <span style={{ width: 32, height: 32, borderRadius: 9, background: tint(k.color), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{k.icon}</span>
              </div>
              <div style={{ ...mono, fontSize: 20, fontWeight: 800, color: k.color, marginTop: 10 }}>{fmtAbs(k.value)}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                <span style={{ fontSize: 10.5, color: C.textMuted }}>{k.sub}</span>
                {k.flagBelowMin && <Badge color={VIZ.red} bg={tint(VIZ.red)}>Below minimum</Badge>}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Projection chart */}
      <Card style={cardStyle}>
        <CardHeader title="Projected Cash on Hand" subtitle={`${months[0]?.label || ""} – ${months[months.length - 1]?.label || ""} · minimum ${fmtAbs(minBalance)}`} />
        <div style={{ padding: "8px 12px 16px", height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={projection} margin={{ top: 6, right: 16, left: 4, bottom: 0 }}>
              <defs>
                {/* Stops land exactly on the zero-crossing of the Y domain, so
                    the line/fill switch from blue to red right where cash on
                    hand actually goes negative — not tied to the minimum-
                    balance line, which is a separate, lower threshold. */}
                <linearGradient id="cfStroke" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={zeroOffset} stopColor={VIZ.blue} />
                  <stop offset={zeroOffset} stopColor={VIZ.red} />
                </linearGradient>
                <linearGradient id="cfFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={Math.max(0, zeroOffset - 0.0001)} stopColor={VIZ.blue} stopOpacity={0.22} />
                  <stop offset={zeroOffset} stopColor={VIZ.blue} stopOpacity={0.22} />
                  <stop offset={zeroOffset} stopColor={VIZ.red} stopOpacity={0.18} />
                  <stop offset={Math.min(1, zeroOffset + 0.0001)} stopColor={VIZ.red} stopOpacity={0.18} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#EFEFEF" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={{ stroke: "#E5E5E5" }} />
              <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
              <Tooltip content={<ProjectionTooltip />} />
              <Legend payload={legendPayload} verticalAlign="top" align="right" height={30} wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={Number(minBalance) || 0} stroke={VIZ.red} strokeDasharray="5 4" label={{ value: "Min", position: "right", fill: VIZ.red, fontSize: 10 }} />
              <ReferenceLine y={0} stroke="#D5D5D5" strokeWidth={1} />
              <Bar dataKey="receipts" name="Target Receipts" fill={tint(VIZ.aqua)} stroke={VIZ.aqua} strokeWidth={0} barSize={16} radius={[3, 3, 0, 0]} legendType="none" />
              <Area type="monotone" dataKey="closing" name="Cash on Hand" stroke="url(#cfStroke)" strokeWidth={2.5} fill="url(#cfFill)" dot={{ r: 2 }} activeDot={{ r: 4 }} legendType="none" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Per-car forecast */}
      <Card style={cardStyle}>
        <CardHeader
          title="Per-Car Forecast"
          subtitle={isCagr
            ? "Each car uses its saved CAGR target (read-only) — nudge the whole forecast with the adjustment %"
            : "Each car's monthly receipt is editable — search, sort, and bulk-edit for large fleets"}
        />

        {/* Controls */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #F0F0F0", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <input placeholder="🔍 Search plate / model…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...selectStyle, width: 180 }} />
          <select value={`${sortKey}:${sortDir}`} onChange={(e) => { const [k, d] = e.target.value.split(":"); setSortKey(k); setSortDir(d); }} style={selectStyle}>
            <option value="receipt:desc">Sort: Receipt ↓ (highest first)</option>
            <option value="receipt:asc">Sort: Receipt ↑ (lowest first)</option>
            <option value="twelveMo:desc">Sort: {horizon}-mo ↓</option>
            <option value="coe:asc">Sort: COE soonest</option>
            <option value="plate:asc">Sort: Plate A–Z</option>
          </select>
          <span style={{ fontSize: 11, color: C.textMuted }}>Showing <strong style={{ color: C.navy }}>{perCarRows.length}</strong> of {fleet.length}</span>

          <div style={{ flex: 1, minWidth: 12 }} />

          {isCagr ? (
            /* CAGR: global forecast adjustment (doesn't touch saved targets) */
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: C.textSec, fontWeight: 600 }}>
              Forecast adjustment
              <input type="number" value={adjustmentPct} onChange={(e) => setAdjustmentPct(e.target.value)} style={{ ...selectStyle, width: 78 }} />%
              {Number(adjustmentPct) !== 0 && (
                <button type="button" onClick={() => setAdjustmentPct(0)} style={{ ...bulkBtn, padding: "5px 8px" }}>Reset</button>
              )}
            </label>
          ) : (
            /* Manual: bulk edits scoped to the filtered rows */
            <>
              <input type="number" placeholder="% uplift" value={uplift} onChange={(e) => setUplift(e.target.value)} style={{ ...selectStyle, width: 92 }} />
              <button type="button" onClick={applyUplift} style={bulkBtn}>Apply to {perCarRows.length}</button>
              <button type="button" onClick={resetAllToTarget} style={{ ...bulkBtn, color: C.textSec }}>↺ Reset to target</button>
            </>
          )}

          {/* View toggle */}
          <div style={{ display: "flex", border: "1px solid #E0E0E0", borderRadius: 8, overflow: "hidden" }}>
            {["table", "cards"].map((v) => (
              <button key={v} type="button" onClick={() => setViewOverride(v)}
                style={{ padding: "7px 12px", fontSize: 11.5, fontWeight: 600, border: "none", cursor: "pointer", textTransform: "capitalize", background: effectiveView === v ? VIZ.blue : "#fff", color: effectiveView === v ? "#fff" : C.textSec }}>{v}</button>
            ))}
          </div>
        </div>

        {effectiveView === "cards" ? (
          <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            {pagedCarRows.map((r) => renderCard(r))}
            {perCarRows.length === 0 && <div style={{ color: C.textMuted, fontSize: 12, padding: 20 }}>No matching vehicles</div>}
          </div>
        ) : isCagr ? (
          /* CAGR table — read-only, CAGR target + basis columns */
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr>
                  {[["Plate", "plate", "left"], ["Make / Model", null, "left"], ["CAGR Target (saved)", null, "left"], ["Monthly Target Receipt", "receipt", "right"], [`${horizon}-mo Target Receipt`, "twelveMo", "right"], ["COE Remaining", "coe", "right"], ["Target Basis", null, "left"]].map(([label, key, align]) => (
                    <th key={label} onClick={key ? () => toggleSort(key) : undefined} style={{ ...th, textAlign: align, cursor: key ? "pointer" : "default", userSelect: "none" }}>
                      {label}{key && sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedCarRows.map((r) => (
                  <tr key={r.plate} style={{ borderBottom: "1px solid #F3F3F3" }}>
                    <td style={{ padding: "8px 12px" }}><PlateBadge plate={r.plate} small /></td>
                    <td style={{ padding: "8px 12px", fontSize: 11.5, color: C.textPri, whiteSpace: "nowrap" }}>{r.model}</td>
                    <td style={{ padding: "8px 12px" }}><TierBadge tier={r.tier} /></td>
                    <td style={{ ...numCell, fontWeight: 700, color: r.receipt > 0 ? VIZ.blue : C.textMuted }}>{r.receipt > 0 ? fmtAbs(r.receipt) : "—"}</td>
                    <td style={{ ...numCell, fontWeight: 700, color: C.navy }}>{fmtAbs(r.twelveMo)}</td>
                    <td style={{ ...numCell, color: r.moToCoe != null && r.moToCoe <= 6 ? VIZ.red : C.textSec }}>{r.moToCoe != null ? `${r.moToCoe} mo` : "—"}</td>
                    <td style={{ padding: "8px 12px", fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>{r.hasCagr ? "CAGR + COE" : "—"}</td>
                  </tr>
                ))}
                {perCarRows.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No matching vehicles</td></tr>}
              </tbody>
            </table>
          </div>
        ) : (
          /* Manual table — editable receipt column */
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead>
                <tr>
                  {[["Plate", "plate", "left"], ["Monthly Receipt", "receipt", "right"], [`${horizon}-mo contribution`, "twelveMo", "right"], ["COE", "coe", "right"]].map(([label, key, align]) => (
                    <th key={label} onClick={key ? () => toggleSort(key) : undefined} style={{ ...th, textAlign: align, cursor: key ? "pointer" : "default", userSelect: "none" }}>
                      {label}{key && sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedCarRows.map((r) => {
                  const editVal = edits[r.plate] !== undefined ? edits[r.plate] : r.receipt;
                  return (
                    <tr key={r.plate} style={{ borderBottom: "1px solid #F3F3F3" }}>
                      <td style={{ padding: "6px 12px" }}><PlateBadge plate={r.plate} small /></td>
                      <td style={{ padding: "5px 12px", textAlign: "right" }}>
                        <input type="number" value={editVal}
                          onChange={(e) => setEdits((s) => ({ ...s, [r.plate]: e.target.value }))}
                          onBlur={() => commitEdit(r.plate)}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          style={{ ...mono, width: 96, textAlign: "right", padding: "5px 8px", borderRadius: 7, border: `1px solid ${VIZ.blue}44`, background: tint(VIZ.blue), fontSize: 12.5, fontWeight: 700, color: C.navy, outline: "none" }} />
                      </td>
                      <td style={{ ...numCell, fontWeight: 700, color: C.navy }}>{fmtAbs(r.twelveMo)}</td>
                      <td style={{ ...numCell, color: r.moToCoe != null && r.moToCoe <= 6 ? VIZ.red : C.textSec }}>{r.moToCoe != null ? `${r.moToCoe} mo` : "—"}</td>
                    </tr>
                  );
                })}
                {perCarRows.length === 0 && <tr><td colSpan={4} style={{ padding: 20, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No matching vehicles</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <Pager page={carCurPage} setPage={setCarPage} totalPages={carTotalPages} totalCount={perCarRows.length} pageSize={CAR_PAGE_SIZE} noun="results" />
      </Card>

      {/* Monthly projection — full-width slim table */}
      <Card style={cardStyle}>
        <CardHeader title="Monthly Projection" subtitle={`${horizon}-month cash flow · Ledger balance + ${isCagr ? "CAGR target" : "rental"} receipts`} />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
            <thead><tr>{["Month", "Cash on hand (beginning)", `+ ${isCagr ? "Target " : ""}Receipts`, "= Total Cash Available", "Status"].map((h) => <th key={h} style={{ ...th, textAlign: h === "Month" ? "left" : h === "Status" ? "center" : "right" }}>{h}</th>)}</tr></thead>
            <tbody>
              {pagedMonths.map((r) => {
                const s = r.closing < Number(minBalance) ? { label: "Below minimum", color: VIZ.red } : statusOf(r.closing);
                return (
                  <tr key={r.ym} style={{ borderBottom: "1px solid #F3F3F3" }}>
                    <td style={{ padding: "9px 12px", fontSize: 11.5, fontWeight: 600, color: C.navy }}>{r.label}</td>
                    <td style={{ ...numCell, color: C.textSec }}>{fmtAbs(r.opening)}</td>
                    <td style={{ ...numCell, color: VIZ.green }}>{fmtAbs(r.receipts)}</td>
                    <td style={{ padding: "9px 12px" }}><BalanceCell value={r.closing} /></td>
                    <td style={{ padding: "9px 12px", textAlign: "center" }}><Badge color={s.color} bg={tint(s.color)}>{s.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager page={monthCurPage} setPage={setMonthPage} totalPages={monthTotalPages} totalCount={projection.length} pageSize={MONTH_PAGE_SIZE} noun="months" />
      </Card>
    </div>
  );
};

export default CashFlow;
