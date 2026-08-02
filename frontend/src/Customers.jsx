import { useMemo, useState } from "react";
import { C, mono, fmt } from "./theme";
import { Card, CardHeader, Badge, Btn, Modal, Input, Select } from "./components";
import { computeBookingInvoice } from "./useFleetData";

// Customer directory backed by a real customers table (add/edit/delete), with
// live booking stats (count, spend, last rental) joined in from bookings by IC.
// New bookings auto-upsert their customer here (see useFleetData.addBooking).

const normIC = (ic) => (ic || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const CUSTOMER_TYPES = [
  { value: "Local", label: "Local" },
  { value: "Foreigner", label: "Foreigner" },
  { value: "Tourist", label: "Tourist" },
];

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? String(d).slice(0, 10) : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const emptyForm = { ic: "", name: "", contact: "", license: "", customerType: "Local", age: "", drivingExperience: "", address: "" };

const Customers = ({ customers = [], bookings = [], onSaveCustomer, onUpdateCustomer, onDeleteCustomer }) => {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState(null);        // "add" | "edit" | "view" | null
  const [selected, setSelected] = useState(null); // the customer being viewed/edited
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  // Per-IC booking stats, computed once from bookings.
  const statsByIc = useMemo(() => {
    const map = {};
    bookings.forEach((b) => {
      const key = normIC(b.ic);
      if (!key) return;
      if (!map[key]) map[key] = { count: 0, plates: new Set(), totalSpent: 0, lastRental: null };
      const s = map[key];
      s.count += 1;
      if (b.plate) s.plates.add(b.plate);
      if (!b.cancelled) s.totalSpent += computeBookingInvoice(b).finalInvoiceTotal || 0;
      const d = b.end || b.start;
      if (d && (!s.lastRental || new Date(d) > new Date(s.lastRental))) s.lastRental = d;
    });
    return map;
  }, [bookings]);

  const statFor = (ic) => statsByIc[normIC(ic)] || { count: 0, plates: new Set(), totalSpent: 0, lastRental: null };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = customers.map((c) => ({ ...c, stats: statFor(c.ic) }));
    if (!q) return list;
    return list.filter((c) =>
      (c.name || "").toLowerCase().includes(q) ||
      (c.ic || "").toLowerCase().includes(q) ||
      (c.contact || "").toLowerCase().includes(q) ||
      (c.license || "").toLowerCase().includes(q)
    );
  }, [customers, statsByIc, search]);

  const totalBookings = bookings.length;
  const totalRevenue = bookings.reduce((s, b) => s + (b.cancelled ? 0 : computeBookingInvoice(b).finalInvoiceTotal || 0), 0);

  const summary = [
    { label: "Total Customers", value: customers.length, icon: "👥", money: false },
    { label: "Total Bookings", value: totalBookings, icon: "📅", money: false },
    { label: "Total Revenue", value: totalRevenue, icon: "💰", money: true },
  ];

  // ── Modal handlers ──────────────────────────────────────────────────────
  const openAdd = () => { setForm(emptyForm); setError(""); setSelected(null); setMode("add"); };
  const openEdit = (c) => { setForm({ ...emptyForm, ...c, age: c.age ?? "", drivingExperience: c.drivingExperience ?? "" }); setError(""); setSelected(c); setMode("edit"); };
  const openView = (c) => { setSelected(c); setMode("view"); };
  const close = () => { setMode(null); setSelected(null); setError(""); };

  const handleSubmit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!form.ic.trim()) { setError("IC / ID is required"); return; }
    if (!form.name.trim()) { setError("Customer name is required"); return; }
    if (mode === "add") onSaveCustomer(form);
    else if (mode === "edit" && selected) onUpdateCustomer(selected.id, {
      ic: form.ic, name: form.name, contact: form.contact, license: form.license,
      customerType: form.customerType,
      age: form.age === "" ? null : Number(form.age),
      drivingExperience: form.drivingExperience === "" ? null : Number(form.drivingExperience),
      address: form.address,
    });
    close();
  };

  const handleDelete = (c) => {
    if (window.confirm(`Delete customer "${c.name}" (${c.ic})? This removes the customer record; their past bookings are not affected.`)) {
      onDeleteCustomer(c.id);
    }
  };

  const th = { textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 12.5, color: C.textPri, background: C.surface, outline: "none", boxSizing: "border-box" };
  const actionBtn = (color) => ({ padding: "3px 8px", fontSize: 10.5, fontWeight: 600, background: "none", border: `1px solid ${color}`, color, borderRadius: 6, cursor: "pointer", marginRight: 6 });

  // Booking history for the viewed customer.
  const viewBookings = selected ? bookings.filter((b) => normIC(b.ic) === normIC(selected.ic)) : [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Customers</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>Customer directory — add, edit, and review rental history</div>
        </div>
        <Btn primary onClick={openAdd}>＋ Add New Customer</Btn>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16 }}>
        {summary.map((s) => (
          <Card key={s.label}>
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 15 }}>{s.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.textMuted }}>{s.label}</span>
              </div>
              <div style={{ ...mono, fontSize: 18, fontWeight: 700, color: C.navy }}>
                {s.money ? fmt(Math.round(s.value)) : s.value}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Search */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>Search</div>
          <input style={inputStyle} placeholder="Search by name, IC/ID, contact, or license…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Card>

      {/* Directory */}
      <Card>
        <CardHeader title="Customer Directory" right={<Badge>{rows.length} customers</Badge>} />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["Customer", "IC / ID", "Contact", "License", "Type", "Age", "Exp (yrs)", "Bookings", "Total Spent", "Last Rental", "Actions"].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id ?? c.ic} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: C.navy }}>{c.name}</td>
                  <td style={{ padding: "10px 12px", ...mono, fontSize: 11, color: C.textSec }}>{c.ic}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: C.textSec, whiteSpace: "nowrap" }}>{c.contact || "—"}</td>
                  <td style={{ padding: "10px 12px", ...mono, fontSize: 11, color: C.textSec }}>{c.license || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{c.customerType ? <Badge color={C.navyMid} bg={C.bg}>{c.customerType}</Badge> : "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, textAlign: "center" }}>{c.age ?? "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, textAlign: "center" }}>{c.drivingExperience ?? "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, textAlign: "center" }}>{c.stats.count}</td>
                  <td style={{ padding: "10px 12px", ...mono, fontSize: 12, fontWeight: 700, color: C.green, textAlign: "right", whiteSpace: "nowrap" }}>{fmt(Math.round(c.stats.totalSpent))}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>{fmtDate(c.stats.lastRental)}</td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    <button style={actionBtn(C.teal)} onClick={() => openView(c)}>View</button>
                    <button style={actionBtn(C.navyMid)} onClick={() => openEdit(c)}>Edit</button>
                    <button style={actionBtn(C.red)} onClick={() => handleDelete(c)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
            {customers.length === 0 ? "No customers yet. Add one, or they appear automatically when you create bookings." : "No customers match your search."}
          </div>
        )}
      </Card>

      {/* Add / Edit modal */}
      <Modal
        open={mode === "add" || mode === "edit"}
        title={mode === "edit" ? "Edit Customer" : "Add New Customer"}
        onClose={close}
        onSubmit={handleSubmit}
        submitText={mode === "edit" ? "Save Changes" : "Add Customer"}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Input label="IC / ID Number *" value={form.ic} onChange={(e) => setForm({ ...form, ic: e.target.value })} placeholder="e.g. S8901234A" />
          <Input label="Customer Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ahmed Al Mansoori" />
          <Input label="Contact Number" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="e.g. 9501234567" />
          <Input label="Driving License Number" value={form.license} onChange={(e) => setForm({ ...form, license: e.target.value })} placeholder="e.g. DL-2024-88213" />
          <Select label="Customer Type" value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value })} options={CUSTOMER_TYPES} />
          <Input label="Age" type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} placeholder="e.g. 32" />
          <Input label="Driving Experience (years)" type="number" value={form.drivingExperience} onChange={(e) => setForm({ ...form, drivingExperience: e.target.value })} placeholder="e.g. 5" />
        </div>
        <Input label="Rental / Home Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="e.g. 02-81 Pandan Gardens, Block 410, Singapore" />
        {error && <div style={{ background: C.redFaint, color: C.red, fontSize: 12, padding: "9px 12px", borderRadius: 8 }}>{error}</div>}
      </Modal>

      {/* View modal */}
      <Modal open={mode === "view"} title="Customer Details" onClose={close} onSubmit={close} submitText="Close">
        {selected && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 16 }}>
              {[
                ["Name", selected.name],
                ["IC / ID", selected.ic],
                ["Contact", selected.contact || "—"],
                ["License", selected.license || "—"],
                ["Customer Type", selected.customerType || "—"],
                ["Age", selected.age ?? "—"],
                ["Driving Experience", selected.drivingExperience != null ? `${selected.drivingExperience} yrs` : "—"],
                ["Address", selected.address || "—"],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{k}</div>
                  <div style={{ fontSize: 12.5, color: C.textPri, marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, margin: "6px 0 8px" }}>
              Rental History ({viewBookings.length})
            </div>
            <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
              {viewBookings.length === 0 ? (
                <div style={{ padding: 16, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No bookings yet</div>
              ) : viewBookings.map((b) => (
                <div key={b.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 11.5 }}>
                  <span style={{ ...mono, color: C.navyMid }}>{b.id}</span>
                  <span style={{ color: C.textSec }}>{b.plate || "—"}</span>
                  <span style={{ color: C.textMuted }}>{fmtDate(b.start)} → {fmtDate(b.end)}</span>
                  <span style={{ ...mono, fontWeight: 700, color: C.green }}>{fmt(Math.round(computeBookingInvoice(b).finalInvoiceTotal || 0))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Customers;
