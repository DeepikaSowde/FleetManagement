import { useState, useMemo } from "react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { C, mono, fmt } from "./theme";
import { Card, CardHeader, Btn, Badge, PlateBadge } from "./components";

// Categories from RDK Trading's real ledger (RDK_Car Rental_Database.xlsx).
const CATEGORIES = [
  "Vehicle Purchase", "New Vehicle Advance Paid", "Insurance", "Road Tax & Transfer Fee",
  "LTA Fee", "LTA Transfer", "Registration", "Inspection", "Internal Sticker", "Fuel",
  "Parking Fee", "External Pickup/Drop", "Repairs & Maintenance", "PR Payment", "Advertisement",
  "Salary", "Office", "Tools", "Other / Miscellaneous",
];

const CAT_HUES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7"];
const OTHER_HUE = "#9a9992";
const ACQ_HUES = { purchase: "#2a78d6", insurance: "#1baf7a", regOther: "#eda100" };

// Fixed buckets for the Expense Breakdown summary (matches the reference design).
const BREAKDOWN = [
  { key: "Vehicle Purchase", icon: "🚗", color: "#2a78d6", match: (c) => /purchase|advance/i.test(c) },
  { key: "Insurance", icon: "🛡️", color: "#8b5cf6", match: (c) => /insurance/i.test(c) },
  { key: "Maintenance", icon: "🔧", color: "#eda100", match: (c) => /repair|maintenance/i.test(c) },
  { key: "Fuel", icon: "⛽", color: "#1baf7a", match: (c) => /fuel/i.test(c) },
  { key: "Others", icon: "▦", color: "#9a9992", match: () => true },
];

const pad2 = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthKey = (iso) => (iso ? String(iso).slice(0, 7) : null);
const monthLabel = (key) => { const [y, m] = key.split("-"); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" }); };
const dayShort = (iso) => { const d = new Date(`${iso}T00:00:00`); return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); };

const EmptyViz = ({ icon, text }) => (
  <div style={{ height: "100%", minHeight: 160, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: C.textMuted }}>
    <div style={{ fontSize: 32, opacity: 0.5 }}>{icon}</div>
    <div style={{ fontSize: 12 }}>{text}</div>
  </div>
);

const fieldLabel = { fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 };
const fieldInput = { width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 12, color: C.textPri, background: C.surface, outline: "none" };
const selectStyle = { padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: "inherit", background: C.surface, cursor: "pointer", color: C.textPri, outline: "none" };

// Tinted car glyph — stand-in for a photo (matches the Car Availability page).
const CAR_COLOR_HEX = { Silver: "#C3C8CC", White: "#E9ECEA", Blue: "#4472C4", Black: "#353B40", Red: "#D64045", Grey: "#8A8F94", Gray: "#8A8F94", Green: "#4B6B3A", Yellow: "#E4B33B", Orange: "#DD7A34", Brown: "#8C6B4B" };
function CarGlyph({ color }) {
  const paint = CAR_COLOR_HEX[color] || "#6C7A70";
  return (
    <svg viewBox="0 0 132 84" style={{ width: "100%", height: "100%", display: "block" }} aria-hidden="true">
      <ellipse cx="66" cy="70" rx="52" ry="7" fill="#00000010" />
      <path d="M12 58 Q10 44 24 41 L40 40 Q50 28 66 27 Q86 27 96 40 L112 44 Q122 46 122 58 L120 64 Q118 66 112 66 L20 66 Q14 66 12 60 Z" fill={paint} stroke="#00000022" strokeWidth="1.2" />
      <path d="M44 40 Q52 30 66 29 Q82 29 92 41 Z" fill="#ffffff" opacity="0.22" />
      <path d="M50 39 Q56 33 65 33 L65 39 Z" fill="#2b3a42" opacity="0.55" />
      <path d="M69 33 Q80 34 86 39 L69 39 Z" fill="#2b3a42" opacity="0.55" />
      <circle cx="38" cy="65" r="12" fill="#23282b" /><circle cx="38" cy="65" r="5.2" fill="#c7cdd0" />
      <circle cx="96" cy="65" r="12" fill="#23282b" /><circle cx="96" cy="65" r="5.2" fill="#c7cdd0" />
    </svg>
  );
}

