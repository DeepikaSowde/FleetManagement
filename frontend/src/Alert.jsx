import { useState } from "react";
import { C, mono, fmt } from "./theme";
import { Card } from "./components";

// Alerts & Notifications — three real categories, all derived live from
// useFleetData's generateAlerts():
//   • Payment      (type: "monthly_rent") — unpaid rows on active monthly
//     contracts, subtyped by due_soon / due_today / overdue / upcoming.
//   • Renewal      (type: "coe") — vehicle registration expiring within 90d.
//   • Operational  (type: "maintenance" | "return" | "booking") — cars stuck
//     in maintenance, today's returns, tomorrow's pickups.
// No alert data is invented here — everything shown comes from the alerts
// array the app already computes.

const CATEGORY_OF = { monthly_rent: "payment", coe: "renewal", maintenance: "operational", return: "operational", booking: "operational" };

const CATEGORY_TABS = [
  { key: "all", label: "All Alerts" },
  { key: "payment", label: "Payment Alerts" },
  { key: "renewal", label: "Renewal Alerts" },
  { key: "operational", label: "Operational Alerts" },
];

const SECTION_META = {
  payment: { title: "Monthly Rental Payment Alerts", icon: "💲", color: C.red, bg: C.redFaint },
  renewal: { title: "Registration Renewal Alerts", icon: "⚠️", color: C.red, bg: C.redFaint },
  operational: { title: "Operational Alerts", icon: "🔔", color: C.amber, bg: C.amberFaint },
};

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

// Icon chip colour/glyph for one alert row.
const rowVisual = (a) => {
  if (a.type === "monthly_rent") {
    if (a.subtype === "upcoming") return { icon: "📅", bg: C.blueFaint, color: C.blue };
    if (a.subtype === "due_soon") return { icon: "🔔", bg: C.amberFaint, color: C.amber };
    return { icon: "🔔", bg: C.redFaint, color: C.red }; // due_today / overdue
  }
  if (a.type === "coe") return { icon: "❗", bg: C.redFaint, color: C.red };
  if (a.type === "maintenance") return { icon: "🔧", bg: C.amberFaint, color: C.amber };
  if (a.type === "return") return { icon: "🔔", bg: C.amberFaint, color: C.amber };
  if (a.type === "booking") return { icon: "🔔", bg: C.blueFaint, color: C.blue };
  return { icon: "🔔", bg: C.bg, color: C.textMuted };
};

const ROW_TITLE = {
  monthly_rent: { due_soon: "Monthly Rental Due Soon", due_today: "Monthly Rental Due Today", overdue: "Monthly Rental Overdue", upcoming: "Upcoming Monthly Rental" },
  coe: "Registration Renewal Due Soon",
  maintenance: "Maintenance Pending",
  return: "Return Due Today",
  booking: "Booking Starting Tomorrow",
};
const rowTitle = (a) => (a.type === "monthly_rent" ? ROW_TITLE.monthly_rent[a.subtype] : ROW_TITLE[a.type]) || a.msg;

// The colored "due" line under the Due Date / Date value.
const dueLabel = (a) => {
  if (a.type === "monthly_rent") {
    if (a.subtype === "overdue") return { text: `${a.days} day${a.days === 1 ? "" : "s"} overdue`, color: C.red };
    if (a.subtype === "due_today") return { text: "Due today", color: C.red };
    if (a.subtype === "due_soon") return { text: `${a.days} day${a.days === 1 ? "" : "s"} remaining`, color: C.amber };
    return { text: `${a.days} days remaining`, color: C.blue }; // upcoming
  }
  if (a.type === "coe") return { text: `${a.days} day${a.days === 1 ? "" : "s"} remaining`, color: a.urgent ? C.red : C.amber };
  if (a.type === "return") return { text: "Today", color: C.green };
  if (a.type === "booking") return { text: "Tomorrow", color: C.blue };
  if (a.type === "maintenance") return { text: `Day ${a.days}`, color: a.urgent ? C.red : C.amber };
  return { text: "", color: C.textMuted };
};

