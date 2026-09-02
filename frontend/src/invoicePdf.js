// Generates the downloadable Invoice PDF for a booking, laid out to match
// the reference receipt design (header/logo block, RECEIPT title, Vehicle
// Details, Rental Schedule, Customer Details, Charges table, payment
// footer). Called from Booking.jsx's "🧾 Invoice" button, which is only
// enabled once the vehicle has been marked as returned.
//
// Requires the `jspdf` package: npm install jspdf

import { jsPDF } from "jspdf";
import { INVOICE_LOGO_DATA_URI, INVOICE_LOGO_ASPECT } from "./invoiceLogo";

// Letterhead shown on every generated Invoice — this is YOUR company's
// details, not read from booking data. Update to match your business before
// shipping; nothing else in this file needs to change.
const COMPANY_INFO = {
  name: "RDK Trading Pte Ltd",
  legalName: "RDK Trading Pte. Ltd.",
  addressLines: ["22 UB. HBE, Singapore 408830"],
  uen: "202416072K",
  email: "RDKtrading1995@gmail.com",
  phone: "84605545",
  bank: "DBS Current: 0721375478",
  paynow: "PayNow UEN: 202416072K",
};

const pad2 = (n) => String(n).padStart(2, "0");

// Rental Schedule dates use DD/MM/YYYY (slashes), matching the reference.
const fmtDateSlash = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return "—";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const pad3 = (n) => String(n).padStart(3, "0");

