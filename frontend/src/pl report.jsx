import { useState, useMemo, useEffect } from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, Cell, AreaChart, Area, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";
import { C, mono, fmt, totalInv } from "./theme";

const tint = (hex) => `${hex}1A`;
// Categorical palette for the Net-Profit-by-Car donut/legend.
const DONUT_COLORS = ["#2563EB", "#16A34A", "#0EA5A5", "#EAB308", "#EF4444", "#F97316", "#8B5CF6"];

// Semicircle utilization gauge (SVG): teal→green→amber arc with a needle at the
// given percentage, the value below the pivot, and 0/100 endpoint labels.
const Gauge = ({ value = 0, size = 260 }) => {
  const w = size, h = size * 0.56;
  const cx = w / 2, cy = h - 4, r = w / 2 - 24;
  const polar = (ang) => ({ x: cx + r * Math.cos((ang * Math.PI) / 180), y: cy - r * Math.sin((ang * Math.PI) / 180) });
  const arc = (a0, a1) => { const s = polar(a0), e = polar(a1); return `M ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y}`; };
  const v = Math.max(0, Math.min(100, value));
  const needleAng = 180 - (v / 100) * 180;
  const np = { x: cx + (r - 16) * Math.cos((needleAng * Math.PI) / 180), y: cy - (r - 16) * Math.sin((needleAng * Math.PI) / 180) };
  return (
    <svg width={w} height={h + 40} viewBox={`0 0 ${w} ${h + 40}`}>
      <path d={arc(180, 108)} stroke="#0EA5A5" strokeWidth="16" fill="none" strokeLinecap="round" />
      <path d={arc(108, 36)} stroke="#16A34A" strokeWidth="16" fill="none" />
      <path d={arc(36, 0)} stroke="#F59E0B" strokeWidth="16" fill="none" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={np.x} y2={np.y} stroke="#475569" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="7" fill="#475569" />
      <text x={cx - r} y={cy + 22} textAnchor="middle" fontSize="11" fill="#64748B">0</text>
      <text x={cx + r} y={cy + 22} textAnchor="middle" fontSize="11" fill="#64748B">100</text>
      <text x={cx} y={cy + 30} textAnchor="middle" fontSize="24" fontWeight="800" fill="#0F172A">{v.toFixed(1)}%</text>
    </svg>
  );
};
import { forfeitedDepositIncome } from "./ledgerUtils";
import { Card, CardHeader, Btn, StatusTag, PlateBadge, KpiCard, MiniBar, PLRow } from "./components";

