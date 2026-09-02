import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from "recharts";
import { C, mono, fmt, totalInv, carAssetValueBy, fleetAssetValueBy, DEPRECIATION_METHODS, hasManualValue } from "./theme";
import { Card, CardHeader, PlateBadge } from "./components";
import { buildLedgerRows, forfeitedDepositIncome } from "./ledgerUtils";

// Analytics view on the Ledger page's "Dashboard" tab. All values are derived
// from data the app already has (no backend). Colours use a validated
// colour-blind-safe categorical palette (see dataviz skill).

const VIZ = {
  blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a", yellow: "#eda100",
  magenta: "#e87ba4", green: "#008300", violet: "#4a3aa7", red: "#e34948",
};
const DONUT = [VIZ.blue, VIZ.orange, VIZ.aqua, VIZ.yellow, VIZ.magenta, VIZ.violet, VIZ.green, VIZ.red];
const UP = "#006300", DOWN = VIZ.red;

const cardStyle = { background: "#ffffff", borderRadius: 14, border: "1px solid #ECECEC", boxShadow: "0 1px 2px rgba(16,24,40,0.06)" };
const tint = (hex) => `${hex}1A`;

const monthLabelOf = (ym) => {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
};
const monthShort = (ym) => {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short" });
};
const prevMonthOf = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const pct = (cur, prev) => (!prev ? (cur > 0 ? 100 : 0) : ((cur - prev) / Math.abs(prev)) * 100);

// Inline editor for a car's manual current value (used only under the "Manual
// value" method). Keeps its own draft state and commits on blur / Enter so
// typing doesn't fire a save on every keystroke. Blank clears the value.
const inlineInput = { padding: "5px 8px", borderRadius: 7, border: "1px solid #D9D9D9", fontSize: 11, width: 108, textAlign: "right", fontFamily: "inherit", outline: "none" };
const ManualValueCell = ({ value, cost, onCommit }) => {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => { setV(value == null ? "" : String(value)); }, [value]);
  const commit = () => {
    const t = v.trim();
    const next = t === "" ? null : Number(t);
    const prev = value == null ? null : Number(value);
    if (next !== prev && !(next != null && Number.isNaN(next))) onCommit(next);
  };
  return (
    <input type="number" min="0" value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      placeholder={String(Math.round(cost))}
      style={inlineInput} />
  );
};

