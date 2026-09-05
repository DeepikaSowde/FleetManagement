import { useState, useMemo, useEffect } from "react";
import { C, mono, fmt, totalInv, daysUntil, generateTargetOptions } from "./theme";
import { fleetDisplayStatus } from "./useFleetData";
import { Card, CardHeader, Btn, StatusTag, PlateBadge, SectionTitle } from "./components";
import AddCarWizard from "./AddCarWizard";


// ─────────────────────────────────────────────────────────────────────────
// Expense taxonomy — shared between the Add Vehicle Expense form and Expense History
// ─────────────────────────────────────────────────────────────────────────
const EXPENSE_CATEGORIES = ["Repair", "Insurance", "Road Tax", "Fuel", "Cleaning", "Parking", "Tyres", "Accessories", "Other"];

const CATEGORY_META = {
  Repair: { icon: "🔧", color: C.red },
  Insurance: { icon: "🛡", color: C.teal },
  "Road Tax": { icon: "📋", color: C.navy },
  Fuel: { icon: "⛽", color: C.amber },
  Cleaning: { icon: "🧽", color: C.teal },
  Parking: { icon: "🅿", color: C.navy },
  Tyres: { icon: "🛞", color: C.red },
  Accessories: { icon: "✨", color: C.amber },
  Other: { icon: "📎", color: C.textMuted },
};

// ─────────────────────────────────────────────────────────────────────────
// Financial math — kept in one place so every consumer (summary tiles,
// pulse strip, status pill) reads from the same numbers.
// ─────────────────────────────────────────────────────────────────────────
const parseDateSafe = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const getBookingDays = (b) => {
  if (b.days != null && !isNaN(Number(b.days))) return Number(b.days);
  const s = parseDateSafe(b.start || b.startDate || b.from);
  const e = parseDateSafe(b.end || b.endDate || b.to);
  if (!s || !e) return 0;
  const diff = Math.round((e - s) / 86400000);
  return diff > 0 ? diff : diff === 0 ? 1 : 0;
};

const getBookingRevenue = (b) => {
  if (b.amount != null && !isNaN(Number(b.amount))) return Number(b.amount);
  if (b.total != null && !isNaN(Number(b.total))) return Number(b.total);
  return (Number(b.rate) || 0) * getBookingDays(b);
};

const isCancelled = (b) => ["cancelled", "canceled"].includes(String(b.status || "").toLowerCase());

function computeCarFinancials(car, bookings, expenses) {
  const inv = totalInv(car);

  const carBookings = bookings.filter((b) => b.plate === car.plate && !isCancelled(b));
  const bookingRevenue = carBookings.reduce((sum, b) => sum + getBookingRevenue(b), 0);
  const totalBookings = carBookings.length;
  const rentalDays = carBookings.reduce((sum, b) => sum + getBookingDays(b), 0);

  const carExpenses = expenses
    .filter((e) => e.plate === car.plate)
    .sort((a, b) => (parseDateSafe(b.date) || 0) - (parseDateSafe(a.date) || 0));
 const vehicleExpense = carExpenses.reduce(
  (sum, e) => sum + (Number(e.amount) || 0),
  0
);
 const netProfit = bookingRevenue - vehicleExpense;
 const roi = inv > 0 ? (netProfit / inv) * 100 : 0;

  return { inv, bookingRevenue, totalBookings, rentalDays,  vehicleExpense, netProfit, roi, carExpenses };
}

// ─────────────────────────────────────────────────────────────────────────
// Shared bits of the details page UI
// ─────────────────────────────────────────────────────────────────────────

