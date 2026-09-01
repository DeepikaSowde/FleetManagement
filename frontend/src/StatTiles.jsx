import { C } from "./theme";
import { Card } from "./components";

// Reusable row of 6 fleet/customer/booking stat tiles. Shared by the Ledger
// Dashboard and the Fleet page so both stay visually identical. Colours align
// with the app's bright theme: a coloured icon chip + a dark value.
const VIZ = { teal: "#0EA5A5", green: "#16A34A", blue: "#2563EB", amber: "#D97706", purple: "#8B5CF6" };
const tint = (hex) => `${hex}1A`;
const cardStyle = { background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px rgba(16,24,40,0.05)" };

export default function StatTiles({ totalVehicles = 0, onRent = 0, available = 0, maintenance = 0, totalCustomers = 0, totalBookings = 0 }) {
  const totalV = totalVehicles || 1;
  const tiles = [
    { label: "Total Vehicles", value: totalVehicles, icon: "🚗", color: VIZ.teal, sub: "All vehicles" },
    { label: "Available", value: available, icon: "✅", color: VIZ.green, sub: `${Math.round((available / totalV) * 100)}%` },
    { label: "On Rent", value: onRent, icon: "🔑", color: VIZ.blue, sub: `${Math.round((onRent / totalV) * 100)}%` },
    { label: "Under Maintenance", value: maintenance, icon: "🔧", color: VIZ.amber, sub: `${Math.round((maintenance / totalV) * 100)}%` },
    { label: "Total Customers", value: totalCustomers, icon: "👥", color: VIZ.purple, sub: "All customers" },
    { label: "Total Bookings", value: totalBookings, icon: "📅", color: VIZ.teal, sub: "All time" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
      {tiles.map((t) => (
        <Card key={t.label} style={cardStyle}>
          <div style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: tint(t.color), color: t.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{t.icon}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9.5, color: C.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.navy, lineHeight: 1.15 }}>{t.value}</div>
              <div style={{ fontSize: 9.5, color: C.textMuted }}>{t.sub}</div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
