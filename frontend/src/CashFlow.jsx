import { useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { C, mono, fmt, daysUntil } from "./theme";
import { Card, CardHeader, PlateBadge } from "./components";
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

const VIZ = { blue: "#2a78d6", green: "#008300", amber: "#eda100", violet: "#4a3aa7", red: "#e34948", aqua: "#1baf7a" };
const tint = (h) => `${h}1A`;
const cardStyle = { background: "#fff", borderRadius: 14, border: "1px solid #ECECEC", boxShadow: "0 1px 2px rgba(16,24,40,0.06)" };
const selectStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid #E0E0E0", background: "#fff", fontSize: 12.5, fontFamily: "inherit", color: C.textPri, outline: "none" };
const field = { ...selectStyle, width: "100%", boxSizing: "border-box" };
const fieldWrap = { display: "flex", flexDirection: "column", gap: 6 };
const fieldLabel = { fontSize: 10.5, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4 };
const miniLink = { marginTop: 2, background: "none", border: "none", padding: 0, color: VIZ.blue, fontSize: 10.5, fontWeight: 600, cursor: "pointer", textAlign: "left" };
const bulkBtn = { padding: "7px 10px", borderRadius: 8, border: "1px solid #E0E0E0", background: "#fff", fontSize: 11.5, fontWeight: 600, color: VIZ.blue, cursor: "pointer", fontFamily: "inherit" };

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

const CashFlow = ({ fleet = [], earnings = [], expenses = [], bookings = [], onUpdateCar, calculateCarMonthlyTarget }) => {
  // Current cash position from the ledger — the natural default for "starting cash".
  const currentBalance = useMemo(() => {
    const rows = buildLedgerRows(earnings, expenses, bookings);
    return Math.round(rows.reduce((s, r) => s + r.credit - r.debit, 0));
  }, [earnings, expenses, bookings]);

  const [startingCash, setStartingCash] = useState(currentBalance);
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
            <div style={{ ...mono, fontSize: 18, fontWeight: 800, color: receipt > 0 ? C.navy : C.textMuted }}>{receipt > 0 ? fmt(receipt) : "—"}</div>
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
          {horizon}-mo contribution <strong style={{ color: C.navy }}>{fmt(Math.round(receipt * horizon))}</strong>
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

  // Build the month-by-month projection (receipts-only, rolling up).
  const projection = useMemo(() => {
    let opening = Number(startingCash) || 0;
    return months.map((m) => {
      const receipts = totalReceiptsPerMonth;
      const closing = opening + receipts;
      const row = { ...m, opening, receipts, closing };
      opening = closing;
      return row;
    });
  }, [months, startingCash, totalReceiptsPerMonth]);

  const totalReceipts = projection.reduce((s, r) => s + r.receipts, 0);
  const closingCash = projection.length ? projection[projection.length - 1].closing : startingCash;
  const lowest = projection.reduce((min, r) => Math.min(min, r.opening, r.closing), Number(startingCash) || 0);
  const belowMin = lowest < Number(minBalance);
  const firstBreach = projection.find((r) => r.closing < Number(minBalance));

  const isCagr = forecastMethod === "cagr";
  const kpis = [
    { label: "Starting Cash (Ledger)", value: startingCash, color: VIZ.blue, icon: "📗", sub: `${months[0]?.label || ""}` },
    { label: isCagr ? "Total Target Monthly Receipt" : "Monthly Receipts", value: totalReceiptsPerMonth, color: VIZ.green, icon: "📈", sub: isCagr ? "Sum of all cars' CAGR targets" : "Sum of all car receipts" },
    { label: `${horizon}-Month ${isCagr ? "Target " : ""}Receipts`, value: totalReceipts, color: VIZ.aqua, icon: "💰", sub: "Projected" },
    { label: `Total Cash Available (${horizon}mo)`, value: closingCash, color: VIZ.violet, icon: "💵", sub: months[months.length - 1]?.label || "" },
    { label: "Lowest Balance", value: lowest, color: belowMin ? VIZ.red : VIZ.violet, icon: belowMin ? "⚠️" : "🛡️", sub: belowMin ? "Below minimum!" : "Above minimum" },
  ];

  const th = { textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid #EFEFEF", whiteSpace: "nowrap", position: "sticky", top: 0, background: "#fff", zIndex: 1 };
  const numCell = { padding: "9px 12px", ...mono, fontSize: 11.5, textAlign: "right", whiteSpace: "nowrap" };

  const methods = [
    { id: "cagr", label: "CAGR Targets (from vehicles)", rec: true },
    { id: "manual", label: "Manual Targets", rec: false },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Forecast assumptions */}
      <Card style={cardStyle}>
        <CardHeader title="Forecast Assumptions" subtitle="Adjust these and everything below recalculates live" />
        <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16, alignItems: "start" }}>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Starting cash on hand</span>
            <input type="number" value={startingCash} onChange={(e) => setStartingCash(e.target.value)} style={field} />
            <button type="button" onClick={() => setStartingCash(currentBalance)} style={miniLink}>↺ Use current balance ({fmt(currentBalance)})</button>
          </label>
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
          <span>Projected cash dips below your minimum ({fmt(minBalance)}) in <strong>{firstBreach.label}</strong> (closing {fmt(firstBreach.closing)}). Consider adding rentals or trimming costs before then.</span>
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
              <div style={{ ...mono, fontSize: 20, fontWeight: 800, color: k.color, marginTop: 10 }}>{fmt(Math.round(k.value))}</div>
              <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 4 }}>{k.sub}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Projection chart */}
      <Card style={cardStyle}>
        <CardHeader title="Projected Cash on Hand" subtitle={`${months[0]?.label || ""} – ${months[months.length - 1]?.label || ""} · minimum ${fmt(minBalance)}`} />
        <div style={{ padding: "8px 12px 16px", height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={projection} margin={{ top: 10, right: 16, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="cfFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={VIZ.blue} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={VIZ.blue} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#EFEFEF" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={{ stroke: "#E5E5E5" }} />
              <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
              <Tooltip formatter={(v) => fmt(Math.round(v))} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
              <ReferenceLine y={Number(minBalance)} stroke={VIZ.red} strokeDasharray="5 4" label={{ value: "Min", position: "right", fill: VIZ.red, fontSize: 10 }} />
              <Area type="monotone" dataKey="closing" name="Cash on hand" stroke={VIZ.blue} strokeWidth={2.5} fill="url(#cfFill)" dot={{ r: 2 }} activeDot={{ r: 4 }} />
            </AreaChart>
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
          <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, maxHeight: 520, overflowY: "auto" }}>
            {perCarRows.map((r) => renderCard(r))}
            {perCarRows.length === 0 && <div style={{ color: C.textMuted, fontSize: 12, padding: 20 }}>No matching vehicles</div>}
          </div>
        ) : isCagr ? (
          /* CAGR table — read-only, CAGR target + basis columns */
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
                {perCarRows.map((r) => (
                  <tr key={r.plate} style={{ borderBottom: "1px solid #F3F3F3" }}>
                    <td style={{ padding: "8px 12px" }}><PlateBadge plate={r.plate} small /></td>
                    <td style={{ padding: "8px 12px", fontSize: 11.5, color: C.textPri, whiteSpace: "nowrap" }}>{r.model}</td>
                    <td style={{ padding: "8px 12px" }}><TierBadge tier={r.tier} /></td>
                    <td style={{ ...numCell, fontWeight: 700, color: r.receipt > 0 ? VIZ.blue : C.textMuted }}>{r.receipt > 0 ? fmt(r.receipt) : "—"}</td>
                    <td style={{ ...numCell, fontWeight: 700, color: C.navy }}>{fmt(Math.round(r.twelveMo))}</td>
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
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
                {perCarRows.map((r) => {
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
                      <td style={{ ...numCell, fontWeight: 700, color: C.navy }}>{fmt(Math.round(r.twelveMo))}</td>
                      <td style={{ ...numCell, color: r.moToCoe != null && r.moToCoe <= 6 ? VIZ.red : C.textSec }}>{r.moToCoe != null ? `${r.moToCoe} mo` : "—"}</td>
                    </tr>
                  );
                })}
                {perCarRows.length === 0 && <tr><td colSpan={4} style={{ padding: 20, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No matching vehicles</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Monthly projection — full-width slim table */}
      <Card style={cardStyle}>
        <CardHeader title="Monthly Projection" subtitle={`${horizon}-month cash flow · Ledger balance + ${isCagr ? "CAGR target" : "rental"} receipts`} />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Month", "Cash on hand (beginning)", `+ ${isCagr ? "Target " : ""}Receipts`, "= Total Cash Available"].map((h) => <th key={h} style={{ ...th, textAlign: h === "Month" ? "left" : "right" }}>{h}</th>)}</tr></thead>
            <tbody>
              {projection.map((r) => (
                <tr key={r.ym} style={{ borderBottom: "1px solid #F3F3F3" }}>
                  <td style={{ padding: "9px 12px", fontSize: 11.5, fontWeight: 600, color: C.navy }}>{r.label}</td>
                  <td style={{ ...numCell, color: C.textSec }}>{fmt(Math.round(r.opening))}</td>
                  <td style={{ ...numCell, color: VIZ.green }}>{fmt(Math.round(r.receipts))}</td>
                  <td style={{ ...numCell, fontWeight: 700, color: r.closing < Number(minBalance) ? VIZ.red : C.navy }}>{fmt(Math.round(r.closing))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default CashFlow;
