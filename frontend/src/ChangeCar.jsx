// Change Car — swaps the car on a booking that's out with the customer.
// Opened from the booking's detail view (Booking.jsx). Three steps:
//   1. Return the current car (swap time, odometer, fuel, charges for it)
//   2. Pick the new car (only cars free from the swap to the booking's end)
//      and record its handover readings
//   3. Price & payment (same rate or the new car's rate, swap fee, collect /
//      refund, deposit top-up)
// The figures come from carSwap.js; saving goes through fleetData.changeCar,
// which the server re-checks under a lock and writes in one transaction.
import { useMemo, useState } from "react";
import { C, mono, fmt, TRANSACTION_METHODS } from "./theme";
import { Btn } from "./components";
import { validatePaymentReference, REFERENCE_LABEL, referencePlaceholder, referenceMaxLength, referenceRequired } from "./paymentReference";
import PaymentRefError from "./PaymentRefError";
import { MAX_ODOMETER_KM } from "./mileage";
import { computeSwapPricing, buildChangeCarPayload, SWAP_CHARGE_TYPES } from "./carSwap";
import { generateVehicleChangeSlip } from "./vehicleChangeSlip";

const FUEL_LEVELS = ["Full", "3/4", "1/2", "1/4", "Empty"];
const STEPS = ["Return Current Car", "New Car", "Price & Payment"];

const labelStyle = { display: "block", fontSize: 11.5, fontWeight: 600, color: C.textPri, marginBottom: 5 };
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: C.surface };
const sectionStyle = { border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", background: C.bg, marginBottom: 12 };
const grid2 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 };

const Field = ({ label, required, children, hint }) => (
  <div>
    <label style={labelStyle}>{label}{required && <span style={{ color: C.red }}> *</span>}</label>
    {children}
    {hint && <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 4 }}>{hint}</div>}
  </div>
);

const localToday = () => new Date().toLocaleDateString("en-CA");
const localNow = () => new Date().toTimeString().slice(0, 5);
const fmtDT = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d) ? v : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const money = (n) => fmt(Math.round((Number(n) || 0) * 100) / 100);

