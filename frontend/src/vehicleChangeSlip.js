// Vehicle Change Slip — a one-page PDF recording one Change Car on a booking:
// the car returned (readings at return), the car handed over (readings at
// handover), the days/rate each car carries, and whatever was charged,
// collected or refunded at that swap. Downloadable from the booking's car
// history any time after the swap; no signature step.
import { jsPDF } from "jspdf";
import { INVOICE_LOGO_DATA_URI, INVOICE_LOGO_ASPECT } from "./invoiceLogo";
import { COMPANY_INFO } from "./invoicePdf";

const money = (n) => `SGD ${(Number(n) || 0).toFixed(2)}`;
const pad2 = (n) => String(n).padStart(2, "0");
// Booking datetimes are naive "YYYY-MM-DDTHH:MM" strings — printed as stored,
// never shifted through a timezone.
const fmtDateTime = (v) => {
  if (!v) return "—";
  const [d, t] = String(v).split("T");
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return String(v);
  if (!t) return `${day}/${m}/${y}`;
  const [h, min] = t.split(":").map(Number);
  return `${day}/${m}/${y} ${h % 12 === 0 ? 12 : h % 12}:${pad2(min || 0)} ${h >= 12 ? "PM" : "AM"}`;
};
const km = (v) => (v === null || v === undefined || v === "" ? "—" : `${Number(v).toLocaleString()} km`);