// Small trend sparkline (inline SVG) for the Top 5 vehicles table.
function Sparkline({ points, color }) {
  if (!points || points.length < 2) return <span style={{ fontSize: 10, color: C.textMuted }}>—</span>;
  const w = 90, h = 26, max = Math.max(...points, 1), min = Math.min(...points, 0);
  const span = max - min || 1;
  const path = points.map((v, i) => `${(i / (points.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }} aria-hidden="true">
      <polyline points={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Expense Management KPI card — icon chip + value + delta line.
function ExpKpi({ label, value, sub, subColor, icon, iconBg, bar, barColor }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px", background: C.surface, display: "flex", flexDirection: "column", gap: 8, minHeight: 96 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{icon}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
          <div style={{ ...mono, fontSize: 22, fontWeight: 800, color: C.navy, marginTop: 3, letterSpacing: -0.4 }}>{value}</div>
        </div>
      </div>
      {sub && <div style={{ fontSize: 11, fontWeight: 600, color: subColor || C.textMuted }}>{sub}</div>}
      {bar != null && (
        <div style={{ height: 6, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${Math.max(3, Math.min(100, bar))}%`, height: "100%", background: barColor, borderRadius: 4 }} />
        </div>
      )}
    </div>
  );
}

const Expenses = ({ expenses = [], fleet = [], onAddExpense, onUpdateExpense, onDeleteExpense }) => {
  const [showForm, setShowForm] = useState(false);
  const [catFilter, setCatFilter] = useState("all");
  const [newExpense, setNewExpense] = useState({ plate: "", date: "", category: "", desc: "", amount: "", receipt: false, paidTo: "" });
  const [sortBy, setSortBy] = useState("high");
  const [statusFilter, setStatusFilter] = useState("all");
  // Expense Management dashboard filters.
  const [period, setPeriod] = useState("all"); // all | thisMonth | lastMonth | thisYear | custom
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [topRange, setTopRange] = useState("6m"); // 1m | 6m | 1y

  // ── Period scoping for the dashboard ──────────────────────────────────────
  const range = useMemo(() => {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    if (period === "thisMonth") return { from: isoOf(new Date(y, m, 1)), to: isoOf(new Date(y, m + 1, 0)) };
    if (period === "lastMonth") return { from: isoOf(new Date(y, m - 1, 1)), to: isoOf(new Date(y, m, 0)) };
    if (period === "thisYear") return { from: isoOf(new Date(y, 0, 1)), to: isoOf(new Date(y, 11, 31)) };
    if (period === "custom") return { from: fromDate || null, to: toDate || null };
    return { from: null, to: null };
  }, [period, fromDate, toDate]);

  const inRange = (dateStr) => {
    if (!dateStr) return false;
    if (range.from && dateStr < range.from) return false;
    if (range.to && dateStr > range.to) return false;
    return true;
  };
  const scoped = useMemo(() => (range.from || range.to ? expenses.filter((e) => inRange(e.date)) : expenses), [expenses, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const scopedTotal = scoped.reduce((s, e) => s + (e.amount || 0), 0);

  // ── Category analytics (scoped) ───────────────────────────────────────────
  const byCategory = useMemo(() => {
    const map = {};
    scoped.forEach((e) => { const k = e.category || "Uncategorised"; map[k] = (map[k] || 0) + (e.amount || 0); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [scoped]);
  const catColorMap = useMemo(() => {
    const map = {};
    byCategory.forEach((d, i) => { map[d.name] = i < CAT_HUES.length ? CAT_HUES[i] : OTHER_HUE; });
    return map;
  }, [byCategory]);
  const catColor = (cat) => catColorMap[cat] || OTHER_HUE;
  const donutData = useMemo(() => {
    const top = byCategory.slice(0, CAT_HUES.length);
    const otherTotal = byCategory.slice(CAT_HUES.length).reduce((s, d) => s + d.value, 0);
    return otherTotal > 0 ? [...top, { name: "Other", value: otherTotal }] : top;
  }, [byCategory]);

  // Trend — bucket by day when a range is set, otherwise by month across all time.
  const trend = useMemo(() => {
    const byDay = !!(range.from && range.to);
    const map = {};
    scoped.forEach((e) => {
      const k = byDay ? e.date : monthKey(e.date);
      if (!k) return;
      map[k] = (map[k] || 0) + (e.amount || 0);
    });
    const rows = Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ label: byDay ? dayShort(k) : monthLabel(k), key: k, total: v }));
    return rows;
  }, [scoped, range]);
  const trendHigh = trend.reduce((m, r) => (r.total > (m?.total ?? -Infinity) ? r : m), null);
  const trendLow = trend.reduce((m, r) => (r.total < (m?.total ?? Infinity) ? r : m), null);

  // Expense Breakdown buckets (scoped).
  const breakdown = useMemo(() => {
    const totals = Object.fromEntries(BREAKDOWN.map((b) => [b.key, 0]));
    scoped.forEach((e) => {
      const bucket = BREAKDOWN.find((b) => b.match(e.category || ""));
      totals[bucket.key] += e.amount || 0;
    });
    return BREAKDOWN.map((b) => ({ ...b, value: totals[b.key] }));
  }, [scoped]);

  // Month-over-month (full data) for the KPI deltas + This Month card.
  const now = new Date();
  const curMonthKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = `${lm.getFullYear()}-${pad2(lm.getMonth() + 1)}`;
  const sumMonth = (key) => expenses.filter((e) => monthKey(e.date) === key).reduce((s, e) => s + (e.amount || 0), 0);
  const thisMonthTotal = sumMonth(curMonthKey), lastMonthTotal = sumMonth(lastMonthKey);
  const momPct = lastMonthTotal > 0 ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : null;
  const allTimeTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const topCat = byCategory[0];
  const vehiclesWithCost = new Set(scoped.map((e) => e.plate).filter((p) => p && p !== "General")).size;

  // Top 5 vehicles by expense over the selected window, with a monthly sparkline.
  const topCars = useMemo(() => {
    const months = { "1m": 1, "6m": 6, "1y": 12 }[topRange] || 6;
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
    const map = {};
    expenses.forEach((e) => {
      if (!e.plate || e.plate === "General") return;
      if (e.date && new Date(e.date) < cutoff) return;
      if (!map[e.plate]) map[e.plate] = { total: 0, byMonth: {} };
      map[e.plate].total += e.amount || 0;
      const mk = monthKey(e.date);
      if (mk) map[e.plate].byMonth[mk] = (map[e.plate].byMonth[mk] || 0) + (e.amount || 0);
    });
    const grand = Object.values(map).reduce((s, v) => s + v.total, 0);
    return Object.entries(map).map(([plate, v]) => ({
      plate, total: v.total, share: grand > 0 ? (v.total / grand) * 100 : 0,
      spark: Object.keys(v.byMonth).sort().map((k) => v.byMonth[k]),
    })).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [expenses, topRange]);

  // ── Fleet acquisition (unchanged) ─────────────────────────────────────────
  const acquisition = useMemo(() => {
    const num = (v) => Number(v) || 0;
    const rows = fleet.map((c) => {
      const purchase = num(c.purchase), advance = num(c.purchaseAdvance ?? c.purchase_advance),
        insurance = num(c.insurance), reg = num(c.reg), other = num(c.otherCharges ?? c.other_charges);
      return {
        plate: c.plate, name: `${c.make || ""} ${c.model || ""}`.trim() || c.model || c.plate, color: c.color, status: c.status || "",
        purchase: purchase + advance, insurance, regOther: reg + other, total: purchase + advance + insurance + reg + other,
      };
    }).filter((r) => r.total > 0);
    const totalInvested = rows.reduce((s, r) => s + r.total, 0);
    const totals = rows.reduce((a, r) => { a.purchase += r.purchase; a.insurance += r.insurance; a.regOther += r.regOther; return a; }, { purchase: 0, insurance: 0, regOther: 0 });
    return { rows, totalInvested, totals };
  }, [fleet]);
  const { rows: acqRows, totalInvested, totals: acqTotals } = acquisition;
  const avgCost = acqRows.length ? Math.round(totalInvested / acqRows.length) : 0;
  const mostExpensive = acqRows.reduce((m, r) => (r.total > (m?.total || 0) ? r : m), null);
  const statusOptions = useMemo(() => [...new Set(acqRows.map((r) => r.status).filter(Boolean))], [acqRows]);
  const cards = useMemo(() => {
    let rows = acqRows;
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    rows = [...rows];
    if (sortBy === "high") rows.sort((a, b) => b.total - a.total);
    else if (sortBy === "low") rows.sort((a, b) => a.total - b.total);
    else rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [acqRows, statusFilter, sortBy]);
  const acqDonut = [
    { key: "purchase", name: "Purchase", value: acqTotals.purchase, color: ACQ_HUES.purchase },
    { key: "insurance", name: "Insurance", value: acqTotals.insurance, color: ACQ_HUES.insurance },
    { key: "regOther", name: "Reg. & Other", value: acqTotals.regOther, color: ACQ_HUES.regOther },
  ].filter((d) => d.value > 0);
  const acqDonutTotal = acqDonut.reduce((s, d) => s + d.value, 0);

  const filtered = catFilter === "all" ? expenses : expenses.filter((e) => e.category === catFilter);
  const filteredTotal = filtered.reduce((s, e) => s + (e.amount || 0), 0);
  const modelOf = (plate) => { const c = fleet.find((f) => f.plate === plate); return c ? (c.model || "") : ""; };
  const yTick = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`);

  const handleAddExpense = () => {
    if (!newExpense.plate || !newExpense.date || !newExpense.category || !newExpense.amount) { alert("Please fill in all required fields"); return; }
    const isExternalPickup = newExpense.category === "External Pickup/Drop";
    if (isExternalPickup && !newExpense.paidTo.trim()) { alert("Enter the name of the external person paid for the pickup/drop."); return; }
    const desc = isExternalPickup && newExpense.paidTo.trim()
      ? `Paid to ${newExpense.paidTo.trim()}${newExpense.desc.trim() ? ` — ${newExpense.desc.trim()}` : ""}` : newExpense.desc;
    onAddExpense({ ...newExpense, desc, amount: parseFloat(newExpense.amount) });
    setNewExpense({ plate: "", date: "", category: "", desc: "", amount: "", receipt: false, paidTo: "" });
    setShowForm(false);
  };
  const handleDelete = (expenseId) => { if (window.confirm("Are you sure you want to delete this expense?")) onDeleteExpense(expenseId); };

  // Semicircle gauge: share of the scoped total that is the single largest bucket.
  const gaugeTop = breakdown.reduce((m, b) => (b.value > (m?.value || 0) ? b : m), null);
  const gaugePct = scopedTotal > 0 && gaugeTop ? (gaugeTop.value / scopedTotal) * 100 : 0;
  const gaugeData = [{ name: "v", value: gaugePct }, { name: "r", value: 100 - gaugePct }];
  const periodShareOfAll = allTimeTotal > 0 ? (scopedTotal / allTimeTotal) * 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ══ EXPENSE MANAGEMENT ══════════════════════════════════════════════ */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>Expense Management</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Track, analyze and manage all your operational expenses</div>
        </div>
        <Btn primary id="expenses-log" onClick={() => setShowForm(!showForm)}>＋ Log Expense</Btn>
      </div>

      {/* Log form */}
      {showForm && (
        <Card>
          <CardHeader title="Log New Expense" />
          <div style={{ padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={fieldLabel}>Car (Plate)</div>
                <select id="expense-plate" value={newExpense.plate} onChange={e => setNewExpense({ ...newExpense, plate: e.target.value })} style={fieldInput}>
                  <option value="">-- Select --</option>
                  <option value="General">General / Overhead (no vehicle)</option>
                  {fleet.map(c => <option key={c.plate} value={c.plate}>{c.plate}</option>)}
                </select>
              </div>
              <div><div style={fieldLabel}>Date</div><input id="expense-date" type="date" value={newExpense.date} onChange={e => setNewExpense({ ...newExpense, date: e.target.value })} style={fieldInput} /></div>
              <div>
                <div style={fieldLabel}>Category</div>
                <select id="expense-category" value={newExpense.category} onChange={e => setNewExpense({ ...newExpense, category: e.target.value })} style={fieldInput}>
                  <option value="">-- Select --</option>
                  {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
            </div>
            {newExpense.category === "External Pickup/Drop" && (
              <div style={{ marginBottom: 12 }}>
                <div style={fieldLabel}>Paid To — External Person *</div>
                <input id="expense-paidto" type="text" placeholder="Name of the external person who handled the pickup/drop" value={newExpense.paidTo} onChange={e => setNewExpense({ ...newExpense, paidTo: e.target.value })} style={{ ...fieldInput, fontFamily: "inherit" }} />
                <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>Recorded as an expense against this vehicle and reflected in the Ledger.</div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 12 }}>
              <div><div style={fieldLabel}>Description</div><input id="expense-desc" type="text" placeholder="e.g. 60,000 km oil change and filter" value={newExpense.desc} onChange={e => setNewExpense({ ...newExpense, desc: e.target.value })} style={{ ...fieldInput, fontFamily: "inherit" }} /></div>
              <div><div style={fieldLabel}>Amount (SGD)</div><input id="expense-amount" type="number" placeholder="0.00" value={newExpense.amount} onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })} style={{ ...fieldInput, fontFamily: "'Courier New',monospace" }} /></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn primary small id="expense-save" onClick={handleAddExpense}>Save Expense</Btn>
              <Btn small id="expense-cancel" onClick={() => setShowForm(false)}>Cancel</Btn>
            </div>
          </div>
        </Card>
      )}

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <ExpKpi label="Total Expenses" value={fmt(scopedTotal)} icon="👛" iconBg="#EAF1FE"
          sub={momPct == null ? `${scoped.length} records` : `${momPct >= 0 ? "↑" : "↓"} ${Math.abs(momPct).toFixed(1)}% vs last month`}
          subColor={momPct == null ? C.textMuted : (momPct >= 0 ? C.green : C.red)} />
        <ExpKpi label="This Month" value={fmt(thisMonthTotal)} icon="📅" iconBg="#F1ECFE"
          sub={momPct == null ? monthLabel(curMonthKey) : `${momPct >= 0 ? "↑" : "↓"} ${Math.abs(momPct).toFixed(0)}% vs last month`}
          subColor={momPct == null ? C.textMuted : (momPct >= 0 ? C.green : C.red)} />
        <ExpKpi label="Top Category" value={topCat ? fmt(topCat.value) : fmt(0)} icon="🏷️" iconBg="#FEF3C7"
          sub={topCat ? topCat.name : "—"} subColor={C.textMuted}
          bar={topCat && scopedTotal > 0 ? (topCat.value / scopedTotal) * 100 : 0} barColor={C.amber} />
        <ExpKpi label="Vehicles with Costs" value={vehiclesWithCost} icon="🚗" iconBg="#DCFCE7" sub={`of ${fleet.length} cars`} subColor={C.textMuted} />
      </div>

      {/* Period filter */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} style={selectStyle}>
          <option value="all">📅 Filter by period</option>
          <option value="thisMonth">This Month</option>
          <option value="lastMonth">Last Month</option>
          <option value="thisYear">This Year</option>
          <option value="custom">Custom</option>
        </select>
        {period === "custom" && (
          <>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={selectStyle} />
            <span style={{ fontSize: 12, color: C.textMuted }}>to</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={selectStyle} />
          </>
        )}
      </div>

      {/* Category · Trend · Breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1fr", gap: 16 }}>
        {/* Expenses by Category */}
        <Card>
          <CardHeader title="Expenses by Category" subtitle="Share of total expenses" />
          <div style={{ padding: 14 }}>
            {byCategory.length === 0 ? <EmptyViz icon="🧾" text="No expenses in this period." /> : (
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ width: 150, height: 150, position: "relative", flexShrink: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={46} outerRadius={72} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                        {donutData.map((d, i) => <Cell key={i} fill={catColor(d.name)} />)}
                      </Pie>
                      <Tooltip formatter={(v) => fmt(Math.round(v))} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                    <div style={{ ...mono, fontSize: 15, fontWeight: 800, color: C.navy, lineHeight: 1 }}>{fmt(scopedTotal)}</div>
                    <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>Total</div>
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  {donutData.map((d) => (
                    <div key={d.name} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: catColor(d.name), flexShrink: 0, marginTop: 3 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: C.textSec, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</div>
                        <div style={{ ...mono, fontSize: 10.5, color: C.textMuted }}>{fmt(d.value)} ({Math.round((d.value / (scopedTotal || 1)) * 100)}%)</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Expense Trend */}
        <Card>
          <CardHeader title="Expense Trend" subtitle="Total spend for selected period" />
          <div style={{ padding: "12px 10px 8px", height: 232 }}>
            {trend.length === 0 ? <EmptyViz icon="📉" text="No spend in this period." /> : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="expTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.blue} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={C.blue} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEE" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: C.textMuted }} tickLine={false} axisLine={{ stroke: "#E5E5E5" }} interval="preserveStartEnd" minTickGap={20} />
                  <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={40} tickFormatter={yTick} />
                  <Tooltip formatter={(v) => [fmt(Math.round(v)), "Spend"]} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                  <Area type="monotone" dataKey="total" stroke={C.blue} strokeWidth={2.5} fill="url(#expTrend)" dot={{ r: 2.5, fill: C.blue }} activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          {trend.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "0 14px 14px" }}>
              <div style={{ background: C.bg, borderRadius: 8, padding: "8px 12px" }}>
                <div style={{ fontSize: 10, color: C.textMuted }}>Highest Spend</div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: C.navy }}>{trendHigh.label} · {fmt(Math.round(trendHigh.total))}</div>
              </div>
              <div style={{ background: C.bg, borderRadius: 8, padding: "8px 12px" }}>
                <div style={{ fontSize: 10, color: C.textMuted }}>Lowest Spend</div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: C.navy }}>{trendLow.label} · {fmt(Math.round(trendLow.total))}</div>
              </div>
            </div>
          )}
        </Card>

        {/* Expense Breakdown */}
        <Card>
          <CardHeader title="Expense Breakdown" subtitle="This period's expense summary" />
          <div style={{ padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <div style={{ textAlign: "center", minWidth: 52 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: periodShareOfAll >= 0 ? C.green : C.red }}>{periodShareOfAll.toFixed(0)}%</div>
                <div style={{ fontSize: 9, color: C.textMuted }}>of all-time</div>
              </div>
              <div style={{ width: 130, height: 78, position: "relative" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={gaugeData} dataKey="value" cx="50%" cy="100%" startAngle={180} endAngle={0} innerRadius={44} outerRadius={62} stroke="none">
                      <Cell fill={C.blue} /><Cell fill={C.bg} />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 2, textAlign: "center", pointerEvents: "none" }}>
                  <div style={{ ...mono, fontSize: 14, fontWeight: 800, color: C.navy, lineHeight: 1 }}>{fmt(scopedTotal)}</div>
                  <div style={{ fontSize: 8.5, color: C.textMuted }}>Total Spent</div>
                </div>
              </div>
              <div style={{ textAlign: "center", minWidth: 52 }}>
                <div style={{ ...mono, fontSize: 13, fontWeight: 800, color: C.navy }}>{scoped.length}</div>
                <div style={{ fontSize: 9, color: C.textMuted }}>Transactions</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginTop: 14 }}>
              {breakdown.map((b) => (
                <div key={b.key} style={{ textAlign: "center" }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: `${b.color}18`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{b.icon}</div>
                  <div style={{ ...mono, fontSize: 10.5, fontWeight: 700, color: C.navy, marginTop: 4 }}>{b.value >= 1000 ? `${Math.round(b.value / 1000)}k` : Math.round(b.value)}</div>
                  <div style={{ fontSize: 8, color: C.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.key}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Top 5 Vehicles by Expense */}
      <Card>
        <CardHeader
          title="Top 5 Vehicles by Expense"
          subtitle="Highest-cost vehicles in the selected period"
          right={
            <div style={{ display: "flex", gap: 4 }}>
              {[["1m", "1 Month"], ["6m", "6 Months"], ["1y", "1 Year"]].map(([val, lbl]) => (
                <button key={val} onClick={() => setTopRange(val)} style={{ padding: "5px 10px", fontSize: 11, fontWeight: 600, borderRadius: 7, cursor: "pointer", border: `1px solid ${topRange === val ? C.blue : C.border}`, background: topRange === val ? C.blueFaint : C.surface, color: topRange === val ? C.blue : C.textSec }}>{lbl}</button>
              ))}
            </div>
          }
        />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["Vehicle", "Total Expense (SGD)", "Share", "Trend"].map((h, i) => (
                  <th key={h} style={{ textAlign: i === 0 ? "left" : i === 3 ? "left" : "right", padding: "9px 14px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topCars.map((v, i) => {
                const hue = CAT_HUES[i % CAT_HUES.length];
                return (
                  <tr key={v.plate} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 16 }}>🚗</span>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: C.navy, whiteSpace: "nowrap" }}>{modelOf(v.plate) || v.plate}</span>
                        <PlateBadge plate={v.plate} small />
                      </div>
                    </td>
                    <td style={{ padding: "11px 14px", textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
                        <div style={{ flex: 1, maxWidth: 260, height: 7, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ width: `${Math.max(3, v.share)}%`, height: "100%", background: hue, borderRadius: 4 }} />
                        </div>
                        <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.navy, whiteSpace: "nowrap", minWidth: 90, textAlign: "right" }}>{fmt(Math.round(v.total))}</span>
                      </div>
                    </td>
                    <td style={{ padding: "11px 14px", ...mono, fontSize: 12, fontWeight: 700, color: C.textSec, textAlign: "right", whiteSpace: "nowrap" }}>{v.share.toFixed(1)}%</td>
                    <td style={{ padding: "11px 14px" }}><Sparkline points={v.spark} color={hue} /></td>
                  </tr>
                );
              })}
              {topCars.length === 0 && <tr><td colSpan={4} style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No vehicle costs in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ══ FLEET ACQUISITION ═══════════════════════════════════════════════ */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>Fleet Acquisition</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>All-in purchase cost per vehicle · purchase + insurance + registration + other</div>
        </div>
      </div>

      {/* Acquisition KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        <div style={{ position: "relative", overflow: "hidden", border: `1px solid ${C.green}33`, borderRadius: 16, padding: "18px 20px", background: `linear-gradient(120deg, ${C.green}14 0%, ${C.green}06 55%, ${C.surface} 100%)` }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>Total Invested</div>
          <div style={{ ...mono, fontSize: 26, fontWeight: 800, color: C.green, marginTop: 8, letterSpacing: -0.6 }}>{fmt(totalInvested)}</div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4 }}>{acqRows.length} Vehicles</div>
          <div style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", fontSize: 40, opacity: 0.5 }}>📈</div>
        </div>
        <div style={{ position: "relative", overflow: "hidden", border: `1px solid ${C.blue}33`, borderRadius: 16, padding: "18px 20px", background: `linear-gradient(120deg, ${C.blue}14 0%, ${C.blue}06 55%, ${C.surface} 100%)` }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>Avg Cost Per Vehicle</div>
          <div style={{ ...mono, fontSize: 26, fontWeight: 800, color: C.blue, marginTop: 8, letterSpacing: -0.6 }}>{fmt(avgCost)}</div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4 }}>Acquisition Cost</div>
          <div style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", fontSize: 40, opacity: 0.5 }}>🧮</div>
        </div>
        <div style={{ position: "relative", overflow: "hidden", border: `1px solid ${C.amber}33`, borderRadius: 16, padding: "18px 20px", background: `linear-gradient(120deg, ${C.amber}14 0%, ${C.amber}06 55%, ${C.surface} 100%)` }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>Most Expensive</div>
          <div style={{ ...mono, fontSize: 26, fontWeight: 800, color: C.amber, marginTop: 8, letterSpacing: -0.6 }}>{mostExpensive ? fmt(mostExpensive.total) : fmt(0)}</div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mostExpensive ? mostExpensive.name : "—"}</div>
          <div style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", fontSize: 40, opacity: 0.5 }}>🏆</div>
        </div>
      </div>

      {/* Acquisition by Vehicle */}
      <Card>
        <CardHeader
          title="Acquisition by Vehicle"
          subtitle="Overview of all vehicles and their acquisition cost"
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
                <option value="all">All Status</option>
                {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={selectStyle}>
                <option value="high">Sort by: Highest Cost</option>
                <option value="low">Sort by: Lowest Cost</option>
                <option value="name">Sort by: Name</option>
              </select>
            </div>
          }
        />
        <div style={{ padding: 16 }}>
          {acqRows.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 13 }}>Add a vehicle to see its acquisition cost here.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14 }}>
              {cards.map((r, i) => {
                const share = totalInvested > 0 ? (r.total / totalInvested) * 100 : 0;
                const hue = CAT_HUES[i % CAT_HUES.length];
                return (
                  <div key={r.plate} data-testid="acq-card" data-plate={r.plate} style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, background: C.surface, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <PlateBadge plate={r.plate} small />
                      <span style={{ ...mono, fontSize: 10.5, fontWeight: 700, color: hue, background: `${hue}18`, borderRadius: 20, padding: "2px 9px" }}>{share.toFixed(1)}%</span>
                    </div>
                    <div style={{ height: 54, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ width: 116, height: 50 }}><CarGlyph color={r.color} /></div></div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                    <div style={{ ...mono, fontSize: 19, fontWeight: 800, color: C.textPri, letterSpacing: -0.5 }}>{fmt(r.total)}</div>
                    <div style={{ height: 5, background: C.bg, borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${Math.max(4, share)}%`, height: "100%", background: hue, borderRadius: 4 }} /></div>
                    <div style={{ marginTop: 2, paddingTop: 8, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {[["Purchase", r.purchase], ["Insurance", r.insurance], ["Reg. & Other", r.regOther]].map(([label, val]) => (
                          <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10.5, padding: "1.5px 0" }}>
                            <span style={{ color: C.textMuted }}>{label}</span>
                            <span style={{ ...mono, fontWeight: 700, color: hue }}>{fmt(val)}</span>
                          </div>
                        ))}
                      </div>
                      <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 7, border: `1px solid ${C.border}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: 15, fontWeight: 700 }}>›</span>
                    </div>
                  </div>
                );
              })}
              {acqDonut.length > 0 && (
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, background: C.surface }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.navy, marginBottom: 8 }}>Acquisition Summary</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 96, height: 96, position: "relative", flexShrink: 0 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={acqDonut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={46} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                            {acqDonut.map((d) => <Cell key={d.key} fill={d.color} />)}
                          </Pie>
                          <Tooltip formatter={(v) => fmt(Math.round(v))} contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                        <div style={{ ...mono, fontSize: 16, fontWeight: 800, color: C.navy, lineHeight: 1 }}>{acqRows.length}</div>
                        <div style={{ fontSize: 8, color: C.textMuted, textAlign: "center" }}>Total<br />Vehicles</div>
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {acqDonut.map((d) => (
                        <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontSize: 10.5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                          <span style={{ flex: 1, color: C.textSec, whiteSpace: "nowrap" }}>{d.name}</span>
                          <span style={{ ...mono, fontWeight: 700, color: C.navy }}>{acqDonutTotal ? ((d.value / acqDonutTotal) * 100).toFixed(1) : 0}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Expense Records */}
      <Card>
        <CardHeader
          title="Expense Records"
          subtitle={catFilter === "all" ? `${expenses.length} records` : `${filtered.length} in ${catFilter}`}
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <select id="expense-filter-category" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={selectStyle}>
                <option value="all">All Categories</option>
                {byCategory.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
              <Badge color={C.red} bg={C.redFaint}>{fmt(filteredTotal)}</Badge>
            </div>
          }
        />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["ID", "Vehicle", "Date", "Category", "Description", "Amount", "Receipt", "Action"].map((h) => (
                  <th key={h} style={{ textAlign: h === "Amount" || h === "Action" ? "right" : "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} data-testid="expense-row" data-expense-id={e.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px 12px", ...mono, fontSize: 11, fontWeight: 700, color: C.navyMid }}>{e.id}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <PlateBadge plate={e.plate} small />
                      <span style={{ fontSize: 11, color: C.textSec, whiteSpace: "nowrap" }}>{modelOf(e.plate)}</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>{e.date}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: catColor(e.category) + "18", color: catColor(e.category), whiteSpace: "nowrap" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: catColor(e.category) }} />{e.category}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: C.textSec }}>{e.desc || "—"}</td>
                  <td style={{ padding: "10px 12px", ...mono, fontSize: 12, fontWeight: 700, color: C.red, whiteSpace: "nowrap", textAlign: "right" }}>{fmt(e.amount)}</td>
                  <td style={{ padding: "10px 12px" }}>{e.receipt ? <span style={{ fontSize: 11, color: C.green }}>✓ Yes</span> : <span style={{ fontSize: 11, color: C.textMuted }}>—</span>}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                      <button title="Delete expense" data-testid="expense-delete" onClick={() => handleDelete(e.id)} style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, background: `${C.red}12`, border: `1px solid ${C.red}30`, color: C.red, cursor: "pointer", fontSize: 13 }}>🗑️</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>{expenses.length === 0 ? "No expenses recorded" : "No expenses in this category"}</div>
        )}
      </Card>
    </div>
  );
};

export default Expenses;
