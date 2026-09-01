import { C } from "./theme";
import { Card } from "./components";

// Reusable row of 6 fleet/customer/booking stat tiles. Shared by the Ledger
// Dashboard and the Fleet page. Colours align with the app's bright theme:
// a coloured icon chip (top-right), a dark value, and an optional "View →"
// footer link per tile (passed via `links`, keyed by tile label).
const VIZ = { teal: "#0EA5A5", green: "#16A34A", blue: "#2563EB", amber: "#D97706", purple: "#8B5CF6" };
const tint = (hex) => `${hex}1A`;
const cardStyle = { background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px rgba(16,24,40,0.05)" };

export default function StatTiles({ totalVehicles = 0, onRent = 0, available = 0, maintenance = 0, totalCustomers = 0, totalBookings = 0, links = {} }) {
  const totalV = totalVehicles || 1;
  const tiles = [
    { label: "Total Vehicles", value: totalVehicles, icon: "🚗", color: VIZ.teal, sub: "All registered" },
    { label: "Available", value: available, icon: "✅", color: VIZ.green, sub: `${Math.round((available / totalV) * 100)}% available` },
    { label: "On Rent", value: onRent, icon: "🔑", color: VIZ.blue, sub: `${Math.round((onRent / totalV) * 100)}% on rent` },
    { label: "Under Maintenance", value: maintenance, icon: "🔧", color: VIZ.amber, sub: `${Math.round((maintenance / totalV) * 100)}%` },
    { label: "Total Customers", value: totalCustomers, icon: "👥", color: VIZ.purple, sub: "All customers" },
    { label: "Total Bookings", value: totalBookings, icon: "📅", color: VIZ.teal, sub: "All time" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
      {tiles.map((t) => {
        const link = links[t.label];
        return (
          <Card key={t.label} style={cardStyle}>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", minHeight: 132 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontSize: 9.5, color: C.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{t.label}</div>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: tint(t.color), color: t.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{t.icon}</div>
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.navy, marginTop: 8, lineHeight: 1.1 }}>{t.value}</div>
              <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 3 }}>{t.sub}</div>
              {link && (
                <button onClick={link.onClick} style={{ marginTop: "auto", paddingTop: 12, background: "none", border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 700, color: t.color }}>{link.text} →</button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
