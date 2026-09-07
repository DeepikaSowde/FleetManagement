import { useState, useMemo } from "react";
import {
  C, mono, fmt, totalInv, daysUntil, generateTargetOptions,
  purchaseAfterCoe, PURCHASE_AFTER_COE_MESSAGE,
} from "./theme";
import { Btn, Input } from "./components";
import { Combobox, SelectField, ComplianceField, buildBrandModelMap } from "./AddCarWizard";

/* =====================================================================================
   EDIT VEHICLE
   -------------------------------------------------------------------------------------
   The Add Car wizard's form, pre-filled with one vehicle and shown in one pass
   instead of five steps — the same field components, labels, grids and section
   order, because someone editing a car should recognise the form they filled in
   when they added it. Stepping through five screens to change one date would be
   the wrong shape for an edit.

   Two dates drive everything downstream, so both are editable here and the
   figures recompute as you type:

     Purchase Date  moves the start of the runway, so the CAGR compounding
                    period, Future Value and the daily rate all change.
     COE Expiry     moves the end of it, so Target Rate, Running Days Target
                    and Target Profit all change.

   The recalculated tiers are shown live with the vehicle's current tier
   preselected, and anything that moved is called out against its old value —
   an edit that silently rewrites a target would be worse than one that
   refuses to.
   ===================================================================================== */

const SECTION = { fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8, marginTop: 16 };
const GRID = (min = 170) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 10 });
const req = <span style={{ color: C.red }}>*</span>;

// Money fields are whole numbers, matching the Add Car form.
const wholeNumber = (raw) => (raw === "" ? "" : String(raw).replace(/[^\d]/g, ""));

