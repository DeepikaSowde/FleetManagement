// Change Car — the pricing and the save payload for swapping the car on a
// booking that's out with the customer. Pure functions, so the Change Car
// screen can show the exact figures before anything is saved; the server
// (bookingModel.changeCar) re-checks availability and writes it all in one
// transaction.
//
// Agreed rules:
//  • Days: the old car isn't counted on the swap day, the new car is — so the
//    old car gets (swap date − its start date) days and the new car (end date
//    − swap date) days, which add up to the booking's days.
//  • Rate: staff choose "same rate" (the price doesn't change) or "new car's
//    rate" (the new car's remaining days are re-priced at its rate). The
//    difference is an upgrade charge (collected at the swap) or a downgrade
//    credit (refunded if already paid). Same rate onto a dearer car is a free
//    upgrade and needs an approver's name.
//  • Old car's fuel / mileage / damage charges and an optional swap fee are
//    charged at the swap.
//  • Deposit stays; an optional top-up can be collected. Nothing is refunded
//    from the deposit mid-booking.
import { computeBookingInvoice, computeCarEarningSplit, calendarDaysBetween } from "./useFleetData";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Whole calendar days by date part — the swap-day rule above. Lives in
// useFleetData so Car History, earnings and reports count days the same way.
export { calendarDaysBetween };

// Charges the old car can pick up when it comes back at a swap. Same values
// and tax treatment as Booking.jsx's CHARGE_TYPES, plus excess mileage
// (listed here rather than imported, since Booking.jsx imports this module).
export const SWAP_CHARGE_TYPES = [
  { value: "fuel_shortfall", label: "Fuel Shortfall", taxable: true },
  { value: "mileage_charge", label: "Excess Mileage", taxable: true },
  { value: "damage_fee", label: "Damage Fee", taxable: true },
  { value: "cleaning_fee", label: "Cleaning Fee", taxable: true },
  { value: "parking_fine", label: "Parking Fine", taxable: false },
  { value: "traffic_fine", label: "Traffic Fine", taxable: false },
  { value: "other_taxable", label: "Other (Taxable)", taxable: true },
  { value: "other_non_taxable", label: "Other (Non-Taxable)", taxable: false },
];

// What the current car's stretch of the booking is worth before the swap:
// the agreed rental (plus earlier swap rate differences) less what earlier
// cars on this booking already took. For a booking that never changed car,
// that's simply its rental amount.
const currentCarRentalValue = (b) => {
  const split = computeCarEarningSplit(b);
  if (!split) return computeBookingInvoice(b).rateCharge;
  return split[split.length - 1].total;
};

// The full swap picture for the screen and the save:
//   { isMonthly, oldDays, newDays, oldRentalShare, rateAdjustment, newCharges,
//     amountDue, refundDue, freeUpgrade, currentRate, newRate, rentSchedule }
// amountDue / refundDue include VAT: amountDue is what the swap adds to the
// bill (to collect now or later); refundDue is how much the customer has now
// overpaid, when the swap lowered the price below what they've already paid.
export const computeSwapPricing = ({ booking: b, newCar, swapAt, rateMode, newRate, swapFee, oldCarCharges = [], actor = "System" }) => {
  const isMonthly = b.rentalType === "monthly";
  const curFrom = b.currentCarFrom || b.start;
  const oldDays = calendarDaysBetween(curFrom, swapAt);
  const newDays = calendarDaysBetween(swapAt, b.end);
  const currentRate = Number(b.rate) || 0;
  const rateForNew = rateMode === "new" ? Number(newRate) || 0 : currentRate;
  const vatPct = Number(b.vatRate) || 0;
  const at = new Date().toISOString();
  const stamp = (i) => `swap-${Date.now()}-${i}`;

  const newCharges = [];
  let oldRentalShare = null;
  let rateAdjustment = 0;
  let rentSchedule;

  if (isMonthly) {
    // A monthly contract is billed per month from its rent schedule; the new
    // rate applies to the months not yet collected.
    if (rateMode === "new" && Array.isArray(b.rentSchedule)) {
      rentSchedule = b.rentSchedule.map((r) => (r.paid ? r : { ...r, amount: rateForNew }));
    }
  } else {
    const value = currentCarRentalValue(b);
    const totalDays = oldDays + newDays;
    oldRentalShare = round2(totalDays > 0 ? (value * oldDays) / totalDays : 0);
    const sameRest = value - oldRentalShare;
    const newRest = rateMode === "new" ? rateForNew * newDays : sameRest;
    rateAdjustment = round2(newRest - sameRest);
    if (rateAdjustment !== 0) {
      newCharges.push({
        id: stamp("rate"),
        type: rateAdjustment > 0 ? "upgrade" : "downgrade",
        kind: "rate_adjustment",
        // Plain ASCII on purpose: this label is printed on the Invoice and the
        // Vehicle Change Slip, whose PDF font has no arrow glyph.
        label: `Vehicle change ${rateAdjustment > 0 ? "upgrade" : "downgrade"} (${b.plate} to ${newCar?.plate || "new car"}, ${newDays} day${newDays === 1 ? "" : "s"} at ${round2(rateForNew)}/day)`,
        amount: rateAdjustment,
        taxable: true,
        origin: "swap",
        addedAt: at,
        by: actor,
      });
    }
  }

  const fee = Number(swapFee) || 0;
  if (fee > 0) {
    newCharges.push({ id: stamp("fee"), type: "swap_fee", kind: "swap_fee", label: "Vehicle change fee", amount: round2(fee), taxable: true, origin: "swap", addedAt: at, by: actor });
  }
  oldCarCharges.forEach((c, i) => {
    const amt = Number(c.amount) || 0;
    if (amt <= 0) return;
    const t = SWAP_CHARGE_TYPES.find((x) => x.value === c.type) || { label: "Charge", taxable: true };
    newCharges.push({
      id: stamp(`c${i}`), type: c.type, kind: "old_car_charge",
      label: `${t.label} - ${b.plate}${c.note ? ` (${c.note})` : ""}`,
      amount: round2(amt), taxable: t.taxable, origin: "swap", addedAt: at, by: actor,
    });
  });

  const withVat = (c) => (c.taxable ? c.amount * (1 + vatPct / 100) : c.amount);
  const swapTotal = round2(newCharges.reduce((s, c) => s + withVat(c), 0));

  // Overpayment after the swap: what's been paid toward the booking (outside
  // any extension's own payments) beyond what it now costs.
  const after = computeBookingInvoice({ ...b, charges: [...(b.charges || []), ...newCharges] });
  const refundDue = round2(Math.max(0, after.originalPaid - after.preExtensionInvoiceTotal));
  const before = computeBookingInvoice(b);
  const amountDue = round2(Math.max(0, after.balanceDue - before.balanceDue));

  const newCarRate = Number(newCar?.targetRate) || 0;
  const freeUpgrade = !isMonthly && rateMode === "same" && newCarRate > currentRate;

  return {
    isMonthly, oldDays, newDays, currentRate, newRate: rateForNew,
    oldRentalShare, rateAdjustment, newCharges, swapTotal,
    amountDue, refundDue, freeUpgrade, rentSchedule,
  };
};