const LedgerDashboard = ({
  earnings = [], expenses = [], bookings = [], fleet = [], customers = [], investors = [],
  calculateMetrics, calculateCarMetrics, onUpdateCar,
}) => {
  // Months that actually have data (income and/or expenses).
  const monthsPresent = useMemo(() => {
    const s = new Set();
    earnings.forEach((e) => { const m = (e.end || e.start || "").slice(0, 7); if (m) s.add(m); });
    expenses.forEach((x) => { const m = (x.date || "").slice(0, 7); if (m) s.add(m); });
    return [...s].sort();
  }, [earnings, expenses]);

  // Default to "all" so the dashboard shows everything even when income and
  // expenses fall in different months.
  const [period, setPeriod] = useState("all");
  const isAll = period === "all";

  // ── Money helpers ─────────────────────────────────────────────────────────
  const earnMonth = (m) => earnings.filter((e) => (e.end || e.start || "").startsWith(m)).reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings, { prefix: m });
  const expMonth = (m) => expenses.filter((x) => (x.date || "").startsWith(m)).reduce((s, x) => s + (x.amount || 0), 0);
  const totalEarn = earnings.reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings);
  const totalExp = expenses.reduce((s, x) => s + (x.amount || 0), 0);

  const income = isAll ? totalEarn : earnMonth(period);
  const expenseTotal = isAll ? totalExp : expMonth(period);
  const profit = income - expenseTotal;
  const prevP = isAll ? null : prevMonthOf(period);

  // ── Balances (shared ledger helper) ───────────────────────────────────────
  // Current Balance = true cash position = every credit − every debit, i.e.
  // Investment + Rental Income + Deposits − Expenses − Refunds. Investor capital
  // now flows in via buildLedgerRows. Opening Balance is intentionally not shown.
  const rows = useMemo(() => buildLedgerRows(earnings, expenses, bookings, investors), [earnings, expenses, bookings, investors]);
  const currentBalance = rows.reduce((s, r) => s + r.credit - r.debit, 0);

  // ── Balance sheet (assets & net worth) ─────────────────────────────────────
  // The full car cost is booked as a "Vehicle Purchase" expense, which pulls the
  // cash balance down — but the car is still an asset you own. We value each car
  // by straight-line depreciation from its purchase date to its registration
  // (COE) expiry, then:
  //   Net Worth = Cash Balance + Fleet Asset Value
  // so the depreciating asset offsets the purchase expense and the true position
  // shows through. Only cars still in the fleet are counted.
  const [depMethod, setDepMethod] = useState("coe");
  const [depRate, setDepRate] = useState(20);
  const methodDef = DEPRECIATION_METHODS.find((m) => m.id === depMethod) || DEPRECIATION_METHODS[0];

  const assetRows = useMemo(() =>
    fleet.map((c) => {
      const cost = totalInv(c);
      const value = carAssetValueBy(c, depMethod, depRate);
      return {
        plate: c.plate,
        model: `${c.make || ""} ${c.model || ""}`.trim() || c.plate,
        cost,
        value,
        manualValue: hasManualValue(c) ? Number(c.manualValue) : null,
        depreciation: Math.max(0, cost - value),
        depPct: cost > 0 ? ((cost - value) / cost) * 100 : 0,
      };
    }).filter((r) => r.cost > 0).sort((a, b) => b.value - a.value),
  [fleet, depMethod, depRate]);
  const fleetValue = useMemo(() => fleetAssetValueBy(fleet, depMethod, depRate), [fleet, depMethod, depRate]);
  const totalCost = assetRows.reduce((s, r) => s + r.cost, 0);
  const netWorth = currentBalance + fleetValue;

  const kpis = [
    { label: "Current Balance", value: currentBalance, sub: "Investment + Income − Expenses", color: VIZ.aqua, icon: "💵", delta: null },
    { label: "Total Income", value: income, sub: isAll ? "All time" : "Selected month", color: VIZ.blue, icon: "💲", delta: prevP ? pct(income, earnMonth(prevP)) : null },
    { label: "Total Expense", value: expenseTotal, sub: isAll ? "All time" : "Selected month", color: VIZ.red, icon: "📉", delta: prevP ? pct(expenseTotal, expMonth(prevP)) : null },
    { label: "Net Profit", value: profit, sub: isAll ? "All time" : "Selected month", color: VIZ.violet, icon: "📊", delta: prevP ? pct(profit, earnMonth(prevP) - expMonth(prevP)) : null },
  ];

  // ── Revenue chart ─────────────────────────────────────────────────────────
  // All-time  → Income vs Expense by month (shows disjoint months clearly).
  // A month   → daily income, this month vs last.
  const revenue = useMemo(() => {
    if (isAll) {
      return {
        mode: "monthly",
        xKey: "label",
        series: [{ key: "Income", color: VIZ.blue }, { key: "Expense", color: VIZ.red }],
        data: monthsPresent.map((m) => ({ label: monthShort(m), Income: earnMonth(m), Expense: expMonth(m) })),
      };
    }
    const [y, m] = period.split("-").map(Number);
    const daysIn = new Date(y, m, 0).getDate();
    const dayMap = (ym) => {
      const map = {};
      earnings.forEach((e) => {
        const dt = (e.end || e.start || "").slice(0, 10);
        if (dt.slice(0, 7) === ym) map[Number(dt.slice(8, 10))] = (map[Number(dt.slice(8, 10))] || 0) + (e.total || 0);
      });
      return map;
    };
    const thisM = dayMap(period), lastM = dayMap(prevMonthOf(period));
    return {
      mode: "daily",
      xKey: "day",
      series: [{ key: "This Month", color: VIZ.blue }, { key: "Last Month", color: "#B7B7B7" }],
      data: Array.from({ length: daysIn }, (_, i) => ({ day: i + 1, "This Month": thisM[i + 1] || 0, "Last Month": lastM[i + 1] || 0 })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earnings, expenses, period, monthsPresent]);

  // ── Expense breakdown donut (computed straight from expenses) ──────────────
  const donut = useMemo(() => {
    const src = isAll ? expenses : expenses.filter((x) => (x.date || "").startsWith(period));
    const byCat = {};
    src.forEach((x) => { const k = x.category || "Other"; byCat[k] = (byCat[k] || 0) + (x.amount || 0); });
    return Object.entries(byCat).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [expenses, period, isAll]);
  const donutTotal = donut.reduce((s, d) => s + d.value, 0);

  // ── Vehicle profitability + top performers ────────────────────────────────
  const vehicleRows = useMemo(() => fleet.map((c) => {
    const m = calculateCarMetrics(c.plate);
    return { plate: c.plate, model: `${c.make} ${c.model}`, revenue: m.earnings, expense: m.expenses, profit: m.profit, profitPct: m.earnings > 0 ? (m.profit / m.earnings) * 100 : 0 };
  }), [fleet, calculateCarMetrics]);
  const daysRentedByPlate = useMemo(() => {
    const map = {};
    bookings.forEach((b) => {
      if (b.cancelled || !b.start || !b.end) return;
      map[b.plate] = (map[b.plate] || 0) + Math.max(0, Math.round((new Date(b.end) - new Date(b.start)) / 86400000));
    });
    return map;
  }, [bookings]);
  const rankedVehicles = useMemo(() => [...vehicleRows].sort((a, b) => b.profit - a.profit), [vehicleRows]);
  const topVehicles = rankedVehicles.slice(0, 5);
  const [showAllVehicles, setShowAllVehicles] = useState(false);
  const visibleVehicles = showAllVehicles ? rankedVehicles : rankedVehicles.slice(0, 5);

  const metrics = calculateMetrics();

  const th = { textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid #EFEFEF`, whiteSpace: "nowrap" };
  const rank = ["#EAB308", "#94A3B8", "#B45309"];
  const selectStyle = { padding: "6px 10px", borderRadius: 8, border: "1px solid #E0E0E0", background: "#fff", fontSize: 12, fontFamily: "inherit", color: C.textPri, outline: "none", cursor: "pointer" };
  const Delta = ({ v }) => v == null ? null : (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: v >= 0 ? UP : DOWN }}>
      {v >= 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}% <span style={{ color: C.textMuted, fontWeight: 500 }}>vs last month</span>
    </span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Period selector */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <select style={selectStyle} value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="all">All time</option>
          {[...monthsPresent].reverse().map((m) => <option key={m} value={m}>{monthLabelOf(m)}</option>)}
        </select>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        {kpis.map((k) => (
          <Card key={k.label} style={cardStyle}>
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>{k.label}</div>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: tint(k.color), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{k.icon}</div>
              </div>
              <div style={{ ...mono, fontSize: 19, fontWeight: 800, color: k.color, marginTop: 8 }}>{fmt(Math.round(k.value))}</div>
              <div style={{ marginTop: 6, minHeight: 14 }}>{k.delta != null ? <Delta v={k.delta} /> : <span style={{ fontSize: 10, color: C.textMuted }}>{k.sub}</span>}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Balance Sheet — Assets & Net Worth */}
      <Card style={cardStyle}>
        <CardHeader title="Balance Sheet — Assets & Net Worth"
          subtitle="Cars are assets — choose how they depreciate"
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select style={selectStyle} value={depMethod} onChange={(e) => setDepMethod(e.target.value)}>
                {/* Only the Straight-line → registration expiry method is offered;
                    the other depreciation options have been removed from the menu. */}
                {DEPRECIATION_METHODS.filter((m) => m.id === "coe").map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              {methodDef.needsRate && (
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="number" min="0" max="100" value={depRate}
                    onChange={(e) => setDepRate(e.target.value === "" ? "" : Number(e.target.value))}
                    style={{ ...selectStyle, width: 62 }} />
                  <span style={{ fontSize: 11, color: C.textMuted }}>%/yr</span>
                </div>
              )}
            </div>
          } />
        <div style={{ padding: "0 16px 16px" }}>
          {/* Summary row: Cash + Fleet Asset Value = Net Worth */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
            {[
              { label: "Cash Balance", value: currentBalance, color: VIZ.aqua, sub: "Income − Expenses" },
              { label: "Fleet Asset Value", value: fleetValue, color: VIZ.blue, sub: `Now worth of ${assetRows.length} car${assetRows.length === 1 ? "" : "s"}` },
              { label: "Net Worth", value: netWorth, color: netWorth >= 0 ? UP : DOWN, sub: "Cash + Fleet Value", strong: true },
            ].map((t) => (
              <div key={t.label} style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${t.strong ? tint(t.color) : "#EFEFEF"}`, background: t.strong ? tint(t.color) : "#FBFBFC" }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>{t.label}</div>
                <div style={{ ...mono, fontSize: t.strong ? 21 : 18, fontWeight: 800, color: t.color, marginTop: 6 }}>{fmt(Math.round(t.value))}</div>
                <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>{t.sub}</div>
              </div>
            ))}
          </div>

          {/* Per-vehicle asset table */}
          {assetRows.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Vehicle", "Invested", "Current Value", "Depreciation"].map((h, i) => <th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {assetRows.map((r) => (
                    <tr key={r.plate} style={{ borderBottom: "1px solid #F3F3F3" }}>
                      <td style={{ padding: "9px 12px" }}><PlateBadge plate={r.plate} small /></td>
                      <td style={{ padding: "9px 12px", ...mono, fontSize: 11, color: C.textSec, textAlign: "right" }}>{fmt(Math.round(r.cost))}</td>
                      <td style={{ padding: "9px 12px", ...mono, fontSize: 11, fontWeight: 700, color: C.navy, textAlign: "right" }}>
                        {depMethod === "manual" && onUpdateCar
                          ? <ManualValueCell value={r.manualValue} cost={r.cost} onCommit={(val) => onUpdateCar(r.plate, { manualValue: val })} />
                          : fmt(Math.round(r.value))}
                      </td>
                      <td style={{ padding: "9px 12px", textAlign: "right" }}>
                        <span style={{ ...mono, fontSize: 10.5, fontWeight: 700, color: DOWN }}>−{fmt(Math.round(r.depreciation))}</span>
                        <span style={{ fontSize: 10, color: C.textMuted, marginLeft: 6 }}>({r.depPct.toFixed(0)}%)</span>
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid #ECECEC" }}>
                    <td style={{ padding: "9px 12px", fontSize: 11, fontWeight: 700, color: C.textPri }}>Total</td>
                    <td style={{ padding: "9px 12px", ...mono, fontSize: 11, fontWeight: 700, color: C.textSec, textAlign: "right" }}>{fmt(Math.round(totalCost))}</td>
                    <td style={{ padding: "9px 12px", ...mono, fontSize: 11, fontWeight: 800, color: C.navy, textAlign: "right" }}>{fmt(Math.round(fleetValue))}</td>
                    <td style={{ padding: "9px 12px", ...mono, fontSize: 11, fontWeight: 700, color: DOWN, textAlign: "right" }}>−{fmt(Math.round(totalCost - fleetValue))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 20, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No vehicles with a recorded investment yet.</div>
          )}

          <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 10, lineHeight: 1.5 }}>
            {depMethod === "coe" && <>Each car starts at its Total Investment and depreciates <b>straight-line to zero at its registration (COE) expiry</b>. </>}
            {depMethod === "wdv" && <>Each car loses <b>{depRate || 0}% of its remaining value per year</b> (reducing balance) since its purchase date. </>}
            {depMethod === "slcost" && <>Each car loses <b>{depRate || 0}% of its original cost per year</b> since its purchase date, floored at zero. </>}
            {depMethod === "manual" && <>Type each car's <b>current market/resale value</b> in the Current Value column (saved automatically). Leave a cell blank to fall back to its cost. </>}
            Because the full purchase is booked as an expense, adding the current fleet value back gives your true <b>Net Worth</b>.
          </div>
        </div>
      </Card>

      {/* Revenue & Expense Analysis */}
      <Card style={cardStyle}>
        <div style={{ padding: "16px 16px 0" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>Revenue &amp; Expense Analysis</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>
            {isAll ? "Income vs expense by month" : `Daily income · ${monthLabelOf(period)} vs ${monthLabelOf(prevMonthOf(period))}`}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 8, padding: "4px 12px 16px" }}>
          {/* Revenue Overview */}
          <div style={{ borderRight: "1px solid #F0F0F0", paddingRight: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 4px 2px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.textPri }}>Revenue Overview</div>
              <div style={{ display: "flex", gap: 12, fontSize: 10.5, color: C.textMuted }}>
                {revenue.series.map((s) => (
                  <span key={s.key}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: s.color, marginRight: 4 }} />{s.key}</span>
                ))}
              </div>
            </div>
            <div style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenue.data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={VIZ.blue} stopOpacity={0.22} />
                      <stop offset="95%" stopColor={VIZ.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EFEFEF" vertical={false} />
                  <XAxis dataKey={revenue.xKey} tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={{ stroke: "#E5E5E5" }} interval={revenue.mode === "daily" ? 4 : 0} />
                  <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
                  <Tooltip formatter={(v) => fmt(Math.round(v))} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                  {revenue.series.slice().reverse().map((s) => (
                    <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color}
                      strokeWidth={s.key === "Last Month" ? 1.5 : 2.5}
                      strokeDasharray={s.key === "Last Month" ? "5 4" : undefined}
                      fill={s.key === "Income" || s.key === "This Month" ? "url(#revFill)" : "none"} dot={false} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Expense Breakdown */}
          <div style={{ paddingLeft: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textPri, padding: "6px 4px 2px" }}>Expense Breakdown</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ width: 150, height: 180, position: "relative" }}>
                {donut.length === 0 ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 12, color: C.textMuted, textAlign: "center" }}>No expenses<br />in this period</div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={donut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={74} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                          {donut.map((d, i) => <Cell key={d.name} fill={DONUT[i % DONUT.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => fmt(Math.round(v))} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                      <div style={{ ...mono, fontSize: 13, fontWeight: 800, color: C.textPri }}>{fmt(Math.round(donutTotal))}</div>
                      <div style={{ fontSize: 8.5, color: C.textMuted }}>Total Expense</div>
                    </div>
                  </>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                {donut.map((d, i) => (
                  <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, fontSize: 10.5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: DONUT[i % DONUT.length], flexShrink: 0 }} />
                    <span style={{ flex: 1, color: C.textSec, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                    <span style={{ ...mono, fontWeight: 700, color: C.textPri }}>{fmt(Math.round(d.value))}</span>
                    <span style={{ color: C.textMuted, width: 38, textAlign: "right" }}>{donutTotal ? ((d.value / donutTotal) * 100).toFixed(1) : 0}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Vehicle Profitability + Top Performing */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card style={cardStyle}>
          <CardHeader title="Vehicle Profitability" subtitle="Lifetime, per car"
            right={rankedVehicles.length > 5 && (
              <button onClick={() => setShowAllVehicles((s) => !s)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, color: VIZ.blue }}>
                {showAllVehicles ? "Show less" : `View all (${rankedVehicles.length})`}
              </button>
            )} />
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Vehicle", "Revenue", "Expense", "Profit", "Profit %"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {visibleVehicles.map((v) => (
                  <tr key={v.plate} style={{ borderBottom: "1px solid #F3F3F3" }}>
                    <td style={{ padding: "9px 12px" }}><PlateBadge plate={v.plate} small /></td>
                    <td style={{ padding: "9px 12px", ...mono, fontSize: 11, color: VIZ.green, textAlign: "right" }}>{fmt(Math.round(v.revenue))}</td>
                    <td style={{ padding: "9px 12px", ...mono, fontSize: 11, color: VIZ.red, textAlign: "right" }}>{fmt(Math.round(v.expense))}</td>
                    <td style={{ padding: "9px 12px", ...mono, fontSize: 11, fontWeight: 700, color: v.profit >= 0 ? C.navy : VIZ.red, textAlign: "right" }}>{fmt(Math.round(v.profit))}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>
                      <span style={{ ...mono, fontSize: 10.5, fontWeight: 700, color: v.profitPct >= 0 ? UP : DOWN, background: v.profitPct >= 0 ? tint(VIZ.green) : tint(VIZ.red), padding: "2px 7px", borderRadius: 20 }}>{v.profitPct.toFixed(1)}%</span>
                    </td>
                  </tr>
                ))}
                {vehicleRows.length === 0 && <tr><td colSpan="5" style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No vehicles</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card style={cardStyle}>
          <CardHeader title="Top Performing Vehicles" subtitle="By lifetime profit" />
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["#", "Vehicle", "Model", "Profit", "Days", "Type"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {topVehicles.map((v, i) => (
                  <tr key={v.plate} style={{ borderBottom: "1px solid #F3F3F3" }}>
                    <td style={{ padding: "9px 12px" }}>
                      <span style={{ display: "inline-flex", width: 20, height: 20, borderRadius: "50%", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#fff", background: rank[i] || "#CBD5E1" }}>{i + 1}</span>
                    </td>
                    <td style={{ padding: "9px 12px" }}><PlateBadge plate={v.plate} small /></td>
                    <td style={{ padding: "9px 12px", fontSize: 11, color: C.textSec, whiteSpace: "nowrap" }}>{v.model}</td>
                    <td style={{ padding: "9px 12px", ...mono, fontSize: 11, fontWeight: 700, color: C.navy, textAlign: "right" }}>{fmt(Math.round(v.profit))}</td>
                    <td style={{ padding: "9px 12px", fontSize: 11, textAlign: "center" }}>{daysRentedByPlate[v.plate] || 0}</td>
                    <td style={{ padding: "9px 12px" }}><span style={{ fontSize: 9.5, fontWeight: 600, color: UP, background: tint(VIZ.green), padding: "2px 7px", borderRadius: 20, whiteSpace: "nowrap" }}>Rental Income</span></td>
                  </tr>
                ))}
                {topVehicles.length === 0 && <tr><td colSpan="6" style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No vehicles</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

    </div>
  );
};

export default LedgerDashboard;