// The middle "data column(s)" — Due Date + Amount, or Due Date + Vehicle, or
// Date + Booking ID, depending on the alert type.
const rowColumns = (a) => {
  const due = dueLabel(a);
  if (a.type === "monthly_rent") {
    return [
      { label: "Due Date", value: fmtDate(a.dueDate), sub: due.text, subColor: due.color },
      { label: "Amount", value: fmt(a.amount || 0) },
    ];
  }
  if (a.type === "coe") {
    return [
      { label: "Due Date", value: fmtDate(a.dueDate), sub: due.text, subColor: due.color },
      { label: "Vehicle", value: a.plate, isMono: true },
    ];
  }
  return [
    { label: "Date", value: fmtDate(a.dueDate), sub: due.text, subColor: due.color },
    a.bookingId ? { label: "Booking ID", value: a.bookingId, isMono: true } : null,
  ].filter(Boolean);
};

// The action buttons for a row — see the header comment for exactly which
// buttons each alert type/subtype gets; matches the reference design 1:1.
const rowActions = (a, { onOpenBooking, onRenewVehicle, sent, onSend }) => {
  const sendBtn = sent
    ? { label: "✓ Sent", kind: "outline", color: C.textMuted, disabled: true }
    : { label: "Send Reminder", kind: "outline", color: C.blue, onClick: onSend };
  if (a.type === "monthly_rent") {
    if (a.subtype === "due_soon") return [sendBtn, { label: "View Booking", kind: "outline", color: C.blue, onClick: () => onOpenBooking?.(a.bookingId) }];
    if (a.subtype === "due_today" || a.subtype === "overdue") {
      return [{ label: "Collect Payment", kind: "solid", color: C.red, onClick: () => onOpenBooking?.(a.bookingId) }, sendBtn];
    }
    return [{ label: "View Booking", kind: "outline", color: C.blue, onClick: () => onOpenBooking?.(a.bookingId) }]; // upcoming
  }
  if (a.type === "coe") return [{ label: "Renew Now", kind: "outline", color: C.blue, onClick: () => onRenewVehicle?.(a.plate) }];
  if (a.type === "maintenance") return [{ label: "View Vehicle", kind: "outline", color: C.blue, onClick: () => onRenewVehicle?.(a.plate) }];
  return [{ label: "View Booking", kind: "outline", color: C.blue, onClick: () => onOpenBooking?.(a.bookingId) }]; // return / booking
};

const ActionButton = ({ label, kind, color, disabled, onClick }) => (
  <button
    disabled={disabled}
    onClick={(e) => { e.stopPropagation(); onClick?.(); }}
    style={{
      padding: "6px 12px", borderRadius: 8, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap",
      fontFamily: "inherit", cursor: disabled ? "default" : "pointer",
      border: `1px solid ${color}`,
      background: kind === "solid" ? color : "#fff",
      color: kind === "solid" ? "#fff" : color,
      opacity: disabled ? 0.7 : 1,
    }}
  >
    {label}
  </button>
);

