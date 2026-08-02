import { C, mono } from "./theme";
import { Card } from "./components";

// Reusable row of 6 fleet/customer/booking stat tiles. Shared by the Ledger
// Dashboard and the Fleet page so both stay visually identical.
const VIZ = { blue: "#2a78d6", green: "#008300", violet: "#4a3aa7", yellow: "#eda100", red: "#e34948", aqua: "#1baf7a" };
const tint = (hex) => `${hex}1A`;
const cardStyle = { background: "#ffffff", borderRadius: 14, border: "1px solid #ECECEC", boxShadow: "0 1px 2px rgba(16,24,40,0.06)" };

export default function StatTiles({ totalVehicles = 0, onRent = 0, available = 0, maintenance = 0, totalCustomers = 0, totalBookings = 0 }) {
  const totalV = totalVehicles || 1;
  const tiles = [
    { label: "Total Vehicles", value: totalVehicles, icon: "🚗", color: VIZ.blue, sub: "All vehicles" },
    { label: "On Rent", value: onRent, icon: "🔑", color: VIZ.green, sub: `${Math.round((onRent / totalV) * 100)}%` },
    { label: "Available", value: available, icon: "🚙", color: VIZ.violet, sub: `${Math.round((available / totalV) * 100)}%` },
    { label: "Under Maintenance", value: maintenance, icon: "🔧", color: VIZ.yellow, sub: `${Math.round((maintenance / totalV) * 100)}%` },
    { label: "Total Customers", value: totalCustomers, icon: "👥", color: VIZ.red, sub: "All customers" },
    { label: "Total Bookings", value: totalBookings, icon: "📅", color: VIZ.aqua, sub: "All time" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
      {tiles.map((t) => (
        <Card key={t.label} style={cardStyle}>
          <div style={{ padding: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: tint(t.color), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>{t.icon}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...mono, fontSize: 18, fontWeight: 800, color: t.color, lineHeight: 1.1 }}>{t.value}</div>
              <div style={{ fontSize: 10, color: C.textPri, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.label}</div>
              <div style={{ fontSize: 9, color: C.textMuted }}>{t.sub}</div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
