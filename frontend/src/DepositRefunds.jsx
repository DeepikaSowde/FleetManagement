import { useState, useMemo } from "react";
import { C, mono, fmt } from "./theme";
import { Btn } from "./components";
import { STATUS_PILL_COLORS, STATUS_PILL_FAINT } from "./Fleet";

// ── Deposit Refunds ──────────────────────────────────────────────────────────
// A ready-made "how much deposit do we still owe back?" report. Every booking
// collects a refundable security deposit up front; it's returned to the
// customer at vehicle return via the refund flow in Booking.jsx. This page is
// the at-a-glance list of what's still outstanding — one row per booking with a
// deposit that hasn't been fully returned, a Refund Due column, and a running
// total, so staff never have to open bookings one by one to work it out.
//
// The deposit maths here deliberately mirrors computeBookingInvoice in
// Booking.jsx (the single source of truth) so the two never drift:
//   deposit held  = deductible
//   depositPaid   = explicit depositPaid, else (depositCollected ? full : 0)
//   refunded      = depositRefundedAmount once depositRefunded is set
//   refund due    = depositPaid − refunded (never negative)
const depositPicture = (b) => {
  const deposit = Number(b.deductible) || 0;
  const depositPaid = (b.depositPaid !== undefined && b.depositPaid !== null && String(b.depositPaid).trim() !== "")
    ? Math.max(0, Math.min(Number(b.depositPaid) || 0, deposit))
    : (b.depositCollected ? deposit : 0);
  const refunded = b.depositRefunded
    ? Math.max(0, Number(b.depositRefundedAmount ?? depositPaid) || 0)
    : 0;
  const refundDue = Math.max(0, depositPaid - refunded);
  return { deposit, depositPaid, refunded, refundDue };
};

// A booking is "ready to refund" once the car is actually back — the deposit
// can be returned. Before that it's still held against an active rental.
const isReturned = (b) =>
  !!b.actualReturnAt || b.forceCompleted || ["Completed", "Closed", "Cancelled"].includes(b.status);

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
};

// Compact status pill matching the Bookings list look.
const StatusPill = ({ status }) => (
  <span style={{
    display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: 10.5, fontWeight: 700,
    color: STATUS_PILL_COLORS[status] || C.navy,
    background: STATUS_PILL_FAINT[status] || C.tealFaint,
  }}>{status || "—"}</span>
);

// Summary tile for the top strip.
const SummaryTile = ({ label, value, sub, accent }) => (
  <div style={{ flex: 1, minWidth: 180, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent }} />
    <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>{label}</div>
    <div style={{ ...mono, fontSize: 22, fontWeight: 700, color: C.textPri, letterSpacing: -0.5 }}>{value}</div>
    {sub && <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 4 }}>{sub}</div>}
  </div>
);

const FILTERS = [
  { id: "pending", label: "Pending refunds" },
  { id: "ready", label: "Ready to refund" },
  { id: "active", label: "Held on active rentals" },
  { id: "refunded", label: "Refunded (history)" },
];