const fieldStyle = {
  width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${C.border}`,
  fontFamily: "inherit", fontSize: 12, outline: "none", boxSizing: "border-box", background: C.surface, color: C.textPri,
};

// Compact row for details modal
const CompactRow = ({ label, value, valueColor, bold, useMono = true }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "8px 0",
    borderBottom: `1px solid ${C.border}`,
    fontSize: 12,
  }}>
    <span style={{ color: C.textMuted, fontWeight: 500, fontSize: 11 }}>{label}</span>
    <span style={{ ...(useMono ? mono : {}), fontWeight: bold ? 700 : 600, color: valueColor || C.textPri, fontSize: 12 }}>
      {value}
    </span>
  </div>
);

// Status derived from days-remaining for any compliance/validity date —
// shared between this view and the Add New Car wizard's Compliance step so
// "Expiring" / "Expired" never mean different things in the two places.
const complianceStatus = (days) => {
  if (days == null || isNaN(days)) return { label: "—", color: C.textMuted };
  if (days < 0) return { label: "Expired", color: C.red };
  if (days <= 30) return { label: "Expiring Soon", color: C.red };
  if (days <= 90) return { label: "Expiring", color: C.amber };
  return { label: "Active", color: C.green };
};

// Read-only row for a single compliance/validity date — shows the date plus
// an auto-computed days-remaining / status readout underneath, matching the
// wizard's Compliance step.
const ComplianceRow = ({ label, date }) => {
  const days = date ? daysUntil(date) : null;
  const st = complianceStatus(days);
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12,
    }}>
      <span style={{ color: C.textMuted, fontWeight: 500, fontSize: 11 }}>{label}</span>
      <div style={{ textAlign: "right" }}>
        <div style={{ ...mono, fontWeight: 600, fontSize: 12 }}>{date || "—"}</div>
        {date && (
          <div style={{ fontSize: 9.5, fontWeight: 700, color: st.color }}>
            {st.label}{days != null ? ` · ${days >= 0 ? `${days}d left` : `${Math.abs(days)}d overdue`}` : ""}
          </div>
        )}
      </div>
    </div>
  );
};

// Right-side slide-over drawer for logging a new expense. Rendered via a fixed
// backdrop + panel so opening/closing it never navigates away from the details page.
const ExpenseDrawer = ({ car, onAddExpense, onClose }) => {
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");

  const handleSave = () => {
    const amt = parseFloat(amount);
    if (!description.trim()) { setError("Add a short description for this expense."); return; }
    if (!amt || amt <= 0) { setError("Enter an amount greater than 0."); return; }
    if (!date) { setError("Pick a date for this expense."); return; }
    if (typeof onAddExpense !== "function") { setError("Expense saving isn't wired up yet."); return; }

    onAddExpense({ plate: car.plate, category, description: description.trim(), amount: amt, date });
    onClose(); // save closes the drawer immediately; the page re-renders with fresh totals from props
  };

  return (
    <>
      <style>{`
        @keyframes fleetModalFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fleetModalPop { from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
      `}</style>
      {/* Light backdrop — keeps the Fleet Details page visible behind the modal */}
      {/* Backdrop click no longer closes the modal — close only via ✕. */}
      <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.22)", zIndex: 60, animation: "fleetModalFade 0.15s ease" }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        width: "100%", maxWidth: 380, margin: "0 14px", maxHeight: "85vh",
        background: C.surface, zIndex: 61, display: "flex", flexDirection: "column",
        border: `1px solid ${C.border}`, borderRadius: 12,
        boxShadow: "0 16px 40px rgba(15, 23, 42, 0.18)", animation: "fleetModalPop 0.18s cubic-bezier(.2,.8,.2,1)",
        overflow: "hidden",
      }}>
        <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Add Vehicle Expense</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 14, color: C.textMuted, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        <div style={{ padding: 12, overflowY: "auto", flex: 1 }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Category</div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...fieldStyle, cursor: "pointer" }}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_META[c].icon} {c}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Description</div>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description" style={fieldStyle} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Amount (SGD)</div>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00" style={{ ...fieldStyle, fontFamily: mono.fontFamily }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Date</div>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle} />
            </div>
          </div>

          {error && <div style={{ fontSize: 10.5, color: C.red, marginBottom: 8 }}>{error}</div>}

          <Btn primary small onClick={handleSave} style={{ width: "100%" }}>Save Expense</Btn>
        </div>
      </div>
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Compact Vehicle Details Modal — overlays on top of Fleet list
// ─────────────────────────────────────────────────────────────────────────
const VehicleDetailsModal = ({ car, bookings, expenses, onAddExpense, onUpdateCar, onDelete, onClose, startEditing = false }) => {
  const fin = useMemo(() => computeCarFinancials(car, bookings, expenses), [car, bookings, expenses]);
  const d = daysUntil(car.coe);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Edit mode — toggled by the "Edit" button below, or entered immediately
  // when opened via the table's "Edit" link (startEditing). `editForm` holds
  // a draft copy of the editable fields; nothing is written back to the
  // fleet via onUpdateCar until Save is pressed, so Cancel always discards cleanly.
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState("");
  const recoveryPct = fin.inv > 0 ? Math.min((fin.bookingRevenue / fin.inv) * 100, 100) : 0;
  const profitColor = fin.netProfit > 0 ? C.green : fin.netProfit < 0 ? C.red : C.amber;

  const handleStartEdit = () => {
    setEditForm({
      make: car.make || "",
      model: car.model || "",
      year: car.year ?? "",
      color: car.color || "",
      fuelType: car.fuelType || "Petrol",
      transmission: car.transmission || "Automatic",
      purchase: car.purchase ?? 0,
      purchaseAdvance: car.purchaseAdvance ?? 0,
      insurance: car.insurance ?? 0,
      reg: car.reg ?? 0,
      otherCharges: car.otherCharges ?? 0,
      coe: car.coe || "",
      insuranceExpiry: car.insuranceExpiry || "",
      ltaTransferDate: car.ltaTransferDate || "",
      roadTaxExpiry: car.roadTaxExpiry || "",
      inspectionExpiry: car.inspectionExpiry || "",
      targetRate: car.targetRate ?? "",
      runningDaysTarget: car.runningDaysTarget ?? "",
      profitPctTarget: car.profitPctTarget ?? "",
    });
    setEditError("");
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditForm(null);
    setEditError("");
  };

  // Opened via the Fleet table's "Edit" link (as opposed to "Details →") —
  // jump straight into edit mode instead of making the user click Edit again.
  useEffect(() => {
    if (startEditing) handleStartEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveEdit = () => {
    if (!editForm.make.trim() || !editForm.model.trim()) {
      setEditError("Make and Model can't be empty.");
      return;
    }
    if (!editForm.year || Number(editForm.year) <= 0) {
      setEditError("Enter a valid Year.");
      return;
    }
    if (!editForm.coe) {
      setEditError("COE Expiry Date is required.");
      return;
    }
    const negativeField = [
      ["purchase", "Purchase"], ["purchaseAdvance", "Purchase Advance"],
      ["insurance", "Insurance"], ["reg", "Registration"], ["otherCharges", "Other Charges"],
    ].find(([key]) => editForm[key] !== "" && Number(editForm[key]) < 0);
    if (negativeField) {
      setEditError(`${negativeField[1]} can't be negative.`);
      return;
    }
    const nonWholeField = [
      ["purchaseAdvance", "Purchase Advance"], ["insurance", "Insurance"],
      ["reg", "Registration"], ["otherCharges", "Other Charges"],
    ].find(([key]) => editForm[key] !== "" && !Number.isInteger(Number(editForm[key])));
    if (nonWholeField) {
      setEditError(`${nonWholeField[1]} must be a whole number.`);
      return;
    }
    if (typeof onUpdateCar !== "function") {
      setEditError("Saving isn't wired up yet.");
      return;
    }
    onUpdateCar(car.plate, {
      make: editForm.make.trim(),
      model: editForm.model.trim(),
      year: Number(editForm.year),
      color: editForm.color.trim(),
      fuelType: editForm.fuelType,
      transmission: editForm.transmission,
      purchase: Number(editForm.purchase) || 0,
      purchaseAdvance: Number(editForm.purchaseAdvance) || 0,
      insurance: Number(editForm.insurance) || 0,
      reg: Number(editForm.reg) || 0,
      otherCharges: Number(editForm.otherCharges) || 0,
      coe: editForm.coe,
      insuranceExpiry: editForm.insuranceExpiry,
      ltaTransferDate: editForm.ltaTransferDate,
      roadTaxExpiry: editForm.roadTaxExpiry,
      inspectionExpiry: editForm.inspectionExpiry,
      targetRate: editForm.targetRate === "" ? car.targetRate : Number(editForm.targetRate),
      runningDaysTarget: editForm.runningDaysTarget === "" ? car.runningDaysTarget : Number(editForm.runningDaysTarget),
      profitPctTarget: editForm.profitPctTarget === "" ? car.profitPctTarget : Number(editForm.profitPctTarget),
    });
    setEditing(false);
    setEditForm(null);
    setEditError("");
  };

  return (
    <>
      <style>{`
        @keyframes detailsFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes detailsSlide { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      {/* Backdrop */}
      {/* Backdrop click no longer closes the details panel — close only via ✕. */}
      <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.3)", zIndex: 40, animation: "detailsFade 0.15s ease" }} />
      
      {/* Modal */}
      <div style={{
        position: "fixed", top: "55%", left: "50%", transform: "translate(-50%, -50%)",
        width: "100%", maxWidth: 520, margin: "0 14px", maxHeight: "75vh",
        background: C.surface, zIndex: 41, display: "flex", flexDirection: "column",
        border: `1px solid ${C.border}`, borderRadius: 14,
        boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)", animation: "detailsSlide 0.2s cubic-bezier(.2,.8,.2,1)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{car.make} {car.model}</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{car.plate}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 18, color: C.textMuted, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        {/* Scrollable Content */}
        <div style={{ padding: "8px 12px", overflowY: "auto", flex: 1, fontSize: 12 }}>
          
          {/* Status & Registration Alert */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
            <StatusTag status={toFleetPageStatus(car.status)} />
            <div style={{
              fontSize: 10.5, fontWeight: 600, padding: "6px 10px", borderRadius: 8,
              background: d < 30 ? C.redFaint : d < 90 ? C.amberFaint : C.greenFaint,
              color: d < 30 ? C.red : d < 90 ? C.amber : C.green,
            }}>
              {d < 30 ? "⚠" : d < 90 ? "⚡" : "✓"} Reg. Expiry: {car.coe}
            </div>
          </div>

          {/* Vehicle Details */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>Vehicle</div>
            {editing ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Make</div>
                  <input type="text" value={editForm.make} onChange={(e) => setEditForm({ ...editForm, make: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Model</div>
                  <input type="text" value={editForm.model} onChange={(e) => setEditForm({ ...editForm, model: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Year</div>
                  <input type="number" value={editForm.year} onChange={(e) => setEditForm({ ...editForm, year: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Colour</div>
                  <input type="text" value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Fuel Type</div>
                  <select value={editForm.fuelType} onChange={(e) => { const v = e.target.value; setEditForm({ ...editForm, fuelType: v, transmission: v === "EV" ? "Automatic" : editForm.transmission }); }} style={{ ...fieldStyle, cursor: "pointer" }}>
                    <option value="Petrol">Petrol</option>
                    <option value="Diesel">Diesel</option>
                    <option value="EV">EV</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Transmission</div>
                  <select value={editForm.transmission} onChange={(e) => setEditForm({ ...editForm, transmission: e.target.value })} disabled={editForm.fuelType === "EV"} style={{ ...fieldStyle, cursor: "pointer" }}>
                    <option value="Automatic">Automatic</option>
                    {editForm.fuelType !== "EV" && <option value="Manual">Manual</option>}
                  </select>
                </div>
              </div>
            ) : (
              <>
                <CompactRow label="Make" value={car.make} useMono={false} />
                <CompactRow label="Model" value={car.model} useMono={false} />
                <CompactRow label="Year" value={car.year} useMono={false} />
                <CompactRow label="Colour" value={car.color} useMono={false} />
                <CompactRow label="Fuel Type" value={car.fuelType || "—"} useMono={false} />
                <CompactRow label="Transmission" value={car.transmission || "—"} useMono={false} />
              </>
            )}
          </div>

          {/* Compliance & Validity */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>Compliance & Validity</div>
            {editing ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Insurance Expiry</div>
                  <input type="date" value={editForm.insuranceExpiry} onChange={(e) => setEditForm({ ...editForm, insuranceExpiry: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>LTA Transfer Validity</div>
                  <input type="date" value={editForm.ltaTransferDate} onChange={(e) => setEditForm({ ...editForm, ltaTransferDate: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Road Tax Expiry</div>
                  <input type="date" value={editForm.roadTaxExpiry} onChange={(e) => setEditForm({ ...editForm, roadTaxExpiry: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Inspection Due</div>
                  <input type="date" value={editForm.inspectionExpiry} onChange={(e) => setEditForm({ ...editForm, inspectionExpiry: e.target.value })} style={fieldStyle} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>COE Expiry *</div>
                  <input type="date" value={editForm.coe} onChange={(e) => setEditForm({ ...editForm, coe: e.target.value })} style={fieldStyle} />
                </div>
              </div>
            ) : (
              <>
                <ComplianceRow label="Insurance Expiry" date={car.insuranceExpiry} />
                <ComplianceRow label="LTA Transfer Validity" date={car.ltaTransferDate} />
                <ComplianceRow label="Road Tax Expiry" date={car.roadTaxExpiry} />
                <ComplianceRow label="Inspection Due" date={car.inspectionExpiry} />
              </>
            )}
          </div>

          {/* Investment */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>Investment</div>
            {editing ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Purchase (SGD)</div>
                  <input type="number" min="0" value={editForm.purchase} onChange={(e) => setEditForm({ ...editForm, purchase: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Purchase Advance (SGD)</div>
                  <input type="number" min="0" step="1" value={editForm.purchaseAdvance} onChange={(e) => { const v = e.target.value; if (v !== "" && !/^\d+$/.test(v)) return; setEditForm({ ...editForm, purchaseAdvance: v }); }} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Insurance (SGD)</div>
                  <input type="number" min="0" step="1" value={editForm.insurance} onChange={(e) => { const v = e.target.value; if (v !== "" && !/^\d+$/.test(v)) return; setEditForm({ ...editForm, insurance: v }); }} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Registration (SGD)</div>
                  <input type="number" min="0" step="1" value={editForm.reg} onChange={(e) => { const v = e.target.value; if (v !== "" && !/^\d+$/.test(v)) return; setEditForm({ ...editForm, reg: v }); }} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Other Charges (SGD)</div>
                  <input type="number" min="0" step="1" value={editForm.otherCharges} onChange={(e) => { const v = e.target.value; if (v !== "" && !/^\d+$/.test(v)) return; setEditForm({ ...editForm, otherCharges: v }); }} style={fieldStyle} />
                </div>
              </div>
            ) : (
              <>
                <CompactRow label="Purchase" value={fmt(car.purchase)} />
                <CompactRow label="Purchase Advance" value={fmt(car.purchaseAdvance || 0)} />
                <CompactRow label="Insurance" value={fmt(car.insurance)} />
                <CompactRow label="Registration" value={fmt(car.reg)} />
                <CompactRow label="Other Charges" value={fmt(car.otherCharges || 0)} />
                <CompactRow label="Total" value={fmt(fin.inv)} valueColor={C.green} bold />
              </>
            )}
          </div>

          {/* Target */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>Target</div>
            {editing ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Target Rate (SGD/day)</div>
                  <input type="number" min="0" value={editForm.targetRate} onChange={(e) => setEditForm({ ...editForm, targetRate: e.target.value })} style={fieldStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Running Days / Month</div>
                  <input type="number" min="0" value={editForm.runningDaysTarget} onChange={(e) => setEditForm({ ...editForm, runningDaysTarget: e.target.value })} style={fieldStyle} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Target Profit %</div>
                  <input type="number" step="0.1" value={editForm.profitPctTarget} onChange={(e) => setEditForm({ ...editForm, profitPctTarget: e.target.value })} style={fieldStyle} />
                </div>
              </div>
            ) : (
              <>
                <CompactRow label="Target Rate" value={car.targetRate != null ? `SGD ${car.targetRate}/day` : "—"} useMono={false} />
                <CompactRow label="Running Days Target" value={car.runningDaysTarget != null ? `${car.runningDaysTarget} days/mo` : "—"} useMono={false} />
                <CompactRow label="Target Profit %" value={car.profitPctTarget != null ? `${car.profitPctTarget}%` : "—"} useMono={false} />
              </>
            )}
          </div>

          {/* Financial Summary — Simplified */}
       <div style={{ marginBottom: 12 }}>
  <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>
    Financial Summary
  </div>

  <CompactRow label="Total Investment" value={fmt(fin.inv)} valueColor={C.navy} bold />
  <CompactRow label="Booking Revenue" value={fmt(fin.bookingRevenue)} valueColor={C.green} />
  <CompactRow label="Vehicle Expense" value={fmt(fin.vehicleExpense)} valueColor={C.amber} />
  <CompactRow label="Net Profit" value={fmt(fin.netProfit)} valueColor={profitColor} bold />
  <CompactRow label="ROI" value={`${fin.roi.toFixed(2)}%`} valueColor={profitColor} bold />
</div>

          {/* Performance Metrics */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>Performance</div>
            <CompactRow label="Rental Days" value={`${fin.rentalDays}d`} useMono={false} />
            <CompactRow label="Total Bookings" value={fin.totalBookings} useMono={false} />
            <CompactRow label="Recovery %" value={`${recoveryPct.toFixed(0)}%`} useMono={false} />
            
            {/* Recovery Progress Bar */}
            <div style={{ marginTop: 8 }}>
              <div style={{ position: "relative", height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${recoveryPct}%`, height: "100%", background: C.teal, borderRadius: 3 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.textMuted, marginTop: 4 }}>
                <span>{fmt(fin.bookingRevenue)}</span>
                <span>Target: {fmt(fin.inv)}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          {editError && (
            <div style={{ marginTop: 10, fontSize: 11, fontWeight: 600, color: C.red }}>{editError}</div>
          )}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            {editing ? (
              <>
                <Btn small onClick={handleSaveEdit} style={{ flex: 1, background: C.greenFaint, color: C.green, border: `1px solid ${C.green}` }}>
                  Save Changes
                </Btn>
                <Btn small onClick={handleCancelEdit}>Cancel</Btn>
              </>
            ) : (
              <>
                <Btn small onClick={() => setDrawerOpen(true)} style={{ flex: 1, background: C.greenFaint, color: C.green, border: `1px solid ${C.green}` }}>
                  + Add Vehicle Expense
                </Btn>
                <Btn small onClick={onDelete} style={{ background: C.redFaint, color: C.red, border: `1px solid ${C.red}` }}>Delete</Btn>
              </>
            )}
          </div>
        </div>
      </div>

      {drawerOpen && (
        <ExpenseDrawer car={car} onAddExpense={onAddExpense} onClose={() => setDrawerOpen(false)} />
      )}
    </>
  );
};

