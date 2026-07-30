import { useState } from "react";
import { C, mono, fmt } from "./theme";
import { Card, CardHeader, Btn, Badge, PlateBadge } from "./components";

const Expenses = ({ expenses = [], fleet = [], onAddExpense, onUpdateExpense, onDeleteExpense }) => {
  const [showForm, setShowForm] = useState(false);
  const [newExpense, setNewExpense] = useState({
    plate: "",
    date: "",
    category: "",
    desc: "",
    amount: "",
    receipt: false,
  });

  const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);

  const cats = {};
  expenses.forEach(e => { 
    cats[e.category] = (cats[e.category] || 0) + (e.amount || 0); 
  });

  const handleAddExpense = () => {
    if (!newExpense.plate || !newExpense.date || !newExpense.category || !newExpense.amount) {
      alert("Please fill in all required fields");
      return;
    }
    onAddExpense({
      ...newExpense,
      amount: parseFloat(newExpense.amount),
    });
    setNewExpense({ plate: "", date: "", category: "", desc: "", amount: "", receipt: false });
    setShowForm(false);
  };

  const handleDelete = (expenseId) => {
    if (window.confirm("Are you sure you want to delete this expense?")) {
      onDeleteExpense(expenseId);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Expense Management</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>Log running costs, maintenance, and repairs per car</div>
        </div>
        <Btn primary onClick={() => setShowForm(!showForm)}>＋ Log Expense</Btn>
      </div>

      {showForm && (
        <Card style={{ marginBottom: 16 }}>
          <CardHeader title="Log New Expense" />
          <div style={{ padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>Car (Plate)</div>
                <select value={newExpense.plate} onChange={e => setNewExpense({ ...newExpense, plate: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 12, color: C.textPri, background: C.surface, outline: "none" }}>
                  <option value="">-- Select --</option>
                  {fleet.map(c => <option key={c.plate} value={c.plate}>{c.plate}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>Date</div>
                <input type="date" value={newExpense.date} onChange={e => setNewExpense({ ...newExpense, date: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 12, color: C.textPri, outline: "none" }} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>Category</div>
                <select value={newExpense.category} onChange={e => setNewExpense({ ...newExpense, category: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 12, color: C.textPri, background: C.surface, outline: "none" }}>
                  <option value="">-- Select --</option>
                  <option value="Routine Service">Routine Service</option>
                  <option value="Body Repair">Body Repair</option>
                  <option value="Fuel">Fuel</option>
                  <option value="Tyre Replacement">Tyre Replacement</option>
                  <option value="Electrical Repair">Electrical Repair</option>
                  <option value="Engine Repair">Engine Repair</option>
                  <option value="Air-Con Service">Air-Con Service</option>
                  <option value="Insurance Renewal">Insurance Renewal</option>
                  <option value="Road Tax / Registration">Road Tax / Registration</option>
                  <option value="COE Renewal">COE Renewal</option>
                  <option value="Cleaning & Detailing">Cleaning & Detailing</option>
                  <option value="Parking / Fines">Parking / Fines</option>
                  <option value="Other / Miscellaneous">Other / Miscellaneous</option>
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>Description</div>
                <input type="text" placeholder="e.g. 60,000 km oil change and filter" value={newExpense.desc} onChange={e => setNewExpense({ ...newExpense, desc: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 12, outline: "none" }} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>Amount (SGD)</div>
                <input type="number" placeholder="0.00" value={newExpense.amount} onChange={e => setNewExpense({ ...newExpense, amount: e.target.value })} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "'Courier New',monospace", fontSize: 12, outline: "none" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn primary small onClick={handleAddExpense}>Save Expense</Btn>
              <Btn small onClick={() => setShowForm(false)}>Cancel</Btn>
            </div>
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr", gap: 16 }}>
        <Card>
          <CardHeader title="Expense Records" right={<Badge>{fmt(total)} total</Badge>} />
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["ID", "Car", "Date", "Category", "Description", "Amount", "Receipt", "Actions"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expenses.map(e => (
                <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px 12px", ...mono, fontSize: 11, fontWeight: 700, color: C.navyMid }}>{e.id}</td>
                  <td style={{ padding: "10px 12px" }}><PlateBadge plate={e.plate} small /></td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>{e.date}</td>
                  <td style={{ padding: "10px 12px" }}><Badge color={C.navyMid} bg={C.bg}>{e.category}</Badge></td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: C.textSec }}>{e.desc}</td>
                  <td style={{ padding: "10px 12px", ...mono, fontSize: 12, fontWeight: 700, color: C.red }}>{fmt(e.amount)}</td>
                  <td style={{ padding: "10px 12px" }}>
                    {e.receipt
                      ? <span style={{ fontSize: 11, color: C.green }}>✓ Yes</span>
                      : <span style={{ fontSize: 11, color: C.textMuted }}>– No</span>}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <button onClick={() => handleDelete(e.id)}
                      style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.red, cursor: "pointer", fontWeight: 600 }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {expenses.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>No expenses recorded</div>
          )}
        </Card>

        <Card>
          <CardHeader title="By Category" />
          <div style={{ padding: 16 }}>
            {Object.entries(cats).length === 0 ? (
              <div style={{ textAlign: "center", color: C.textMuted, fontSize: 12, padding: "20px" }}>No expenses to show</div>
            ) : (
              <>
                {Object.entries(cats).sort(([, a], [, b]) => b - a).map(([cat, amt]) => (
                  <div key={cat} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11 }}>
                      <span style={{ color: C.textSec, fontWeight: 500 }}>{cat}</span>
                      <span style={{ ...mono, fontWeight: 700, color: C.red }}>{fmt(amt)}</span>
                    </div>
                    <div style={{ height: 5, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${(amt / total) * 100}%`, height: "100%", background: C.navyMid, borderRadius: 3, opacity: 0.7 }} />
                    </div>
                  </div>
                ))}
                <div style={{ borderTop: `2px solid ${C.navy}`, paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 700, fontSize: 12 }}>Total</span>
                  <span style={{ ...mono, fontWeight: 700, fontSize: 13, color: C.red }}>{fmt(total)}</span>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Expenses;