import { useMemo, useState } from "react";
import { C, mono, fmt, daysUntil } from "./theme";
import { Card, Badge, Btn, Modal, Input, Select } from "./components";
import { computeBookingInvoice } from "./useFleetData";
import RestrictedLicenses from "./RestrictedLicenses";
import { CONTACT_COUNTRY_CODES, contactDigitsRequired, combineContact, splitContact } from "./contactCodes";

// Customer Management — master customer directory with live, booking-derived
// stats (pending amount, pending bookings, last booking/payment) joined in from
// bookings by IC. New bookings auto-upsert their customer (see
// useFleetData.addBooking), so this list always mirrors booking activity.
// Layout: KPI strip + pending banner on top, then a two-pane body — a paginated
// customer list on the left and a details panel for the selected customer on the right.

const normIC = (ic) => (ic || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const CUSTOMER_TYPES = [
  { value: "Local", label: "Local" },
  { value: "Foreigner", label: "Foreigner" },
  { value: "Tourist", label: "Tourist" },
];

const PAGE_SIZE = 8;

// A customer becomes a "Repeated Customer" once they reach this many bookings.
const REPEAT_THRESHOLD = 20;

// Numeric DD/MM/YYYY to match the reference design (e.g. 01/08/2025).
const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? String(d).slice(0, 10) : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const emptyForm = {
  // `contact` holds the LOCAL digits only; `contactCountryCode` the dial code —
  // same two-part shape as the New Booking form. They're combined into the full
  // stored number on save (see handleSubmit / combineContact).
  ic: "", name: "", contact: "", contactCountryCode: "+65", email: "", license: "", licenseExpiry: "",
  customerType: "Local", age: "", dob: "", nationality: "", drivingExperience: "", address: "",
};

// Deterministic avatar colour from a name so a customer always gets the same tint.
const AVATAR_COLORS = [C.teal, C.tealLight, C.amber, C.green, C.navyMid, C.red];
const avatarColor = (s) => {
  const str = s || "";
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};
const initials = (name) =>
  (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";

const Customers = ({
  customers = [], bookings = [], onSaveCustomer, onUpdateCustomer, onDeleteCustomer,
  currentUserRole = "Staff",
  restrictedLicenses = [], onAddRestrictedLicense, onUpdateRestrictedLicense, onDeleteRestrictedLicense,
}) => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | active | inactive | pending
  const [repeatOnly, setRepeatOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState(null);   // "add" | "edit" | null
  const [formCustomer, setFormCustomer] = useState(null); // customer being edited
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  // Per-field inline errors (keyed by field name), rendered under each field —
  // same behavior as the New Booking form's Customer Details step.
  const [fieldErrors, setFieldErrors] = useState({});
  const [historyFor, setHistoryFor] = useState(null); // customer whose booking history modal is open

  // ── Per-IC booking stats, computed once from bookings ─────────────────────
  const statsByIc = useMemo(() => {
    const map = {};
    bookings.forEach((b) => {
      const key = normIC(b.ic);
      if (!key) return;
      if (!map[key]) map[key] = { count: 0, totalSpent: 0, pendingAmount: 0, pendingBookings: 0, lastBooking: null, lastPayment: null, hasOpen: false };
      const s = map[key];
      s.count += 1;
      const inv = computeBookingInvoice(b);
      if (!b.cancelled) {
        s.totalSpent += inv.finalInvoiceTotal || 0;
        if (inv.balanceDue > 0) { s.pendingAmount += inv.balanceDue; s.pendingBookings += 1; }
      }
      if (b.status === "Active" || b.status === "Upcoming") s.hasOpen = true;
      const d = b.end || b.start;
      if (d && (!s.lastBooking || new Date(d) > new Date(s.lastBooking))) s.lastBooking = d;
      inv.payments.forEach((p) => {
        if (!p.addedAt) return;
        if (!s.lastPayment || new Date(p.addedAt) > new Date(s.lastPayment.addedAt)) s.lastPayment = p;
      });
    });
    return map;
  }, [bookings]);

  const statFor = (ic) => statsByIc[normIC(ic)] || { count: 0, totalSpent: 0, pendingAmount: 0, pendingBookings: 0, lastBooking: null, lastPayment: null, hasOpen: false };

  // A customer is Active if they have an open (Active/Upcoming) booking or one
  // that ended within the last 180 days; otherwise Inactive.
  const statusOf = (stats) => (stats.hasOpen || (stats.lastBooking && daysUntil(stats.lastBooking) >= -180) ? "Active" : "Inactive");

  // Customers enriched with their derived stats + status.
  const enriched = useMemo(
    () => customers.map((c) => { const stats = statFor(c.ic); return { ...c, stats, status: statusOf(stats) }; }),
    [customers, statsByIc]
  );

  // ── KPI figures ───────────────────────────────────────────────────────────
  const total = enriched.length;
  const activeCount = enriched.filter((c) => c.status === "Active").length;
  const repeatCount = enriched.filter((c) => c.stats.count >= REPEAT_THRESHOLD).length;
  const pendingCustomers = enriched.filter((c) => c.stats.pendingAmount > 0);

  const now = new Date();
  const ym = (d) => { const dt = new Date(d); return isNaN(dt) ? null : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`; };
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, "0")}`;
  const newThisMonth = enriched.filter((c) => ym(c.createdAt) === thisMonth).length;
  const newLastMonth = enriched.filter((c) => ym(c.createdAt) === lastMonth).length;
  const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : "0%");
  const momDelta =
    newLastMonth > 0 ? `${newThisMonth >= newLastMonth ? "+" : ""}${Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 100)}% vs last month`
    : newThisMonth > 0 ? "new this month" : "no change";

  // ── Filtering + pagination ────────────────────────────────────────────────
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter((c) => {
      if (statusFilter === "active" && c.status !== "Active") return false;
      if (statusFilter === "inactive" && c.status !== "Inactive") return false;
      if (statusFilter === "pending" && c.stats.pendingAmount <= 0) return false;
      if (repeatOnly && c.stats.count < REPEAT_THRESHOLD) return false;
      if (!q) return true;
      return (
        (c.name || "").toLowerCase().includes(q) ||
        (c.ic || "").toLowerCase().includes(q) ||
        (c.contact || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q)
      );
    });
  }, [enriched, search, statusFilter, repeatOnly]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageRows = rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const selected = enriched.find((c) => c.id === selectedId) || pageRows[0] || rows[0] || null;

  const resetPage = () => setPage(1);

  // ── KPI card definitions ──────────────────────────────────────────────────
  const kpis = [
    { label: "Total Customers", value: total, icon: "👥", tint: "#E8EEF7", accent: "#3B6FB5", sub: `+${newThisMonth} this month`, subColor: C.green },
    { label: "Active Customers", value: activeCount, icon: "🟢", tint: C.greenFaint, accent: C.green, sub: `${pct(activeCount, total)} of total`, subColor: C.green },
    { label: "New This Month", value: newThisMonth, icon: "📅", tint: C.amberFaint, accent: C.amber, sub: momDelta, subColor: C.green },
    { label: "Repeat Customers", value: repeatCount, icon: "📈", tint: "#EDE8F5", accent: "#6D5BB3", sub: `${pct(repeatCount, total)} of total`, subColor: "#6D5BB3" },
    { label: "Payment Pending Customers", value: pendingCustomers.length, icon: "⚠️", tint: C.redFaint, accent: C.red, sub: `${pct(pendingCustomers.length, total)} of total`, subColor: C.red, alert: true },
  ];

  // ── Modal handlers ────────────────────────────────────────────────────────
  const openAdd = () => { setForm(emptyForm); setError(""); setFieldErrors({}); setFormCustomer(null); setMode("add"); };
  const openEdit = (c) => {
    setForm({
      ...emptyForm, ...c,
      // Split the stored full number back into dial code + local digits so the
      // two-part editor round-trips cleanly.
      ...splitContact(c.contact ?? ""),
      age: c.age ?? "", drivingExperience: c.drivingExperience ?? "",
      email: c.email ?? "", licenseExpiry: c.licenseExpiry ?? "", dob: c.dob ?? "", nationality: c.nationality ?? "",
    });
    setError(""); setFieldErrors({}); setFormCustomer(c); setMode("edit");
  };
  const close = () => { setMode(null); setFormCustomer(null); setError(""); setFieldErrors({}); };

  // IC / ID Number and Driving License Number are the same value, so mirror the
  // IC into the license field as it's typed (same as the New Booking form). The
  // license stays editable in case a record ever needs to differ. Normalizes to
  // uppercase alphanumerics, capped at 15 chars (fits a full Emirates ID).
  const handleICChange = (raw) => {
    let v = (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (v.length > 15) v = v.slice(0, 15);
    setForm((prev) => ({ ...prev, ic: v, license: v }));
    setFieldErrors((prev) => ({ ...prev, ic: undefined, license: undefined }));
  };

  const handleSubmit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    // ── Per-field validation (mirrors the New Booking Customer Details step) ──
    const errors = {};
    if (!form.ic.trim()) errors.ic = "IC / ID Number is required";
    if (!form.name.trim()) errors.name = "Customer Name is required";
    {
      const requiredDigits = contactDigitsRequired(form.contactCountryCode);
      if (!form.contact.trim()) errors.contact = "Phone Number is required";
      else if (form.contact.length !== requiredDigits) errors.contact = `Contact number must be exactly ${requiredDigits} digits`;
    }
    if (form.age === "" || form.age === null) errors.age = "Age is required";
    else if (isNaN(Number(form.age)) || Number(form.age) <= 0) errors.age = "Enter a valid age";
    if (!String(form.license || "").trim()) errors.license = "Driving License Number is required";
    if (form.drivingExperience === "" || form.drivingExperience === null) errors.drivingExperience = "Driving Experience is required";
    else if (isNaN(Number(form.drivingExperience)) || Number(form.drivingExperience) < 0) errors.drivingExperience = "Enter valid years of driving experience";

    if (Object.keys(errors).length) { setFieldErrors(errors); setError(""); return; }
    setFieldErrors({});

    // One customer name maps to one IC — block reusing a name under a different IC.
    {
      const nameKey = form.name.trim().toLowerCase();
      const icKey = normIC(form.ic);
      const clash = customers.find(
        (c) => c.id !== (formCustomer && formCustomer.id)
          && (c.name || "").trim().toLowerCase() === nameKey
          && normIC(c.ic) !== icKey
      );
      if (clash) { setError(`A customer named "${form.name.trim()}" already exists with IC ${clash.ic}. Use the same IC, or a different name.`); return; }
    }
    const payload = {
      ic: form.ic, name: form.name,
      // Store the full international number (dial digits + local) in `contact`.
      contact: combineContact(form.contactCountryCode, form.contact),
      email: form.email,
      license: form.license, licenseExpiry: form.licenseExpiry || null,
      customerType: form.customerType, nationality: form.nationality, dob: form.dob || null,
      address: form.address,
      age: form.age === "" ? null : Number(form.age),
      drivingExperience: form.drivingExperience === "" ? null : Number(form.drivingExperience),
    };
    if (mode === "add") onSaveCustomer(payload);
    else if (mode === "edit" && formCustomer) onUpdateCustomer(formCustomer.id, payload);
    close();
  };

  const handleDelete = (c) => {
    if (window.confirm(`Delete customer "${c.name}" (${c.ic})? This removes the customer record; their past bookings are not affected.`)) {
      onDeleteCustomer(c.id);
      if (selectedId === c.id) setSelectedId(null);
    }
  };

  const applyPendingFilter = () => { setStatusFilter("pending"); resetPage(); };

  // Booking history for the customer whose modal is open.
  const historyBookings = historyFor ? bookings.filter((b) => normIC(b.ic) === normIC(historyFor.ic)) : [];

  // ── Styles ────────────────────────────────────────────────────────────────
  const th = { textAlign: "left", padding: "10px 14px", fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", background: C.bg };
  const td = { padding: "10px 14px", fontSize: 12, color: C.textSec, borderBottom: `1px solid ${C.border}`, verticalAlign: "middle" };
  const controlStyle = { padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 12, color: C.textPri, background: C.surface, outline: "none", boxSizing: "border-box" };
  // Phone control (country-code select + digits input) — matches the shared
  // Input's look, red border on error, same as the New Booking form's field.
  const phoneCtlStyle = (hasError) => ({ width: "100%", padding: "8px 12px", border: `1px solid ${hasError ? C.red : C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: C.surface });

  const StatusPill = ({ status }) => {
    const active = status === "Active";
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: active ? C.greenFaint : C.redFaint, color: active ? C.green : C.red, fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
        {status}
      </span>
    );
  };

  return (
    <div>
      {/* Action row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.navy }}>Customer Overview</div>
        <Btn primary id="customers-add" onClick={openAdd}>＋ Add New Customer</Btn>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 14 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: C.surface, border: `1px solid ${k.alert ? C.red : C.border}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: k.tint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>{k.icon}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textMuted, lineHeight: 1.3 }}>{k.label}</div>
                <div style={{ ...mono, fontSize: 22, fontWeight: 700, color: C.navy, marginTop: 2 }}>{k.value}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: k.subColor }}>{k.sub}</span>
              {k.alert && <button onClick={applyPendingFilter} style={{ fontSize: 10, fontWeight: 600, color: C.teal, background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>View All</button>}
            </div>
          </div>
        ))}
      </div>

      {/* Body: two-pane — customer list (left) + details & payment summary (right) */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        {/* ── Customer list ─────────────────────────────────────────────── */}
        <Card>
          <div style={{ padding: "14px 18px 12px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 12 }}>Customer List</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
                <input
                  id="customers-search"
                  style={{ ...controlStyle, width: "100%", paddingRight: 30 }}
                  placeholder="Search by name, IC number, phone, email…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); resetPage(); }}
                />
                <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: C.textMuted, fontSize: 13, pointerEvents: "none" }}>🔍</span>
              </div>
              <button
                onClick={() => { setRepeatOnly((v) => !v); resetPage(); }}
                title="Show repeat customers only"
                style={{ ...controlStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: repeatOnly ? C.teal : C.textSec, borderColor: repeatOnly ? C.teal : C.border }}
              >
                ⚲ Filters{repeatOnly ? " •" : ""}
              </button>
              <select id="customers-filter-status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); resetPage(); }} style={{ ...controlStyle, cursor: "pointer" }}>
                <option value="all">Status: All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="pending">Payment Pending</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Customer", "IC Number", "Phone", "Status", "Total Bookings", "Pending Amount", "Last Booking", ""].map((h, i) => (
                    <th key={i} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((c) => {
                  const isSel = selected && c.id === selected.id;
                  const pend = c.stats.pendingAmount;
                  return (
                    <tr
                      key={c.id ?? c.ic}
                      onClick={() => setSelectedId(c.id)}
                      style={{ cursor: "pointer", background: isSel ? C.tealFaint : "transparent" }}
                    >
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 30, height: 30, borderRadius: "50%", background: avatarColor(c.name), color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials(c.name)}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.navy, whiteSpace: "nowrap" }}>{c.name}</div>
                            <div style={{ fontSize: 10.5, color: C.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>{c.email || "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ ...td, ...mono, fontSize: 11 }}>{c.ic}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{c.contact || "—"}</td>
                      <td style={td}><StatusPill status={c.status} /></td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <span style={{ fontWeight: 700, color: C.navy }}>{c.stats.count}</span>
                        {c.stats.count >= REPEAT_THRESHOLD && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: "#6D5BB3", background: "#EDE8F5", borderRadius: 999, padding: "1px 6px", whiteSpace: "nowrap" }}>Repeated</span>}
                      </td>
                      <td style={{ ...td, ...mono, fontWeight: 700, color: pend > 0 ? C.red : C.green, whiteSpace: "nowrap" }}>{fmt(Math.round(pend))}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", color: C.textMuted }}>{fmtDate(c.stats.lastBooking)}</td>
                      <td style={{ ...td, textAlign: "center", color: C.textMuted }}>›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {rows.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
              {customers.length === 0 ? "No customers yet. Add one, or they appear automatically when you create bookings." : "No customers match your filters."}
            </div>
          )}

          {/* Pagination */}
          {rows.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderTop: `1px solid ${C.border}`, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 11, color: C.textMuted }}>
                Showing {(curPage - 1) * PAGE_SIZE + 1} to {Math.min(curPage * PAGE_SIZE, rows.length)} of {rows.length} customers
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <PageBtn disabled={curPage === 1} onClick={() => setPage(curPage - 1)}>‹</PageBtn>
                {pageNumbers(curPage, totalPages).map((p, i) =>
                  p === "…" ? (
                    <span key={`e${i}`} style={{ padding: "0 4px", color: C.textMuted, fontSize: 12 }}>…</span>
                  ) : (
                    <PageBtn key={p} active={p === curPage} onClick={() => setPage(p)}>{p}</PageBtn>
                  )
                )}
                <PageBtn disabled={curPage === totalPages} onClick={() => setPage(curPage + 1)}>›</PageBtn>
              </div>
            </div>
          )}
        </Card>

        {/* ── Customer details + payment summary (right column) ──────────── */}
        <div style={{ display: "grid", gap: 16 }}>
          <Card>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>Customer Details</span>
                {selected && <StatusPill status={selected.status} />}
              </div>
              {selected && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => openEdit(selected)} style={{ fontSize: 11, fontWeight: 600, color: C.green, background: "none", border: `1px solid ${C.green}`, borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>Edit</button>
                  <button onClick={() => handleDelete(selected)} style={{ fontSize: 11, fontWeight: 600, color: C.red, background: "none", border: `1px solid ${C.red}`, borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>Delete</button>
                </div>
              )}
            </div>

            {!selected ? (
              <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>Select a customer to see their details.</div>
            ) : (
              <div style={{ padding: 18 }}>
                {/* Identity header: avatar + name + phone/IC */}
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
                  <div style={{ width: 54, height: 54, borderRadius: "50%", background: avatarColor(selected.name), color: "#fff", fontSize: 19, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials(selected.name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 4 }}>{selected.name}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11.5, color: C.textSec }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>📞 {selected.contact || "—"}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>🪪 {selected.ic}</span>
                    </div>
                  </div>
                </div>

                {/* Two-column field grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 28px" }}>
                  <div>
                    <DetailField label="Email" value={selected.email || "—"} />
                    <DetailField label="Date of Birth" value={fmtDate(selected.dob)} />
                    <DetailField label="Nationality" value={selected.nationality || "—"} />
                    <DetailField label="Customer Type" value={selected.customerType || "—"} />
                    <DetailField label="Address" value={selected.address || "—"} />
                    <DetailField label="Driving Experience" value={selected.drivingExperience != null ? `${selected.drivingExperience} Years` : "—"} />
                  </div>
                  <div>
                    <DetailField label="License Number" value={selected.license || "—"} />
                    <DetailField label="License Expiry" value={fmtDate(selected.licenseExpiry)} />
                    <DetailField label="Created Date" value={fmtDate(selected.createdAt)} />
                    <DetailField label="Last Updated" value={fmtDate(selected.updatedAt || selected.createdAt)} />
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Payment Summary — its own card below the details */}
          {selected && (
            <Card>
              <div style={{ padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: selected.stats.pendingAmount > 0 ? C.red : C.navy }}>Payment Summary</span>
                  <button onClick={() => setHistoryFor(selected)} style={{ fontSize: 11, fontWeight: 600, color: C.green, background: C.surface, border: `1px solid ${C.green}`, borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>View All Bookings</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "16px 10px" }}>
                  <SummaryStat label="Total Bookings" value={`${selected.stats.count}${selected.stats.count >= REPEAT_THRESHOLD ? " · Repeated" : ""}`} valueColor={selected.stats.count >= REPEAT_THRESHOLD ? "#6D5BB3" : undefined} />
                  <SummaryStat label="Pending Bookings" value={selected.stats.pendingBookings} />
                  <SummaryStat
                    label="Last Payment"
                    value={selected.stats.lastPayment ? fmt(Math.round(selected.stats.lastPayment.amount || 0)) : "—"}
                    hint={selected.stats.lastPayment ? fmtDate(selected.stats.lastPayment.addedAt) : ""}
                  />
                  <SummaryStat label="Total Pending Amount" value={fmt(Math.round(selected.stats.pendingAmount))} valueColor={selected.stats.pendingAmount > 0 ? C.red : C.green} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: C.textMuted, marginTop: 16 }}>
                  <span>ℹ️</span> Pending amount includes unpaid balance from bookings.
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Restricted Driving Licenses — admin only (moved here from Settings).
          Staff never see this panel mounted; booking creation still reads the
          blocklist regardless of role via a separate, open path. */}
      {currentUserRole === "Admin" && (
        <div style={{ marginTop: 16 }}>
          <RestrictedLicenses
            licenses={restrictedLicenses}
            onAdd={onAddRestrictedLicense}
            onUpdate={onUpdateRestrictedLicense}
            onDelete={onDeleteRestrictedLicense}
          />
        </div>
      )}

      {/* Add / Edit modal */}
      <Modal
        testId="customer-modal"
        open={mode === "add" || mode === "edit"}
        title={mode === "edit" ? "Edit Customer" : "Add New Customer"}
        onClose={close}
        onSubmit={handleSubmit}
        submitText={mode === "edit" ? "Save Changes" : "Add Customer"}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Input id="customer-ic" label="IC / ID Number *" value={form.ic} onChange={(e) => handleICChange(e.target.value)} placeholder="e.g. S8901234A" error={fieldErrors.ic} />
          <Input id="customer-name" label="Customer Name *" value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setFieldErrors((p) => ({ ...p, name: undefined })); }} placeholder="e.g. Ravi Kumar" error={fieldErrors.name} />

          {/* Phone Number — same two-part Country Code + digits control, digit
              rules, and error message as the New Booking form. */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: C.textPri }}>Phone Number *</label>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                id="customer-contact-code"
                value={form.contactCountryCode}
                onChange={(e) => {
                  const newCode = e.target.value;
                  const requiredDigits = contactDigitsRequired(newCode);
                  const clamped = form.contact.slice(0, requiredDigits);
                  setForm({ ...form, contactCountryCode: newCode, contact: clamped });
                  setFieldErrors((p) => ({ ...p, contact: clamped && clamped.length !== requiredDigits ? `Contact number must be exactly ${requiredDigits} digits` : undefined }));
                }}
                style={{ ...phoneCtlStyle(false), width: 110, flex: "0 0 auto", cursor: "pointer" }}
              >
                {CONTACT_COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                ))}
              </select>
              <input
                id="customer-contact"
                type="text"
                value={form.contact}
                onChange={(e) => {
                  const requiredDigits = contactDigitsRequired(form.contactCountryCode);
                  const v = e.target.value.replace(/\D/g, "").slice(0, requiredDigits);
                  setForm({ ...form, contact: v });
                  if (fieldErrors.contact && (v === "" || v.length === requiredDigits)) setFieldErrors((p) => ({ ...p, contact: undefined }));
                }}
                onBlur={() => {
                  const requiredDigits = contactDigitsRequired(form.contactCountryCode);
                  if (form.contact && form.contact.length !== requiredDigits) setFieldErrors((p) => ({ ...p, contact: `Contact number must be exactly ${requiredDigits} digits` }));
                }}
                placeholder="e.g. 98765432"
                style={{ ...phoneCtlStyle(!!fieldErrors.contact), flex: 1 }}
              />
            </div>
            <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 5 }}>{contactDigitsRequired(form.contactCountryCode)} digits required</div>
            {fieldErrors.contact && <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>{fieldErrors.contact}</div>}
          </div>

          <Input id="customer-email" label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="e.g. ravi.kumar@email.com" />
          <Input id="customer-dob" label="Date of Birth" type="date" value={form.dob || ""} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
          <Input id="customer-nationality" label="Nationality" value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} placeholder="e.g. Singaporean" />
          <Select id="customer-type" label="Customer Type" value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value })} options={CUSTOMER_TYPES} />
          <Input id="customer-age" label="Age *" type="number" value={form.age} onChange={(e) => { setForm({ ...form, age: e.target.value }); setFieldErrors((p) => ({ ...p, age: undefined })); }} placeholder="e.g. 32" error={fieldErrors.age} />
          <Input id="customer-license" label="Driving License Number *" value={form.license} onChange={(e) => { setForm({ ...form, license: e.target.value }); setFieldErrors((p) => ({ ...p, license: undefined })); }} placeholder="e.g. S1234567A" error={fieldErrors.license} />
          <Input id="customer-license-expiry" label="License Expiry" type="date" value={form.licenseExpiry || ""} onChange={(e) => setForm({ ...form, licenseExpiry: e.target.value })} />
          <Input id="customer-driving-experience" label="Driving Experience (years) *" type="number" value={form.drivingExperience} onChange={(e) => { setForm({ ...form, drivingExperience: e.target.value }); setFieldErrors((p) => ({ ...p, drivingExperience: undefined })); }} placeholder="e.g. 5" error={fieldErrors.drivingExperience} />
        </div>
        <Input id="customer-address" label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="e.g. 12, Jalan Bukit Merah, #04-15, Singapore 150012" />
        {error && <div style={{ background: C.redFaint, color: C.red, fontSize: 12, padding: "9px 12px", borderRadius: 8 }}>{error}</div>}
      </Modal>

      {/* Booking history modal */}
      <Modal open={!!historyFor} title={historyFor ? `Bookings — ${historyFor.name}` : "Bookings"} onClose={() => setHistoryFor(null)} onSubmit={() => setHistoryFor(null)} submitText="Close">
        <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, marginBottom: 8 }}>Rental History ({historyBookings.length})</div>
        <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
          {historyBookings.length === 0 ? (
            <div style={{ padding: 16, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No bookings yet</div>
          ) : historyBookings.map((b) => {
            const inv = computeBookingInvoice(b);
            return (
              <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, rowGap: 4, flexWrap: "wrap", padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 11.5 }}>
                <span style={{ ...mono, color: C.navyMid }}>{b.id}</span>
                <span style={{ color: C.textSec }}>{b.plate || "—"}</span>
                <span style={{ color: C.textMuted, whiteSpace: "nowrap" }}>{fmtDate(b.start)} → {fmtDate(b.end)}</span>
                <span style={{ ...mono, fontWeight: 700, color: inv.balanceDue > 0 ? C.red : C.green }}>{fmt(Math.round(inv.finalInvoiceTotal || 0))}</span>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
};

// Compact page-number list with ellipses, e.g. 1 2 3 … 31.
const pageNumbers = (cur, total) => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  const start = Math.max(2, cur - 1);
  const end = Math.min(total - 1, cur + 1);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
};

const PageBtn = ({ children, active, disabled, onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      minWidth: 28, height: 28, padding: "0 8px", borderRadius: 6,
      border: `1px solid ${active ? C.teal : C.border}`,
      background: active ? C.teal : C.surface,
      color: active ? "#fff" : disabled ? C.textMuted : C.textSec,
      fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.5 : 1,
    }}
  >
    {children}
  </button>
);

// One label/value pair in the Customer Details two-column grid — label muted on
// the left, value emphasized on the right (matching the reference design).
const DetailField = ({ label, value }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "8px 0", fontSize: 12 }}>
    <span style={{ color: C.textMuted, flexShrink: 0 }}>{label}</span>
    <span style={{ color: C.textPri, fontWeight: 600, textAlign: "right", wordBreak: "break-word" }}>{value}</span>
  </div>
);

const SummaryStat = ({ label, value, valueColor, hint }) => (
  <div>
    <div style={{ fontSize: 9.5, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>{label}</div>
    <div style={{ ...mono, fontSize: 13, fontWeight: 700, color: valueColor || C.navy, whiteSpace: "nowrap" }}>{value}</div>
    {hint && <div style={{ fontSize: 9.5, color: C.textMuted, marginTop: 2 }}>{hint}</div>}
  </div>
);

export default Customers;
