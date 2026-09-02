import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import { C, mono, fmt } from "./theme";
import { Card, CardHeader, Btn, Badge, PlateBadge, KpiCard } from "./components";

// Palette for the per-car bars — distinct, readable in both the chart and the
// rest of the app's teal/green language.
const BARS = ["#0EA5A0", "#296A63", "#6C8D92", "#9D7A4C", "#6C8164", "#8F4C41"];
const monthKey = (iso) => (iso ? String(iso).slice(0, 7) : null); // "YYYY-MM"
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};

// Booking payments, normalized the same way the rest of the app treats legacy
// data: prefer the real `payments` array; fall back to the single
// `amountCollected` field for older bookings so nothing is dropped.
const paymentsOf = (b) => {
  if (!b) return [];
  if (Array.isArray(b.payments) && b.payments.length) return b.payments;
  if (Number(b.amountCollected) > 0) {
    return [{ id: "seed", amount: Number(b.amountCollected), method: b.paymentMethod || "Cash", reference: b.referenceCode || "", addedAt: b.createdAt || null }];
  }
  return [];
};

const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const dmy = (d) => (d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

// Rental basis of one earning row → drives the unit-aware Duration/Rate columns:
//   Daily   → days   + SGD/day
//   Hourly  → hours  + SGD/hr   (a "daily" booking whose duration is under 24h)
//   Monthly → months + SGD/month (each row is one recognized contract month)
// Rate is derived from the row's own total so it always matches Paid/Balance.
const RATE_UNIT = { day: "day", hour: "hr", month: "month" };
const unitInfoOf = (r) => {
  const b = r.booking, e = r.e;
  if (b && b.rentalType === "monthly") {
    const rate = Number(b.monthlyRent) || r.total || Number(e.rate) || 0;
    return { basis: "Monthly", count: 1, unit: "month", rate };
  }
  const start = (b && b.start) || e.start;
  const end = (b && (b.actualReturnAt || b.end)) || e.end;
  const hours = start && end ? Math.round((new Date(end) - new Date(start)) / 3600000) : 0;
  if (hours > 0 && hours < 24) {
    return { basis: "Hourly", count: hours, unit: "hour", rate: r.total / hours };
  }
  return { basis: "Daily", count: Number(e.days) || 0, unit: "day", rate: Number(e.rate) || 0 };
};
const durationText = (u) => `${u.count} ${u.unit}${u.count === 1 ? "" : "s"}`;
const rateText = (u) => `SGD ${Math.round(u.rate).toLocaleString()}/${RATE_UNIT[u.unit]}`;

// Chart bucketing by the selected granularity.
const weekKey = (s) => {
  const date = new Date(s);
  const onejan = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil((((date - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
};
const bucketOf = (iso, gran) => {
  if (!iso) return null;
  const s = String(iso);
  if (gran === "Daily") return s.slice(0, 10);
  if (gran === "Yearly") return s.slice(0, 4);
  if (gran === "Weekly") return weekKey(s);
  return s.slice(0, 7); // Monthly
};
const bucketLabel = (key, gran) => {
  if (gran === "Monthly") return monthLabel(key);
  if (gran === "Daily") { const [y, m, dd] = key.split("-"); return new Date(+y, +m - 1, +dd).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  return key;
};

// Friendly placeholder shown in a chart slot when there's no data yet.
const EmptyViz = ({ icon, text }) => (
  <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: C.textMuted }}>
    <div style={{ fontSize: 34, opacity: 0.5 }}>{icon}</div>
    <div style={{ fontSize: 12 }}>{text}</div>
  </div>
);

const selectStyle = { padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: "inherit", color: C.textPri, background: C.surface, outline: "none" };
const toggleBtn = (active) => ({ padding: "4px 12px", fontSize: 11, fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", background: active ? C.teal : "transparent", color: active ? "#fff" : C.textMuted });

const Earning = ({ earnings = [], fleet = [], bookings = [], onAddEarning, onUpdateEarning, onDeleteEarning, onLockEarning }) => {
  const [period, setPeriod] = useState("This Month");
  const [carFilter, setCarFilter] = useState("All Cars");
  const [search, setSearch] = useState("");
  const [overviewGran, setOverviewGran] = useState("Monthly");
  const [topScope, setTopScope] = useState("Monthly");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selected, setSelected] = useState(null); // the row object shown in the modal

  const now = new Date();
  const bookingById = useMemo(() => {
    const map = {};
    bookings.forEach((b) => { map[b.id] = b; });
    return map;
  }, [bookings]);

  // One derived row per earning: joins the booking to compute Paid / Balance /
  // Payment History / Notes and the Closed|Pending status (locked = Closed).
  const allRows = useMemo(() => earnings.map((e) => {
    const b = bookingById[e.bookingId];
    const pays = paymentsOf(b);
    const total = Number(e.total) || 0;
    const paid = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    // Status is driven purely by payment completion: fully collected → Closed
    // automatically, otherwise Pending. (Not the booking-lock flag.)
    const closed = total > 0 && paid >= total;
    return {
      e, booking: b, payments: pays,
      total, paid, balance: total - paid, closed,
      notes: (b && (b.comments || b.notes)) || "",
      date: (e.end || e.start || "").slice(0, 10),
      status: closed ? "Closed" : "Pending",
    };
  }), [earnings, bookingById]);

  const getPeriodRange = (p) => {
    const y = now.getFullYear(), m = now.getMonth();
    if (p === "This Month") return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0) };
    if (p === "Last Month") return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0) };
    if (p === "This Year") return { from: new Date(y, 0, 1), to: new Date(y, 11, 31) };
    return { from: null, to: null };
  };
  const range = getPeriodRange(period);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (range.from && range.to) {
        if (!r.date) return false;
        const d = new Date(r.date);
        if (d < range.from || d > range.to) return false;
      }
      if (carFilter !== "All Cars" && (r.e.plate || "") !== carFilter) return false;
      if (q && ![r.e.plate, r.e.customer, r.e.bookingId, r.e.id].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allRows, range.from, range.to, carFilter, search]);

  // KPIs (over the filtered set) + a this-month vs last-month delta.
  const totalEarnings = filtered.reduce((s, r) => s + r.total, 0);
  const closedTotal = filtered.filter((r) => r.closed).reduce((s, r) => s + r.total, 0);
  const pendingTotal = totalEarnings - closedTotal;
  const pctOf = (part) => (totalEarnings > 0 ? ((part / totalEarnings) * 100).toFixed(1) : "0.0");
  const monthSum = (offset) => {
    const y = now.getFullYear(), m = now.getMonth() + offset;
    const key = `${new Date(y, m, 1).getFullYear()}-${String(new Date(y, m, 1).getMonth() + 1).padStart(2, "0")}`;
    return allRows.filter((r) => monthKey(r.date) === key).reduce((s, r) => s + r.total, 0);
  };
  const thisM = monthSum(0), lastM = monthSum(-1);
  const delta = lastM > 0 ? ((thisM - lastM) / lastM) * 100 : null;

  const plates = useMemo(() => {
    const set = new Set();
    earnings.forEach((e) => e.plate && set.add(e.plate));
    fleet.forEach((c) => c.plate && set.add(c.plate));
    return [...set].sort();
  }, [earnings, fleet]);

  // Earnings Overview — Paid vs Pending amount, bucketed by the chosen granularity.
  const overview = useMemo(() => {
    const map = {};
    filtered.forEach((r) => {
      const k = bucketOf(r.date, overviewGran);
      if (!k) return;
      if (!map[k]) map[k] = { key: k, paid: 0, pending: 0 };
      map[k].paid += r.paid;
      map[k].pending += Math.max(0, r.balance);
    });
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key)).map((r) => ({ ...r, label: bucketLabel(r.key, overviewGran) }));
  }, [filtered, overviewGran]);

  // Top earning cars, scoped to this month or this year.
  const topCars = useMemo(() => {
    const y = now.getFullYear();
    const inScope = (r) => topScope === "Yearly" ? r.date.startsWith(String(y)) : monthKey(r.date) === `${y}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const map = {};
    filtered.filter(inScope).forEach((r) => { const p = r.e.plate || "—"; map[p] = (map[p] || 0) + r.total; });
    return Object.entries(map).map(([plate, total]) => ({ plate, total })).sort((a, b) => b.total - a.total).slice(0, 6);
  }, [filtered, topScope]);

  const yTick = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const pageClamped = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageClamped - 1) * rowsPerPage, pageClamped * rowsPerPage);
  useEffect(() => { setPage(1); }, [period, carFilter, search, rowsPerPage]);

  // Close the modal on Escape.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const labelCell = { fontSize: 11, color: C.textMuted };
  const valCell = { fontSize: 12.5, fontWeight: 600, color: C.textPri };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>Earnings</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Track and manage earnings from completed bookings and payments.</div>
        </div>
        <Btn small id="earnings-export">⬇ Export</Btn>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>Filter by Period</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} style={selectStyle}>
            {["This Month", "Last Month", "This Year", "All Time"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, fontSize: 12, color: C.textSec }}>
          📅 {range.from ? `${dmy(range.from)} — ${dmy(range.to)}` : "All time"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>Filter by Car</span>
          <select value={carFilter} onChange={(e) => setCarFilter(e.target.value)} style={selectStyle}>
            <option value="All Cars">All Cars</option>
            {plates.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍  Search car plate…" style={{ ...selectStyle, minWidth: 200 }} />
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
        <KpiCard
          label="Total Earnings" value={fmt(totalEarnings)}
          sub={delta == null ? `${filtered.length} earnings` : `${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta).toFixed(1)}% vs last month`}
          accent={C.teal} badge={`${filtered.length} Earnings`} badgeColor={C.teal} badgeBg={C.tealFaint}
        />
        <KpiCard
          label="Pending" value={fmt(pendingTotal)}
          sub={`${pctOf(pendingTotal)}% of total amount`}
          accent={C.amber} badge={`${filtered.filter((r) => !r.closed).length} pending`} badgeColor={C.amber} badgeBg={C.amberFaint}
        />
        <KpiCard
          label="Closed" value={fmt(closedTotal)}
          sub={`${pctOf(closedTotal)}% of total amount`}
          accent={C.green} badge={`${filtered.filter((r) => r.closed).length} closed`} badgeColor={C.green} badgeBg={C.greenFaint}
        />
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px 10px", borderBottom: `1px solid ${C.border}` }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>Earnings Overview</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Paid vs pending amount</div>
            </div>
            <div style={{ display: "inline-flex", background: C.bg, borderRadius: 8, padding: 2 }}>
              {["Daily", "Weekly", "Monthly", "Yearly"].map((g) => (
                <button key={g} onClick={() => setOverviewGran(g)} style={toggleBtn(overviewGran === g)}>{g}</button>
              ))}
            </div>
          </div>
          <div style={{ padding: "14px 10px 10px", height: 260 }}>
            {overview.length === 0 ? (
              <EmptyViz icon="📈" text="Earnings appear here as bookings complete." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={overview} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="earnPaid" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.green} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={C.green} stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#00000010" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={{ stroke: C.border }} />
                  <YAxis tick={{ fontSize: 10, fill: C.textMuted }} tickLine={false} axisLine={false} width={44} tickFormatter={yTick} />
                  <Tooltip formatter={(v, n) => [fmt(Math.round(v)), n === "paid" ? "Paid" : "Pending"]} contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${C.border}` }} />
                  <Area type="monotone" dataKey="paid" stroke={C.green} strokeWidth={2} fill="url(#earnPaid)" />
                  <Area type="monotone" dataKey="pending" stroke={C.amber} strokeWidth={2} strokeDasharray="5 4" fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px 10px", borderBottom: `1px solid ${C.border}` }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>Top Earning Cars</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Based on total amount</div>
            </div>
            <div style={{ display: "inline-flex", background: C.bg, borderRadius: 8, padding: 2 }}>
              {["Monthly", "Yearly"].map((g) => (
                <button key={g} onClick={() => setTopScope(g)} style={toggleBtn(topScope === g)}>{g}</button>
              ))}
            </div>
          </div>
          <div style={{ padding: "12px 10px 10px", height: 260 }}>
            {topCars.length === 0 ? (
              <EmptyViz icon="🚗" text="No car revenue yet." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCars} layout="vertical" margin={{ top: 4, right: 18, left: 4, bottom: 4 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="plate" width={82} tick={{ fontSize: 10.5, fill: C.textSec }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => fmt(Math.round(v))} cursor={{ fill: C.bg }} contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${C.border}` }} />
                  <Bar dataKey="total" radius={[0, 6, 6, 0]} barSize={16}>
                    {topCars.map((_, i) => <Cell key={i} fill={BARS[i % BARS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Earnings Records table */}
      <Card>
        <CardHeader title="Earnings Records" subtitle="All earnings from completed bookings with payment tracking" />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["Booking ID", "Car Plate", "Customer", "Type", "Period", "Duration", "Rate", "Total Amount", "Paid", "Balance", "Status", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const u = unitInfoOf(r);
                return (
                <tr key={r.e.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 11, fontWeight: 700, color: C.navyMid, whiteSpace: "nowrap" }}>{r.e.bookingId || "–"}</td>
                  <td style={{ padding: "11px 12px" }}><PlateBadge plate={r.e.plate} small /></td>
                  <td style={{ padding: "11px 12px", fontSize: 12, fontWeight: 600 }}>{r.e.customer}</td>
                  <td style={{ padding: "11px 12px" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: C.teal, background: C.tealFaint, borderRadius: 20, padding: "3px 9px", whiteSpace: "nowrap" }}>{r.e.type || "Rental Earning"}</span>
                  </td>
                  <td style={{ padding: "11px 12px", fontSize: 11, color: C.textSec, whiteSpace: "nowrap" }}>{r.e.start} → {r.e.end}</td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 11, textAlign: "center", whiteSpace: "nowrap" }}>{durationText(u)}</td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 11, whiteSpace: "nowrap" }}>{rateText(u)}</td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 13, fontWeight: 700, color: C.navy, whiteSpace: "nowrap" }}>{fmt(r.total)}</td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 12, fontWeight: 700, color: C.green, whiteSpace: "nowrap" }}>{fmt(r.paid)}</td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 12, fontWeight: 700, color: r.balance > 0 ? C.amber : C.textMuted, whiteSpace: "nowrap" }}>{fmt(r.balance)}</td>
                  <td style={{ padding: "11px 12px" }}>
                    {r.closed
                      ? <Badge color={C.green} bg={C.greenFaint}>Closed</Badge>
                      : <Badge color={C.amber} bg={C.amberFaint}>Pending</Badge>}
                  </td>
                  <td style={{ padding: "11px 12px" }}>
                    <button onClick={() => setSelected(r)} title="View details" aria-label="View details"
                      style={{ padding: "4px 8px", fontSize: 14, background: "none", border: "none", color: C.teal, cursor: "pointer" }}>👁</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>No earnings records found</div>
        )}
        {/* Pagination */}
        {filtered.length > 0 && (
          <div style={{ padding: "12px 18px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ fontSize: 11, color: C.textMuted }}>
              Showing {(pageClamped - 1) * rowsPerPage + 1} to {Math.min(pageClamped * rowsPerPage, filtered.length)} of {filtered.length} entries
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageClamped <= 1} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: pageClamped <= 1 ? C.textMuted : C.textPri, cursor: pageClamped <= 1 ? "default" : "pointer", fontSize: 12 }}>‹</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 6).map((p) => (
                  <button key={p} onClick={() => setPage(p)} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${p === pageClamped ? C.teal : C.border}`, background: p === pageClamped ? C.teal : C.surface, color: p === pageClamped ? "#fff" : C.textPri, cursor: "pointer", fontSize: 12, fontWeight: p === pageClamped ? 700 : 400 }}>{p}</button>
                ))}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageClamped >= totalPages} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: pageClamped >= totalPages ? C.textMuted : C.textPri, cursor: pageClamped >= totalPages ? "default" : "pointer", fontSize: 12 }}>›</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.textMuted }}>
                Rows per page
                <select value={rowsPerPage} onChange={(e) => setRowsPerPage(Number(e.target.value))} style={{ ...selectStyle, padding: "4px 6px" }}>
                  {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* ── Centered detail modal ─────────────────────────────────────────── */}
      {selected && (() => {
        const r = selected;
        const e = r.e;
        return (
          <div
            onClick={() => setSelected(null)}
            style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(21,40,43,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          >
            <div
              onClick={(ev) => ev.stopPropagation()}
              style={{ width: "min(560px, 100%)", maxHeight: "88vh", overflowY: "auto", background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: "0 20px 60px rgba(0,0,0,0.28)" }}
            >
              {/* Header */}
              <div style={{ position: "sticky", top: 0, background: C.surface, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${C.border}`, borderTopLeftRadius: 14, borderTopRightRadius: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>Earning Details</div>
                <button onClick={() => setSelected(null)} aria-label="Close" style={{ background: "none", border: "none", fontSize: 20, color: C.textMuted, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>

              <div style={{ padding: "18px 20px" }}>
                {/* Booking & Earning Information */}
                <div style={{ fontSize: 12, fontWeight: 800, color: C.navy, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Booking &amp; Earning Information</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", background: C.bg }}>
                  {[
                    ["Booking ID", e.bookingId || "–"],
                    ["Car Plate", e.plate || "–"],
                    ["Customer", e.customer || "–"],
                    ["Type", e.type || "Rental Earning"],
                    ["Period", `${e.start} → ${e.end}`],
                    ["Duration", durationText(unitInfoOf(r))],
                    ["Rate", rateText(unitInfoOf(r))],
                    ["Total Amount", fmt(r.total)],
                    ["Paid", fmt(r.paid)],
                    ["Balance", fmt(r.balance)],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div style={labelCell}>{label}</div>
                      <div style={valCell}>{val}</div>
                    </div>
                  ))}
                  <div>
                    <div style={labelCell}>Status</div>
                    <div style={{ marginTop: 2 }}>
                      {r.closed
                        ? <Badge color={C.green} bg={C.greenFaint}>Closed</Badge>
                        : <Badge color={C.amber} bg={C.amberFaint}>Pending</Badge>}
                    </div>
                  </div>
                </div>

                {/* Payment History */}
                <div style={{ fontSize: 12, fontWeight: 800, color: C.navy, textTransform: "uppercase", letterSpacing: 0.5, margin: "20px 0 10px" }}>Payment History</div>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: C.bg }}>
                        {["Date & Time", "Amount", "Payment Method", "Reference"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 9.5, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.payments.length === 0 ? (
                        <tr><td colSpan={4} style={{ padding: 16, textAlign: "center", fontSize: 12, color: C.textMuted }}>No payments recorded</td></tr>
                      ) : r.payments.map((p, i) => (
                        <tr key={p.id || i} style={{ borderTop: `1px solid ${C.border}` }}>
                          <td style={{ padding: "8px 12px", fontSize: 11, color: C.textSec, whiteSpace: "nowrap" }}>{fmtDateTime(p.addedAt)}</td>
                          <td style={{ padding: "8px 12px", ...mono, fontSize: 11.5, fontWeight: 700, color: C.green }}>{fmt(Number(p.amount) || 0)}</td>
                          <td style={{ padding: "8px 12px", fontSize: 11.5, color: C.textPri }}>{p.method || "Cash"}</td>
                          <td style={{ padding: "8px 12px", ...mono, fontSize: 11, color: C.textMuted }}>{p.reference || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    {r.payments.length > 0 && (
                      <tfoot>
                        <tr style={{ borderTop: `1px solid ${C.border}`, background: C.bg }}>
                          <td style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: C.textSec }}>Total Paid</td>
                          <td style={{ padding: "8px 12px", ...mono, fontSize: 11.5, fontWeight: 700, color: C.green }}>{fmt(r.paid)}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                {/* Notes (only if present) */}
                {r.notes ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.navy, textTransform: "uppercase", letterSpacing: 0.5, margin: "20px 0 10px" }}>Notes</div>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", background: C.bg, fontSize: 12.5, color: C.textSec, lineHeight: 1.5 }}>{r.notes}</div>
                  </>
                ) : null}
              </div>

              {/* Footer */}
              <div style={{ position: "sticky", bottom: 0, background: C.surface, display: "flex", justifyContent: "flex-end", padding: "12px 20px", borderTop: `1px solid ${C.border}`, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }}>
                <button onClick={() => setSelected(null)} style={{ padding: "8px 18px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.textSec, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default Earning;
