import { useMemo, useState } from "react";
import { C, mono, fmt } from "./theme";
import { Card, CardHeader, Badge } from "./components";
import { computeBookingInvoice } from "./useFleetData";

// Read-only customer directory. This app has no separate customers table —
// customer identity lives on the bookings themselves (same design decision the
// IC-lookup in useFleetData relies on). So this page derives the customer list
// by grouping every booking by its customer's IC/ID (or name when no IC),
// exactly like the Ledger derives from earnings/expenses. No backend needed.

const normIC = (ic) => (ic || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? String(d).slice(0, 10) : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const Customers = ({ bookings = [] }) => {
  const [search, setSearch] = useState("");

  // Group bookings into one record per customer.
  const customers = useMemo(() => {
    const map = new Map();
    bookings.forEach((b) => {
      const key = normIC(b.ic) || (b.customer || "").trim().toUpperCase();
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, { key, bookings: [], plates: new Set() });
      }
      const rec = map.get(key);
      rec.bookings.push(b);
      if (b.plate) rec.plates.add(b.plate);
    });

    return [...map.values()].map((rec) => {
      // Most-recent booking wins for the customer's current details.
      const sorted = [...rec.bookings].sort((a, b) => new Date(b.start || 0) - new Date(a.start || 0));
      const latest = sorted[0];
      const activeBookings = rec.bookings.filter((b) => !b.cancelled);
      const totalSpent = activeBookings.reduce((s, b) => s + (computeBookingInvoice(b).finalInvoiceTotal || 0), 0);
      const lastRental = sorted.reduce((max, b) => {
        const d = b.end || b.start;
        return d && (!max || new Date(d) > new Date(max)) ? d : max;
      }, null);
      return {
        key: rec.key,
        name: latest.customer || "—",
        ic: latest.ic || "—",
        contact: latest.contact || "—",
        license: latest.license || "—",
        bookingsCount: rec.bookings.length,
        vehicles: rec.plates.size,
        totalSpent,
        lastRental,
      };
    }).sort((a, b) => b.bookingsCount - a.bookingsCount);
  }, [bookings]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.ic.toLowerCase().includes(q) ||
      c.contact.toLowerCase().includes(q) ||
      c.license.toLowerCase().includes(q)
    );
  }, [customers, search]);

  const totalRevenue = customers.reduce((s, c) => s + c.totalSpent, 0);
  const totalBookings = customers.reduce((s, c) => s + c.bookingsCount, 0);

  const summary = [
    { label: "Total Customers", value: customers.length, icon: "👥", money: false },
    { label: "Total Bookings", value: totalBookings, icon: "📅", money: false },
    { label: "Total Revenue", value: totalRevenue, icon: "💰", money: true },
  ];

  const th = { textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
  const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 12.5, color: C.textPri, background: C.surface, outline: "none", boxSizing: "border-box" };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Customers</div>
        <div style={{ fontSize: 11, color: C.textMuted }}>Everyone who has ever booked — built from your booking history</div>
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
                {["Customer", "IC / ID", "Contact", "License", "Bookings", "Vehicles", "Total Spent", "Last Rental"].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: C.navy }}>{c.name}</td>
                  <td style={{ padding: "10px 12px", ...mono, fontSize: 11, color: C.textSec }}>{c.ic}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: C.textSec, whiteSpace: "nowrap" }}>{c.contact}</td>
                  <td style={{ padding: "10px 12px", ...mono, fontSize: 11, color: C.textSec }}>{c.license}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, textAlign: "center" }}>{c.bookingsCount}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, textAlign: "center" }}>{c.vehicles}</td>
                  <td style={{ padding: "10px 12px", ...mono, fontSize: 12, fontWeight: 700, color: C.green, textAlign: "right", whiteSpace: "nowrap" }}>{fmt(Math.round(c.totalSpent))}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>{fmtDate(c.lastRental)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
            {customers.length === 0 ? "No customers yet — they appear here once you create bookings." : "No customers match your search."}
          </div>
        )}
      </Card>
    </div>
  );
};

export default Customers;