// Helper function to categorize COE status
const getCOEStatus = (daysRemaining) => {
  if (daysRemaining < 0) return "Expired";
  if (daysRemaining <= 30) return "Expiring in 30 Days";
  if (daysRemaining <= 90) return "Expiring in 90 Days";
  if (daysRemaining <= 180) return "Expiring in 180 Days";
  return "Active";
};

// Accent color for each fleet status, used by the status filter pills.
// Exported so other screens (e.g. the Booking module's availability timeline)
// render the same four statuses with the exact same colors instead of
// maintaining a second color mapping that could drift out of sync.
export const STATUS_PILL_COLORS = {
  Available: C.green,
  Maintenance: C.amber,
  Upcoming: C.blue,
  "On Rental": C.blue,
  "Ending Today": C.red,
  Rented: C.blue,
  Booked: C.blue,
  Inactive: C.textMuted,
};
export const STATUS_PILL_FAINT = {
  Available: C.greenFaint,
  Maintenance: C.amberFaint,
  Upcoming: C.blueFaint,
  "On Rental": C.blueFaint,
  "Ending Today": C.redFaint,
  Rented: C.blueFaint,
  Booked: C.blueFaint,
  Inactive: C.bg,
};
const getStatusPillColor = (status) => STATUS_PILL_COLORS[status] || C.navy;
const getStatusPillFaint = (status) => STATUS_PILL_FAINT[status] || C.tealFaint;