// `index` is the swap's position in booking.carHistory (the car that was
// returned at it). The car handed over is the next segment — the following
// history entry, or the booking's current car if this was the latest swap.
export const generateVehicleChangeSlip = (booking, index, fleet = []) => {
  const history = booking.carHistory || [];
  const oldSeg = history[index];
  if (!oldSeg) return;
  const next = history[index + 1];
  const newSeg = next
    ? { plate: next.plate, startOdo: (Number(next.startOdo) || 0) + (Number(next.staffKm) || 0), startFuel: next.startFuel, rate: next.rate }
    : { plate: booking.plate, startOdo: booking.startingMileage, startFuel: booking.fuelLevel, rate: booking.rate };
  const carOf = (plate) => fleet.find((c) => c.plate === plate);
  const brandModel = (plate) => [carOf(plate)?.make, carOf(plate)?.model].filter(Boolean).join(" ") || "—";
  const swapCharges = (booking.charges || []).filter((c) => c.swapId && c.swapId === oldSeg.swapId);
  const swapPayments = (booking.payments || []).filter((p) => p.swapId && p.swapId === oldSeg.swapId);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 15;
  const width = 180;
  const navy = [15, 23, 42];
  const slate = [71, 85, 105];
  let y = 16;

  const logoW = 38;
  const logoH = logoW / INVOICE_LOGO_ASPECT;
  doc.addImage(INVOICE_LOGO_DATA_URI, "PNG", marginX, y - 4, logoW, logoH);
  const textX = marginX + logoW + 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...slate);
  let ay = y;
  doc.text(`${COMPANY_INFO.legalName}, ${COMPANY_INFO.addressLines[0]}`, textX, ay); ay += 4;
  doc.text(`UEN: ${COMPANY_INFO.uen}`, textX, ay); ay += 4;
  doc.text(`Email: ${COMPANY_INFO.email}`, textX, ay); ay += 4;
  doc.text(`Mobile/Whatsapp: ${COMPANY_INFO.phone}`, textX, ay);
  y = Math.max(y - 4 + logoH, ay) + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...navy);
  doc.text("VEHICLE CHANGE SLIP", 105, y, { align: "center" });
  y += 8;

  // One bordered row; grows to fit the longest wrapped cell, so a long
  // charge label never runs into the row below.
  const row = (cells) => {
    doc.setFontSize(9);
    const wrapped = cells.map((c) => {
      doc.setFont("helvetica", c.bold ? "bold" : "normal");
      return doc.splitTextToSize(String(c.text ?? ""), c.w - 6);
    });
    const h = Math.max(7, 3 + Math.max(...wrapped.map((l) => l.length)) * 4);
    let x = marginX;
    cells.forEach((c, i) => {
      doc.setDrawColor(...navy);
      if (c.fill) { doc.setFillColor(...c.fill); doc.rect(x, y, c.w, h, "FD"); } else doc.rect(x, y, c.w, h);
      doc.setFont("helvetica", c.bold ? "bold" : "normal");
      doc.setTextColor(...navy);
      doc.text(wrapped[i], x + 3, y + 4.8);
      x += c.w;
    });
    y += h;
  };
  const pair = (label, value) => row([{ w: width * 0.35, text: label, bold: true }, { w: width * 0.65, text: value }]);
  const heading = (t) => { y += 3; row([{ w: width, text: t, bold: true, fill: [241, 245, 249] }]); };

  heading("Booking");
  pair("Booking ID", booking.id);
  pair("Customer", `${booking.customer || "—"}${booking.contact ? ` · ${booking.contact}` : ""}`);
  pair("Changed At", fmtDateTime(oldSeg.to));
  pair("Booking Return Date", fmtDateTime(booking.end));

  heading("Vehicles");
  const col = [width * 0.3, width * 0.35, width * 0.35];
  row([{ w: col[0], text: "" }, { w: col[1], text: "Returned", bold: true }, { w: col[2], text: "Handed Over", bold: true }]);
  row([{ w: col[0], text: "Plate", bold: true }, { w: col[1], text: oldSeg.plate }, { w: col[2], text: newSeg.plate }]);
  row([{ w: col[0], text: "Brand & Model", bold: true }, { w: col[1], text: brandModel(oldSeg.plate) }, { w: col[2], text: brandModel(newSeg.plate) }]);
  row([{ w: col[0], text: "Odometer", bold: true }, { w: col[1], text: km(oldSeg.endOdo) }, { w: col[2], text: km(newSeg.startOdo) }]);
  row([{ w: col[0], text: "Fuel", bold: true }, { w: col[1], text: oldSeg.endFuel || "—" }, { w: col[2], text: newSeg.startFuel || "—" }]);
  const startOdo = (Number(oldSeg.startOdo) || 0) + (Number(oldSeg.staffKm) || 0);
  row([{ w: col[0], text: "Driven on this booking", bold: true }, { w: col[1], text: oldSeg.startOdo === null || oldSeg.startOdo === undefined ? "—" : km(Math.max(0, Number(oldSeg.endOdo) - startOdo)) }, { w: col[2], text: "" }]);

  heading("Rental");
  if (booking.rentalType !== "monthly") {
    pair(`Days on ${oldSeg.plate}`, oldSeg.days === null || oldSeg.days === undefined ? "—" : `${oldSeg.days}`);
    pair(`Rental share for ${oldSeg.plate}`, oldSeg.rentalShare === null || oldSeg.rentalShare === undefined ? "—" : money(oldSeg.rentalShare));
  }
  pair("Rate after change", oldSeg.rateMode === "new" ? `New car's rate — ${money(newSeg.rate)}${booking.rentalType === "monthly" ? "/month" : "/day"}` : "Same rate as before");
  if (oldSeg.approvedBy) pair("Free upgrade approved by", oldSeg.approvedBy);
  if (oldSeg.reason) pair("Reason", oldSeg.reason);

  if (swapCharges.length || swapPayments.length || oldSeg.depositTopUp) {
    heading("Charges & Payments at this change");
    swapCharges.forEach((c) => pair(c.label, `${money(c.amount)}${c.taxable ? " + VAT" : ""}`));
    swapPayments.forEach((p) => pair(
      p.amount < 0 ? "Refunded" : "Collected",
      `${money(Math.abs(p.amount))} · ${p.method}${p.reference ? ` · Ref ${p.reference}` : ""}`,
    ));
    if (oldSeg.depositTopUp) pair("Deposit top-up", `${money(oldSeg.depositTopUp)}${oldSeg.depositTopUpMethod ? ` · ${oldSeg.depositTopUpMethod}` : ""}${oldSeg.depositTopUpReference ? ` · Ref ${oldSeg.depositTopUpReference}` : ""}`);
  }

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...slate);
  const recordedAt = oldSeg.changedAt ? new Date(oldSeg.changedAt).toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  doc.text(`Recorded by ${oldSeg.changedBy || "—"}${recordedAt ? ` on ${recordedAt}` : ""}. All other booking terms are unchanged.`, marginX, y, { maxWidth: width });

  doc.save(`Vehicle_Change_${booking.id}_${index + 1}.pdf`);
};
