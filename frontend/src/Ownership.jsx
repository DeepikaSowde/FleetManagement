import { useState, useMemo } from "react";
import { C } from "./theme";
import { Btn, Input, Select } from "./components";

/* =====================================================================================
   OWNERSHIP (CAP TABLE)
   -------------------------------------------------------------------------------------
   The one place a holding percentage can change. Everything here is a view of
   ownership_events on the server: each event carries the FULL holdings table as
   agreed (totalling 100%), not a delta, and once published it is history.

   Deliberately NOT derived from the money ledger. Dividends, reinvestments and
   exits are cash; they show up on the Investors screens. A percentage moves only
   because the people involved agreed to move it, on a date, for a reason.

   The server owns every rule (100% total, sign-off before publishing, no editing
   an Effective event, no back-dating behind the current table). This page awaits
   the server and shows its refusal message rather than second-guessing it — so
   the UI can never disagree with what was actually recorded.
   ===================================================================================== */

const EVENT_TYPES = [
  "Opening", "New Investor", "Reinvestment", "Exit", "Transfer", "Buyback", "Adjustment",
];

const MODE_LABELS = {
  off: "Straight to the register — no sign-off",
  admin_attest: "Note who agreed (default)",
  investor_signoff: "Every holder must accept",
};

// Colour follows the investor, never their rank, so adding someone new never
// repaints anyone else. Assigned by position in the investor list, which is
// stable (the backend orders investors by created_at).
const SERIES_COLORS = ["#2563EB", "#15803D", "#7C3AED", "#B45309", "#0E7490", "#9D174D", "#4338CA", "#65A30D"];

