import { useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { C, mono, fmt, daysUntil } from "./theme";
import { Card, CardHeader, PlateBadge } from "./components";
import { buildLedgerRows } from "./ledgerUtils";

// Cash Flow Forecast — a rolling projection of cash on hand across future
// months (like the RDK "Cash Flow reference" sheet). Each car contributes an
// editable flat monthly receipt (defaulting to its computed monthly target);
// outflows use the fleet's monthly maintenance budget. Everything is a
// projection layered on a starting cash balance — no new persisted data except
// the per-car monthly_forecast the user edits here.

const VIZ = { blue: "#2a78d6", green: "#008300", amber: "#eda100", violet: "#4a3aa7", red: "#e34948", aqua: "#1baf7a" };
const tint = (h) => `${h}1A`;
const cardStyle = { background: "#fff", borderRadius: 14, border: "1px solid #ECECEC", boxShadow: "0 1px 2px rgba(16,24,40,0.06)" };
const selectStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid #E0E0E0", background: "#fff", fontSize: 12.5, fontFamily: "inherit", color: C.textPri, outline: "none" };
const field = { ...selectStyle, width: "100%", boxSizing: "border-box" };
const fieldWrap = { display: "flex", flexDirection: "column", gap: 6 };
const fieldLabel = { fontSize: 10.5, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4 };
const miniLink = { marginTop: 2, background: "none", border: "none", padding: 0, color: VIZ.blue, fontSize: 10.5, fontWeight: 600, cursor: "pointer", textAlign: "left" };
const bulkBtn = { padding: "7px 10px", borderRadius: 8, border: "1px solid #E0E0E0", background: "#fff", fontSize: 11.5, fontWeight: 600, color: VIZ.blue, cursor: "pointer", fontFamily: "inherit" };

const monthsFrom = (startYm, n) => {
  const [y, m] = startYm.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 + i, 1);
    return { ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }) };
  });
};
const invOf = (car) => (Number(car.purchase) || 0) + (Number(car.insurance) || 0) + (Number(car.reg) || 0) + (Number(car.otherCharges) || 0);