// The request body for POST /bookings/:id/change-car.
// Every charge and payment made at a swap carries the swap's id (also stored
// on the car-history segment), so the Vehicle Change Slip can list exactly
// what belonged to that swap.
export const buildChangeCarPayload = ({ booking, pricing, form, actor = "System" }) => {
  const at = new Date().toISOString();
  const swapId = `SW-${Date.now()}`;
  const payments = [];
  const collect = Number(form.collectAmount) || 0;
  if (collect > 0) {
    payments.push({ id: `${swapId}-pay`, swapId, amount: round2(collect), method: form.collectMethod, reference: (form.collectReference || "").trim(), addedAt: form.swapAt, origin: "swap", by: actor });
  }
  const refund = Number(form.refundAmount) || 0;
  if (refund > 0) {
    // A refund is a negative payment: it takes the overpaid money back off
    // Total Paid, and the Ledger books it as cash out.
    payments.push({ id: `${swapId}-refund`, swapId, amount: -round2(refund), method: form.refundMethod, reference: (form.refundReference || "").trim(), addedAt: form.swapAt, origin: "swap-refund", by: actor });
  }
  const topUp = Number(form.depositTopUp) || 0;
  const details = [
    `${booking.plate} → ${form.newPlate}`,
    `Old car odo ${form.oldReturnOdo} km, fuel ${form.oldReturnFuel}`,
    `New car odo ${form.newStartOdo} km, fuel ${form.newStartFuel}`,
    pricing.isMonthly ? null : `${pricing.oldDays} day(s) on ${booking.plate}, ${pricing.newDays} on ${form.newPlate}`,
    form.rateMode === "new" ? `New car's rate ${pricing.newRate}` : "Same rate",
    form.approvedBy ? `Free upgrade approved by ${form.approvedBy.trim()}` : null,
    collect > 0 ? `Collected ${round2(collect)} (${form.collectMethod})` : null,
    refund > 0 ? `Refunded ${round2(refund)} (${form.refundMethod})` : null,
    topUp > 0 ? `Deposit top-up ${round2(topUp)} (${form.depositTopUpMethod})` : null,
    form.reason ? `Reason: ${form.reason.trim()}` : null,
  ].filter(Boolean).join(" · ");
  return {
    swapId,
    newPlate: form.newPlate,
    swapAt: form.swapAt,
    oldReturnOdo: form.oldReturnOdo,
    oldReturnFuel: form.oldReturnFuel,
    newStartOdo: form.newStartOdo,
    newStartFuel: form.newStartFuel,
    reason: form.reason,
    approvedBy: pricing.freeUpgrade ? form.approvedBy : "",
    rateMode: form.rateMode,
    newRate: pricing.newRate,
    oldDays: pricing.oldDays,
    oldRentalShare: pricing.oldRentalShare,
    charges: pricing.newCharges.map((c) => ({ ...c, swapId })),
    payments,
    depositTopUp: topUp,
    depositTopUpMethod: topUp > 0 ? form.depositTopUpMethod : undefined,
    depositTopUpReference: topUp > 0 ? (form.depositTopUpReference || "").trim() : undefined,
    rentSchedule: pricing.rentSchedule,
    historyEntry: { id: `h-${Date.now()}-swap`, type: "car_changed", at, by: actor, detail: details },
  };
};