const STATE_STYLE = {
  Draft:     { color: C.textMuted, bg: C.linen },
  Pending:   { color: C.amber, bg: C.amberFaint },
  Effective: { color: C.green, bg: C.greenFaint },
  Rejected:  { color: C.red, bg: C.redFaint },
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const fmtINR = (n) =>
  n === null || n === undefined || n === "" ? "—"
    : "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

const fmtPct = (n) => (Number(n) || 0).toFixed(2) + "%";

const fmtDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${MON[Number(m) - 1]} ${y}`;
};

// Indian short form, for the implied-valuation readout where the exact rupee
// is less useful than the order of magnitude.
const fmtCrLakh = (n) => {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1e7) return "₹" + (v / 1e7).toFixed(2) + " Cr";
  if (v >= 1e5) return "₹" + (v / 1e5).toFixed(2) + " L";
  return fmtINR(v);
};

/* ---- Holdings in force on a date = the latest Effective event on or before it ---- */
export function holdingsAsOf(events, dateIso) {
  const effective = (events || [])
    .filter((e) => e.state === "Effective" && e.effectiveDate <= dateIso)
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0));
  const latest = effective[effective.length - 1];
  return latest ? latest.holdings : [];
}

const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 };
const th = { fontSize: 10.5, fontWeight: 700, color: C.textMuted, letterSpacing: 0.4, textTransform: "uppercase", textAlign: "left", padding: "8px 12px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
const td = { fontSize: 12.5, color: C.textPri, padding: "9px 12px", borderBottom: `1px solid ${C.linen}` };

/* =========================================================================== ATOMS === */
function StatePill({ state }) {
  const s = STATE_STYLE[state] || STATE_STYLE.Draft;
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: s.color, background: s.bg, padding: "3px 9px", borderRadius: 20 }}>
      {state}
    </span>
  );
}

function Swatch({ color }) {
  return <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: "inline-block", flex: "none" }} />;
}

function Empty({ title, message, actionLabel, onAction }) {
  return (
    <div style={{ ...card, textAlign: "center", padding: "44px 20px" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: C.textMuted, maxWidth: 460, margin: "0 auto 16px" }}>{message}</div>
      {actionLabel && <Btn primary onClick={onAction}>{actionLabel}</Btn>}
    </div>
  );
}

/* ================================================================ TIMELINE CHART === */
// Ownership is a staircase, not a curve — flat until an agreed event moves it —
// so the bands are drawn step-after. Only Effective events appear: a draft that
// nobody has agreed to has not changed who owns anything.
function OwnershipTimeline({ events, investors, colorOf }) {
  const effective = useMemo(
    () => (events || [])
      .filter((e) => e.state === "Effective")
      .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1)),
    [events]
  );

  if (effective.length === 0) return null;

  const W = 860, H = 320;
  const padL = 44, padR = 116, padT = 34, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const t0 = Date.parse(effective[0].effectiveDate);
  // Run the axis to today, or a little past the last event if it is dated ahead.
  const lastEvent = Date.parse(effective[effective.length - 1].effectiveDate);
  const t1 = Math.max(Date.parse(todayIso()), lastEvent + 86400000 * 60);
  const span = Math.max(t1 - t0, 86400000);

  const x = (t) => padL + ((t - t0) / span) * plotW;
  const y = (p) => padT + ((100 - p) / 100) * plotH;

  // Everyone who has ever appeared in an effective table, in investor order.
  const ids = investors.map((i) => i.id).filter((id) => effective.some((e) => e.holdings.some((h) => h.investorId === id)));

  const valuesAt = (t) => {
    let table = [];
    effective.forEach((e) => { if (t >= Date.parse(e.effectiveDate)) table = e.holdings; });
    return ids.map((id) => {
      const row = table.find((h) => h.investorId === id);
      return row ? Number(row.pct) : 0;
    });
  };

  const breaks = effective.map((e) => Date.parse(e.effectiveDate));

  const bands = ids.map((id, si) => {
    const top = [], bottom = [];
    breaks.forEach((t, bi) => {
      const tNext = bi + 1 < breaks.length ? breaks[bi + 1] : t1;
      const vals = valuesAt(t);
      let base = 0;
      for (let k = 0; k < si; k++) base += vals[k];
      const upper = base + vals[si];
      top.push([x(t), y(upper)], [x(tNext), y(upper)]);
      bottom.push([x(t), y(base)], [x(tNext), y(base)]);
    });
    bottom.reverse();
    const pts = top.concat(bottom);
    return {
      id,
      d: "M" + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L") + "Z",
      color: colorOf(id),
    };
  });

  const endVals = valuesAt(t1);
  let acc = 0;
  const endLabels = ids.map((id, i) => {
    const mid = acc + endVals[i] / 2;
    acc += endVals[i];
    return { id, mid, pct: endVals[i], name: investors.find((v) => v.id === id)?.name || id };
  }).filter((l) => l.pct > 0);

  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: C.navy }}>Ownership over time</div>
      <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 3, marginBottom: 14 }}>
        Share of company, %. Flat until an agreed event moves it — every step below is a published entry.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginBottom: 12 }}>
        {ids.map((id) => (
          <span key={id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: C.textSec }}>
            <Swatch color={colorOf(id)} />
            {investors.find((v) => v.id === id)?.name || id}
          </span>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 620, height: "auto", display: "block" }}>
          {[0, 25, 50, 75, 100].map((p) => (
            <g key={p}>
              <line x1={padL} x2={padL + plotW} y1={y(p)} y2={y(p)} stroke={C.linen} strokeWidth="1" />
              <text x={padL - 8} y={y(p) + 3.5} textAnchor="end" fontSize="10.5" fill={C.textMuted}>{p}%</text>
            </g>
          ))}

          {/* 2px surface-coloured stroke is what opens the gap between fills. */}
          {bands.map((b) => (
            <path key={b.id} d={b.d} fill={b.color} stroke={C.surface} strokeWidth="2" strokeLinejoin="round" />
          ))}

          {effective.map((e) => {
            const tx = x(Date.parse(e.effectiveDate));
            return (
              <g key={e.id}>
                <line x1={tx} x2={tx} y1={padT - 10} y2={padT + plotH} stroke={C.border} strokeWidth="1" strokeDasharray="3 3" />
                <text x={tx + 4} y={padT - 14} fontSize="9.5" fill={C.textMuted}>{e.type}</text>
              </g>
            );
          })}

          <line x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH} stroke={C.border} strokeWidth="1" />
          <text x={padL} y={padT + plotH + 18} fontSize="10" fill={C.textMuted}>{fmtDate(effective[0].effectiveDate)}</text>
          <text x={padL + plotW} y={padT + plotH + 18} fontSize="10" fill={C.textMuted} textAnchor="end">{fmtDate(new Date(t1).toISOString().slice(0, 10))}</text>

          {/* Direct labels, so identity never rests on colour alone. */}
          {endLabels.map((l) => (
            <text key={l.id} x={padL + plotW + 10} y={y(l.mid) + 4} fontSize="11" fontWeight="600" fill={colorOf(l.id)}>
              {l.name.length > 12 ? l.name.slice(0, 11) + "…" : l.name} {l.pct.toFixed(0)}%
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}

/* =============================================================== EVENT FORM MODAL === */
// Wider than the shared Modal because the whole holdings table is entered here —
// that is the point: you restate what everyone holds AFTER the change, and the
// total has to come to 100 before it can be saved.
// Mounted only while open (the caller renders it conditionally), so every open
// starts from the table as it actually stands rather than from whatever was
// half-typed last time.
function EventFormModal({ investors, currentHoldings, onClose, onSave }) {
  const [type, setType] = useState("New Investor");
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [newMoneyAmount, setNewMoneyAmount] = useState("");
  const [newMoneyInvestorId, setNewMoneyInvestorId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Seeded from the current table so the admin edits from reality rather than
  // typing every percentage from scratch.
  const [pcts, setPcts] = useState(() => {
    const next = {};
    investors.forEach((inv) => {
      const row = currentHoldings.find((h) => h.investorId === inv.id);
      next[inv.id] = row ? String(Number(row.pct)) : "";
    });
    return next;
  });

  const before = (id) => {
    const row = currentHoldings.find((h) => h.investorId === id);
    return row ? Number(row.pct) : null;
  };

  const rows = investors.map((inv) => ({
    inv,
    before: before(inv.id),
    after: pcts[inv.id] === "" || pcts[inv.id] === undefined ? null : Number(pcts[inv.id]),
  }));

  const total = rows.reduce((s, r) => s + (Number.isFinite(r.after) ? r.after : 0), 0);
  const balanced = Math.abs(total - 100) <= 0.01;

  // Plain arithmetic on what has already been typed — never a valuation of our
  // own. Shown so the group can see the basis they are agreeing to.
  const money = parseFloat(newMoneyAmount) || 0;
  const buyerPct = newMoneyInvestorId ? Number(pcts[newMoneyInvestorId]) : 0;
  const impliedPost = money > 0 && buyerPct > 0 ? (money / buyerPct) * 100 : null;
  const impliedPre = impliedPost === null ? null : impliedPost - money;

  const submit = async () => {
    setError("");
    if (!effectiveDate) return setError("Pick the date this change takes effect.");
    if (!balanced) return setError(`Holdings must total 100% — this table totals ${total.toFixed(2)}%.`);

    const holdings = rows
      .filter((r) => Number.isFinite(r.after) && r.after > 0)
      .map((r) => ({ investorId: r.inv.id, pct: r.after }));

    setSaving(true);
    try {
      await onSave({
        type,
        effectiveDate,
        reason: reason || null,
        newMoneyAmount: money > 0 ? money : null,
        newMoneyInvestorId: newMoneyInvestorId || null,
        holdings,
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: C.surface, borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", zIndex: 201, width: "min(720px, calc(100vw - 24px))", maxHeight: "90vh", overflowY: "auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Record an ownership change</div>
            <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
              Enter what everyone holds <b>after</b> the change. It saves as a draft first.
            </div>
          </div>
          <div onClick={onClose} style={{ cursor: "pointer", fontSize: 18, color: C.textMuted }}>✕</div>
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}
              options={EVENT_TYPES.map((t) => ({ value: t, label: t }))} />
            <Input label="Effective date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Input label="Money coming in (₹, optional)" type="number" value={newMoneyAmount}
              onChange={(e) => setNewMoneyAmount(e.target.value)} placeholder="e.g., 3000000" />
            <Select label="…from which investor" value={newMoneyInvestorId}
              onChange={(e) => setNewMoneyInvestorId(e.target.value)}
              options={investors.map((i) => ({ value: i.id, label: i.name }))} />
          </div>

          <Input label="Reason — in the group's own words" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., D invests ₹30,00,000 at ₹1.20 Cr pre-money, agreed 28 Mar" />

          {impliedPost !== null && (
            <div style={{ background: C.blueFaint, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: C.textSec }}>
              At {fmtPct(buyerPct)} for {fmtINR(money)}, this implies a{" "}
              <b style={{ color: C.navy }}>{fmtCrLakh(impliedPre)} pre-money</b> /{" "}
              <b style={{ color: C.navy }}>{fmtCrLakh(impliedPost)} post-money</b> valuation.
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
                Arithmetic on the numbers above — FleetOpz is not valuing your business. It is here so
                everyone can see the basis they are agreeing to.
              </div>
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 600, color: C.textPri, marginBottom: 6 }}>Holdings after this change</div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 6 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Investor</th>
                  <th style={{ ...th, textAlign: "right" }}>Before</th>
                  <th style={{ ...th, textAlign: "right", width: 150 }}>After %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.inv.id}>
                    <td style={td}>{r.inv.name}</td>
                    <td style={{ ...td, textAlign: "right", color: C.textMuted }}>
                      {r.before === null ? "—" : fmtPct(r.before)}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <input
                        type="number" step="0.01" min="0" max="100"
                        value={pcts[r.inv.id] ?? ""}
                        onChange={(e) => setPcts({ ...pcts, [r.inv.id]: e.target.value })}
                        placeholder="0"
                        style={{ width: 110, padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12.5, textAlign: "right", fontFamily: "inherit", outline: "none" }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...td, fontWeight: 700, borderBottom: "none", background: C.linen }}>Total</td>
                  <td style={{ ...td, borderBottom: "none", background: C.linen }} />
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none", background: C.linen, color: balanced ? C.green : C.red }}>
                    {total.toFixed(2)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: balanced ? C.textMuted : C.red, marginBottom: 4 }}>
            {balanced
              ? "Totals 100% — ready to save as a draft."
              : `Off by ${(total - 100).toFixed(2)} points. Leave an investor blank to show they hold nothing.`}
          </div>

          {error && (
            <div style={{ background: C.redFaint, color: C.red, fontSize: 12, padding: "9px 12px", borderRadius: 8, marginTop: 10 }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "20px 24px", borderTop: `1px solid ${C.border}` }}>
          <Btn secondary onClick={onClose}>Cancel</Btn>
          <Btn primary onClick={submit} disabled={saving || !balanced}>
            {saving ? "Saving…" : "Save as draft"}
          </Btn>
        </div>
      </div>
    </>
  );
}

/* ============================================================= ATTESTATION MODAL === */
// admin_attest mode: publishing is gated on recording who agreed and how.
function AttestModal({ onClose, onConfirm }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!text.trim()) return setError("Say who agreed — this is the record an investor will read later.");
    setBusy(true);
    try { await onConfirm(text.trim()); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 210 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: C.surface, borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", zIndex: 211, width: "min(480px, calc(100vw - 24px))" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, fontSize: 15, fontWeight: 700, color: C.navy }}>
          Who agreed to this change?
        </div>
        <div style={{ padding: 24 }}>
          <Input label="Agreed by, and how" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="e.g., All three agreed on the call, 28 Mar 2026" />
          {error && <div style={{ background: C.redFaint, color: C.red, fontSize: 12, padding: "9px 12px", borderRadius: 8 }}>{error}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "20px 24px", borderTop: `1px solid ${C.border}` }}>
          <Btn secondary onClick={onClose}>Cancel</Btn>
          <Btn primary onClick={go} disabled={busy}>{busy ? "Publishing…" : "Publish"}</Btn>
        </div>
      </div>
    </>
  );
}

/* ==================================================================== EVENT CARD === */
function EventCard({ event, investors, colorOf, prevHoldings, mode, onSubmitForApproval, onDecide, onPublish, onDiscard, busyId, error }) {
  const nameOf = (id) => investors.find((i) => i.id === id)?.name || id;
  const beforePct = (id) => {
    const row = (prevHoldings || []).find((h) => h.investorId === id);
    return row ? Number(row.pct) : null;
  };

  const isBusy = busyId === event.id;
  const outstanding = (event.approvals || []).filter((a) => a.decision !== "Accepted").length;

  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.navy }}>{event.type}</span>
            <StatePill state={event.state} />
            <span style={{ fontSize: 11.5, color: C.textMuted }}>effective {fmtDate(event.effectiveDate)}</span>
          </div>
          {event.reason && <div style={{ fontSize: 12, color: C.textSec, marginTop: 5, maxWidth: 620 }}>{event.reason}</div>}
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 5 }}>
            {event.id}
            {event.newMoneyAmount ? ` · ${fmtINR(event.newMoneyAmount)} in from ${nameOf(event.newMoneyInvestorId)}` : ""}
            {event.createdBy ? ` · drafted by ${event.createdBy}` : ""}
          </div>
          {event.attestation && (
            <div style={{ fontSize: 11.5, color: C.textSec, marginTop: 5, fontStyle: "italic" }}>
              Agreed: {event.attestation}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {event.state === "Draft" && mode === "investor_signoff" && (
            <Btn small onClick={() => onSubmitForApproval(event.id)} disabled={isBusy}>Send for approval</Btn>
          )}
          {(event.state === "Draft" || event.state === "Pending") && (
            <Btn small primary onClick={() => onPublish(event)} disabled={isBusy}>Publish</Btn>
          )}
          {event.state !== "Effective" && (
            <Btn small secondary onClick={() => onDiscard(event.id)} disabled={isBusy}>Discard</Btn>
          )}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
          <thead>
            <tr>
              <th style={th}>Investor</th>
              <th style={{ ...th, textAlign: "right" }}>Before</th>
              <th style={{ ...th, textAlign: "right" }}>After</th>
              <th style={{ ...th, textAlign: "right" }}>Change</th>
            </tr>
          </thead>
          <tbody>
            {(event.holdings || []).map((h) => {
              const b = beforePct(h.investorId);
              const delta = b === null ? null : Number(h.pct) - b;
              return (
                <tr key={h.investorId}>
                  <td style={td}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Swatch color={colorOf(h.investorId)} />
                      {h.investorName || nameOf(h.investorId)}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "right", color: C.textMuted }}>{b === null ? "—" : fmtPct(b)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtPct(h.pct)}</td>
                  <td style={{ ...td, textAlign: "right", color: delta === null ? C.textMuted : delta > 0 ? C.green : delta < 0 ? C.red : C.textMuted }}>
                    {delta === null ? "new" : delta === 0 ? "—" : (delta > 0 ? "+" : "") + delta.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {event.state === "Pending" && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 18px", background: C.bg }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.navy, marginBottom: 3 }}>
            Sign-off — {outstanding === 0 ? "all holders have accepted" : `${outstanding} still to answer`}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
            The holders as they stood before this change. One rejection sends the whole event back.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(event.approvals || []).map((a) => (
              <div key={a.investorId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.textPri }}>
                  <Swatch color={colorOf(a.investorId)} />
                  {a.investorName || nameOf(a.investorId)}
                  {a.note && <span style={{ fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>— “{a.note}”</span>}
                </span>
                {a.decision === "Pending" ? (
                  <span style={{ display: "flex", gap: 6 }}>
                    <Btn small onClick={() => onDecide(event.id, a.investorId, "Accepted")} disabled={isBusy}>Accepted</Btn>
                    <Btn small secondary onClick={() => onDecide(event.id, a.investorId, "Rejected")} disabled={isBusy}>Rejected</Btn>
                  </span>
                ) : (
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: a.decision === "Accepted" ? C.green : C.red }}>
                    {a.decision}{a.decidedAt ? ` · ${fmtDate(a.decidedAt)}` : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isBusy && error && (
        <div style={{ borderTop: `1px solid ${C.border}`, background: C.redFaint, color: C.red, fontSize: 12, padding: "10px 18px" }}>
          {error}
        </div>
      )}
    </div>
  );
}

/* ========================================================================= PAGE === */
export default function Ownership({
  investors = [],
  events = [],
  mode = "admin_attest",
  onCreateEvent,
  onSubmitEvent,
  onDecideEvent,
  onPublishEvent,
  onDeleteEvent,
  onChangeMode,
}) {
  const [showForm, setShowForm] = useState(false);
  const [attestFor, setAttestFor] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const colorOf = useMemo(() => {
    const map = {};
    investors.forEach((inv, i) => { map[inv.id] = SERIES_COLORS[i % SERIES_COLORS.length]; });
    return (id) => map[id] || C.textMuted;
  }, [investors]);

  const today = todayIso();
  const current = useMemo(() => holdingsAsOf(events, today), [events, today]);

  // Newest first for reading; the chart re-sorts ascending for the axis.
  const ordered = useMemo(
    () => [...events].sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : 0)),
    [events]
  );

  // The table each event was measured against — the one in force the day before it.
  const holdingsBefore = (event) => {
    const priorDay = new Date(Date.parse(event.effectiveDate) - 86400000).toISOString().slice(0, 10);
    return holdingsAsOf(events.filter((e) => e.id !== event.id), priorDay);
  };

  const run = async (id, fn) => {
    setBusyId(id);
    setError("");
    try { await fn(); }
    catch (err) { setError(err.message); }
    finally { setBusyId(null); }
  };

  const handlePublish = (event) => {
    // admin_attest needs a note first, unless one was already recorded.
    if (mode === "admin_attest" && !event.attestation) return setAttestFor(event);
    run(event.id, () => onPublishEvent(event.id));
  };

  const hasOpening = events.some((e) => e.type === "Opening");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy }}>Ownership</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3, maxWidth: 640 }}>
            The only place a holding percentage changes. Dividends, reinvestments and exits are money —
            they never move these figures on their own. Published entries cannot be edited or deleted.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={mode}
            onChange={(e) => onChangeMode?.(e.target.value)}
            title="How much sign-off a change needs before it can be published"
            style={{ padding: "8px 11px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, fontFamily: "inherit", background: C.surface, color: C.textPri, outline: "none" }}
          >
            {Object.entries(MODE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <Btn primary onClick={() => setShowForm(true)} disabled={investors.length === 0}>
            {hasOpening ? "+ Record change" : "+ Record opening cap table"}
          </Btn>
        </div>
      </div>

      {investors.length === 0 ? (
        <Empty
          title="Add your investors first"
          message="The cap table is built from the investors on this module. Add them under All Investors, then record the opening split here."
        />
      ) : events.length === 0 ? (
        <Empty
          title="No ownership recorded yet"
          message="Start with the opening cap table — who put in what at the beginning, as a percentage. Every later change (a new investor, a reinvestment at a different price, a sale between investors) is recorded against it, and nothing is ever overwritten."
          actionLabel="+ Record opening cap table"
          onAction={() => setShowForm(true)}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Current table, read from the latest published entry. */}
          <div style={{ ...card }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: C.navy }}>Cap table today</div>
              <div style={{ fontSize: 11.5, color: C.textMuted }}>as at {fmtDate(today)}</div>
            </div>
            {current.length === 0 ? (
              <div style={{ fontSize: 12.5, color: C.textMuted }}>
                Nothing published yet — the drafts below have not taken effect.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {current.map((h) => (
                  <div key={h.investorId} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 190px) 1fr 68px", alignItems: "center", gap: 12 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.textPri }}>
                      <Swatch color={colorOf(h.investorId)} />
                      {h.investorName}
                    </span>
                    <span style={{ background: C.linen, borderRadius: 3, height: 16, overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${h.pct}%`, background: colorOf(h.investorId), borderRadius: "0 3px 3px 0" }} />
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, textAlign: "right" }}>{fmtPct(h.pct)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <OwnershipTimeline events={events} investors={investors} colorOf={colorOf} />

          <div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: C.navy, marginBottom: 4 }}>History</div>
            <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 12 }}>
              Newest first. This is what an investor reads when they question their percentage.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ordered.map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  investors={investors}
                  colorOf={colorOf}
                  prevHoldings={holdingsBefore(e)}
                  mode={mode}
                  onSubmitForApproval={(id) => run(id, () => onSubmitEvent(id))}
                  onDecide={(id, investorId, decision) => run(id, () => onDecideEvent(id, investorId, decision))}
                  onPublish={handlePublish}
                  onDiscard={(id) => run(id, () => onDeleteEvent(id))}
                  busyId={busyId}
                  error={error}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <EventFormModal
          investors={investors}
          currentHoldings={current}
          onClose={() => setShowForm(false)}
          onSave={onCreateEvent}
        />
      )}

      {attestFor && (
        <AttestModal
          onClose={() => setAttestFor(null)}
          onConfirm={(text) => onPublishEvent(attestFor.id, text)}
        />
      )}
    </div>
  );
}