// Payment method + reference pair, used for collect / refund / deposit top-up.
const MethodAndRef = ({ method, setMethod, reference, setReference }) => (
  <>
    <Field label="Method">
      <select value={method} onChange={(e) => setMethod(e.target.value)} style={inputStyle}>
        {TRANSACTION_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </Field>
    <Field label={REFERENCE_LABEL} required={referenceRequired(method)}>
      <input value={reference} maxLength={referenceMaxLength(method)} placeholder={referencePlaceholder(method)} onChange={(e) => setReference(e.target.value)} style={inputStyle} />
      <PaymentRefError method={method} value={reference} />
    </Field>
  </>
);

export default function ChangeCar({ booking, fleet, checkBookingConflict, onSave, onClose, actor = "System" }) {
  // The booking prop refreshes to the saved booking (now on the new car) once
  // the change is saved — keep the car being returned for the success text.
  const [returnedPlate] = useState(booking.plate);
  const [step, setStep] = useState(0);
  const [swapDate, setSwapDate] = useState(localToday);
  const [swapTime, setSwapTime] = useState(localNow);
  const [oldReturnOdo, setOldReturnOdo] = useState("");
  const [oldReturnFuel, setOldReturnFuel] = useState("Full");
  const [oldCharges, setOldCharges] = useState([]);
  const [reason, setReason] = useState("");
  const [newPlate, setNewPlate] = useState("");
  const [newStartOdo, setNewStartOdo] = useState("");
  const [newStartFuel, setNewStartFuel] = useState("Full");
  const [rateMode, setRateMode] = useState("same");
  const [newRate, setNewRate] = useState("");
  const [swapFee, setSwapFee] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [collectAmount, setCollectAmount] = useState(null); // null → defaults to the amount due
  const [collectMethod, setCollectMethod] = useState("Cash");
  const [collectReference, setCollectReference] = useState("");
  const [refundAmount, setRefundAmount] = useState(null);   // null → defaults to the refund due
  const [refundMethod, setRefundMethod] = useState("Cash");
  const [refundReference, setRefundReference] = useState("");
  const [depositTopUp, setDepositTopUp] = useState("");
  const [depositTopUpMethod, setDepositTopUpMethod] = useState("Cash");
  const [depositTopUpReference, setDepositTopUpReference] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);

  const swapAt = swapDate && swapTime ? `${swapDate}T${swapTime}` : "";
  const isMonthly = booking.rentalType === "monthly";
  const handoverOdo = (Number(booking.startingMileage) || 0) + (Number(booking.staffToCustomerKm) || 0);
  const currentFrom = booking.currentCarFrom || booking.start;
  const newCar = fleet.find((c) => c.plate === newPlate);

  // Every other car, with why it can't be picked (if it can't). Only cars
  // free from the swap time to the booking's return can be chosen.
  const carOptions = useMemo(() => {
    const today = localToday();
    return fleet.filter((c) => c.plate !== booking.plate).map((c) => {
      let blocked = "";
      if (c.status === "Maintenance") blocked = "Under maintenance";
      else if ((c.coe && c.coe < today) || (c.insuranceExpiry && c.insuranceExpiry < today)) blocked = "COE/Insurance expired";
      else if (swapAt && checkBookingConflict(c.plate, swapAt, booking.end, booking.id)) blocked = "Booked during this period";
      return { car: c, blocked };
    }).sort((a, b) => (a.blocked ? 1 : 0) - (b.blocked ? 1 : 0) || a.car.plate.localeCompare(b.car.plate));
  }, [fleet, booking, swapAt, checkBookingConflict]);

  const effectiveNewRate = newRate === "" ? (newCar?.targetRate ?? "") : newRate;
  const pricing = useMemo(() => computeSwapPricing({
    booking, newCar, swapAt, rateMode, newRate: effectiveNewRate, swapFee, oldCarCharges: oldCharges, actor,
  }), [booking, newCar, swapAt, rateMode, effectiveNewRate, swapFee, oldCharges, actor]);
  const collect = collectAmount === null ? String(pricing.amountDue || "") : collectAmount;
  const refund = refundAmount === null ? String(pricing.refundDue || "") : refundAmount;

  const validateStep = (i) => {
    if (i === 0) {
      if (!swapAt || isNaN(new Date(swapAt))) return "Enter the swap date and time.";
      if (new Date(swapAt) > new Date(Date.now() + 15 * 60000)) return "The swap time can't be in the future — record the swap when it happens.";
      if (new Date(swapAt) < new Date(currentFrom)) return `The swap time can't be before ${booking.plate} went out on this booking (${fmtDT(currentFrom)}).`;
      if (new Date(swapAt) >= new Date(booking.end)) return "The swap time must be before the booking's return date. Extend the booking first.";
      if (oldReturnOdo === "" || isNaN(Number(oldReturnOdo))) return `Enter ${booking.plate}'s odometer at return.`;
      if (Number(oldReturnOdo) < handoverOdo) return `${booking.plate}'s return odometer must be at least ${handoverOdo.toLocaleString()} km (its odometer at handover).`;
      if (Number(oldReturnOdo) > MAX_ODOMETER_KM) return `Odometer can't exceed ${MAX_ODOMETER_KM.toLocaleString()} km.`;
      if (oldCharges.some((c) => !c.type || !(Number(c.amount) > 0))) return "Each charge needs a type and an amount above 0 (remove empty ones).";
    }
    if (i === 1) {
      if (!newPlate) return "Choose the new car.";
      const opt = carOptions.find((o) => o.car.plate === newPlate);
      if (!opt || opt.blocked) return `${newPlate} can't be used: ${opt?.blocked || "not available"}.`;
      if (newStartOdo === "" || isNaN(Number(newStartOdo)) || Number(newStartOdo) < 0) return `Enter ${newPlate}'s odometer at handover.`;
      if (Number(newStartOdo) > MAX_ODOMETER_KM) return `Odometer can't exceed ${MAX_ODOMETER_KM.toLocaleString()} km.`;
    }
    if (i === 2) {
      if (rateMode === "new" && !(Number(effectiveNewRate) >= 0 && String(effectiveNewRate).trim() !== "")) return "Enter the new car's rate.";
      if (pricing.freeUpgrade && !approvedBy.trim()) return `Keeping the same rate on a dearer car is a free upgrade — enter who approved it.`;
      if (Number(swapFee) < 0) return "Swap fee can't be negative.";
      const c = Number(collect) || 0;
      if (c < 0) return "Amount collected can't be negative.";
      if (c > 0) { const m = validatePaymentReference(collectMethod, collectReference); if (m) return m; }
      const r = Number(refund) || 0;
      if (r < 0) return "Refund can't be negative.";
      if (r > pricing.refundDue + 0.001) return `Refund can't be more than the ${money(pricing.refundDue)} overpaid.`;
      if (r > 0) { const m = validatePaymentReference(refundMethod, refundReference); if (m) return m; }
      const t = Number(depositTopUp) || 0;
      if (t < 0) return "Deposit top-up can't be negative.";
      if (t > 0) { const m = validatePaymentReference(depositTopUpMethod, depositTopUpReference); if (m) return m; }
    }
    return "";
  };

  const next = () => {
    const msg = validateStep(step);
    setError(msg);
    if (!msg) setStep(step + 1);
  };

  const save = async () => {
    for (let i = 0; i < STEPS.length; i++) {
      const msg = validateStep(i);
      if (msg) { setStep(i); setError(msg); return; }
    }
    setError("");
    setSaving(true);
    try {
      const payload = buildChangeCarPayload({
        booking, pricing, actor,
        form: {
          newPlate, swapAt, oldReturnOdo, oldReturnFuel, newStartOdo, newStartFuel, reason, approvedBy, rateMode,
          collectAmount: collect, collectMethod, collectReference,
          refundAmount: refund, refundMethod, refundReference,
          depositTopUp, depositTopUpMethod, depositTopUpReference,
        },
      });
      setSaved(await onSave(payload));
    } catch (err) {
      setError(err?.message || "The car change couldn't be saved.");
    } finally {
      setSaving(false);
    }
  };

  const shell = (body, footer) => (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.45)", zIndex: 300 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "min(720px, calc(100vw - 24px))", maxHeight: "92vh", display: "flex", flexDirection: "column", background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: "0 24px 60px rgba(15, 23, 42, 0.25)", zIndex: 301 }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>🔄 Change Car — {booking.id}</div>
            <div style={{ fontSize: 11.5, color: C.textMuted }}>{booking.customer} · now on <span style={mono}>{booking.plate}</span> · returns {fmtDT(booking.end)}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 18, color: C.textMuted, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1 }}>{body}</div>
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>{footer}</div>
      </div>
    </>
  );

  if (saved) {
    const index = (saved.carHistory || []).length - 1;
    return shell(
      <div style={{ textAlign: "center", padding: "18px 6px" }}>
        <div style={{ fontSize: 34 }}>✅</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginTop: 6 }}>Car changed to {saved.plate}</div>
        <div style={{ fontSize: 12.5, color: C.textSec, marginTop: 6 }}>
          {returnedPlate} is back and available from {fmtDT(swapAt)}. {saved.plate} stays on this booking until {fmtDT(saved.end)}.
        </div>
      </div>,
      <>
        <Btn onClick={() => generateVehicleChangeSlip(saved, index, fleet)}>📄 Download Vehicle Change Slip</Btn>
        <Btn primary onClick={onClose}>Done</Btn>
      </>
    );
  }

  const stepper = (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 14, overflowX: "auto" }}>
      {STEPS.map((s, i) => (
        <div key={s} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: i <= step ? C.teal : C.bg, color: i <= step ? "#fff" : C.textMuted, border: i <= step ? "none" : `1px solid ${C.border}`, flexShrink: 0 }}>{i < step ? "✓" : i + 1}</span>
          <span style={{ fontSize: 12, fontWeight: i === step ? 700 : 500, color: i <= step ? C.navy : C.textMuted, marginLeft: 6, whiteSpace: "nowrap" }}>{s}</span>
          {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, minWidth: 14, margin: "0 8px", background: i < step ? C.teal : C.border }} />}
        </div>
      ))}
    </div>
  );

  const stepReturn = (
    <>
      <div style={sectionStyle}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 10 }}>When is the car being changed?</div>
        <div style={grid2}>
          <Field label="Swap Date" required><input type="date" value={swapDate} max={localToday()} onChange={(e) => setSwapDate(e.target.value)} style={inputStyle} /></Field>
          <Field label="Swap Time" required><input type="time" value={swapTime} onChange={(e) => setSwapTime(e.target.value)} style={inputStyle} /></Field>
        </div>
      </div>
      <div style={sectionStyle}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 10 }}>Return <span style={mono}>{booking.plate}</span></div>
        <div style={grid2}>
          <Field label="Odometer at Return (km)" required hint={`At handover: ${handoverOdo.toLocaleString()} km`}>
            <input type="number" min={handoverOdo} value={oldReturnOdo} onChange={(e) => setOldReturnOdo(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Fuel at Return" required hint={`At handover: ${booking.fuelLevel || "—"}`}>
            <select value={oldReturnFuel} onChange={(e) => setOldReturnFuel(e.target.value)} style={inputStyle}>
              {FUEL_LEVELS.map((f) => <option key={f}>{f}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}>Charges for {booking.plate} (fuel, mileage, damage…)</span>
            <button type="button" onClick={() => setOldCharges((l) => [...l, { id: `oc-${Date.now()}`, type: "fuel_shortfall", amount: "", note: "" }])} style={{ border: `1px solid ${C.teal}`, color: C.teal, background: C.surface, borderRadius: 7, padding: "4px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>+ Add Charge</button>
          </div>
          {oldCharges.length === 0 && <div style={{ fontSize: 11.5, color: C.textMuted }}>No charges for the returned car.</div>}
          {oldCharges.map((c) => (
            <div key={c.id} style={{ display: "grid", gridTemplateColumns: "minmax(130px, 1.2fr) minmax(90px, 0.8fr) minmax(110px, 1.2fr) auto", gap: 8, marginBottom: 6 }}>
              <select value={c.type} onChange={(e) => setOldCharges((l) => l.map((x) => (x.id === c.id ? { ...x, type: e.target.value } : x)))} style={inputStyle}>
                {SWAP_CHARGE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}{t.taxable ? "" : " (no VAT)"}</option>)}
              </select>
              <input type="number" min="0" placeholder="Amount" value={c.amount} onChange={(e) => setOldCharges((l) => l.map((x) => (x.id === c.id ? { ...x, amount: e.target.value } : x)))} style={inputStyle} />
              <input placeholder="Note (optional)" value={c.note} onChange={(e) => setOldCharges((l) => l.map((x) => (x.id === c.id ? { ...x, note: e.target.value } : x)))} style={inputStyle} />
              <button type="button" aria-label="Remove charge" onClick={() => setOldCharges((l) => l.filter((x) => x.id !== c.id))} style={{ border: "none", background: "none", color: C.red, fontSize: 16, cursor: "pointer" }}>✕</button>
            </div>
          ))}
        </div>
      </div>
      <Field label="Reason (optional)">
        <input value={reason} maxLength={200} placeholder="e.g. Breakdown, customer request, upgrade" onChange={(e) => setReason(e.target.value)} style={inputStyle} />
      </Field>
    </>
  );

  const stepNewCar = (
    <>
      <div style={sectionStyle}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 4 }}>Choose the new car</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>Only cars free from {fmtDT(swapAt)} until {fmtDT(booking.end)} can be picked. To take another customer's car, change their booking's car first — the car becomes free once it's back.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8, maxHeight: 260, overflowY: "auto" }}>
          {carOptions.map(({ car, blocked }) => {
            const active = car.plate === newPlate;
            return (
              <button key={car.plate} type="button" disabled={!!blocked} onClick={() => { setNewPlate(car.plate); setNewRate(""); }}
                style={{ textAlign: "left", padding: "9px 11px", borderRadius: 9, cursor: blocked ? "not-allowed" : "pointer", fontFamily: "inherit", border: `1.5px solid ${active ? C.teal : C.border}`, background: active ? C.tealFaint : blocked ? C.bg : C.surface, opacity: blocked ? 0.6 : 1 }}>
                <div style={{ ...mono, fontSize: 12.5, fontWeight: 700, color: C.navy }}>{car.plate}</div>
                <div style={{ fontSize: 11, color: C.textSec }}>{[car.make, car.model].filter(Boolean).join(" ") || "—"}</div>
                <div style={{ fontSize: 10.5, marginTop: 3, color: blocked ? C.red : C.teal, fontWeight: 600 }}>
                  {blocked || `Available${car.targetRate ? ` · ${fmt(Number(car.targetRate))}/day` : ""}`}
                </div>
              </button>
            );
          })}
          {carOptions.length === 0 && <div style={{ fontSize: 12, color: C.textMuted }}>No other cars in the fleet.</div>}
        </div>
      </div>
      {newPlate && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 10 }}>Hand over <span style={mono}>{newPlate}</span></div>
          <div style={grid2}>
            <Field label="Odometer at Handover (km)" required>
              <input type="number" min="0" value={newStartOdo} onChange={(e) => setNewStartOdo(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Fuel at Handover" required>
              <select value={newStartFuel} onChange={(e) => setNewStartFuel(e.target.value)} style={inputStyle}>
                {FUEL_LEVELS.map((f) => <option key={f}>{f}</option>)}
              </select>
            </Field>
          </div>
        </div>
      )}
    </>
  );

  const row = (label, value, strong) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", fontSize: 12 }}>
      <span style={{ color: C.textMuted }}>{label}</span>
      <span style={{ color: C.navy, fontWeight: strong ? 700 : 600, textAlign: "right" }}>{value}</span>
    </div>
  );
  const unit = isMonthly ? "/month" : "/day";

  const stepPrice = (
    <>
      <div style={sectionStyle}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Rate</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {[["same", `Keep same rate (${fmt(pricing.currentRate)}${unit})`], ["new", `Use ${newPlate}'s rate`]].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setRateMode(v)} style={{ flex: "1 1 200px", padding: "9px 12px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, border: `1.5px solid ${rateMode === v ? C.teal : C.border}`, background: rateMode === v ? C.tealFaint : C.surface, color: rateMode === v ? C.teal : C.textSec }}>{l}</button>
          ))}
        </div>
        {rateMode === "new" && (
          <div style={{ maxWidth: 240, marginBottom: 10 }}>
            <Field label={`${newPlate} Rate (SGD${unit})`} required hint={newCar?.targetRate ? `Fleet target rate: ${fmt(Number(newCar.targetRate))}/day` : "No target rate set for this car"}>
              <input type="number" min="0" value={effectiveNewRate} onChange={(e) => setNewRate(e.target.value)} style={inputStyle} />
            </Field>
          </div>
        )}
        {pricing.freeUpgrade && (
          <div style={{ maxWidth: 320, marginBottom: 10 }}>
            <Field label="Free upgrade approved by" required hint={`${newPlate}'s rate (${fmt(Number(newCar.targetRate))}/day) is higher than this booking's (${fmt(pricing.currentRate)}/day).`}>
              <input value={approvedBy} maxLength={80} placeholder="Manager's name" onChange={(e) => setApprovedBy(e.target.value)} style={inputStyle} />
            </Field>
          </div>
        )}
        {!isMonthly ? (
          <>
            {row(`${booking.plate} — days (swap day not counted)`, `${pricing.oldDays} day${pricing.oldDays === 1 ? "" : "s"} · ${money(pricing.oldRentalShare)}`)}
            {row(`${newPlate} — days (from swap day)`, `${pricing.newDays} day${pricing.newDays === 1 ? "" : "s"}`)}
            {row(pricing.rateAdjustment > 0 ? "Upgrade charge" : pricing.rateAdjustment < 0 ? "Downgrade credit" : "Rate difference", pricing.rateAdjustment === 0 ? "None" : `${money(pricing.rateAdjustment)} + VAT`)}
          </>
        ) : (
          <div style={{ fontSize: 11.5, color: C.textMuted }}>Monthly contract: {rateMode === "new" ? "the new rate applies to every month not yet collected." : "the rent schedule stays as it is."}</div>
        )}
        <div style={{ maxWidth: 240, marginTop: 10 }}>
          <Field label="Swap Fee (optional, SGD)"><input type="number" min="0" value={swapFee} onChange={(e) => setSwapFee(e.target.value)} style={inputStyle} /></Field>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 6 }}>Summary of this change</div>
        {pricing.newCharges.length === 0 && <div style={{ fontSize: 11.5, color: C.textMuted }}>No charges — the price doesn't change.</div>}
        {pricing.newCharges.map((c) => row(c.label, `${money(c.amount)}${c.taxable && Number(booking.vatRate) ? " + VAT" : ""}`))}
        {pricing.newCharges.length > 0 && row(`Total for this change${Number(booking.vatRate) ? ` (incl. ${booking.vatRate}% VAT)` : ""}`, money(pricing.swapTotal), true)}
      </div>

      {pricing.amountDue > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Collect now <span style={{ fontWeight: 500, color: C.textMuted, fontSize: 11.5 }}>— {money(pricing.amountDue)} added to the bill (optional; leave 0 to collect later)</span></div>
          <div style={grid2}>
            <Field label="Amount (SGD)"><input type="number" min="0" value={collect} onChange={(e) => setCollectAmount(e.target.value)} style={inputStyle} /></Field>
            {Number(collect) > 0 && <MethodAndRef method={collectMethod} setMethod={setCollectMethod} reference={collectReference} setReference={setCollectReference} />}
          </div>
        </div>
      )}

      {pricing.refundDue > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Refund the difference <span style={{ fontWeight: 500, color: C.textMuted, fontSize: 11.5 }}>— the customer has now paid {money(pricing.refundDue)} more than the booking costs</span></div>
          <div style={grid2}>
            <Field label="Refund Amount (SGD)"><input type="number" min="0" max={pricing.refundDue} value={refund} onChange={(e) => setRefundAmount(e.target.value)} style={inputStyle} /></Field>
            {Number(refund) > 0 && <MethodAndRef method={refundMethod} setMethod={setRefundMethod} reference={refundReference} setReference={setRefundReference} />}
          </div>
        </div>
      )}

      <div style={sectionStyle}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Security deposit <span style={{ fontWeight: 500, color: C.textMuted, fontSize: 11.5 }}>— stays at {money(Number(booking.deductible) || 0)}; add a top-up if needed</span></div>
        <div style={grid2}>
          <Field label="Top-up Amount (optional, SGD)"><input type="number" min="0" value={depositTopUp} onChange={(e) => setDepositTopUp(e.target.value)} style={inputStyle} /></Field>
          {Number(depositTopUp) > 0 && <MethodAndRef method={depositTopUpMethod} setMethod={setDepositTopUpMethod} reference={depositTopUpReference} setReference={setDepositTopUpReference} />}
        </div>
      </div>
    </>
  );

  return shell(
    <>
      {stepper}
      {[stepReturn, stepNewCar, stepPrice][step]}
      {error && <div style={{ marginTop: 6, padding: "9px 12px", borderRadius: 8, background: C.redFaint, color: C.red, fontSize: 12, fontWeight: 600 }}>{error}</div>}
    </>,
    <>
      <Btn secondary onClick={step === 0 ? onClose : () => { setError(""); setStep(step - 1); }}>{step === 0 ? "Cancel" : "← Back"}</Btn>
      {step < STEPS.length - 1
        ? <Btn primary onClick={next}>Next →</Btn>
        : <Btn primary disabled={saving} onClick={save} style={saving ? { opacity: 0.6 } : undefined}>{saving ? "Saving…" : "Confirm Change Car"}</Btn>}
    </>
  );
}