// The Fleet page collapses the 5 live statuses into 3 buckets, using the SAME
// shared rule (fleetDisplayStatus) the Dashboard and metrics use, so every count
// agrees. Option B: Maintenance is its own bucket (a garaged car isn't
// "available"), so the pills read Available / On Rental / Maintenance and
// Total = Available + On Rental + Maintenance.
//   Upcoming      → Available    (car is free until the future booking starts)
//   Ending Today  → On Rental    (still out until the day ends)
//   Maintenance   → Maintenance  (its own bucket)
//   everything else passes through unchanged
const toFleetPageStatus = (status) => fleetDisplayStatus(status);

// Common rental-fleet colour names mapped to an accurate swatch — covers the
// descriptive names staff actually type (e.g. "Pearl White", "Jet Black")
// that a plain CSS colour keyword wouldn't recognize on its own. Keys are
// matched case-insensitively.
const COLOR_ALIASES = {
  silver: "#C0C0C0", white: "#F5F5F5", "pearl white": "#F5F5F5", ivory: "#F5F0E6",
  black: "#1A1A1A", "jet black": "#1A1A1A",
  blue: "#4472C4", "dark blue": "#1F3A66", navy: "#0F172A", "sky blue": "#7EC8E3",
  red: "#D64045", maroon: "#7C1D2E", wine: "#722F37",
  grey: "#8A8A8A", gray: "#8A8A8A", "dark grey": "#555555", "dark gray": "#555555",
  green: "#3E8E5A", "dark green": "#2F5D3A",
  gold: "#C9A15A", champagne: "#D9C6A5", beige: "#D8CDB8", brown: "#6B4226", bronze: "#8C5E32",
  orange: "#E0792C", yellow: "#E6C64A", purple: "#6C4FA1", pink: "#E38AAE",
};

