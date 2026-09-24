// The one place Today's Operations is worked out. Both the Today's Operations
// module and the Dashboard widget import from here, so the date, the
// pickup/return rules, the status mapping and every count come from the same
// code and can never drift apart.
//   • Pickup  = a (non-cancelled) booking starting on the selected date
//   • Return  = a (non-cancelled) booking ending on the selected date

export const toDateStr = (v) => { const d = new Date(v); return isNaN(d) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10); };
export const timeStr = (v) => { const d = new Date(v); return isNaN(d) ? "--" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
export const shortDate = (v) => { const d = new Date(v); return isNaN(d) ? String(v).slice(0, 10) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); };

// "Today" as the Today's Operations module has always defined it.
export const todayOpsDate = () => new Date().toISOString().slice(0, 10);

export function buildOps(bookings = [], fleet = [], date) {
  const ops = [];
  const makeOp = (b, type, when) => {
    const car = fleet.find((c) => c.plate === b.plate);
    const model = car ? `${car.make} ${car.model}` : (b.plate || "—");
    const state = (type === "Pickup" ? b.opPickup : b.opReturn) || {};
    // Booking is the source of truth for whether this pickup/return has
    // actually happened (Vehicle Handover / Confirm Return in Booking.jsx).
    // `done` always wins: once it's true the operation reads Completed no
    // matter what's stored, and while it's false the operation can never
    // read Completed even if a stale/invalid "Completed" was written to
    // state.status before this sync rule existed.
    const done = type === "Pickup" ? !!b.handoverAt : (!!b.returnedAt || !!b.mileageIn);
    const status = done
      ? "Completed"
      : (state.status === "Completed" ? (state.assignedTo ? "Assigned" : "Pending") : (state.status || (state.assignedTo ? "Assigned" : "Pending")));
    return {
      key: `${b.id}-${type}`,
      bookingId: b.id,
      type,
      time: timeStr(when),
      timeVal: new Date(when).getTime() || 0,
      vehicle: model,
      plate: b.plate || "—",
      contract: `${shortDate(b.start)} – ${shortDate(b.end)}`,
      remark: state.remark ?? b.comments ?? "",
      place: state.place ?? (type === "Pickup" ? (b.pickup || "") : (b.drop || "")),
      customer: b.customer || "—",
      contact: b.contact || "",
      assignedTo: state.assignedTo ?? null,
      status,
      done,
      stateKey: type === "Pickup" ? "opPickup" : "opReturn",
      raw: state,
    };
  };
  bookings.forEach((b) => {
    if (b.cancelled) return;
    if (b.start && toDateStr(b.start) === date) ops.push(makeOp(b, "Pickup", b.start));
    if (b.end && toDateStr(b.end) === date) ops.push(makeOp(b, "Return", b.end));
  });
  return ops.sort((a, b) => a.timeVal - b.timeVal);
}

// "Completed" means VALIDLY completed — status is Completed (already gated to
// a real Booking handover/return) AND a real employee is assigned. An
// Unassigned operation is never counted as Completed, even if the underlying
// booking event has physically happened.
export const isValidCompleted = (o) => o.status === "Completed" && !!o.assignedTo;

export function summarizeOps(allOps) {
  const pickups = allOps.filter((o) => o.type === "Pickup");
  const returns = allOps.filter((o) => o.type === "Return");
  const pending = allOps.filter((o) => o.status === "Pending");
  const completed = allOps.filter(isValidCompleted);
  return {
    pickups, returns, pending, completed,
    pickupCompleted: pickups.filter(isValidCompleted).length,
    returnCompleted: returns.filter(isValidCompleted).length,
    pickupPending: pickups.filter((o) => o.status === "Pending").length,
    returnPending: returns.filter((o) => o.status === "Pending").length,
  };
}
