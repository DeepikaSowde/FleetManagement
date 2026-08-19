import { useMemo, useState } from "react";
import { C, mono, fmt } from "./theme";
import { Card, CardHeader, Badge, PlateBadge } from "./components";
import { buildLedgerRows } from "./ledgerUtils";
import LedgerDashboard from "./LedgerDashboard";

// Read-only financial ledger. It is NOT a separate data source — it is a
// unified, chronological view built from data the app already tracks:
//   • Booking payments  -> "Rental Income" credits, one entry per payment
//                          actually received (see buildLedgerRows)
//   • Expenses          -> "Expense" debits
//   • Booking deposits  -> "Deposit IN" credit at pickup, "Deposit OUT" debit
//                          when refunded (deposits move cash but are NOT profit,
//                          so they never touch the P&L — only this cash ledger)
//   • Investments       -> "Investment" credits (investor capital in; cash only,
//                          not profit). TEMP: seeded from the RDK Excel (data.js).
// with a running balance and Opening/Credit/Debit/Closing summary, filtered by
// period / vehicle / type / search. Same idea as the P&L page: derived, live.

const num = (n) => (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthLabel = (ym) => {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
};

const fmtDate = (d) => {
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const selectStyle = {
  width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
  fontFamily: "inherit", fontSize: 12, color: C.textPri, background: C.surface, outline: "none",
};

const Ledger = ({
  earnings = [], expenses = [], bookings = [], fleet = [], customers = [], investors = [],
  calculateMetrics, calculateMonthlyMetrics, calculateCarMetrics, getExpensesByCategory,
}) => {
  const [view, setView] = useState("dashboard"); // "dashboard" | "ledger"
  const [period, setPeriod] = useState("all");   // "all" | "YYYY-MM"
  const [vehicle, setVehicle] = useState("all");  // "all" | plate
  const [type, setType] = useState("all");        // "all" | "Rental Income" | "Expense"
  const [search, setSearch] = useState("");

  const modelOf = (plate) => {
    const car = fleet.find((c) => c.plate === plate);
    return car ? `${car.make} ${car.model}` : "—";
  };

  // Unified, date-sorted transaction list with a running balance (shared helper).
  const allTx = useMemo(() => buildLedgerRows(earnings, expenses, bookings, investors), [earnings, expenses, bookings, investors]);

  // Month options derived from the data present.
  const months = useMemo(
    () => [...new Set(allTx.map((t) => t.date.slice(0, 7)).filter(Boolean))].sort().reverse(),
    [allTx]
  );
  const plates = useMemo(() => [...new Set(allTx.map((t) => t.plate).filter(Boolean))].sort(), [allTx]);

  // Opening balance = net of every transaction BEFORE the selected period.
  const periodStart = period === "all" ? null : `${period}-01`;
  const openingBalance = useMemo(() => {
    if (!periodStart) return 0;
    return allTx
      .filter((t) => t.date < periodStart)
      .reduce((s, t) => s + t.credit - t.debit, 0);
  }, [allTx, periodStart]);

  // Rows shown = period + vehicle + type + search filters applied.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTx
      .filter((t) => (period === "all" ? true : t.date.slice(0, 7) === period))
      .filter((t) => (vehicle === "all" ? true : t.plate === vehicle))
      .filter((t) => (type === "all" ? true : t.type === type))
      .filter((t) =>
        !q ||
        t.description.toLowerCase().includes(q) ||
        t.remarks.toLowerCase().includes(q) ||
        t.plate.toLowerCase().includes(q)
      )
      .slice()
      .reverse(); // newest first for display
  }, [allTx, period, vehicle, type, search]);

  const totalCredit = rows.reduce((s, t) => s + t.credit, 0);
  const totalDebit = rows.reduce((s, t) => s + t.debit, 0);
  const closingBalance = openingBalance + totalCredit - totalDebit;

  const periodText = period === "all" ? "All time" : monthLabel(period);

  const summary = [
    { label: "Total Credit", value: totalCredit, color: C.green, icon: "📈", sub: periodText },
    { label: "Total Debit", value: totalDebit, color: C.red, icon: "📉", sub: periodText },
    { label: "Closing Balance", value: closingBalance, color: C.teal, icon: "📘", sub: periodText },
  ];

  const th = { textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };

  // Badge colours per transaction type.
  const typeStyle = {
    "Investment": { color: C.navy, bg: C.linen },
    "Rental Income": { color: C.green, bg: C.greenFaint },
    "Deposit Income": { color: C.green, bg: C.greenFaint },
    "Deposit IN": { color: C.teal, bg: C.tealFaint },
    "Expense": { color: C.red, bg: C.redFaint },
    "Deposit OUT": { color: C.amber, bg: C.amberFaint },
  };

  const toggleBtn = (activeState) => ({
    padding: "7px 16px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer",
    background: activeState ? C.teal : "transparent", color: activeState ? "#fff" : C.textSec,
  });

  return (
    <div>
      {/* Header: title + Dashboard / Ledger toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>
            {view === "dashboard" ? "Financial Dashboard" : "Financial Ledger"}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted }}>
            {view === "dashboard"
              ? "Balances, income & expense analysis, and vehicle profitability"
              : "All money movements — rental income and expenses — with a running balance"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, background: C.bg, padding: 4, borderRadius: 10 }}>
          <button style={toggleBtn(view === "dashboard")} onClick={() => setView("dashboard")}>📊 Dashboard</button>
          <button style={toggleBtn(view === "ledger")} onClick={() => setView("ledger")}>📒 Ledger</button>
        </div>
      </div>

      {view === "dashboard" ? (
        <LedgerDashboard
          earnings={earnings}
          expenses={expenses}
          bookings={bookings}
          fleet={fleet}
          customers={customers}
          investors={investors}
          calculateMetrics={calculateMetrics}
          calculateMonthlyMetrics={calculateMonthlyMetrics}
          calculateCarMetrics={calculateCarMetrics}
          getExpensesByCategory={getExpensesByCategory}
        />
      ) : (
      <>
      {/* Filters */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 2fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>Period</div>
            <select style={selectStyle} value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="all">All time</option>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>Vehicle</div>
            <select style={selectStyle} value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
              <option value="all">All Vehicles</option>
              {plates.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>Transaction Type</div>
            <select style={selectStyle} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All Types</option>
              <option value="Investment">Investment</option>
              <option value="Rental Income">Rental Income</option>
              <option value="Deposit Income">Deposit Income</option>
              <option value="Expense">Expense</option>
              <option value="Deposit IN">Deposit IN</option>
              <option value="Deposit OUT">Deposit OUT</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>Search</div>
            <input style={selectStyle} placeholder="Search description, remarks, plate…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </Card>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginBottom: 16 }}>
        {summary.map((s) => (
          <Card key={s.label}>
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 15 }}>{s.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.textMuted }}>{s.label}</span>
              </div>
              <div style={{ ...mono, fontSize: 18, fontWeight: 700, color: s.color }}>{fmt(Math.round(s.value))}</div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>{s.sub}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Ledger table */}
      <Card>
        <CardHeader title="Transactions" right={<Badge>{rows.length} entries</Badge>} />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["Date", "Vehicle", "Model", "Type", "Description", "Credit", "Debit", "Balance", "Remarks"].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                  <td style={{ padding: "10px 12px" }}>{r.plate ? <PlateBadge plate={r.plate} small /> : <span style={{ fontSize: 11, color: C.textMuted }}>—</span>}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: C.textSec, whiteSpace: "nowrap" }}>{modelOf(r.plate)}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <Badge color={(typeStyle[r.type] || typeStyle.Expense).color} bg={(typeStyle[r.type] || typeStyle.Expense).bg}>{r.type}</Badge>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: C.textSec }}>{r.description}</td>
                  <td style={{ padding: "10px 12px", ...mono, fontSize: 12, fontWeight: 700, color: C.green, textAlign: "right", whiteSpace: "nowrap" }}>{r.credit ? num(r.credit) : "–"}</td>
                  <td style={{ padding: "10px 12px", ...mono, fontSize: 12, fontWeight: 700, color: C.red, textAlign: "right", whiteSpace: "nowrap" }}>{r.debit ? num(r.debit) : "–"}</td>
                  <td style={{ padding: "10px 12px", ...mono, fontSize: 12, fontWeight: 700, color: C.navy, textAlign: "right", whiteSpace: "nowrap" }}>{num(r.balance)}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>{r.remarks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
            No transactions yet. They appear here automatically as you record earnings and expenses.
          </div>
        )}
      </Card>
      </>
      )}
    </div>
  );
};

export default Ledger;