// Resolves any free-typed vehicle colour to an accurate swatch: the alias
// table above first, then the browser's own CSS colour parser (covers any
// standard CSS keyword, hex, or rgb() typed directly), and only a neutral
// grey when the text genuinely isn't a recognizable colour.
const resolveColorSwatch = (name) => {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return "#ccc";
  if (COLOR_ALIASES[key]) return COLOR_ALIASES[key];
  if (typeof document !== "undefined") {
    const probe = document.createElement("span").style;
    probe.color = "";
    probe.color = key;
    if (probe.color) return key;
  }
  return "#aaa";
};

// In-app replacement for window.confirm() on Delete — a real dialog styled
// like the rest of the app, with no browser chrome or "<site> says" text.
const DeleteConfirmModal = ({ car, onConfirm, onCancel }) => (
  <>
    <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.45)", zIndex: 300 }} />
    <div style={{
      position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
      background: C.surface, borderRadius: 14, boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)",
      zIndex: 301, width: "min(400px, calc(100vw - 32px))", padding: 24, textAlign: "center",
      boxSizing: "border-box",
    }}>
      <div style={{ width: 48, height: 48, borderRadius: "50%", background: C.redFaint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, margin: "0 auto 14px" }}>🗑</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 6 }}>Delete this vehicle?</div>
      <div style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.5, marginBottom: 20 }}>
        <strong style={{ color: C.textPri }}>{car.make} {car.model} ({car.plate})</strong> will be permanently removed. This action cannot be undone.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn secondary onClick={onCancel} style={{ flex: 1 }}>Cancel</Btn>
        <Btn onClick={onConfirm} style={{ flex: 1, background: C.red, color: "#fff" }}>Delete</Btn>
      </div>
    </div>
  </>
);