export default function EditVehicleForm({ car, fleet = [], onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    plate: car.plate,
    make: car.make || "",
    model: car.model || "",
    year: car.year ?? "",
    color: car.color || "",
    fuelType: car.fuelType || "Petrol",
    transmission: car.transmission || "Automatic",
    purchase: car.purchase ?? "",
    purchaseAdvance: car.purchaseAdvance ?? "",
    insurance: car.insurance ?? "",
    reg: car.reg ?? "",
    otherCharges: car.otherCharges ?? "",
    purchaseDate: car.purchaseDate || "",
    insuranceExpiry: car.insuranceExpiry || "",
    ltaTransferDate: car.ltaTransferDate || "",
    roadTaxExpiry: car.roadTaxExpiry || "",
    inspectionExpiry: car.inspectionExpiry || "",
    coe: car.coe || "",
  }));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState("");

  const setField = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
    setSaveError("");
  };
  const setMoney = (k) => (e) => setField(k, wholeNumber(e.target.value));

  // Brand/model suggestions come from the rest of the fleet, exactly as on Add Car.
  const brandModelMap = useMemo(() => buildBrandModelMap(fleet), [fleet]);
  const brandOptions = Object.keys(brandModelMap);
  const modelOptions = brandModelMap[form.make] || [];

  // An EV has no manual gearbox — same rule as the Add Car form.
  const handleFuelTypeChange = (value) => {
    setForm((f) => ({ ...f, fuelType: value, transmission: value === "EV" ? "Automatic" : f.transmission }));
    setErrors((e) => ({ ...e, fuelType: undefined, transmission: undefined }));
  };

  const investment = useMemo(() => totalInv({
    purchase: parseFloat(form.purchase) || 0,
    purchaseAdvance: parseFloat(form.purchaseAdvance) || 0,
    insurance: parseFloat(form.insurance) || 0,
    reg: parseFloat(form.reg) || 0,
    otherCharges: parseFloat(form.otherCharges) || 0,
  }), [form.purchase, form.purchaseAdvance, form.insurance, form.reg, form.otherCharges]);

  const datesConflict = purchaseAfterCoe({ purchaseDate: form.purchaseDate, coe: form.coe });

  // ── Live recalculation ────────────────────────────────────────────────────
  // Recomputed from the edited dates and investment, not from what was stored,
  // so the figures on screen are always the ones a save would write.
  const options = useMemo(() => {
    if (!form.coe || !form.purchaseDate || datesConflict || investment <= 0) return null;
    return generateTargetOptions({ investment, purchaseDate: form.purchaseDate, coe: form.coe });
  }, [investment, form.purchaseDate, form.coe, datesConflict]);

  // The tier the vehicle is already on, identified by its running-days target —
  // that is what distinguishes the three tiers from one another.
  const [tierLabel, setTierLabel] = useState(() => {
    const initial = generateTargetOptions({
      investment: totalInv(car), purchaseDate: car.purchaseDate, coe: car.coe,
    });
    const match = initial.find((o) => Number(o.runningDays) === Number(car.runningDaysTarget));
    return (match || initial[1]).label;
  });
  const chosen = options ? options.find((o) => o.label === tierLabel) || options[1] : null;

  const changed = (next, prev) =>
    next !== null && next !== undefined && prev !== null && prev !== undefined &&
    Math.abs(Number(next) - Number(prev)) > 0.01;

  const datesMoved = form.purchaseDate !== (car.purchaseDate || "") || form.coe !== (car.coe || "");

  // ── Validation ────────────────────────────────────────────────────────────
  const validate = () => {
    const e = {};
    if (!String(form.make).trim()) e.make = "Brand is required";
    if (!String(form.model).trim()) e.model = "Model is required";
    if (!form.year || Number(form.year) <= 0) e.year = "Enter a valid year";
    if (!String(form.color).trim()) e.color = "Colour is required";
    if (!String(form.fuelType).trim()) e.fuelType = "Fuel Type is required";
    if (!String(form.transmission).trim()) e.transmission = "Transmission is required";

    if (String(form.purchase).trim() === "" || Number(form.purchase) <= 0) {
      e.purchase = "Purchase Price must be greater than 0";
    } else if (!Number.isInteger(Number(form.purchase))) {
      e.purchase = "Purchase Price must be a whole number";
    }
    [["purchaseAdvance", "Purchase Advance"], ["insurance", "Insurance"], ["reg", "Registration"], ["otherCharges", "Other Charges"]]
      .forEach(([k, l]) => {
        if (String(form[k]).trim() === "") return;
        if (Number(form[k]) < 0) e[k] = `${l} can't be negative`;
        else if (!Number.isInteger(Number(form[k]))) e[k] = `${l} must be a whole number`;
      });
    if (String(form.purchase).trim() !== "" && String(form.purchaseAdvance).trim() !== "" &&
        Number(form.purchaseAdvance) > Number(form.purchase)) {
      e.purchaseAdvance = "Advance can't exceed Purchase Price";
    }

    if (!form.purchaseDate) e.purchaseDate = "Purchase Date is required";
    if (!form.coe) e.coe = "COE Expiry Date is required";
    return e;
  };

  const handleSave = () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      setSaveError("Fix the highlighted fields before saving.");
      return;
    }
    if (datesConflict) {
      setSaveError(`${PURCHASE_AFTER_COE_MESSAGE}.`);
      return;
    }
    if (!chosen) {
      setSaveError("The target figures can't be worked out from these dates and amounts.");
      return;
    }

    onSave(car.plate, {
      make: form.make.trim(),
      model: form.model.trim(),
      year: parseInt(form.year, 10),
      color: form.color.trim(),
      fuelType: form.fuelType,
      transmission: form.transmission,
      purchase: parseFloat(form.purchase) || 0,
      purchaseAdvance: parseFloat(form.purchaseAdvance) || 0,
      insurance: parseFloat(form.insurance) || 0,
      reg: parseFloat(form.reg) || 0,
      otherCharges: parseFloat(form.otherCharges) || 0,
      purchaseDate: form.purchaseDate,
      insuranceExpiry: form.insuranceExpiry || null,
      ltaTransferDate: form.ltaTransferDate || null,
      roadTaxExpiry: form.roadTaxExpiry || null,
      inspectionExpiry: form.inspectionExpiry || null,
      coe: form.coe,
      // Recalculated from the edited dates — this is the whole point of
      // letting those two dates be changed.
      targetRate: chosen.rate,
      runningDaysTarget: chosen.runningDays,
      profitPctTarget: chosen.profitPct,
    });
  };

  const Was = ({ from, to, format = (v) => v }) =>
    changed(to, from) ? (
      <span style={{ fontSize: 9.5, color: C.amber, fontWeight: 600, marginLeft: 6 }}>was {format(from)}</span>
    ) : null;

  const coeDays = form.coe ? daysUntil(form.coe) : null;

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: C.surface, borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", zIndex: 201, width: "min(720px, calc(100vw - 24px))", maxHeight: "90vh", overflowY: "auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Edit Vehicle</div>
            <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>
              {car.plate} · {car.make} {car.model}
            </div>
          </div>
          <div onClick={onCancel} style={{ cursor: "pointer", fontSize: 18, color: C.textMuted }}>✕</div>
        </div>

        <div style={{ padding: "6px 24px 14px" }}>

          {/* ── Purchase & Vehicle Details ── */}
          <div style={SECTION}>Purchase & Vehicle Details</div>
          <div style={GRID()}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: C.textPri }}>Car Plate</label>
              <div style={{ padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: C.linen, color: C.textMuted, ...mono }}>
                {form.plate}
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
                The plate identifies this vehicle across bookings, earnings and expenses, so it can't be changed here.
              </div>
            </div>
            <Input label={<>Year {req}</>} type="number" value={form.year}
              onChange={(e) => setField("year", e.target.value)} error={errors.year} />
          </div>

          <div style={{ ...GRID(), marginTop: 6 }}>
            <Combobox label={<>Brand {req}</>} listId="edit-brand-options" value={form.make}
              onChange={(e) => {
                const value = e.target.value;
                setForm((f) => ({ ...f, make: value, model: brandModelMap[value]?.includes(f.model) ? f.model : "" }));
                setErrors((er) => ({ ...er, make: undefined, model: undefined }));
              }}
              options={brandOptions} placeholder="e.g., Toyota" error={errors.make} />
            <Combobox label={<>Model {req}</>} listId="edit-model-options" value={form.model}
              onChange={(e) => setField("model", e.target.value)}
              options={modelOptions} placeholder="e.g., Corolla" error={errors.model} />
          </div>

          <div style={{ ...GRID(150), marginTop: 6 }}>
            <Input label={<>Colour {req}</>} value={form.color}
              onChange={(e) => setField("color", e.target.value)} error={errors.color} />
            <SelectField label={<>Fuel Type {req}</>} value={form.fuelType}
              onChange={(e) => handleFuelTypeChange(e.target.value)}
              options={["Petrol", "Diesel", "EV"]} error={errors.fuelType} />
            <SelectField label={<>Transmission {req}</>} value={form.transmission}
              onChange={(e) => setField("transmission", e.target.value)}
              options={form.fuelType === "EV" ? ["Automatic"] : ["Automatic", "Manual"]} error={errors.transmission} />
          </div>

          <div style={{ ...GRID(), marginTop: 6 }}>
            <Input label={<>Purchase Price (SGD) {req}</>} type="number" min="0" step="1"
              value={form.purchase} onChange={setMoney("purchase")} error={errors.purchase} />
            <Input label="Purchase Advance (SGD)" type="number" min="0" step="1"
              value={form.purchaseAdvance} onChange={setMoney("purchaseAdvance")} error={errors.purchaseAdvance} />
          </div>
          <div style={{ ...GRID(), marginTop: 6 }}>
            <Input label="Insurance (SGD)" type="number" min="0" step="1"
              value={form.insurance} onChange={setMoney("insurance")} error={errors.insurance} />
            <Input label="Registration (SGD)" type="number" min="0" step="1"
              value={form.reg} onChange={setMoney("reg")} error={errors.reg} />
          </div>
          <div style={{ ...GRID(), marginTop: 6 }}>
            <Input label="Other Charges (SGD)" type="number" min="0" step="1"
              value={form.otherCharges} onChange={setMoney("otherCharges")} error={errors.otherCharges} />
            <div>
              <Input label={<>Purchase Date {req}</>} type="date" value={form.purchaseDate}
                onChange={(e) => setField("purchaseDate", e.target.value)} error={errors.purchaseDate} />
              {form.purchaseDate !== (car.purchaseDate || "") && (
                <div style={{ fontSize: 10, color: C.amber, fontWeight: 600, marginTop: -10, marginBottom: 8 }}>
                  Was {car.purchaseDate || "—"} — the target figures below have been recalculated.
                </div>
              )}
            </div>
          </div>

          {/* ── Compliance & Validity ── */}
          <div style={SECTION}>Compliance & Validity</div>
          <div style={GRID()}>
            <ComplianceField label="Insurance Expiry" value={form.insuranceExpiry}
              onChange={(e) => setField("insuranceExpiry", e.target.value)} />
            <ComplianceField label="LTA Transfer Validity" value={form.ltaTransferDate}
              onChange={(e) => setField("ltaTransferDate", e.target.value)} />
          </div>
          <div style={GRID()}>
            <ComplianceField label="Road Tax Expiry" value={form.roadTaxExpiry}
              onChange={(e) => setField("roadTaxExpiry", e.target.value)} />
            <ComplianceField label="Inspection Due" value={form.inspectionExpiry}
              onChange={(e) => setField("inspectionExpiry", e.target.value)} />
          </div>
          {/* Not `blocking`: an existing vehicle may legitimately have an expiry
              already behind it, and refusing to save would leave the record
              stuck. It is flagged, not forbidden. */}
          <ComplianceField label="COE Expiry Date *" value={form.coe}
            onChange={(e) => setField("coe", e.target.value)} />
          {errors.coe && <div style={{ fontSize: 11, color: C.red, marginTop: -6, marginBottom: 8 }}>{errors.coe}</div>}
          {form.coe !== (car.coe || "") && !datesConflict && (
            <div style={{ fontSize: 10, color: C.amber, fontWeight: 600, marginBottom: 8 }}>
              Was {car.coe || "—"} — Target Rate, Running Days and Target Profit have been recalculated below.
            </div>
          )}
          {datesConflict && (
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start", background: C.redFaint, border: `1px solid ${C.red}55`, borderRadius: 6, padding: "8px 10px", marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: C.red }}>⚠</span>
              <span style={{ fontSize: 10.5, color: C.red, fontWeight: 600 }}>
                {PURCHASE_AFTER_COE_MESSAGE}. Purchase date is {form.purchaseDate} — the target
                figures can't be calculated until this is corrected.
              </span>
            </div>
          )}

          {/* ── Total Investment ── */}
          <div style={SECTION}>Total Investment</div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px" }}>
            {[
              ["Purchase Price", form.purchase],
              ["Purchase Advance", form.purchaseAdvance || 0],
              ["Insurance", form.insurance || 0],
              ["Registration", form.reg || 0],
              ["Other Charges", form.otherCharges || 0],
            ].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                <span style={{ color: C.textMuted }}>{l}</span>
                <span style={{ ...mono, fontWeight: 600 }}>{fmt(parseFloat(v) || 0)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0 2px", fontSize: 13, fontWeight: 700 }}>
              <span style={{ color: C.navy }}>Total Investment</span>
              <span style={{ ...mono, color: C.teal, fontSize: 16 }}>
                {fmt(investment)}
                <Was from={totalInv(car)} to={investment} format={(v) => fmt(v)} />
              </span>
            </div>
          </div>

          {/* ── Target & System Suggestions ── */}
          <div style={SECTION}>Target & System Suggestions</div>
          {!options ? (
            <div style={{ fontSize: 11.5, color: C.textMuted, border: `1px dashed ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
              {datesConflict
                ? "Correct the dates above to recalculate the targets."
                : "Enter a purchase price, purchase date and COE expiry to recalculate the targets."}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 10.5, color: C.textMuted, marginBottom: 10 }}>
                Recalculated over the {chosen.yearsToExpiry} year runway from {form.purchaseDate} to {form.coe}
                {coeDays !== null && coeDays < 0 ? " (already expired)" : ""}.
                {datesMoved ? " Changing either date moves every figure here." : ""}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                {options.map((o) => {
                  const isChosen = o.label === chosen.label;
                  return (
                    <div key={o.label} onClick={() => setTierLabel(o.label)}
                      style={{
                        border: `2px solid ${isChosen ? C.teal : C.border}`,
                        background: isChosen ? C.tealFaint : C.surface,
                        borderRadius: 10, padding: 12, cursor: "pointer", textAlign: "center",
                      }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{o.label}</div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: C.tealLight, marginBottom: 8 }}>{o.cagr}% CAGR</div>
                      <div style={{ ...mono, fontSize: 18, fontWeight: 700, color: C.navy }}>SGD {o.rate}</div>
                      <div style={{ fontSize: 9.5, color: C.textMuted, marginBottom: 8 }}>per day</div>
                      <div style={{ fontSize: 11, color: C.textSec, marginBottom: 3 }}>{o.runningDays} days/mo</div>
                      <div style={{ fontSize: 9.5, color: C.textMuted, marginTop: 6 }}>Future Value</div>
                      <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.teal, marginBottom: 3 }}>{fmt(o.futureValue)}</div>
                      <div style={{ ...mono, fontSize: 13, fontWeight: 700, color: o.profitPct >= 0 ? C.green : C.red }}>{o.profitPct}% profit</div>
                    </div>
                  );
                })}
              </div>

              {/* What will actually be written, against what is stored now. */}
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", marginTop: 10 }}>
                {[
                  ["Target Rate", `SGD ${chosen.rate}/day`, car.targetRate != null ? `SGD ${Math.round(car.targetRate)}/day` : null, chosen.rate, car.targetRate],
                  ["Running Days Target", `${chosen.runningDays} days/month`, car.runningDaysTarget != null ? `${Math.round(car.runningDaysTarget)} days/month` : null, chosen.runningDays, car.runningDaysTarget],
                  ["Target Profit", `${chosen.profitPct}%`, car.profitPctTarget != null ? `${Math.round(car.profitPctTarget * 10) / 10}%` : null, chosen.profitPct, car.profitPctTarget],
                  ["Future Value", fmt(chosen.futureValue), null, null, null],
                  ["Target CAGR", `${chosen.cagr}%`, null, null, null],
                  ["Expected Monthly Income", fmt(chosen.monthlyIncome), null, null, null],
                ].map(([l, v, wasLabel, nextNum, prevNum]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                    <span style={{ color: C.textMuted }}>{l}</span>
                    <span style={{ fontWeight: 600, color: C.navy }}>
                      {v}
                      {wasLabel && changed(nextNum, prevNum) && (
                        <span style={{ fontSize: 9.5, color: C.amber, fontWeight: 600, marginLeft: 6 }}>was {wasLabel}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {saveError && (
            <div style={{ background: C.redFaint, color: C.red, fontSize: 12, fontWeight: 600, padding: "9px 12px", borderRadius: 8, marginTop: 12 }}>
              {saveError}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "16px 24px", borderTop: `1px solid ${C.border}` }}>
          <Btn secondary onClick={onCancel}>Cancel</Btn>
          <Btn primary onClick={handleSave} disabled={datesConflict} style={{ opacity: datesConflict ? 0.5 : 1 }}>
            Update Vehicle
          </Btn>
        </div>
      </div>
    </>
  );
}