const CashFlow = ({ fleet = [], earnings = [], expenses = [], bookings = [], onUpdateCar, calculateCarMonthlyTarget, calculateMonthlyBudget }) => {
  // Current cash position from the ledger — the natural default for "starting cash".
  const currentBalance = useMemo(() => {
    const rows = buildLedgerRows(earnings, expenses, bookings);
    return Math.round(rows.reduce((s, r) => s + r.credit - r.debit, 0));
  }, [earnings, expenses, bookings]);

  const [startingCash, setStartingCash] = useState(currentBalance);
  const [startMonth, setStartMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [horizon, setHorizon] = useState(12);
  const [minBalance, setMinBalance] = useState(5000);
  const [edits, setEdits] = useState({}); // in-progress per-car receipt edits (plate -> string)
  // Per-car list controls — search / sort / filter / view, so the section stays
  // usable at 100+ cars instead of one giant wall of cards.
  const [viewOverride, setViewOverride] = useState(null); // null = auto by fleet size
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("net");
  const [sortDir, setSortDir] = useState("asc"); // worst net first by default
  const [netFilter, setNetFilter] = useState("all"); // all | positive | negative
  const [uplift, setUplift] = useState("");

  // Per-car monthly receipt: the editable value, with a SANE default.
  //  1) the value the user saved (car.monthlyForecast) always wins
  //  2) else the car's target daily rate × ~26 rented days
  //  3) else the computed monthly target — but ignore absurd spikes (a car whose
  //     COE has already passed makes that target = its whole remaining
  //     investment), falling back to a sensible placeholder the user can edit.
  const receiptOf = (car) => {
    if (car.monthlyForecast != null) return Number(car.monthlyForecast);
    if (car.targetRate) return Math.round(Number(car.targetRate) * 26);
    const t = Math.round(calculateCarMonthlyTarget?.(car.plate, startMonth) || 0);
    return t > 0 && t <= 15000 ? t : 1500;
  };
  const costOf = (car) => (invOf(car) * (Number(car.maint) || 0) / 100) / 12;
  const maxNet = Math.max(1, ...fleet.map((c) => receiptOf(c) - costOf(c)));

  // Cards for small fleets, table for large — but only until the user picks one.
  const effectiveView = viewOverride ?? (fleet.length > 24 ? "table" : "cards");

  // One derived list feeds BOTH views, so search/sort/filter behave identically
  // whichever is showing. Default sort is Net ascending — the cars dragging cash
  // flow down surface at the top, which is the whole point of a forecast.
  const perCarRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = fleet.map((car) => {
      const receipt = receiptOf(car);
      const cost = costOf(car);
      const net = receipt - cost;
      const moToCoe = car.coe ? Math.max(0, Math.round(daysUntil(car.coe) / 30)) : null;
      return { car, plate: car.plate, receipt, cost, net, moToCoe, twelveMo: net * horizon };
    });
    if (q) list = list.filter((r) => r.plate.toLowerCase().includes(q));
    if (netFilter === "positive") list = list.filter((r) => r.net >= 0);
    else if (netFilter === "negative") list = list.filter((r) => r.net < 0);
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === "plate") return a.plate < b.plate ? -dir : a.plate > b.plate ? dir : 0;
      const pick = { receipt: "receipt", twelveMo: "twelveMo", coe: "moToCoe", net: "net" }[sortKey] || "net";
      const av = a[pick] ?? Infinity;
      const bv = b[pick] ?? Infinity;
      return (av - bv) * dir;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet, edits, query, sortKey, sortDir, netFilter, horizon, startMonth]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "plate" || key === "coe" ? "asc" : "desc"); }
  };

  // Bulk edits apply to the CURRENTLY FILTERED rows only, so "search a subset,
  // then apply" scopes the change to just those cars.
  const applyUplift = () => {
    const pct = Number(uplift);
    if (uplift === "" || Number.isNaN(pct)) return;
    perCarRows.forEach((r) => onUpdateCar?.(r.plate, { monthlyForecast: Math.round(r.receipt * (1 + pct / 100)) }));
    setUplift("");
  };
  const resetAllToTarget = () => {
    perCarRows.forEach((r) => onUpdateCar?.(r.plate, { monthlyForecast: null }));
  };

  // The existing card, factored out so both the cards view and (small-fleet)
  // default can render it from the shared, filtered/sorted list.
  const renderCard = (car) => {
    const receipt = receiptOf(car);
    const cost = costOf(car);
    const net = receipt - cost;
    const moToCoe = car.coe ? Math.max(0, Math.round(daysUntil(car.coe) / 30)) : null;
    const editVal = edits[car.plate] !== undefined ? edits[car.plate] : receipt;
    const barPct = Math.max(0, Math.min(100, (net / maxNet) * 100));
    return (
      <div key={car.plate} style={{ border: "1px solid #ECECEC", borderRadius: 12, padding: 14, background: "#fff", boxShadow: "0 1px 2px rgba(16,24,40,0.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <PlateBadge plate={car.plate} small />
          {moToCoe != null && <span style={{ fontSize: 9.5, color: C.textMuted }}>{moToCoe} mo to COE</span>}
        </div>
        <div style={{ fontSize: 9.5, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Monthly Receipt</div>
        <input type="number" value={editVal}
          onChange={(e) => setEdits((s) => ({ ...s, [car.plate]: e.target.value }))}
          onBlur={() => commitEdit(car.plate)}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          style={{ ...mono, width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 8, border: `1px solid ${VIZ.blue}55`, background: tint(VIZ.blue), fontSize: 14, fontWeight: 700, color: C.navy, outline: "none" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10 }}>
          <span style={{ fontSize: 10, color: C.textMuted }}>Net / month</span>
          <span style={{ ...mono, fontSize: 14, fontWeight: 800, color: net >= 0 ? VIZ.green : VIZ.red }}>{fmt(Math.round(net))}</span>
        </div>
        <div style={{ height: 6, background: "#F0F0F0", borderRadius: 4, overflow: "hidden", marginTop: 6 }}>
          <div style={{ height: "100%", width: `${barPct}%`, background: net >= 0 ? VIZ.green : VIZ.red, borderRadius: 4 }} />
        </div>
        <div style={{ fontSize: 9.5, color: C.textMuted, marginTop: 9, display: "flex", justifyContent: "space-between" }}>
          <span>Cost {fmt(Math.round(cost))}/mo</span>
          <span>{horizon}-mo <strong style={{ color: C.navy }}>{fmt(Math.round(net * horizon))}</strong></span>
        </div>
      </div>
    );
  };

  const months = useMemo(() => monthsFrom(startMonth, horizon), [startMonth, horizon]);
  const totalReceiptsPerMonth = useMemo(() => fleet.reduce((s, c) => s + receiptOf(c), 0), [fleet, edits, startMonth]);

  // Build the month-by-month projection.
  const projection = useMemo(() => {
    let opening = Number(startingCash) || 0;
    return months.map((m) => {
      const receipts = totalReceiptsPerMonth;
      const outflows = Math.round(calculateMonthlyBudget?.(m.ym) || 0);
      const closing = opening + receipts - outflows;
      const row = { ...m, opening, receipts, outflows, net: receipts - outflows, closing };
      opening = closing;
      return row;
    });
  }, [months, startingCash, totalReceiptsPerMonth, calculateMonthlyBudget]);

  const totalReceipts = projection.reduce((s, r) => s + r.receipts, 0);
  const totalOutflows = projection.reduce((s, r) => s + r.outflows, 0);
  const closingCash = projection.length ? projection[projection.length - 1].closing : startingCash;
  const lowest = projection.reduce((min, r) => Math.min(min, r.opening, r.closing), Number(startingCash) || 0);
  const belowMin = lowest < Number(minBalance);
  const firstBreach = projection.find((r) => r.closing < Number(minBalance));

  const kpis = [
    { label: "Starting Cash", value: startingCash, color: VIZ.blue, icon: "📗", sub: `${months[0]?.label || ""}` },
    { label: `Closing (${horizon}mo)`, value: closingCash, color: VIZ.aqua, icon: "💵", sub: months[months.length - 1]?.label || "" },
    { label: "Total Receipts", value: totalReceipts, color: VIZ.green, icon: "📈", sub: "Projected" },
    { label: "Total Outflows", value: totalOutflows, color: VIZ.red, icon: "📉", sub: "Projected" },
    { label: "Lowest Balance", value: lowest, color: belowMin ? VIZ.red : VIZ.violet, icon: belowMin ? "⚠️" : "🛡️", sub: belowMin ? "Below minimum!" : "Above minimum" },
  ];

  const commitEdit = (plate) => {
    const v = edits[plate];
    if (v === undefined) return;
    const num = v === "" ? null : Number(v);
    onUpdateCar?.(plate, { monthlyForecast: num });
    setEdits((e) => { const n = { ...e }; delete n[plate]; return n; });
  };

  const th = { textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid #EFEFEF", whiteSpace: "nowrap", position: "sticky", top: 0, background: "#fff", zIndex: 1 };
  const numCell = { padding: "9px 12px", ...mono, fontSize: 11.5, textAlign: "right", whiteSpace: "nowrap" };

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

      {/* Per-car forecast — scales from cards (small fleet) to a dense,
          searchable/sortable/bulk-editable table (large fleet). */}
      <Card style={cardStyle}>
        <CardHeader title="Per-Car Forecast" subtitle="Each car's monthly receipt is editable — search, sort, and bulk-edit for large fleets" />

        {/* Controls */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #F0F0F0", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <input placeholder="🔍 Search plate…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...selectStyle, width: 160 }} />
          <select value={netFilter} onChange={(e) => setNetFilter(e.target.value)} style={selectStyle}>
            <option value="all">All cars</option>
            <option value="negative">Net negative</option>
            <option value="positive">Net positive</option>
          </select>
          <select value={`${sortKey}:${sortDir}`} onChange={(e) => { const [k, d] = e.target.value.split(":"); setSortKey(k); setSortDir(d); }} style={selectStyle}>
            <option value="net:asc">Sort: Net ↑ (worst first)</option>
            <option value="net:desc">Sort: Net ↓ (best first)</option>
            <option value="receipt:desc">Sort: Receipt ↓</option>
            <option value="twelveMo:desc">Sort: 12-mo ↓</option>
            <option value="coe:asc">Sort: COE soonest</option>
            <option value="plate:asc">Sort: Plate A–Z</option>
          </select>
          <span style={{ fontSize: 11, color: C.textMuted }}>Showing <strong style={{ color: C.navy }}>{perCarRows.length}</strong> of {fleet.length}</span>

          <div style={{ flex: 1, minWidth: 12 }} />

          {/* Bulk actions — scoped to the filtered rows */}
          <input type="number" placeholder="% uplift" value={uplift} onChange={(e) => setUplift(e.target.value)} style={{ ...selectStyle, width: 92 }} />
          <button type="button" onClick={applyUplift} style={bulkBtn}>Apply to {perCarRows.length}</button>
          <button type="button" onClick={resetAllToTarget} style={{ ...bulkBtn, color: C.textSec }}>↺ Reset to target</button>

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
            {perCarRows.map((r) => renderCard(r.car))}
            {perCarRows.length === 0 && <div style={{ color: C.textMuted, fontSize: 12, padding: 20 }}>No matching vehicles</div>}
          </div>
        ) : (
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {[["Plate", "plate", "left"], ["Monthly Receipt", "receipt", "right"], ["Cost/mo", null, "right"], ["Net/mo", "net", "right"], [`${horizon}-mo`, "twelveMo", "right"], ["COE", "coe", "right"]].map(([label, key, align]) => (
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
                      <td style={{ ...numCell, color: C.textMuted }}>{fmt(Math.round(r.cost))}</td>
                      <td style={{ ...numCell, fontWeight: 700, color: r.net >= 0 ? VIZ.green : VIZ.red }}>{fmt(Math.round(r.net))}</td>
                      <td style={{ ...numCell, color: C.navy }}>{fmt(Math.round(r.twelveMo))}</td>
                      <td style={{ ...numCell, color: r.moToCoe != null && r.moToCoe <= 6 ? VIZ.red : C.textSec }}>{r.moToCoe != null ? `${r.moToCoe} mo` : "—"}</td>
                    </tr>
                  );
                })}
                {perCarRows.length === 0 && <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No matching vehicles</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Monthly projection — full-width slim table */}
      <Card style={cardStyle}>
        <CardHeader title="Monthly Projection" subtitle={`${horizon}-month cash flow`} />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Month", "Opening", "+ Receipts", "− Outflows", "= Closing"].map((h) => <th key={h} style={{ ...th, textAlign: h === "Month" ? "left" : "right" }}>{h}</th>)}</tr></thead>
            <tbody>
              {projection.map((r) => (
                <tr key={r.ym} style={{ borderBottom: "1px solid #F3F3F3" }}>
                  <td style={{ padding: "9px 12px", fontSize: 11.5, fontWeight: 600, color: C.navy }}>{r.label}</td>
                  <td style={{ ...numCell, color: C.textSec }}>{fmt(Math.round(r.opening))}</td>
                  <td style={{ ...numCell, color: VIZ.green }}>{fmt(Math.round(r.receipts))}</td>
                  <td style={{ ...numCell, color: VIZ.red }}>{fmt(Math.round(r.outflows))}</td>
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