// Compact rounded-square icon action button used in the Fleet table rows —
// same visual language as the Bookings list's row actions.
const IconBtn = ({ children, title, color, testid, onClick }) => (
  <button data-testid={testid} title={title} onClick={onClick} style={{
    width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center",
    borderRadius: 8, cursor: "pointer", fontSize: 13, lineHeight: 1,
    background: `${color}14`, border: `1px solid ${color}33`, color,
  }}>{children}</button>
);

// Pagination button for the Fleet table footer.
const FlPageBtn = ({ children, active, disabled, onClick }) => (
  <button onClick={onClick} disabled={disabled} style={{
    minWidth: 28, height: 28, padding: "0 8px", borderRadius: 6,
    border: `1px solid ${active ? C.teal : C.border}`,
    background: active ? C.teal : C.surface,
    color: active ? "#fff" : disabled ? C.textMuted : C.textSec,
    fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
  }}>{children}</button>
);

// ─────────────────────────────────────────────────────────────────────────
// Fleet — table/filter list + modal details overlay
// ─────────────────────────────────────────────────────────────────────────
const Fleet = ({ fleet = [], onAddFleet, onUpdateCar, onDeleteCar, calculateCarMetrics, bookings = [], expenses = [], onAddExpense, initialOpenPlate, onInitialOpenPlateHandled }) => {
  // Which car's details modal is open, keyed by plate (not a row index) so it
  // stays correct across pagination/filtering/sorting.
  const [openPlate, setOpenPlate] = useState(null);
  // True when the details modal should open straight into edit mode — set by
  // the table's Edit icon, as opposed to the View icon which opens read-only.
  const [editOnOpen, setEditOnOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirmDeleteCar, setConfirmDeleteCar] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPlate, setSelectedPlate] = useState("All Plates");
  const [coeFilter, setCoeFilter] = useState("All Registration");
  const [statusPillFilter, setStatusPillFilter] = useState("All");
  const [sortField, setSortField] = useState(null);   // 'plate' | 'purchaseDate' | 'coe'
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Deep-link support — e.g. the Alerts page's "Renew Now" / "View Vehicle"
  // buttons set initialOpenPlate to jump straight to that car's edit modal.
  // Same "consume once" pattern as Booking.jsx's detailBookingId: the parent
  // hands off a plate, this opens it, then immediately clears it via the
  // handler so the same plate doesn't re-trigger on the next render.
  useEffect(() => {
    if (!initialOpenPlate) return;
    setEditOnOpen(true);
    setOpenPlate(initialOpenPlate);
    onInitialOpenPlateHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenPlate]);

  // Generate unique plates from fleet (automatically updates when fleet changes)
  const uniquePlates = useMemo(() => {
    return fleet.map(c => c.plate).sort();
  }, [fleet]);

  // Status pill counts (Available / On Rental / etc.) — computed from the
  // full fleet so the numbers on the pills don't shift as other filters change.
  const statusCounts = useMemo(() => {
    const counts = {};
    fleet.forEach(c => { const s = toFleetPageStatus(c.status); counts[s] = (counts[s] || 0) + 1; });
    return counts;
  }, [fleet]);
  const statusPillOptions = useMemo(() => {
    return Object.keys(statusCounts).sort();
  }, [statusCounts]);

  // Combined filtering logic
  const filteredFleet = useMemo(() => {
    return fleet.filter(car => {
      // Search filter across 6 fields
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch =
        car.plate.toLowerCase().includes(searchLower) ||
        car.make.toLowerCase().includes(searchLower) ||
        car.model.toLowerCase().includes(searchLower) ||
        car.year.toString().includes(searchLower) ||
        car.color.toLowerCase().includes(searchLower) ||
        toFleetPageStatus(car.status).toLowerCase().includes(searchLower);

      // Plate filter
      const matchesPlate = selectedPlate === "All Plates" || car.plate === selectedPlate;

      // Status pill filter (All / Available / On Rental / ...)
      const matchesStatusPill = statusPillFilter === "All" || toFleetPageStatus(car.status) === statusPillFilter;

      // Registration expiry filter (car.coe field kept for data compatibility)
      let matchesCOE = true;
      if (coeFilter !== "All Registration") {
        const daysRemaining = daysUntil(car.coe);
        const coeStatus = getCOEStatus(daysRemaining);
        matchesCOE = coeStatus === coeFilter;
      }

      return matchesSearch && matchesPlate && matchesStatusPill && matchesCOE;
    });
  }, [fleet, searchTerm, selectedPlate, statusPillFilter, coeFilter]);

  // Sort layered on top of the filter — sorts whatever filteredFleet currently
  // contains, so filter + sort compose cleanly instead of fighting each other.
  const sortedFleet = useMemo(() => {
    if (!sortField) return filteredFleet;
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...filteredFleet];
    arr.sort((a, b) => {
      if (sortField === "plate") return a.plate.localeCompare(b.plate) * dir;
      // purchaseDate / coe are 'YYYY-MM-DD' strings — Date works, but missing
      // purchaseDate on older records shouldn't crash the sort, just sink to one end.
      const aVal = new Date(a[sortField] || 0).getTime();
      const bVal = new Date(b[sortField] || 0).getTime();
      return (aVal - bVal) * dir;
    });
    return arr;
  }, [filteredFleet, sortField, sortDir]);

  // Car whose details modal is open, resolved by plate against the current
  // sorted/filtered list (falls back to null if it's since been filtered out).
  const car = openPlate ? sortedFleet.find(c => c.plate === openPlate) : null;

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  // Pagination — over the filtered + sorted list, so it always reflects
  // whatever Search/Filters/Sorting currently produced. Any change to those
  // (including the page size itself) resets back to page 1, so a search or
  // filter change never leaves the user stranded on a now-empty later page.
  const totalPages = Math.max(1, Math.ceil(sortedFleet.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageRows = sortedFleet.slice((curPage - 1) * pageSize, curPage * pageSize);
  useEffect(() => { setPage(1); }, [searchTerm, selectedPlate, coeFilter, statusPillFilter, sortField, sortDir, pageSize]);

  const handleWizardComplete = (carData) => {
    onAddFleet(carData);
    setWizardOpen(false);
  };

  const handleDelete = (targetCar) => setConfirmDeleteCar(targetCar);

  const handleConfirmDelete = () => {
    onDeleteCar(confirmDeleteCar.plate);
    setConfirmDeleteCar(null);
    setOpenPlate(null);
  };

  return (
    <div>
      {/* Page header — icon + title + subtitle, with the primary action on the right */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: C.tealFaint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🚗</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.navy, lineHeight: 1.1 }}>Fleet</div>
            <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>Manage your vehicles, investment, and registration status</div>
          </div>
        </div>
        <Btn primary id="fleet-add-car" onClick={() => setWizardOpen(true)}>＋ Add New Car</Btn>
      </div>

      {/* Add Car Wizard Modal */}
      {wizardOpen && (
        <AddCarWizard onComplete={handleWizardComplete} onClose={() => setWizardOpen(false)} fleet={fleet} />
      )}

      {/* Toolbar — search + plate filter + registration filter, same compact
          style as the Bookings page toolbar. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.textMuted, fontSize: 13, pointerEvents: "none" }}>🔍</span>
          <input
            id="fleet-search"
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by plate, make, model, year, colour, or status…"
            style={{ width: "100%", padding: "9px 12px 9px 34px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, fontSize: 12.5, color: C.textPri, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
          />
        </div>
        <select
          id="fleet-filter-plate"
          value={selectedPlate}
          onChange={(e) => setSelectedPlate(e.target.value)}
          style={{ padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, fontSize: 12.5, fontWeight: 600, color: C.textSec, cursor: "pointer", fontFamily: "inherit", outline: "none" }}
        >
          <option value="All Plates">All Plates ({fleet.length})</option>
          {uniquePlates.map((plate) => <option key={plate} value={plate}>{plate}</option>)}
        </select>
        <select
          id="fleet-filter-status"
          value={coeFilter}
          onChange={(e) => setCoeFilter(e.target.value)}
          style={{ padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, fontSize: 12.5, fontWeight: 600, color: C.textSec, cursor: "pointer", fontFamily: "inherit", outline: "none" }}
        >
          <option value="All Registration">Registration: All</option>
          <option value="Active">Active</option>
          <option value="Expiring in 180 Days">Expiring in 180 Days</option>
          <option value="Expiring in 90 Days">Expiring in 90 Days</option>
          <option value="Expiring in 30 Days">Expiring in 30 Days</option>
          <option value="Expired">Expired</option>
        </select>
        {(searchTerm || selectedPlate !== "All Plates" || coeFilter !== "All Registration") && (
          <button id="fleet-clear-filters" onClick={() => { setSearchTerm(""); setSelectedPlate("All Plates"); setCoeFilter("All Registration"); }}
            style={{ padding: "9px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, fontSize: 12.5, fontWeight: 600, color: C.textSec, cursor: "pointer", fontFamily: "inherit" }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Status filter tabs — click a status to show only that status, click All to reset */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {[["All", fleet.length], ...statusPillOptions.map(s => [s, statusCounts[s]])].map(([label, count]) => {
          const isActive = statusPillFilter === label;
          const dotColor = label === "All" ? C.navy : getStatusPillColor(label);
          return (
            <button key={label} data-testid="fleet-status-filter" data-filter={label} onClick={() => setStatusPillFilter(label)} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 999,
              border: `1.5px solid ${isActive ? dotColor : C.border}`,
              background: isActive ? `${dotColor}14` : C.surface,
              color: isActive ? dotColor : C.textSec,
              fontSize: 12.5, fontWeight: 700, cursor: "pointer", transition: "all 0.12s",
            }}>
              {label !== "All" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />}
              {label}
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                background: isActive ? C.surface : C.bg, color: isActive ? dotColor : C.textMuted,
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Fleet Table — full-width, compact rows, same shell as the Bookings list */}
      <Card>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 780, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bg }}>
              {[
                { label: "Plate", field: "plate" },
                { label: "Vehicle", field: null },
                { label: "Investment", field: null },
                { label: "Purchase Date", field: "purchaseDate" },
                { label: "Reg. Expiry", field: "coe" },
                { label: "Status", field: null },
                { label: "Actions", field: null },
              ].map(({ label, field }) => {
                const isActive = field && sortField === field;
                const centered = label === "Actions";
                return (
                  <th key={label}
                    onClick={field ? () => handleSort(field) : undefined}
                    style={{
                      textAlign: centered ? "center" : "left", padding: "11px 14px", fontSize: 10, fontWeight: 700,
                      color: isActive ? C.navy : C.textMuted, textTransform: "uppercase", letterSpacing: 0.5,
                      borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
                      cursor: field ? "pointer" : "default", userSelect: "none",
                    }}>
                    {label}
                    {field && (
                      <span style={{ marginLeft: 4, opacity: isActive ? 1 : 0.35 }}>
                        {isActive ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((c) => {
              const inv = totalInv(c);
              const d = daysUntil(c.coe);
              return (
                <tr key={c.plate} data-testid="fleet-row" data-plate={c.plate}
                  onClick={() => { setEditOnOpen(false); setOpenPlate(c.plate); }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.bg; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  style={{ borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: "transparent", transition: "background 0.12s" }}>
                  <td style={{ padding: "12px 14px", borderLeft: `3px solid ${C.green}`, whiteSpace: "nowrap" }}>
                    <PlateBadge plate={c.plate} small />
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, background: resolveColorSwatch(c.color), border: `1px solid ${C.border}` }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.navy, whiteSpace: "nowrap" }}>{c.make} {c.model}</div>
                        <div style={{ fontSize: 10, color: C.textMuted, whiteSpace: "nowrap" }}>{c.year} · {c.color}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "12px 14px", ...mono, fontSize: 12, fontWeight: 700, color: C.navy, whiteSpace: "nowrap" }}>{fmt(inv)}</td>
                  <td style={{ padding: "12px 14px", fontSize: 11, color: C.textSec, whiteSpace: "nowrap" }}>{c.purchaseDate || "—"}</td>
                  <td style={{ padding: "12px 14px", fontSize: 11, whiteSpace: "nowrap", color: d < 30 ? C.red : d < 90 ? C.amber : C.textMuted, fontWeight: d < 90 ? 700 : 400 }}>
                    {c.coe || "—"} {d < 30 ? "⚠" : d < 90 ? "⚡" : ""}
                  </td>
                  <td style={{ padding: "12px 14px" }}><StatusTag status={toFleetPageStatus(c.status)} /></td>
                  <td style={{ padding: "9px 14px" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <IconBtn testid="fleet-row-details" title="View details" color={C.green} onClick={() => { setEditOnOpen(false); setOpenPlate(c.plate); }}>👁</IconBtn>
                      <IconBtn testid="fleet-row-edit" title="Edit vehicle" color={C.green} onClick={() => { setEditOnOpen(true); setOpenPlate(c.plate); }}>✏️</IconBtn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        {sortedFleet.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
            {fleet.length === 0 ? "No cars registered yet" : "No vehicles match your filters"}
          </div>
        )}

        {/* Pagination */}
        {sortedFleet.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderTop: `1px solid ${C.border}`, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 11, color: C.textMuted }}>
              Showing {(curPage - 1) * pageSize + 1} to {Math.min(curPage * pageSize, sortedFleet.length)} of {sortedFleet.length} vehicles
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <FlPageBtn disabled={curPage === 1} onClick={() => setPage(curPage - 1)}>‹ Previous</FlPageBtn>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <FlPageBtn key={p} active={p === curPage} onClick={() => setPage(p)}>{p}</FlPageBtn>
              ))}
              <FlPageBtn disabled={curPage === totalPages} onClick={() => setPage(curPage + 1)}>Next ›</FlPageBtn>
              <select
                id="fleet-page-size"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 600, color: C.textPri, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 8px", cursor: "pointer", outline: "none", fontFamily: "inherit" }}
              >
                {[10, 20, 50].map(n => <option key={n} value={n}>{n} / page</option>)}
              </select>
            </div>
          </div>
        )}
      </Card>

      {confirmDeleteCar && (
        <DeleteConfirmModal car={confirmDeleteCar} onConfirm={handleConfirmDelete} onCancel={() => setConfirmDeleteCar(null)} />
      )}

      {/* Vehicle Details Modal Overlay */}
      {car && (
        <VehicleDetailsModal
          car={car}
          bookings={bookings}
          expenses={expenses}
          onAddExpense={onAddExpense}
          onUpdateCar={onUpdateCar}
          onDelete={() => handleDelete(car)}
          onClose={() => { setOpenPlate(null); setEditOnOpen(false); }}
          startEditing={editOnOpen}
        />
      )}
    </div>
  );
};

export default Fleet;