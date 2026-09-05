// Mileage accounting for a rental, in one place. Lives on its own (rather than
// in Booking.jsx) so the booking views, the New Booking wizard and the invoice
// PDF can all share it without importing each other.

// ── MILEAGE SPLIT ────────────────────────────────────────────────────────────
// Four readings tell a rental's whole odometer story:
//   A · startingMileage        odometer at the company/shed when the key leaves
//   S · staffToCustomerKm      km staff drives delivering the car to the customer
//   B · customerReturnMileage  odometer when the CUSTOMER hands the car back
//   C · mileageIn              final odometer after staff drives it back to the company
// The customer only owns the middle leg. Both staff legs — the delivery out (S)
// and the drive-back (B->C) — are company/internal km and are never charged to
// the customer. Single source of truth: the handover form, the return form, the
// Distance Driven panel and the audit trail all read the split from here.
export const computeMileageSplit = ({ startingMileage, staffToCustomerKm, customerReturnMileage, mileageIn } = {}) => {
  const num = (v) => (v === "" || v === null || v === undefined || isNaN(Number(v)) ? 0 : Number(v));
  const a = num(startingMileage);
  const s = num(staffToCustomerKm);
  const c = num(mileageIn);
  // Blank B means the customer returned the car directly — no drive-back leg.
  const b = customerReturnMileage === "" || customerReturnMileage === null || customerReturnMileage === undefined
    ? c
    : num(customerReturnMileage);
  const staffBackKm = Math.max(0, c - b);
  const customerKm = Math.max(0, b - (a + s));
  const staffKm = s + staffBackKm;
  // Total is the sum of the two legs rather than C - A, so the three figures
  // always reconcile even if a reading is entered out of order.
  return { a, s, b, c, staffBackKm, customerKm, staffKm, totalKm: customerKm + staffKm };
};