const PL_MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
const shortMonth = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" });
const plYTick = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`);

const EmptyViz = ({ icon, text }) => (
  <div style={{ height: "100%", minHeight: 160, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: C.textMuted }}>
    <div style={{ fontSize: 32, opacity: 0.5 }}>{icon}</div>
    <div style={{ fontSize: 12 }}>{text}</div>
  </div>
);

const PlReport = ({ fleet = [], bookings = [], earnings = [], expenses = [], calculateMetrics, calculateMonthlyMetrics, calculateCarMetrics, initialView = "fleet", onInitialViewConsumed }) => {
  const [view, setView] = useState(initialView);
  // The initial tab may be set by a deep-link (e.g. Dashboard → Vehicle
  // Performance opens the Utilization tab). Tell the parent once, so the next
  // plain navigation to P&L defaults back to the Fleet view.
  useEffect(() => { onInitialViewConsumed?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [selectedCar, setSelectedCar] = useState(fleet.length > 0 ? fleet[0].plate : "");
  const [month, setMonth] = useState("2026-06");
  const [overviewGran, setOverviewGran] = useState("Monthly");
  const [perCarSearch, setPerCarSearch] = useState("");

  const monthLabel = {
    "2026-01": "January",
    "2026-02": "February",
    "2026-03": "March",
    "2026-04": "April",
    "2026-05": "May",
    "2026-06": "June",
    "2026-07": "July",
    "2026-08": "August",
    "2026-09": "September",
    "2026-10": "October",
    "2026-11": "November",
    "2026-12": "December",
  }[month] || month;

  const monthMetrics = calculateMonthlyMetrics(month);
  const metrics = calculateMetrics();

  // Calculate YTD
  const ytdMetrics = {
    income: earnings.reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings),
    expenses: expenses.reduce((s, e) => s + (e.amount || 0), 0),
    get profit() { return this.income - this.expenses; },
  };

  // ── Pictorial data ────────────────────────────────────────────────────────
  // Month-by-month income / expenses / net profit across 2026 for the trend chart.
  const monthlySeries = useMemo(() => PL_MONTHS.map((m) => {
    const mm = calculateMonthlyMetrics(m);
    return { label: shortMonth(m), income: mm.monthlyEarnings || 0, expenses: mm.monthlyExpenses || 0, profit: mm.monthlyProfit || 0 };
  }), [earnings, expenses, bookings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Net P&L per car for the selected month (profit vs loss), biggest first.
  const perCarNet = useMemo(() => fleet.map((c) => {
    const inc = earnings.filter((e) => e.plate === c.plate && e.start?.startsWith(month)).reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings, { prefix: month, plate: c.plate });
    const exp = expenses.filter((e) => e.plate === c.plate && e.date?.startsWith(month)).reduce((s, e) => s + (e.amount || 0), 0);
    return { plate: c.plate, net: inc - exp };
  }).filter((x) => x.net !== 0).sort((a, b) => b.net - a.net), [fleet, earnings, expenses, month]);

  const margin = monthMetrics.monthlyEarnings > 0 ? (monthMetrics.monthlyProfit / monthMetrics.monthlyEarnings) * 100 : 0;

  // Income vs Expenses aggregated to the chosen granularity for the overview chart.
  const overviewData = useMemo(() => {
    if (overviewGran === "Quarterly") {
      return ["Q1", "Q2", "Q3", "Q4"].map((label, i) => {
        const slice = monthlySeries.slice(i * 3, i * 3 + 3);
        return { label, income: slice.reduce((s, x) => s + x.income, 0), expenses: slice.reduce((s, x) => s + x.expenses, 0) };
      });
    }
    if (overviewGran === "Yearly") {
      return [{ label: "2026", income: monthlySeries.reduce((s, x) => s + x.income, 0), expenses: monthlySeries.reduce((s, x) => s + x.expenses, 0) }];
    }
    return monthlySeries;
  }, [monthlySeries, overviewGran]);

  // Net Profit by Car (top 6 for the month) — donut slices sized by |net|, with
  // each car's share of the month's total net for the legend.
  const totalNet = monthMetrics.monthlyProfit;
  const donutCars = perCarNet.slice(0, 6).map((c, i) => ({
    ...c, color: DONUT_COLORS[i % DONUT_COLORS.length],
    absNet: Math.abs(c.net),
    pct: totalNet !== 0 ? (c.net / Math.abs(totalNet)) * 100 : 0,
  }));

  // Target vs actual running days per car (only cars with a target), for the
  // utilization chart.
  const utilData = useMemo(() => fleet.filter((c) => c.runningDaysTarget).map((c) => {
    const actual = bookings
      .filter((b) => b.plate === c.plate && b.start?.startsWith(month))
      .reduce((sum, b) => sum + Math.max(0, Math.round((new Date(b.end) - new Date(b.start)) / 86400000)), 0);
    return { plate: c.plate, target: c.runningDaysTarget || 0, actual };
  }), [fleet, bookings, month]);

  const MonthSelect = (
    <select value={month} onChange={e => setMonth(e.target.value)}
      style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 13, color: C.textPri, background: C.surface, outline: "none" }}>
      <option value="2026-01">January 2026</option>
      <option value="2026-02">February 2026</option>
      <option value="2026-03">March 2026</option>
      <option value="2026-04">April 2026</option>
      <option value="2026-05">May 2026</option>
      <option value="2026-06">June 2026</option>
      <option value="2026-07">July 2026</option>
      <option value="2026-08">August 2026</option>
      <option value="2026-09">September 2026</option>
      <option value="2026-10">October 2026</option>
      <option value="2026-11">November 2026</option>
      <option value="2026-12">December 2026</option>
    </select>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>P&L Reports</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>Profit & Loss by car or fleet</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {MonthSelect}
          {["fleet", "per-car", "utilization"].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${view === v ? C.teal : C.border}`,
              background: view === v ? C.teal : C.surface,
              color: view === v ? "#fff" : C.textSec, fontFamily: "inherit",
            }}>{v === "fleet" ? "Fleet Level" : v === "per-car" ? "Per Car" : "Utilization"}</button>
          ))}
          <Btn small>⬇ Export</Btn>
        </div>
      </div>

      {view === "fleet" ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16, marginBottom: 16 }}>
            {[
              { label: `${monthLabel} Income`, value: fmt(monthMetrics.monthlyEarnings), icon: "👛", color: C.green, sub: "All completed & active bookings", chip: `${monthMetrics.monthlyBookings} bookings`, chipColor: C.green, chipBg: C.greenFaint },
              { label: `${monthLabel} Expenses`, value: fmt(monthMetrics.monthlyExpenses), icon: "🔻", color: C.red, sub: "All categories", chip: `${expenses.filter(e => e.date?.startsWith(month)).length} items`, chipColor: C.red, chipBg: C.redFaint },
              { label: "Net Profit (Loss)", value: fmt(monthMetrics.monthlyProfit), icon: "📊", color: C.blue, sub: "Income – Expenses", chip: monthMetrics.monthlyProfit >= 0 ? "Profit" : "Loss", chipColor: monthMetrics.monthlyProfit >= 0 ? C.green : C.red, chipBg: monthMetrics.monthlyProfit >= 0 ? C.greenFaint : C.redFaint },
              { label: "Profit Margin", value: `${margin.toFixed(1)}%`, icon: "📈", color: C.purple, sub: "Net Profit / Income" },
            ].map((k) => (
              <Card key={k.label}>
                <div style={{ padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>{k.label}</div>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: tint(k.color), color: k.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{k.icon}</div>
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: C.navy, marginTop: 8, lineHeight: 1.1 }}>{k.value}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{k.sub}</div>
                  {k.chip && <div style={{ display: "inline-block", marginTop: 10, fontSize: 10.5, fontWeight: 700, color: k.chipColor, background: k.chipBg, padding: "2px 9px", borderRadius: 20 }}>{k.chip}</div>}
                </div>
              </Card>
            ))}
          </div>

          {/* ── Income vs Expenses Overview + Net Profit by Car ───────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, marginBottom: 16 }}>
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "16px 18px 6px" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>Income vs Expenses Overview</div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{overviewGran} overview for 2026</div>
                </div>
                <div style={{ display: "inline-flex", background: C.bg, borderRadius: 8, padding: 2 }}>
                  {["Monthly", "Quarterly", "Yearly"].map((g) => (
                    <button key={g} onClick={() => setOverviewGran(g)} style={{ padding: "4px 12px", fontSize: 11, fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", background: overviewGran === g ? C.teal : "transparent", color: overviewGran === g ? "#fff" : C.textMuted }}>{g}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, padding: "0 18px 4px", fontSize: 11.5, color: C.textSec }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: C.green }} /> Income</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: C.red }} /> Expenses</span>
              </div>
              <div style={{ padding: "6px 10px 12px", height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={overviewData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="plIncome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.green} stopOpacity={0.35} /><stop offset="100%" stopColor={C.green} stopOpacity={0.02} /></linearGradient>
                      <linearGradient id="plExpense" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.red} stopOpacity={0.3} /><stop offset="100%" stopColor={C.red} stopOpacity={0.02} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#00000010" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={{ stroke: C.border }} />
                    <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={44} tickFormatter={plYTick} />
                    <Tooltip formatter={(v, n) => [fmt(Math.round(v)), n === "income" ? "Income" : "Expenses"]} contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${C.border}` }} />
                    <Area type="monotone" dataKey="income" stroke={C.green} strokeWidth={2.5} fill="url(#plIncome)" dot={{ r: 3, fill: C.green }} />
                    <Area type="monotone" dataKey="expenses" stroke={C.red} strokeWidth={2.5} fill="url(#plExpense)" dot={{ r: 3, fill: C.red }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <div style={{ padding: "16px 18px 6px" }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>Net Profit by Car — {monthLabel}</div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Based on completed bookings</div>
              </div>
              <div style={{ padding: "6px 16px 16px" }}>
                {donutCars.length === 0 ? (
                  <EmptyViz icon="📈" text={`No car P&L for ${monthLabel}.`} />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ position: "relative", width: 170, height: 170, flexShrink: 0 }}>
                      <PieChart width={170} height={170}>
                        <Pie data={donutCars} dataKey="absNet" cx="50%" cy="50%" innerRadius={52} outerRadius={82} paddingAngle={2} stroke="none">
                          {donutCars.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                      </PieChart>
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                        <div style={{ fontSize: 9.5, color: C.textMuted }}>Total</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: totalNet >= 0 ? C.navy : C.red }}>{fmt(totalNet)}</div>
                        <div style={{ fontSize: 8.5, color: C.textMuted }}>Net Profit (Loss)</div>
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 150 }}>
                      {donutCars.map((d) => (
                        <div key={d.plate} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
                          <span style={{ width: 9, height: 9, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 11.5, color: C.textSec, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.plate}</span>
                          <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: d.net >= 0 ? C.green : C.red }}>{d.net >= 0 ? "" : "−"}{fmt(Math.abs(d.net))}</span>
                          <span style={{ fontSize: 10, color: C.textMuted, minWidth: 46, textAlign: "right" }}>({d.pct.toFixed(1)}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card>
              <CardHeader title={`Fleet P&L — ${monthLabel}`} />
              <div style={{ padding: 16 }}>
                <PLRow label="Total Rental Income" value={`+${fmt(monthMetrics.monthlyEarnings)}`} positive={true} />
                <PLRow label="Total Expenses" value={`−${fmt(monthMetrics.monthlyExpenses)}`} positive={false} />
                <PLRow label={`Net P&L — ${monthLabel}`} value={`${monthMetrics.monthlyProfit >= 0 ? "+" : "−"}${fmt(Math.abs(monthMetrics.monthlyProfit))}`} positive={monthMetrics.monthlyProfit >= 0} bold divider />
                <div style={{ marginTop: 12 }}>
                  <PLRow label="YTD Income" value={fmt(ytdMetrics.income)} positive={true} />
                  <PLRow label="YTD Expenses" value={fmt(ytdMetrics.expenses)} positive={false} />
                  <PLRow label="YTD Net P&L" value={fmt(ytdMetrics.profit)} positive={ytdMetrics.profit >= 0} bold divider />
                </div>
              </div>
            </Card>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px 10px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>Per-Car Income — {monthLabel}</div>
                <input value={perCarSearch} onChange={(e) => setPerCarSearch(e.target.value)} placeholder="🔍  Search car plate…" style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 11.5, fontFamily: "inherit", color: C.textPri, background: C.surface, outline: "none", minWidth: 160 }} />
              </div>
              <div style={{ overflowX: "auto", maxHeight: 340, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
                  <thead>
                    <tr style={{ background: C.bg }}>
                      {["Car Plate", "Income (SGD)", "Expenses (SGD)", "Net Profit (SGD)", "Profit Margin"].map((h, i) => (
                        <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "9px 14px", fontSize: 9.5, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fleet.filter(c => !perCarSearch.trim() || (c.plate || "").toLowerCase().includes(perCarSearch.trim().toLowerCase())).map(c => {
                      const carEarnings = earnings.filter(e => e.plate === c.plate && e.start?.startsWith(month)).reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings, { prefix: month, plate: c.plate });
                      const carExpenses = expenses.filter(e => e.plate === c.plate && e.date?.startsWith(month)).reduce((s, e) => s + (e.amount || 0), 0);
                      const net = carEarnings - carExpenses;
                      const marginPct = carEarnings > 0 ? (net / carEarnings) * 100 : 0;
                      return (
                        <tr key={c.plate} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: "10px 14px" }}><PlateBadge plate={c.plate} small /></td>
                          <td style={{ padding: "10px 14px", ...mono, fontSize: 12, color: C.textPri, textAlign: "right", whiteSpace: "nowrap" }}>{carEarnings ? carEarnings.toLocaleString() : "–"}</td>
                          <td style={{ padding: "10px 14px", ...mono, fontSize: 12, color: C.textPri, textAlign: "right", whiteSpace: "nowrap" }}>{carExpenses ? carExpenses.toLocaleString() : "–"}</td>
                          <td style={{ padding: "10px 14px", ...mono, fontSize: 12, fontWeight: 700, color: net >= 0 ? C.green : C.red, textAlign: "right", whiteSpace: "nowrap" }}>{net ? (net < 0 ? "−" : "") + Math.abs(net).toLocaleString() : "–"}</td>
                          <td style={{ padding: "10px 14px", ...mono, fontSize: 12, fontWeight: 700, color: net >= 0 ? C.green : C.red, textAlign: "right", whiteSpace: "nowrap" }}>{carEarnings ? `${marginPct.toFixed(2)}%` : "–"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      ) : view === "utilization" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {(() => {
            const rows = fleet.map(c => {
              const carBookings = bookings.filter(b => b.plate === c.plate && !b.cancelled && b.start?.startsWith(month));
              const actual = carBookings.reduce((sum, b) => sum + Math.max(0, Math.round((new Date(b.end) - new Date(b.start)) / 86400000)), 0);
              const target = c.runningDaysTarget || 0;
              const util = target > 0 ? (actual / target) * 100 : 0;
              const driver = carBookings.length ? carBookings[carBookings.length - 1].customer : "—";
              return { plate: c.plate, model: `${c.make || ""} ${c.model || ""}`.trim(), driver, actual, target, util };
            });
            const totalActual = rows.reduce((s, r) => s + r.actual, 0);
            const totalTarget = rows.reduce((s, r) => s + r.target, 0);
            const overall = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;
            const carsWithBookings = new Set(bookings.filter(b => !b.cancelled && b.start?.startsWith(month)).map(b => b.plate));
            const availableCars = fleet.filter(c => !carsWithBookings.has(c.plate)).length;
            const utilColor = (u) => u >= 70 ? C.green : u >= 40 ? C.amber : C.red;
            return (
              <>
                <Card>
                  <div style={{ padding: "16px 18px 4px", fontSize: 15, fontWeight: 800, color: C.navy, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 17 }}>🚙</span> Overall Fleet Utilization Summary — {monthLabel}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 16px 18px" }}>
                    <Gauge value={overall} />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(150px, 1fr))", gap: 12, marginTop: 8, width: "100%", maxWidth: 640 }}>
                      {[
                        { label: "Total Fleet Running Days", value: totalActual.toLocaleString(), dot: null },
                        { label: "Target Fleet Running Days", value: totalTarget.toLocaleString(), dot: null },
                        { label: "Available Cars", value: availableCars.toLocaleString(), dot: C.green },
                      ].map(s => (
                        <div key={s.label} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", background: C.surface, textAlign: "center" }}>
                          <div style={{ fontSize: 10.5, color: C.textMuted, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>{s.dot && <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.dot }} />}{s.label}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: C.navy, marginTop: 4 }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>

                <Card>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px 10px", borderBottom: `1px solid ${C.border}` }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>Utilization — {monthLabel}</div>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Target vs actual running days per car</div>
                    </div>
                    <div style={{ display: "flex", gap: 14, fontSize: 11, color: C.textSec }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: C.green }} /> Actual</span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 8, borderRadius: 2, border: `1px dashed ${C.textMuted}` }} /> Target</span>
                    </div>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                      <thead>
                        <tr style={{ background: C.bg }}>
                          {["Car Plate", "Car Model", "Driver", "Actual Running Days", "Target Running Days", "Utilization (%)", "Status"].map(h => (
                            <th key={h} style={{ textAlign: "left", padding: "9px 14px", fontSize: 9.5, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No cars registered</td></tr>
                        ) : rows.map(r => {
                          const onHire = r.util >= 50;
                          return (
                            <tr key={r.plate} style={{ borderBottom: `1px solid ${C.border}` }}>
                              <td style={{ padding: "10px 14px" }}><PlateBadge plate={r.plate} small /></td>
                              <td style={{ padding: "10px 14px", fontSize: 12, color: C.textPri, whiteSpace: "nowrap" }}>{r.model || "—"}</td>
                              <td style={{ padding: "10px 14px", fontSize: 12, color: C.textSec, whiteSpace: "nowrap" }}>{r.driver}</td>
                              <td style={{ padding: "10px 14px", minWidth: 180 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ ...mono, fontSize: 12, color: C.textPri, minWidth: 20 }}>{r.actual}</span>
                                  <div style={{ flex: 1, height: 7, background: C.linen, borderRadius: 4, overflow: "hidden" }}>
                                    <div style={{ width: `${Math.min(100, r.util)}%`, height: "100%", background: C.green, borderRadius: 4 }} />
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: "10px 14px", minWidth: 180 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ ...mono, fontSize: 12, color: C.textPri, minWidth: 20 }}>{r.target}</span>
                                  <div style={{ flex: 1, height: 7, borderRadius: 4, border: `1px dashed ${C.border}` }} />
                                </div>
                              </td>
                              <td style={{ padding: "10px 14px", ...mono, fontSize: 12.5, fontWeight: 700, color: utilColor(r.util), whiteSpace: "nowrap" }}>{r.util.toFixed(1)}%</td>
                              <td style={{ padding: "10px 14px" }}>
                                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: onHire ? C.greenFaint : C.amberFaint, color: onHire ? C.green : C.amber, whiteSpace: "nowrap" }}>{onHire ? "On Hire" : "Low"}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            );
          })()}
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 16 }}>
            <select value={selectedCar} onChange={e => setSelectedCar(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 13, color: C.textPri, background: C.surface, outline: "none" }}>
              {fleet.map(c => <option key={c.plate} value={c.plate}>{c.plate} — {c.make} {c.model}</option>)}
            </select>
          </div>
          {(() => {
            const car = fleet.find(c => c.plate === selectedCar);
            if (!car) return <div>No car selected</div>;

            const carEarnings = earnings.filter(e => e.plate === selectedCar && e.start?.startsWith(month)).reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings, { prefix: month, plate: selectedCar });
            const carExpenses = expenses.filter(e => e.plate === selectedCar && e.date?.startsWith(month)).reduce((s, e) => s + (e.amount || 0), 0);
            const net = carEarnings - carExpenses;
            const inv = totalInv(car);
            const totalCarEarnings = earnings.filter(e => e.plate === selectedCar).reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings, { plate: selectedCar });
            const recovery = inv > 0 ? Math.round((totalCarEarnings / inv) * 100) : 0;
            const monthBookings = bookings.filter(b => b.plate === selectedCar && b.start?.startsWith(month));

            // Selected car's month-by-month income & net across 2026.
            const carMonthly = PL_MONTHS.map((m) => {
              const inc = earnings.filter(e => e.plate === selectedCar && e.start?.startsWith(m)).reduce((s, e) => s + (e.total || 0), 0) + forfeitedDepositIncome(bookings, { prefix: m, plate: selectedCar });
              const exp = expenses.filter(e => e.plate === selectedCar && e.date?.startsWith(m)).reduce((s, e) => s + (e.amount || 0), 0);
              return { label: shortMonth(m), income: inc, net: inc - exp };
            });
            const hasCarData = carMonthly.some((d) => d.income !== 0 || d.net !== 0);
            const bookingVals = monthBookings.map(b => (b.rate || 0) * Math.max(0, Math.round((new Date(b.end) - new Date(b.start)) / 86400000)));
            const avgBookingValue = bookingVals.length ? Math.round(bookingVals.reduce((s, v) => s + v, 0) / bookingVals.length) : Math.round(carEarnings);

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <Card>
                  <div style={{ padding: "16px 18px 4px" }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: C.navy, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 17 }}>🚙</span> Monthly Performance — {car.make} {car.model}
                    </div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Income &amp; Net P&L across 2026</div>
                  </div>
                  <div style={{ padding: "6px 10px 4px", height: 280 }}>
                    {!hasCarData ? (
                      <EmptyViz icon="🚙" text="No income or expenses recorded for this car yet." />
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={carMonthly} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="carIncome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.green} stopOpacity={0.3} /><stop offset="100%" stopColor={C.green} stopOpacity={0.02} /></linearGradient>
                            <linearGradient id="carNet" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.red} stopOpacity={0.28} /><stop offset="100%" stopColor={C.red} stopOpacity={0.02} /></linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#00000010" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={{ stroke: C.border }} />
                          <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={44} tickFormatter={plYTick} />
                          <Tooltip formatter={(v, n) => [fmt(Math.round(v)), n === "income" ? "Income" : "Net P&L"]} contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${C.border}` }} />
                          <Area type="monotone" dataKey="income" stroke={C.green} strokeWidth={2.5} fill="url(#carIncome)" dot={{ r: 3, fill: C.green }} />
                          <Area type="monotone" dataKey="net" stroke={C.red} strokeWidth={2.5} fill="url(#carNet)" dot={{ r: 3, fill: C.red }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 18, fontSize: 11.5, color: C.textSec, padding: "0 0 12px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: C.green }} /> Income</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: C.red }} /> Net P&L</span>
                  </div>
                </Card>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <Card>
                      <CardHeader title={`P&L — ${car.make} ${car.model}`} right={<StatusTag status={car.status} />} />
                      <div style={{ padding: 16 }}>
                        <PLRow label={`Rental Income (${monthLabel})`} value={carEarnings ? `+${fmt(carEarnings)}` : fmt(0)} positive={true} />
                        <PLRow label={`Expenses (${monthLabel})`} value={carExpenses ? `−${fmt(carExpenses)}` : fmt(0)} positive={carExpenses === 0} />
                        <PLRow label={`Net P&L (${monthLabel})`} value={`${net >= 0 ? "" : "−"}${fmt(Math.abs(net))}`} positive={net >= 0} bold divider />
                        <div style={{ marginTop: 12 }}>
                          <PLRow label="Total Investment" value={fmt(inv)} />
                          <PLRow label="Total Recovered" value={fmt(totalCarEarnings)} positive={true} />
                          <PLRow label="Pending Recovery" value={fmt(Math.max(0, inv - totalCarEarnings))} positive={false} bold divider />
                        </div>
                      </div>
                    </Card>
                    <Card>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 18px" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Avg. Booking Value ({monthLabel})</div>
                        <div style={{ ...mono, fontSize: 15, fontWeight: 800, color: C.navy }}>{fmt(avgBookingValue)}</div>
                      </div>
                    </Card>
                  </div>
                  <Card>
                    <CardHeader title={`Booking History — ${monthLabel}`} subtitle={`${selectedCar} · ${monthLabel}`} />
                    <div style={{ padding: 16 }}>
                      {monthBookings.length === 0 ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.blueFaint, borderRadius: 8, padding: "12px 14px", fontSize: 12.5, color: C.textSec }}>
                          <span style={{ color: C.blue, fontSize: 15 }}>ⓘ</span> No bookings recorded for {monthLabel}.
                        </div>
                      ) : (
                        monthBookings.map(b => {
                          const days = Math.round((new Date(b.end) - new Date(b.start)) / 86400000);
                          return (
                            <div key={b.id} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>{b.customer}</div>
                                <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.green }}>{fmt(b.rate * days)}</div>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                                <div style={{ fontSize: 10.5, color: C.textMuted }}>{b.start} → {b.end} · {days} days @ SGD {b.rate}/d</div>
                                <StatusTag status={b.status} />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </Card>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default PlReport;