const fmtTime12h = (hhmm) => {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${period}`;
};

const money = (n) => `SGD ${(Number(n) || 0).toFixed(2)}`;

// Auto Receipt/Reference Number in the shape "20260829001" — the issue date
// (YYYYMMDD) plus a 3-digit sequence that resets to 001 each day. The next
// sequence is derived by scanning the receipt numbers already assigned to
// other bookings for the same day, so numbers stay contiguous and never
// collide. Callers persist the returned value onto the booking so it becomes
// permanent (see ensureReceiptNumber in Booking.jsx) — this must be called
// only when actually issuing a new number, not on every re-render.
export const nextReceiptNumber = (bookings = [], when = new Date()) => {
  const prefix = `${when.getFullYear()}${pad2(when.getMonth() + 1)}${pad2(when.getDate())}`;
  let maxSeq = 0;
  for (const b of bookings) {
    const rn = b && b.receiptNumber;
    if (typeof rn === "string" && rn.length === 11 && rn.startsWith(prefix)) {
      const seq = parseInt(rn.slice(8), 10);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  return `${prefix}${pad3(maxSeq + 1)}`;
};

export const generateInvoicePdf = (booking, car, inv) => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 15;
  const contentWidth = pageWidth - marginX * 2;
  // A4 printable bottom edge. Any row/header that would cross this starts a new
  // page and continues at the top margin, so nothing is clipped off the page.
  const bottomLimit = pageHeight - 14;
  const topY = 16;
  const navy = [15, 23, 42];
  const slate = [71, 85, 105];
  const blue = [37, 99, 235];

  // Draws one bordered row split into the given cells, returns the y just
  // below the row so callers can chain `y = cellRow(...)`.
  const cellRow = (y, cells, height = 7) => {
    // If this row can't fit on the current page, continue on the next one so the
    // Charges table (and its Subtotal/Total rows) is never cut off at the bottom.
    if (y + height > bottomLimit) { doc.addPage(); y = topY; }
    let x = marginX;
    cells.forEach((cell) => {
      doc.setDrawColor(15, 23, 42);
      doc.rect(x, y, cell.w, height);
      doc.setFont("helvetica", cell.bold ? "bold" : "normal");
      doc.setFontSize(cell.size || 9);
      const [r, g, b] = cell.color || navy;
      doc.setTextColor(r, g, b);
      const align = cell.align || "left";
      const tx = align === "center" ? x + cell.w / 2 : x + 3;
      doc.text(String(cell.text ?? ""), tx, y + height / 2 + 1.3, { align, maxWidth: cell.w - 4 });
      x += cell.w;
    });
    return y + height;
  };

  const sectionHeader = (y, title) => {
    // Keep a section title with the row(s) that follow — don't strand it at the
    // very bottom of a page.
    if (y + 16 > bottomLimit) { doc.addPage(); y = topY; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...navy);
    doc.text(title, pageWidth / 2, y, { align: "center" });
    return y + 7;
  };

  let y = 16;

  // --- Header: RDK logo (left) + company address/contact (right) ---
  // The logo is embedded as a base64 PNG (invoiceLogo.js) so this synchronous
  // generator can draw it directly, with no async image loading. It already
  // carries the company name, so no separate name line is printed. Height
  // follows the logo's real aspect ratio to avoid distortion.
  const logoW = 38;
  const logoH = logoW / INVOICE_LOGO_ASPECT;
  doc.addImage(INVOICE_LOGO_DATA_URI, "PNG", marginX, y - 4, logoW, logoH);

  const textX = marginX + logoW + 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...slate);
  let ay = y;

  // First address line is merged with the legal name on one line.
  doc.text(`${COMPANY_INFO.legalName}, ${COMPANY_INFO.addressLines[0]}`, textX, ay);
  ay += 4;

  // Any additional address lines (index 1+) render automatically here.
  COMPANY_INFO.addressLines.slice(1).forEach((line) => {
    doc.text(line, textX, ay);
    ay += 4;
  });

  doc.text(`UEN: ${COMPANY_INFO.uen}`, textX, ay); ay += 4;
  doc.setTextColor(...blue);
  doc.text(`Email: ${COMPANY_INFO.email}`, textX, ay); ay += 4;
  doc.setTextColor(...slate);
  doc.text(`Mobile/Whatsapp: ${COMPANY_INFO.phone}`, textX, ay);

  // Advance past whichever is taller — the logo or the contact block.
  y = Math.max(y - 4 + logoH, ay) + 6;

  // --- RECEIPT title ---
  y = sectionHeader(y, "RECEIPT");
  y += 1;

  // The invoice never shows the generated/downloaded date & time — only the
  // Receipt Number is printed (dates come from the booking lifecycle: the
  // frozen pickup and the actual return recorded at Vehicle Return). The
  // number is the permanent one assigned to the booking; nextReceiptNumber is
  // the last-resort fallback for any legacy booking that never got one.
  const receiptNo = booking.receiptNumber || nextReceiptNumber([], new Date());
  y = cellRow(y, [
    { w: contentWidth * 0.22, text: "Receipt Number", bold: true },
    { w: contentWidth * 0.78, text: receiptNo },
  ]);
  y += 4;

  // --- Vehicle Details ---
  y = sectionHeader(y, "Vehicle Details");
  y += 1;
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "Vehicle Registration Number", bold: true },
    { w: contentWidth * 0.6, text: booking.plate || "—" },
  ]);
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "Vehicle Make & Model", bold: true },
    { w: contentWidth * 0.6, text: car?.model || "—" },
  ]);
  const startMileage = booking.startingMileage;
  const returnMileage = booking.mileageIn;
  const kmDriven = (startMileage !== undefined && startMileage !== null && startMileage !== "" &&
    returnMileage !== undefined && returnMileage !== null && returnMileage !== "")
    ? Math.max(0, Number(returnMileage) - Number(startMileage))
    : null;
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "Starting Mileage", bold: true },
    { w: contentWidth * 0.6, text: startMileage !== undefined && startMileage !== null && startMileage !== "" ? `${startMileage} km` : "—" },
  ]);
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "Return Mileage", bold: true },
    { w: contentWidth * 0.6, text: returnMileage !== undefined && returnMileage !== null && returnMileage !== "" ? `${returnMileage} km` : "—" },
  ]);
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "No. of KMs", bold: true },
    { w: contentWidth * 0.6, text: kmDriven !== null ? `${kmDriven} km` : "—" },
  ]);
  y += 4;

  // --- Rental Schedule ---
  y = sectionHeader(y, "Rental Schedule");
  y += 1;
  // The invoice ALWAYS shows the original Pick-up date/time from the initial
  // booking — it must never change when the booking is edited or extended.
  // originalPickupDate/Time are frozen at creation; older bookings without them
  // fall back to the current pickupDate/pickupTime, and finally to the date/time
  // parts of `start` (booking.start = "YYYY-MM-DDTHH:MM") so the Pick-up Time is
  // always shown even when the separate pickupTime field wasn't stored.
  const [startDatePart, startTimePart] = (booking.start || "").split("T");
  const pickupDateEffective = booking.originalPickupDate || booking.pickupDate || startDatePart || "";
  const pickupTimeEffective = booking.originalPickupTime || booking.pickupTime || (startTimePart ? startTimePart.slice(0, 5) : "");

  // Once the vehicle has actually been returned, actualReturnAt ("YYYY-MM-DDTHH:MM")
  // reflects the real return date/time — possibly edited for an early or late
  // return — and takes over the Drop-off column from the originally planned
  // returnDate/returnTime.
  const [actualReturnDatePart, actualReturnTimePart] = booking.actualReturnAt
    ? booking.actualReturnAt.split("T")
    : [null, null];
  const dropDate = actualReturnDatePart || booking.returnDate;
  const dropTime = actualReturnTimePart || booking.returnTime;
  const col0 = contentWidth * 0.25, col1 = contentWidth * 0.375, col2 = contentWidth * 0.375;
  y = cellRow(y, [
    { w: col0, text: "" },
    { w: col1, text: "Pick-up Details", bold: true, align: "center" },
    { w: col2, text: "Drop-off Details", bold: true, align: "center" },
  ]);
  y = cellRow(y, [
    { w: col0, text: "Date", bold: true },
    { w: col1, text: fmtDateSlash(pickupDateEffective), align: "center" },
    { w: col2, text: fmtDateSlash(dropDate), align: "center" },
  ]);
  y = cellRow(y, [
    { w: col0, text: "Time", bold: true },
    { w: col1, text: fmtTime12h(pickupTimeEffective), align: "center" },
    { w: col2, text: fmtTime12h(dropTime), align: "center" },
  ]);
  y = cellRow(y, [
    { w: col0, text: "Location", bold: true },
    { w: col1, text: booking.originalPickup || booking.pickup || "—", align: "center" },
    { w: col2, text: booking.drop || "—", align: "center" },
  ]);
  y += 4;

  // --- Customer Details ---
  y = sectionHeader(y, "Customer Details");
  y += 1;
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "Name", bold: true },
    { w: contentWidth * 0.6, text: booking.customer || "—" },
  ]);
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "Contact Number", bold: true },
    { w: contentWidth * 0.6, text: booking.contact || "—" },
  ]);
  y = cellRow(y, [
    { w: contentWidth * 0.4, text: "NRIC/Passport", bold: true },
    { w: contentWidth * 0.6, text: booking.passport || booking.ic || "—" },
  ]);
  y += 4;

  // --- Charges ---
  y = sectionHeader(y, "Charges");
  y += 1;
  const chargeRows = [
    ["Rental Vehicle Charges for Rental Period", inv.rateCharge],
    ["Delivery Charge", inv.deliveryCharge],
    ["Collection Charge", inv.collectionCharge],
    ["Additional Named Driver", inv.additionalDriverCharge],
    ["Others", inv.otherCharges],
  ];
  // Any charges added later (Charges & Payment tab) get their own rows too,
  // so the Invoice always reflects the full finalInvoiceTotal below.
  (inv.charges || []).forEach((c) => chargeRows.push([c.label, Number(c.amount) || 0]));

  chargeRows.forEach(([label, amt]) => {
    y = cellRow(y, [
      { w: contentWidth * 0.7, text: label },
      { w: contentWidth * 0.3, text: amt > 0 ? money(amt) : "", align: "center" },
    ]);
  });
  // Security Deposit (Refundable) — its own charge line immediately after the
  // other charges, then rolled into the Total below. It's collected alongside the
  // rental and returned at the end, so its collected portion is added into
  // Payments Collected, which keeps the Balance Due correct.
  const deposit = Number(inv.deposit) || 0;
  const depositPaid = Number(booking.depositPaid) || 0;
  if (deposit > 0) {
    y = cellRow(y, [
      { w: contentWidth * 0.7, text: "Security Deposit (Refundable)" },
      { w: contentWidth * 0.3, text: money(deposit), align: "center" },
    ]);
  }

  // Subtotal → VAT → Total → Payments Collected → Balance Due. The Total now
  // includes the Security Deposit; VAT is unchanged (the refundable deposit is
  // not taxed); Subtotal is derived as Total − VAT so it always reconciles
  // regardless of the taxable/non-taxable charge mix.
  const grandTotal = (Number(inv.finalInvoiceTotal) || 0) + deposit;
  const grandPaid = (Number(inv.totalPaid) || 0) + depositPaid;
  const grandBalance = Math.max(0, grandTotal - grandPaid);
  const invSubtotal = grandTotal - (Number(inv.finalVatAmount) || 0);
  y = cellRow(y, [
    { w: contentWidth * 0.7, text: "Subtotal", bold: true },
    { w: contentWidth * 0.3, text: money(invSubtotal), align: "center" },
  ]);
  y = cellRow(y, [
    { w: contentWidth * 0.7, text: `VAT (${inv.vatPct || 0}%)` },
    { w: contentWidth * 0.3, text: money(inv.finalVatAmount), align: "center" },
  ]);
  y = cellRow(y, [
    { w: contentWidth * 0.7, text: "Total", bold: true },
    { w: contentWidth * 0.3, text: money(grandTotal), bold: true, align: "center" },
  ], 8);
  y = cellRow(y, [
    { w: contentWidth * 0.7, text: "Payments Collected" },
    { w: contentWidth * 0.3, text: grandPaid > 0 ? `- ${money(grandPaid)}` : money(0), align: "center" },
  ]);
  y = cellRow(y, [
    { w: contentWidth * 0.7, text: "Balance Due", bold: true },
    { w: contentWidth * 0.3, text: money(grandBalance), bold: true, align: "center" },
  ], 8);
  y += 6;

  // --- Payment footer ---
  // Keep the whole footer block together on the page rather than clipping it —
  // but allow it to use the page's lower margin (it's the last, short block) so a
  // one-page invoice isn't pushed onto a second page just for the footer.
  if (y + 12 > pageHeight - 8) { doc.addPage(); y = topY; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...navy);
  doc.text("Make Payment to:", marginX, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...slate);
  doc.text(COMPANY_INFO.bank, marginX, y);
  doc.text(COMPANY_INFO.paynow, marginX + contentWidth * 0.5, y);

  doc.save(`Invoice_${booking.id || "booking"}.pdf`);
};