import { useState } from "react";
import { C } from "./theme";
import { Card, CardHeader, Btn, Badge, Input, Select } from "./components";

const FIELD_DEFS = [
  { key: "companyName", label: "Company Name", type: "text" },
  { key: "currency",    label: "Currency",      type: "select", opts: [
      { value: "SGD", label: "SGD (Singapore Dollar)" },
      { value: "MYR", label: "MYR (Malaysian Ringgit)" },
      { value: "USD", label: "USD (US Dollar)" },
    ] },
  { key: "timezone",    label: "Timezone",      type: "select", opts: [
      { value: "SGT", label: "SGT (UTC+8)" },
      { value: "MYT", label: "MYT (UTC+8)" },
      { value: "UTC", label: "UTC" },
    ] },
  { key: "maintPct",    label: "Default Maintenance %", type: "text" },
  { key: "coeEarly",    label: "COE Alert — Early",     type: "text" },
  { key: "coeUrgent",   label: "COE Alert — Urgent",    type: "text" },
];

const DEFAULT_PROFILE = {
  companyName: "SG Wheels Pte Ltd",
  currency: "SGD",
  timezone: "SGT",
  maintPct: "7.5%",
  coeEarly: "90 days",
  coeUrgent: "30 days",
};

const currencyLabel = (v) => ({ SGD: "SGD (Singapore Dollar)", MYR: "MYR (Malaysian Ringgit)", USD: "USD (US Dollar)" }[v] || v);
const timezoneLabel = (v) => ({ SGT: "SGT (UTC+8)", MYT: "MYT (UTC+8)", UTC: "UTC" }[v] || v);

const Settings = ({
  onAddUser,
  currentUserRole = "Staff",
}) => {
  const isAdmin = currentUserRole === "Admin";
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [draft, setDraft] = useState(DEFAULT_PROFILE);
  const [editing, setEditing] = useState(false);

  const startEdit = () => { setDraft(profile); setEditing(true); };
  const cancelEdit = () => { setDraft(profile); setEditing(false); };
  const saveEdit = () => { setProfile(draft); setEditing(false); };
  const setField = (key, value) => setDraft(d => ({ ...d, [key]: value }));

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 4 }}>Settings</div>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 16 }}>Company profile, users, and system configuration</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card>
          <CardHeader title="Company Profile" right={
            editing
              ? <div style={{ display: "flex", gap: 8 }}>
                  <Btn small onClick={cancelEdit}>Cancel</Btn>
                  <Btn small primary onClick={saveEdit}>Save</Btn>
                </div>
              : <Btn small primary onClick={startEdit}>Edit Profile</Btn>
          } />
          <div style={{ padding: 16 }}>
            {!editing ? (
              FIELD_DEFS.map(f => (
                <div key={f.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                  <span style={{ color: C.textMuted }}>{f.label}</span>
                  <span style={{ fontWeight: 600, color: C.navy }}>
                    {f.key === "currency" ? currencyLabel(profile[f.key]) : f.key === "timezone" ? timezoneLabel(profile[f.key]) : profile[f.key]}
                  </span>
                </div>
              ))
            ) : (
              <div>
                {FIELD_DEFS.map(f => (
                  f.type === "select"
                    ? <Select key={f.key} label={f.label} value={draft[f.key]} onChange={e => setField(f.key, e.target.value)} options={f.opts} />
                    : <Input key={f.key} label={f.label} value={draft[f.key]} onChange={e => setField(f.key, e.target.value)} />
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="User Management" right={isAdmin ? <Btn small primary onClick={onAddUser}>＋ Add User</Btn> : null} />
          <div style={{ padding: 16 }}>
            {[
              { name: "Selvakumar", role: "Admin", email: "selva@sgwheels.com" },
              { name: "Kavivarthini", role: "Admin", email: "kavi@sgwheels.com" },
              { name: "Rajan Pillai", role: "Staff", email: "rajan@sgwheels.com" },
              { name: "Li Wei", role: "Staff", email: "liwei@sgwheels.com" },
            ].map(u => (
              <div key={u.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: u.role === "Admin" ? C.navy : C.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                  {u.name[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>{u.name}</div>
                  <div style={{ fontSize: 10.5, color: C.textMuted }}>{u.email}</div>
                </div>
                <Badge color={u.role === "Admin" ? C.navy : C.teal} bg={u.role === "Admin" ? C.bg : C.tealFaint}>{u.role}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Settings;