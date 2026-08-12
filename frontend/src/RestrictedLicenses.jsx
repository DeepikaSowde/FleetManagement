import { useState } from "react";
import { C } from "./theme";
import { Card, CardHeader, Btn, Badge, Input } from "./components";

// Admin-only: manage the list of driving license numbers that are blocked from
// being used on a new booking (e.g. active criminal case, court order). Lives in
// the Customers module. The parent gates mounting on the Admin role, so Staff
// never see this panel at all — not just visually hidden. Booking creation still
// reads the blocklist regardless of role (that read is a separate, open path).
const EMPTY_DRAFT = { licenseNumber: "", reason: "" };

export default function RestrictedLicenses({ licenses = [], onAdd, onUpdate, onDelete }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const startAdd = () => { setDraft(EMPTY_DRAFT); setEditingId(null); setAdding(true); };
  const startEdit = (l) => { setDraft({ licenseNumber: l.licenseNumber, reason: l.reason }); setEditingId(l.id); setAdding(true); };
  const cancel = () => { setAdding(false); setEditingId(null); setDraft(EMPTY_DRAFT); };

  const save = () => {
    const licenseNumber = draft.licenseNumber.trim().toUpperCase();
    const reason = draft.reason.trim();
    if (!licenseNumber || !reason) {
      alert("Please enter both a license number and a reason.");
      return;
    }
    if (editingId) onUpdate(editingId, { licenseNumber, reason });
    else onAdd({ licenseNumber, reason });
    cancel();
  };

  const handleDelete = (l) => {
    if (window.confirm(`Remove restriction on license "${l.licenseNumber}"?`)) onDelete(l.id);
  };

  return (
    <Card>
      <CardHeader title="Restricted Driving Licenses" right={
        !adding && <Btn small primary id="rl-add" onClick={startAdd}>＋ Add Restriction</Btn>
      } />
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>
          Licenses listed here are blocked from being used on a new booking.
        </div>

        {adding && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 14, background: C.bg }}>
            <Input
              id="rl-license-number"
              label="Driving License Number"
              value={draft.licenseNumber}
              onChange={e => setDraft(d => ({ ...d, licenseNumber: e.target.value.toUpperCase() }))}
              placeholder="e.g., DL-2024-88213"
            />
            <Input
              id="rl-reason"
              label="Reason"
              value={draft.reason}
              onChange={e => setDraft(d => ({ ...d, reason: e.target.value }))}
              placeholder="e.g., Criminal Case, Court Restriction"
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <Btn small id="rl-cancel" onClick={cancel}>Cancel</Btn>
              <Btn small primary id="rl-save" onClick={save}>{editingId ? "Save Changes" : "Add"}</Btn>
            </div>
          </div>
        )}

        {licenses.length === 0 && !adding ? (
          <div style={{ padding: "16px 0", textAlign: "center", color: C.textMuted, fontSize: 12 }}>No restricted licenses</div>
        ) : (
          licenses.map(l => (
            <div key={l.id} data-testid="rl-row" data-license={l.licenseNumber}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, fontFamily: "monospace" }}>{l.licenseNumber}</div>
                <div style={{ fontSize: 10.5, color: C.textMuted }}>{l.reason}</div>
              </div>
              <Badge color={C.red} bg="#fdecea">Restricted</Badge>
              <button data-testid="rl-edit" onClick={() => startEdit(l)}
                style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.teal, cursor: "pointer", fontWeight: 600 }}>
                Edit
              </button>
              <button data-testid="rl-delete" onClick={() => handleDelete(l)}
                style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.red, cursor: "pointer", fontWeight: 600 }}>
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
