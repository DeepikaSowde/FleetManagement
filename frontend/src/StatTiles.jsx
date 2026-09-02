import { C } from "./theme";
import { Card } from "./components";

// Reusable row of 6 fleet/customer/booking stat tiles. Shared by the Ledger
// Dashboard and the Fleet page. Colours align with the app's bright theme:
// a coloured icon chip (top-right), a dark value, and an optional "View →"
// footer link per tile (passed via `links`, keyed by tile label).
const VIZ = { teal: "#0EA5A5", green: "#16A34A", blue: "#2563EB", amber: "#D97706", purple: "#8B5CF6" };
const tint = (hex) => `${hex}1A`;
const cardStyle = { background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: "0 1px 2px rgba(16,24,40,0.05)" };

export default function StatTiles({ totalVehicles = 0, onRent = 0, available = 0, maintenance = 0, totalCustomers = 0, totalBookings = 0, links = {}, compact = false, showMaintenance = true }) {
  const totalV = totalVehicles || 1;
  // `compact` shrinks each tile ~30% (padding, icon chip, value, min-height) so a
  // dense screen — e.g. the Fleet page — gets the vehicle table into view sooner,
  // without altering the default (roomier) tiles used elsewhere.
  const d = compact
    ? { pad: 12, minH: 88, icon: 38, iconFont: 16, gap: 10, value: 20, linkPad: 8 }
    : { pad: 16, minH: 128, icon: 46, iconFont: 20, gap: 12, value: 24, linkPad: 10 };
  const tiles = [
    { label: "Total Vehicles", value: totalVehicles, icon: "🚗", color: VIZ.teal, sub: "All registered" },
    { label: "Available", value: available, icon: "✅", color: VIZ.green, sub: `${Math.round((available / totalV) * 100)}% available` },
    { label: "On Rent", value: onRent, icon: "🔑", color: VIZ.blue, sub: `${Math.round((onRent / totalV) * 100)}% on rent` },
    // "Under Maintenance" is opt-out (showMaintenance) — the Fleet page hides it.
    ...(showMaintenance ? [{ label: "Under Maintenance", value: maintenance, icon: "🔧", color: VIZ.amber, sub: `${Math.round((maintenance / totalV) * 100)}%` }] : []),
    { label: "Total Customers", value: totalCustomers, icon: "👥", color: VIZ.purple, sub: "All customers" },
    { label: "Total Bookings", value: totalBookings, icon: "📅", color: VIZ.teal, sub: "All time" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
      {tiles.map((t) => {
        const link = links[t.label];
        return (
          <Card key={t.label} style={cardStyle}>
            <div style={{ padding: d.pad, display: "flex", flexDirection: "column", minHeight: d.minH }}>
              <div style={{ display: "flex", alignItems: "center", gap: d.gap }}>
                <div style={{ width: d.icon, height: d.icon, borderRadius: "50%", background: tint(t.color), color: t.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: d.iconFont, flexShrink: 0 }}>{t.icon}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 9.5, color: C.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.label}</div>
                  <div style={{ fontSize: d.value, fontWeight: 800, color: t.color, lineHeight: 1.15 }}>{t.value}</div>
                  <div style={{ fontSize: 10.5, color: C.textMuted }}>{t.sub}</div>
                </div>
              </div>
              {link && (
                <div style={{ marginTop: "auto", borderTop: `1px solid ${C.border}`, marginLeft: -d.pad, marginRight: -d.pad, paddingTop: d.linkPad, paddingLeft: d.pad, paddingRight: d.pad }}>
                  <button onClick={link.onClick} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 700, color: t.color }}>{link.text} →</button>
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
