import { useState, useMemo } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { C, mono, fmt } from "./theme";
import { Card, CardHeader, Btn, Badge, PlateBadge } from "./components";

// Categories from RDK Trading's real ledger (RDK_Car Rental_Database.xlsx).
const CATEGORIES = [
  "Vehicle Purchase", "New Vehicle Advance Paid", "Insurance", "Road Tax & Transfer Fee",
  "LTA Fee", "LTA Transfer", "Registration", "Inspection", "Internal Sticker", "Fuel",
  "Parking Fee", "External Pickup/Drop", "Repairs & Maintenance", "PR Payment", "Advertisement",
  // Other Expenses — business overhead, not tied to a specific vehicle.
  "Salary", "Office", "Tools", "Other / Miscellaneous",
];

// Validated categorical hues (dataviz reference palette). Assigned by spend rank
// for the records-table chips, and cycled per vehicle card in the gallery.
const CAT_HUES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7"];
const OTHER_HUE = "#9a9992";
// Acquisition summary donut — one hue per cost component.
const ACQ_HUES = { purchase: "#2a78d6", insurance: "#1baf7a", regOther: "#eda100" };

const fieldLabel = { fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 };
const fieldInput = { width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 12, color: C.textPri, background: C.surface, outline: "none" };
const selectStyle = { padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: "inherit", background: C.surface, cursor: "pointer", color: C.textPri, outline: "none" };

// Small side-view car thumbnail, tinted to the car's paint colour — a stand-in
// for a real photo, consistent with the Car Availability page's glyph.
const CAR_COLOR_HEX = {
  Silver: "#C3C8CC", White: "#E9ECEA", Blue: "#4472C4", Black: "#353B40",
  Red: "#D64045", Grey: "#8A8F94", Gray: "#8A8F94", Green: "#4B6B3A",
  Yellow: "#E4B33B", Orange: "#DD7A34", Brown: "#8C6B4B",
};
function CarGlyph({ color }) {
  const paint = CAR_COLOR_HEX[color] || "#6C7A70";
  return (
    <svg viewBox="0 0 132 84" style={{ width: "100%", height: "100%", display: "block" }} aria-hidden="true">
      <ellipse cx="66" cy="70" rx="52" ry="7" fill="#00000010" />
      <path d="M12 58 Q10 44 24 41 L40 40 Q50 28 66 27 Q86 27 96 40 L112 44 Q122 46 122 58 L120 64 Q118 66 112 66 L20 66 Q14 66 12 60 Z"
        fill={paint} stroke="#00000022" strokeWidth="1.2" />
      <path d="M44 40 Q52 30 66 29 Q82 29 92 41 Z" fill="#ffffff" opacity="0.22" />
      <path d="M50 39 Q56 33 65 33 L65 39 Z" fill="#2b3a42" opacity="0.55" />
      <path d="M69 33 Q80 34 86 39 L69 39 Z" fill="#2b3a42" opacity="0.55" />
      <circle cx="38" cy="65" r="12" fill="#23282b" /><circle cx="38" cy="65" r="5.2" fill="#c7cdd0" />
      <circle cx="96" cy="65" r="12" fill="#23282b" /><circle cx="96" cy="65" r="5.2" fill="#c7cdd0" />
    </svg>
  );
}

