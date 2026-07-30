import { useMemo, useState } from "react";
import { C, mono, fmt } from "./theme";
import { Card, CardHeader, Badge, PlateBadge } from "./components";

// Read-only financial ledger. It is NOT a separate data source — it is a
// unified, chronological view built from data the app already tracks:
//   • Earnings          -> "Rental Income" credits
//   • Expenses          -> "Expense" debits
//   • Booking deposits  -> "Deposit IN" credit at pickup, "Deposit OUT" debit
//                          when refunded (deposits move cash but are NOT profit,
//                          so they never touch the P&L — only this cash ledger)
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

const Ledger = ({ earnings = [], expenses = [], bookings = [], fleet = [] }) => {
  const [period, setPeriod] = useState("all");   // "all" | "YYYY-MM"
  const [vehicle, setVehicle] = useState("all");  // "all" | plate
  const [type, setType] = useState("all");        // "all" | "Rental Income" | "Expense"
  const [search, setSearch] = useState("");

  const modelOf = (plate) => {
    const car = fleet.find((c) => c.plate === plate);
    return car ? `${car.make} ${car.model}` : "—";
  };

  // Build the unified, date-sorted transaction list with a global running balance.
  const allTx = useMemo(() => {
    const rows = [];

    earnings.forEach((e) => {
      rows.push({
        key: `E-${e.id}`,
        date: (e.end || e.start || "").slice(0, 10),
        plate: e.plate || "",
        type: "Rental Income",
        description: `Rental Income${e.days ? ` - ${e.days} Day${e.days > 1 ? "s" : ""}` : ""}`,
        remarks: e.customer || "—",
        credit: e.total || 0,
        debit: 0,
      });
    });

    expenses.forEach((x) => {
      rows.push({
        key: `X-${x.id}`,
        date: (x.date || "").slice(0, 10),
        plate: x.plate || "",
        type: "Expense",
        description: x.desc || x.category || "Expense",
        remarks: x.category || "—",
        credit: 0,
        debit: x.amount || 0,
      });
    });

    // Deposits come from bookings (money in at pickup, out when refunded).
    bookings.forEach((b) => {
      const deposit = Number(b.deductible) || 0;
      if (deposit > 0) {
        rows.push({
          key: `DI-${b.id}`,
          date: (b.start || "").slice(0, 10),
          plate: b.plate || "",
          type: "Deposit IN",
          description: "Security Deposit",
          remarks: b.customer || "—",
          credit: deposit,
          debit: 0,
        });
      }
      if (b.depositRefunded) {
        const back = b.depositRefundedAmount ?? deposit;
        if (back > 0) {
          rows.push({
            key: `DO-${b.id}`,
            date: (b.depositRefundedAt || b.end || b.start || "").slice(0, 10),
            plate: b.plate || "",
            type: "Deposit OUT",
            description: `Deposit Returned${back < deposit ? " (partial)" : ""}`,
            remarks: b.customer || "—",
            credit: 0,
            debit: back,
          });
        }
      }
    });

    // Chronological (oldest first) so the running balance accumulates correctly.
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));

    let bal = 0;
    rows.forEach((r) => {
      bal += r.credit - r.debit;
      r.balance = bal;
    });
    return rows;
  }, [earnings, expenses, bookings]);

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
    { label: "Opening Balance", value: openingBalance, color: C.navy, icon: "📗", sub: period === "all" ? "Start of records" : `As on 01 ${monthLabel(period)}` },
    { label: "Total Credit", value: totalCredit, color: C.green, icon: "📈", sub: periodText },
    { label: "Total Debit", value: totalDebit, color: C.red, icon: "📉", sub: periodText },
    { label: "Closing Balance", value: closingBalance, color: C.teal, icon: "📘", sub: periodText },
  ];

  const th = { textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };

  // Badge colours per transaction type.
  const typeStyle = {
    "Rental Income": { color: C.green, bg: C.greenFaint },
    "Deposit IN": { color: C.teal, bg: C.tealFaint },
    "Expense": { color: C.red, bg: C.redFaint },
    "Deposit OUT": { color: C.amber, bg: C.amberFaint },
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Financial Ledger</div>
        <div style={{ fontSize: 11, color: C.textMuted }}>All money movements — rental income and expenses — with a running balance</div>
      </div>

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
              <option value="Rental Income">Rental Income</option>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
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
    </div>
  );
};

export default Ledger;