const AlertRow = ({ a, onOpenBooking, onRenewVehicle, sent, onSend }) => {
  const v = rowVisual(a);
  const cols = rowColumns(a);
  const acts = rowActions(a, { onOpenBooking, onRenewVehicle, sent, onSend });
  const clickable = a.bookingId ? () => onOpenBooking?.(a.bookingId) : a.plate ? () => onRenewVehicle?.(a.plate) : undefined;

  return (
    <div
      onClick={clickable}
      style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: `1px solid ${C.border}`, cursor: clickable ? "pointer" : "default" }}
    >
      <div style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0, background: v.bg, color: v.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{v.icon}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{rowTitle(a)}</div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>{a.msg}</div>
        {a.customer && <div style={{ fontSize: 11, color: C.textSec, marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>👤 {a.customer}</div>}
      </div>

      {cols.map((c) => (
        <div key={c.label} style={{ minWidth: 100, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>{c.label}</div>
          <div style={{ ...(c.isMono ? mono : {}), fontSize: 12.5, fontWeight: 700, color: C.navy, marginTop: 2 }}>{c.value}</div>
          {c.sub && <div style={{ fontSize: 10.5, fontWeight: 700, color: c.subColor, marginTop: 2 }}>{c.sub}</div>}
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        {acts.map((btn) => <ActionButton key={btn.label} {...btn} />)}
      </div>

      <span style={{ color: C.textMuted, fontSize: 16, flexShrink: 0 }}>›</span>
    </div>
  );
};

const NOTIFICATION_RULES = [
  { label: "Monthly Rental — Due Soon", val: "3 days before due date", channel: "In-App + Email" },
  { label: "Monthly Rental — Overdue", val: "Day after due date", channel: "In-App + Email" },
  { label: "Registration Renewal — Early Warning", val: "90 days before", channel: "In-App + Email" },
  { label: "Registration Renewal — Urgent Warning", val: "30 days before", channel: "In-App + Email" },
  { label: "Booking Starting Tomorrow", val: "Day before start", channel: "In-App" },
  { label: "Rental Ending Today", val: "Day of end", channel: "In-App" },
  { label: "Maintenance Pending", val: "2 days into maintenance", channel: "In-App" },
];

const Alert = ({ alerts = [], onOpenBooking, onRenewVehicle }) => {
  const [tab, setTab] = useState("all");
  const [sentIds, setSentIds] = useState(() => new Set());
  const [showSettings, setShowSettings] = useState(false);

  const markSent = (id) => setSentIds((prev) => new Set(prev).add(id));

  const counts = alerts.reduce((acc, a) => {
    const cat = CATEGORY_OF[a.type] || "operational";
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, { payment: 0, renewal: 0, operational: 0 });

  // Which sections render: all three under "All Alerts", or just the one
  // matching the selected tab.
  const sectionsToShow = tab === "all" ? ["payment", "renewal", "operational"] : [tab];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.navy, lineHeight: 1.1 }}>Alerts &amp; Notifications</div>
          <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 4 }}>{alerts.length} active alert{alerts.length === 1 ? "" : "s"} · In-app &amp; email notifications</div>
        </div>
        <button
          onClick={() => setShowSettings((s) => !s)}
          style={{ padding: "9px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, fontSize: 12.5, fontWeight: 700, color: C.textSec, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          ⚙️ Notification Settings
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {CATEGORY_TABS.map((t) => {
          const isActive = tab === t.key;
          const count = t.key === "all" ? alerts.length : (counts[t.key] || 0);
          return (
            <button
              key={t.key}
              data-testid="alert-tab"
              data-tab={t.key}
              onClick={() => setTab(t.key)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "9px 16px", borderRadius: 10,
                border: `1.5px solid ${isActive ? C.blue : C.border}`,
                background: isActive ? C.blueFaint : C.surface,
                color: isActive ? C.blue : C.textSec,
                fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              }}
            >
              {t.label}
              <span style={{
                fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                background: count > 0 ? C.red : C.bg, color: count > 0 ? "#fff" : C.textMuted,
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Notification Settings — hidden by default, revealed by the header button */}
      {showSettings && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Notification Settings</div>
            <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>Configure when and how alerts are sent</div>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
              {NOTIFICATION_RULES.map((n) => (
                <div key={n.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>{n.label}</div>
                    <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>{n.val} · {n.channel}</div>
                  </div>
                  <div style={{ width: 36, height: 20, borderRadius: 10, background: C.teal, position: "relative", flexShrink: 0 }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, right: 2 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Sections */}
      {sectionsToShow.map((cat) => {
        const meta = SECTION_META[cat];
        const items = alerts.filter((a) => (CATEGORY_OF[a.type] || "operational") === cat);
        return (
          <Card key={cat} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: 26, height: 26, borderRadius: "50%", background: meta.bg, color: meta.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{meta.icon}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, textTransform: "uppercase", letterSpacing: 0.4 }}>{meta.title}</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 999, background: items.length > 0 ? C.red : C.bg, color: items.length > 0 ? "#fff" : C.textMuted }}>{items.length}</span>
            </div>

            {items.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: C.textMuted, fontSize: 12.5 }}>No {meta.title.toLowerCase()} right now.</div>
            ) : (
              <>
                {items.map((a) => (
                  <AlertRow key={a.id} a={a} onOpenBooking={onOpenBooking} onRenewVehicle={onRenewVehicle} sent={sentIds.has(a.id)} onSend={() => markSent(a.id)} />
                ))}
                {tab === "all" && (
                  <div style={{ padding: "12px 20px", textAlign: "center" }}>
                    <button
                      onClick={() => setTab(cat)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700, color: C.blue, display: "inline-flex", alignItems: "center", gap: 6 }}
                    >
                      View All {meta.title} →
                    </button>
                  </div>
                )}
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
};

export default Alert;