// Big gradient KPI card at the top of the page.
function AcqKpi({ label, value, sub, color, emoji }) {
  return (
    <div style={{ position: "relative", overflow: "hidden", border: `1px solid ${color}33`, borderRadius: 16, padding: "18px 20px", background: `linear-gradient(120deg, ${color}14 0%, ${color}06 55%, ${C.surface} 100%)` }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
      <div style={{ ...mono, fontSize: 26, fontWeight: 800, color, marginTop: 8, letterSpacing: -0.6 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4 }}>{sub}</div>
      <div style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", fontSize: 40, opacity: 0.5, filter: "saturate(1.1)" }}>{emoji}</div>
    </div>
  );
}

const Expenses = ({ expenses = [], fleet = [], onAddExpense, onUpdateExpense, onDeleteExpense }) => {
  const [showForm, setShowForm] = useState(false);
  const [catFilter, setCatFilter] = useState("all");
  const [newExpense, setNewExpense] = useState({ plate: "", date: "", category: "", desc: "", amount: "", receipt: false, paidTo: "" });
  const [sortBy, setSortBy] = useState("high"); // "high" | "low" | "name"
  const [statusFilter, setStatusFilter] = useState("all");

  const byCategory = useMemo(() => {
    const map = {};
    expenses.forEach((e) => { const k = e.category || "Uncategorised"; map[k] = (map[k] || 0) + (e.amount || 0); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [expenses]);
  const catColorMap = useMemo(() => {
    const map = {};
    byCategory.forEach((d, i) => { map[d.name] = i < CAT_HUES.length ? CAT_HUES[i] : OTHER_HUE; });
    return map;
  }, [byCategory]);
  const catColor = (cat) => catColorMap[cat] || OTHER_HUE;

  // Fleet acquisition: what each car cost to buy (all-in — purchase + advance +
  // insurance + registration + other charges), read straight from the fleet.
  const acquisition = useMemo(() => {
    const num = (v) => Number(v) || 0;
    const rows = fleet.map((c) => {
      const purchase = num(c.purchase), advance = num(c.purchaseAdvance ?? c.purchase_advance),
        insurance = num(c.insurance), reg = num(c.reg), other = num(c.otherCharges ?? c.other_charges);
      return {
        plate: c.plate,
        name: `${c.make || ""} ${c.model || ""}`.trim() || c.model || c.plate,
        color: c.color,
        status: c.status || "",
        purchase: purchase + advance, insurance, regOther: reg + other,
        total: purchase + advance + insurance + reg + other,
      };
    }).filter((r) => r.total > 0);
    const totalInvested = rows.reduce((s, r) => s + r.total, 0);
    const totals = rows.reduce((a, r) => {
      a.purchase += r.purchase; a.insurance += r.insurance; a.regOther += r.regOther; return a;
    }, { purchase: 0, insurance: 0, regOther: 0 });
    return { rows, totalInvested, totals };
  }, [fleet]);

  const { rows: acqRows, totalInvested, totals: acqTotals } = acquisition;
  const avgCost = acqRows.length ? Math.round(totalInvested / acqRows.length) : 0;
  const mostExpensive = acqRows.reduce((m, r) => (r.total > (m?.total || 0) ? r : m), null);

  // Status options come from whatever statuses the fleet actually carries.
  const statusOptions = useMemo(
    () => [...new Set(acqRows.map((r) => r.status).filter(Boolean))],
    [acqRows]
  );

  // Cards: filter by status, then sort by the chosen order.
  const cards = useMemo(() => {
    let rows = acqRows;
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    rows = [...rows];
    if (sortBy === "high") rows.sort((a, b) => b.total - a.total);
    else if (sortBy === "low") rows.sort((a, b) => a.total - b.total);
    else rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [acqRows, statusFilter, sortBy]);

  const filtered = catFilter === "all" ? expenses : expenses.filter((e) => e.category === catFilter);
  const filteredTotal = filtered.reduce((s, e) => s + (e.amount || 0), 0);

  // Donut for the acquisition summary.
  const acqDonut = [
    { key: "purchase", name: "Purchase", value: acqTotals.purchase, color: ACQ_HUES.purchase },
    { key: "insurance", name: "Insurance", value: acqTotals.insurance, color: ACQ_HUES.insurance },
    { key: "regOther", name: "Reg. & Other", value: acqTotals.regOther, color: ACQ_HUES.regOther },
  ].filter((d) => d.value > 0);
  const acqDonutTotal = acqDonut.reduce((s, d) => s + d.value, 0);

  const handleAddExpense = () => {
    if (!newExpense.plate || !newExpense.date || !newExpense.category || !newExpense.amount) {
      alert("Please fill in all required fields");
      return;
    }
    const isExternalPickup = newExpense.category === "External Pickup/Drop";
    if (isExternalPickup && !newExpense.paidTo.trim()) {
      alert("Enter the name of the external person paid for the pickup/drop.");
      return;
    }
    const desc = isExternalPickup && newExpense.paidTo.trim()
      ? `Paid to ${newExpense.paidTo.trim()}${newExpense.desc.trim() ? ` — ${newExpense.desc.trim()}` : ""}`
      : newExpense.desc;
    onAddExpense({ ...newExpense, desc, amount: parseFloat(newExpense.amount) });
    setNewExpense({ plate: "", date: "", category: "", desc: "", amount: "", receipt: false, paidTo: "" });
    setShowForm(false);
  };

  const handleDelete = (expenseId) => {
    if (window.confirm("Are you sure you want to delete this expense?")) onDeleteExpense(expenseId);
  };

  const modelOf = (plate) => { const c = fleet.find((f) => f.plate === plate); return c ? (c.model || "") : ""; };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>Fleet Acquisition</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>All-in purchase cost per vehicle · purchase + insurance + registration + other</div>
        </div>
        <Btn primary id="expenses-log" onClick={() => setShowForm(!showForm)}>＋ Add Vehicle Expense</Btn>
      </div>

      {/* Log form */}
      {showForm && (
        <Card>
          <CardHeader title="Add Vehicle Expense" />
          <div style={{ padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={fieldLabel}>Car (Plate)</div>
                <select id="expense-plate" value={newExpense.plate} onChange={e => setNewExpense({ ...newExpense, plate: e.target.value })} style={fieldInput}>
                  <option value="">-- Select --</option>
                  <option value="General">General / Overhead (no vehicle)</option>
                  {fleet.map(c => <option key={c.plate} value={c.plate}>{c.plate}</option>)}
                </select>
              </div>
              <div>
                <div style={fieldLabel}>Date</div>
                <input id="expense-date" type="date" value={newExpense.date} onChange={e => setNewExpense({ ...newExpense, date: e.target.value })} style={fieldInput} />
              </div>
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
                <input id="expense-paidto" type="text" placeholder="Name of the external person who handled the pickup/drop"
                  value={newExpense.paidTo} onChange={e => setNewExpense({ ...newExpense, paidTo: e.target.value })} style={{ ...fieldInput, fontFamily: "inherit" }} />
                <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>Recorded as an expense against this vehicle and reflected in the Ledger.</div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={fieldLabel}>Description</div>
                <input id="expense-desc" type="text" placeholder="e.g. 60,000 km oil change and filter" value={newExpense.desc} onChange={e => setNewExpense({ ...newExpense, desc: e.target.value })} style={{ ...fieldInput, fontFamily: "inherit" }} />
              </div>
              <div>
                <div style={fieldLabel}>Amount (SGD)</div>
                <input id="expense-amount" type="number" placeholder="0.00" value={newExpense.amount} onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })} style={{ ...fieldInput, fontFamily: "'Courier New',monospace" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn primary small id="expense-save" onClick={handleAddExpense}>Save Expense</Btn>
              <Btn small id="expense-cancel" onClick={() => setShowForm(false)}>Cancel</Btn>
            </div>
          </div>
        </Card>
      )}

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        <AcqKpi label="Total Invested" value={fmt(totalInvested)} sub={`${acqRows.length} Vehicles`} color={C.green} emoji="📈" />
        <AcqKpi label="Avg Cost Per Vehicle" value={fmt(avgCost)} sub="Acquisition Cost" color={C.blue} emoji="🧮" />
        <AcqKpi label="Most Expensive" value={mostExpensive ? fmt(mostExpensive.total) : fmt(0)} sub={mostExpensive ? mostExpensive.name : "—"} color={C.amber} emoji="🏆" />
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
                  <div key={r.plate} data-testid="acq-card" data-plate={r.plate}
                    style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, background: C.surface, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <PlateBadge plate={r.plate} small />
                      <span style={{ ...mono, fontSize: 10.5, fontWeight: 700, color: hue, background: `${hue}18`, borderRadius: 20, padding: "2px 9px" }}>{share.toFixed(1)}%</span>
                    </div>
                    <div style={{ height: 54, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ width: 116, height: 50 }}><CarGlyph color={r.color} /></div>
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                    <div style={{ ...mono, fontSize: 19, fontWeight: 800, color: C.textPri, letterSpacing: -0.5 }}>{fmt(r.total)}</div>
                    <div style={{ height: 5, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${Math.max(4, share)}%`, height: "100%", background: hue, borderRadius: 4 }} />
                    </div>
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

              {/* Acquisition Summary donut — occupies the last grid cell */}
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
                  <td style={{ padding: "10px 12px" }}>
                    {e.receipt ? <span style={{ fontSize: 11, color: C.green }}>✓ Yes</span> : <span style={{ fontSize: 11, color: C.textMuted }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                      <button title="Delete expense" data-testid="expense-delete" onClick={() => handleDelete(e.id)}
                        style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, background: `${C.red}12`, border: `1px solid ${C.red}30`, color: C.red, cursor: "pointer", fontSize: 13 }}>🗑️</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
            {expenses.length === 0 ? "No expenses recorded" : "No expenses in this category"}
          </div>
        )}
      </Card>
    </div>
  );
};

export default Expenses;
