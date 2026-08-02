import { useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import { C, mono, fmt } from "./theme";
import { Card, CardHeader, Badge, PlateBadge } from "./components";
import { buildLedgerRows } from "./ledgerUtils";

// Analytics view shown on the Ledger page's "Dashboard" tab. Everything here is
// derived from data the app already has (earnings, expenses, bookings, fleet,
// customers) via the same helpers the rest of the app uses — no backend calls.

const monthLabelOf = (ym) => {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
};
const prevMonthOf = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const pct = (cur, prev) => {
  if (!prev) return cur > 0 ? 100 : 0;
  return ((cur - prev) / Math.abs(prev)) * 100;
};

// Distinct, on-brand colours for the expense donut.
const DONUT_COLORS = [C.teal, C.amber, C.green, C.navyMid, C.red, C.tealLight, C.navy, "#B08968", "#7D8CA3"];

const LedgerDashboard = ({
  earnings = [], expenses = [], bookings = [], fleet = [], customers = [],
  calculateMetrics, calculateMonthlyMetrics, calculateCarMetrics, getExpensesByCategory,
}) => {
  // Active month = the most recent month that has any activity (falls back to
  // the current calendar month) so the dashboard shows real numbers.
  const activeMonth = useMemo(() => {
    const dates = [
      ...earnings.map((e) => (e.end || e.start || "").slice(0, 7)),
      ...expenses.map((x) => (x.date || "").slice(0, 7)),
    ].filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1] : new Date().toISOString().slice(0, 7);
  }, [earnings, expenses]);
  const lastMonth = prevMonthOf(activeMonth);

  // ── Balances (same helper the Ledger uses, so numbers match exactly) ──────
  const rows = useMemo(() => buildLedgerRows(earnings, expenses, bookings), [earnings, expenses, bookings]);
  const monthStart = `${activeMonth}-01`;
  const openingBalance = rows.filter((r) => r.date < monthStart).reduce((s, r) => s + r.credit - r.debit, 0);
  const currentBalance = rows.reduce((s, r) => s + r.credit - r.debit, 0);

  // ── This-month vs last-month P&L ──────────────────────────────────────────
  const cur = calculateMonthlyMetrics(activeMonth);
  const prev = calculateMonthlyMetrics(lastMonth);

  const kpis = [
    { label: "Opening Balance", value: openingBalance, sub: `As of 01 ${monthLabelOf(activeMonth)}`, color: C.navy, delta: null },
    { label: "Current Balance", value: currentBalance, sub: "Live cash position", color: C.teal, delta: null },
    { label: "Total Income", value: cur.monthlyEarnings, sub: "This month", color: C.green, delta: pct(cur.monthlyEarnings, prev.monthlyEarnings) },
    { label: "Total Expense", value: cur.monthlyExpenses, sub: "This month", color: C.red, delta: pct(cur.monthlyExpenses, prev.monthlyExpenses) },
    { label: "Net Profit", value: cur.monthlyProfit, sub: "This month", color: C.navyMid, delta: pct(cur.monthlyProfit, prev.monthlyProfit) },
  ];

  // ── Revenue Overview line chart (daily income: this vs last month) ────────
  const dailyIncome = (ym) => {
    const map = {};
    earnings.forEach((e) => {
      const dt = (e.end || e.start || "").slice(0, 10);
      if (dt.slice(0, 7) === ym) {
        const day = Number(dt.slice(8, 10));
        map[day] = (map[day] || 0) + (e.total || 0);
      }
    });
    return map;
  };
  const revenueSeries = useMemo(() => {
    const [y, m] = activeMonth.split("-").map(Number);
    const daysIn = new Date(y, m, 0).getDate();
    const thisM = dailyIncome(activeMonth);
    const lastM = dailyIncome(lastMonth);
    const out = [];
    for (let d = 1; d <= daysIn; d++) {
      out.push({ day: d, "This Month": thisM[d] || 0, "Last Month": lastM[d] || 0 });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earnings, activeMonth]);

  // ── Expense breakdown donut ───────────────────────────────────────────────
  const donut = useMemo(() => {
    const byCat = getExpensesByCategory(activeMonth) || {};
    return Object.entries(byCat).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [getExpensesByCategory, activeMonth]);
  const totalExpenseMonth = donut.reduce((s, d) => s + d.value, 0);

  // ── Vehicle profitability ─────────────────────────────────────────────────
  const vehicleRows = useMemo(() => fleet.map((c) => {
    const m = calculateCarMetrics(c.plate);
    return {
      plate: c.plate, model: `${c.make} ${c.model}`,
      revenue: m.earnings, expense: m.expenses, profit: m.profit,
      profitPct: m.earnings > 0 ? (m.profit / m.earnings) * 100 : 0,
    };
  }), [fleet, calculateCarMetrics]);

  const daysRentedByPlate = useMemo(() => {
    const map = {};
    bookings.forEach((b) => {
      if (b.cancelled || !b.start || !b.end) return;
      const d = Math.max(0, Math.round((new Date(b.end) - new Date(b.start)) / 86400000));
      map[b.plate] = (map[b.plate] || 0) + d;
    });
    return map;
  }, [bookings]);

  const topVehicles = [...vehicleRows].sort((a, b) => b.profit - a.profit).slice(0, 5);

  // ── Fleet / customer / booking tiles ──────────────────────────────────────
  const metrics = calculateMetrics();
  const tiles = [
    { label: "Total Vehicles", value: metrics.totalFleet, icon: "🚗", color: C.navy },
    { label: "On Rent", value: metrics.onRentalCount, icon: "🔑", color: C.teal },
    { label: "Available", value: metrics.availableCount, icon: "✅", color: C.green },
    { label: "Under Maintenance", value: metrics.maintenanceCount, icon: "🔧", color: C.amber },
    { label: "Total Customers", value: customers.length, icon: "👥", color: C.navyMid },
    { label: "Total Bookings", value: bookings.length, icon: "📅", color: C.tealLight },
  ];

  const th = { textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const Delta = ({ v }) => v == null ? null : (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: v >= 0 ? C.green : C.red }}>
      {v >= 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}% <span style={{ color: C.textMuted, fontWeight: 500 }}>vs last month</span>
    </span>
  );

  return (
    <div>
      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        {kpis.map((k) => (
          <Card key={k.label}>
            <div style={{ padding: 14 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>{k.label}</div>
              <div style={{ ...mono, fontSize: 17, fontWeight: 700, color: k.color }}>{fmt(Math.round(k.value))}</div>
              <div style={{ marginTop: 6 }}>{k.delta != null ? <Delta v={k.delta} /> : <span style={{ fontSize: 10, color: C.textMuted }}>{k.sub}</span>}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Revenue Overview + Expense Breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, marginBottom: 16 }}>
        <Card>
          <CardHeader title="Revenue Overview" subtitle={`Daily rental income · ${monthLabelOf(activeMonth)} vs ${monthLabelOf(lastMonth)}`} />
          <div style={{ padding: "8px 12px 16px", height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueSeries} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={{ stroke: C.border }} />
                <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={48}
                  tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
                <Tooltip formatter={(v) => fmt(Math.round(v))} labelFormatter={(d) => `Day ${d}`}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${C.border}` }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="This Month" stroke={C.teal} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Last Month" stroke={C.tealLight} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Expense Breakdown" subtitle="By category" right={<Badge>{fmt(Math.round(totalExpenseMonth))}</Badge>} />
          <div style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ width: 170, height: 200, position: "relative" }}>
              {donut.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 12, color: C.textMuted }}>No expenses</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={80} paddingAngle={2}>
                      {donut.map((d, i) => <Cell key={d.name} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmt(Math.round(v))} contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${C.border}` }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              {donut.map((d, i) => (
                <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 11 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: DONUT_COLORS[i % DONUT_COLORS.length], flexShrink: 0 }} />
                  <span style={{ flex: 1, color: C.textSec }}>{d.name}</span>
                  <span style={{ ...mono, fontWeight: 700, color: C.textPri }}>{fmt(Math.round(d.value))}</span>
                  <span style={{ color: C.textMuted, width: 40, textAlign: "right" }}>{totalExpenseMonth ? ((d.value / totalExpenseMonth) * 100).toFixed(1) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Vehicle Profitability + Top Performing */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card>
          <CardHeader title="Vehicle Profitability" subtitle="Lifetime, per car" />
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: C.bg }}>{["Vehicle", "Revenue", "Expense", "Profit", "Profit %"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {vehicleRows.map((v) => (
                  <tr key={v.plate} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "9px 12px" }}><PlateBadge plate={v.plate} small /></td>
                    <td style={{ padding: "9px 12px", ...mono, fontSize: 11, color: C.green, textAlign: "right" }}>{fmt(Math.round(v.revenue))}</td>
                    <td style={{ padding: "9px 12px", ...mono, fontSize: 11, color: C.red, textAlign: "right" }}>{fmt(Math.round(v.expense))}</td>
                    <td style={{ padding: "9px 12px", ...mono, fontSize: 11, fontWeight: 700, color: v.profit >= 0 ? C.navy : C.red, textAlign: "right" }}>{fmt(Math.round(v.profit))}</td>
                    <td style={{ padding: "9px 12px", ...mono, fontSize: 11, fontWeight: 700, color: v.profitPct >= 0 ? C.green : C.red, textAlign: "right" }}>{v.profitPct.toFixed(1)}%</td>
                  </tr>
                ))}
                {vehicleRows.length === 0 && <tr><td colSpan="5" style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No vehicles</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Top Performing Vehicles" subtitle="By lifetime profit" />
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: C.bg }}>{["#", "Vehicle", "Model", "Profit", "Days Rented"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {topVehicles.map((v, i) => (
                  <tr key={v.plate} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "9px 12px", fontSize: 12, fontWeight: 700, color: C.textMuted }}>{i + 1}</td>
                    <td style={{ padding: "9px 12px" }}><PlateBadge plate={v.plate} small /></td>
                    <td style={{ padding: "9px 12px", fontSize: 11, color: C.textSec, whiteSpace: "nowrap" }}>{v.model}</td>
                    <td style={{ padding: "9px 12px", ...mono, fontSize: 11, fontWeight: 700, color: C.navy, textAlign: "right" }}>{fmt(Math.round(v.profit))}</td>
                    <td style={{ padding: "9px 12px", fontSize: 11, textAlign: "center" }}>{daysRentedByPlate[v.plate] || 0}</td>
                  </tr>
                ))}
                {topVehicles.length === 0 && <tr><td colSpan="5" style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No vehicles</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
        {tiles.map((t) => (
          <Card key={t.label}>
            <div style={{ padding: 14, textAlign: "center" }}>
              <div style={{ fontSize: 20 }}>{t.icon}</div>
              <div style={{ ...mono, fontSize: 20, fontWeight: 700, color: t.color, marginTop: 4 }}>{t.value}</div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{t.label}</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default LedgerDashboard;