const DepositRefunds = ({ bookings = [], fleet = [], onOpenBooking, selectedCar = "All Cars", selectedRange = "all" }) => {
  const [filter, setFilter] = useState("pending");
  const [query, setQuery] = useState("");

  const carLabel = (plate) => {
    const car = fleet.find(c => c.plate === plate);
    return car ? `${car.brand || car.make || ""} ${car.model || ""}`.trim() : "";
  };

  // Scope by the top-bar Car / Month filters, same as the Bookings page, so
  // this report narrows in step with the rest of the app.
  const scoped = useMemo(() => bookings.filter(b => {
    if (selectedCar !== "All Cars" && b.plate !== selectedCar) return false;
    if (selectedRange !== "all" && !(b.start || "").startsWith(selectedRange)) return false;
    return true;
  }), [bookings, selectedCar, selectedRange]);

  // Every booking that ever collected a deposit, with its refund picture
  // attached — the raw material the filters and totals slice from.
  const withDeposits = useMemo(() => scoped
    .map(b => ({ b, ...depositPicture(b) }))
    .filter(r => r.depositPaid > 0), [scoped]);

  const rows = useMemo(() => {
    let list = withDeposits;
    if (filter === "pending") list = list.filter(r => r.refundDue > 0);
    else if (filter === "ready") list = list.filter(r => r.refundDue > 0 && isReturned(r.b));
    else if (filter === "active") list = list.filter(r => r.refundDue > 0 && !isReturned(r.b));
    else if (filter === "refunded") list = list.filter(r => r.refunded > 0);

    const q = query.trim().toLowerCase();
    if (q) list = list.filter(({ b }) =>
      [b.id, b.customer, b.plate, carLabel(b.plate)].some(v => (v ?? "").toString().toLowerCase().includes(q)));

    // Ready-to-refund first (action needed), then largest amount owed on top.
    return [...list].sort((a, b) => {
      const key = filter === "refunded" ? "refunded" : "refundDue";
      const ar = isReturned(a.b) ? 0 : 1;
      const br = isReturned(b.b) ? 0 : 1;
      if (filter === "pending" && ar !== br) return ar - br;
      return b[key] - a[key];
    });
  }, [withDeposits, filter, query]);

  // Headline totals — always computed off the full scoped set (not the current
  // filter/search) so the tiles read as the true outstanding liability.
  const totals = useMemo(() => {
    const pending = withDeposits.filter(r => r.refundDue > 0);
    const ready = pending.filter(r => isReturned(r.b));
    const active = pending.filter(r => !isReturned(r.b));
    const sum = (arr) => arr.reduce((s, r) => s + r.refundDue, 0);
    return {
      totalDue: sum(pending), totalCount: pending.length,
      readyDue: sum(ready), readyCount: ready.length,
      activeDue: sum(active), activeCount: active.length,
    };
  }, [withDeposits]);

  // Total shown in the table footer follows the current view.
  const viewTotal = rows.reduce((s, r) => s + (filter === "refunded" ? r.refunded : r.refundDue), 0);

  const th = { textAlign: "left", fontSize: 10.5, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, padding: "10px 14px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const td = { fontSize: 12.5, color: C.textPri, padding: "12px 14px", borderBottom: `1px solid ${C.linen}`, verticalAlign: "middle" };

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: C.tealFaint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>💰</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.navy, lineHeight: 1.1 }}>Deposit Refunds</div>
            <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>Security deposits still to be returned, per booking</div>
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <SummaryTile label="Total to refund" value={fmt(totals.totalDue)} sub={`${totals.totalCount} booking${totals.totalCount === 1 ? "" : "s"} outstanding`} accent={C.teal} />
        <SummaryTile label="Ready to refund" value={fmt(totals.readyDue)} sub={`${totals.readyCount} car${totals.readyCount === 1 ? "" : "s"} returned — action needed`} accent={C.amber} />
        <SummaryTile label="Held on active rentals" value={fmt(totals.activeDue)} sub={`${totals.activeCount} still on rental`} accent={C.blue} />
      </div>

      {/* Toolbar — filter tabs + search */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", flexWrap: "wrap" }}>
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none",
              background: filter === f.id ? C.teal : C.surface,
              color: filter === f.id ? "#fff" : C.textSec,
              borderRight: `1px solid ${C.border}`,
            }}>{f.label}</button>
          ))}
        </div>
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.textMuted, fontSize: 13, pointerEvents: "none" }}>🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search booking ID, customer, or car…"
            style={{ width: "100%", padding: "9px 12px 9px 34px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, fontSize: 12.5, color: C.textPri, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
          />
        </div>
      </div>

      {/* Table */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
            <thead>
              <tr>
                <th style={th}>Booking / Customer</th>
                <th style={th}>Car</th>
                <th style={th}>Rental Period</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: "right" }}>Deposit Collected</th>
                <th style={{ ...th, textAlign: "right" }}>Refunded</th>
                <th style={{ ...th, textAlign: "right" }}>{filter === "refunded" ? "Amount Refunded" : "Refund Due"}</th>
                <th style={{ ...th, textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...td, textAlign: "center", color: C.textMuted, padding: "36px 14px" }}>
                    {filter === "refunded" ? "No deposits refunded yet." : "No deposits pending refund — you're all settled. 🎉"}
                  </td>
                </tr>
              ) : rows.map(({ b, deposit, depositPaid, refunded, refundDue }) => {
                const highlight = filter === "refunded" ? refunded : refundDue;
                const ready = refundDue > 0 && isReturned(b);
                return (
                  <tr key={b.id}>
                    <td style={td}>
                      <div style={{ fontWeight: 700, color: C.navy }}>{b.customer || "—"}</div>
                      <div style={{ fontSize: 11, color: C.textMuted, ...mono }}>{b.id}</div>
                    </td>
                    <td style={td}>
                      <div style={{ ...mono, fontWeight: 600 }}>{b.plate || "—"}</div>
                      {carLabel(b.plate) && <div style={{ fontSize: 11, color: C.textMuted }}>{carLabel(b.plate)}</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap", fontSize: 11.5, color: C.textSec }}>
                      {fmtDate(b.start)} → {fmtDate(b.actualReturnAt || b.end)}
                    </td>
                    <td style={td}>
                      <StatusPill status={b.status} />
                      {ready && <div style={{ fontSize: 10, color: C.amber, fontWeight: 700, marginTop: 4 }}>● Ready to refund</div>}
                    </td>
                    <td style={{ ...td, textAlign: "right", ...mono }}>
                      {fmt(depositPaid)}
                      {depositPaid < deposit && <div style={{ fontSize: 10, color: C.textMuted }}>of {fmt(deposit)} agreed</div>}
                    </td>
                    <td style={{ ...td, textAlign: "right", ...mono, color: refunded > 0 ? C.textSec : C.textMuted }}>{fmt(refunded)}</td>
                    <td style={{ ...td, textAlign: "right", ...mono, fontWeight: 700, color: highlight > 0 ? (filter === "refunded" ? C.textPri : C.red) : C.textMuted }}>{fmt(highlight)}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {onOpenBooking && (
                        <Btn small secondary onClick={() => onOpenBooking(b.id)}>Open</Btn>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={6} style={{ ...td, textAlign: "right", fontWeight: 700, color: C.navy, borderBottom: "none", borderTop: `2px solid ${C.border}` }}>
                    {filter === "refunded" ? "Total refunded (this view)" : "Total refund due (this view)"}
                  </td>
                  <td style={{ ...td, textAlign: "right", ...mono, fontWeight: 800, fontSize: 14, color: filter === "refunded" ? C.navy : C.red, borderBottom: "none", borderTop: `2px solid ${C.border}` }}>{fmt(viewTotal)}</td>
                  <td style={{ ...td, borderBottom: "none", borderTop: `2px solid ${C.border}` }}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 12, lineHeight: 1.5 }}>
        The deposit is returned to the customer at vehicle return. Click <strong>Open</strong> on any row to go to the booking
        and record the refund (full, partial, or forfeited) — this list updates automatically once a refund is recorded.
      </div>
    </div>
  );
};

export default DepositRefunds;
