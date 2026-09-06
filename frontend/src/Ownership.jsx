import { useState, useMemo, useEffect } from "react";
import { C } from "./theme";
import { Btn, Input, Select } from "./components";
import { splitFromValuation } from "./capTableMath";

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
// Wider than the shared Modal because the whole holdings table is entered here.
//
// Two ways in, because groups negotiate in two different currencies:
//
//   From an agreed valuation — the usual one. "We all agree the business is
//   worth ₹1.2 Cr and Divya is putting in ₹30 L." The percentages follow:
//
//       new % = (old % × pre-money + what they put in now) ÷ post-money
//
//   which dilutes everyone who put nothing in, and lets an existing investor
//   reinvest at a share different from the one they already hold — both by the
//   same arithmetic, at the price the group set.
//
//   Percentages directly — when the split was decided some other way and the
//   numbers are simply what everyone agreed.
//
// Either way, what gets STORED is the percentage table. The valuation is kept
// alongside as the provenance behind it, so an investor reading the register in
// four years sees the basis, not just the outcome. FleetOpz never works out a
// valuation of its own — that number comes from the people whose money it is.
//
// Mounted only while open (the caller renders it conditionally), so every open
// starts from the table as it actually stands rather than from whatever was
// half-typed last time.

function EventFormModal({ investors, currentHoldings, prefill, onClose, onSave }) {
  const hasPriorTable = currentHoldings.length > 0;

  // A first-ever table has nothing to dilute, so the money ratio IS the split
  // and there is no valuation to agree yet.
  const [entryMode, setEntryMode] = useState("valuation");

  const [type, setType] = useState(prefill?.type || "New Investor");
  const [effectiveDate, setEffectiveDate] = useState(prefill?.effectiveDate || todayIso());
  const [reason, setReason] = useState("");
  const [preMoney, setPreMoney] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // What each investor is putting in at this event (valuation mode).
  const [contribs, setContribs] = useState(() => {
    const next = {};
    investors.forEach((inv) => { next[inv.id] = ""; });
    if (prefill?.newMoneyInvestorId && prefill?.newMoneyAmount) {
      next[prefill.newMoneyInvestorId] = String(prefill.newMoneyAmount);
    }
    return next;
  });

  // Typed percentages (manual mode), seeded from the table as it stands.
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

  // ── The valuation maths ───────────────────────────────────────────────────
  const V = parseFloat(preMoney) || 0;
  const moneyIn = investors.reduce((s, inv) => s + (parseFloat(contribs[inv.id]) || 0), 0);
  const postMoney = V + moneyIn;

  // Needs a valuation only when there is an existing stake to dilute. For the
  // opening table, splitting the money put in is the whole answer.
  const valuationNeeded = hasPriorTable;
  const canCompute = postMoney > 0 && (!valuationNeeded || V > 0);

  const computed = useMemo(
    () => splitFromValuation(investors, currentHoldings, V, contribs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [V, JSON.stringify(contribs), JSON.stringify(currentHoldings), investors.length]
  );

  // Whichever mode is active supplies the table that will actually be saved.
  const effectivePct = (id) =>
    entryMode === "valuation"
      ? (computed ? computed[id] ?? 0 : 0)
      : (pcts[id] === "" || pcts[id] === undefined ? null : Number(pcts[id]));

  const rows = investors.map((inv) => ({
    inv,
    before: before(inv.id),
    contribution: parseFloat(contribs[inv.id]) || 0,
    after: effectivePct(inv.id),
  }));

  const total = rows.reduce((s, r) => s + (Number.isFinite(r.after) ? r.after : 0), 0);
  const balanced = Math.abs(total - 100) <= 0.01;

  // Moving to manual carries the computed numbers across, so the group can
  // nudge one figure without losing the valuation's work.
  const switchToManual = () => {
    if (computed) {
      const next = { ...pcts };
      investors.forEach((inv) => { next[inv.id] = computed[inv.id] ? String(computed[inv.id]) : ""; });
      setPcts(next);
    }
    setEntryMode("manual");
  };

  const contributors = investors.filter((inv) => (parseFloat(contribs[inv.id]) || 0) > 0);

  const submit = async () => {
    setError("");
    if (!effectiveDate) return setError("Pick the date this change takes effect.");
    if (entryMode === "valuation" && !canCompute) {
      return setError(
        valuationNeeded
          ? "Enter the agreed valuation and at least one amount coming in."
          : "Enter what each investor is putting in."
      );
    }
    if (!balanced) return setError(`Holdings must total 100% — this table totals ${total.toFixed(2)}%.`);

    const holdings = rows
      .filter((r) => Number.isFinite(r.after) && r.after > 0)
      .map((r) => ({
        investorId: r.inv.id,
        pct: r.after,
        contribution: r.contribution > 0 ? r.contribution : null,
      }));

    setSaving(true);
    try {
      await onSave({
        type,
        effectiveDate,
        reason: reason || null,
        // Recorded only when the split actually came from a valuation.
        preMoneyValuation: entryMode === "valuation" && V > 0 ? V : null,
        newMoneyAmount: moneyIn > 0 ? moneyIn : null,
        newMoneyInvestorId: contributors.length === 1 ? contributors[0].id : null,
        holdings,
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const tabBtn = (active) => ({
    padding: "8px 14px",
    fontSize: 12.5,
    fontWeight: 700,
    color: active ? C.surface : C.textSec,
    background: active ? C.teal : "transparent",
    border: `1px solid ${active ? C.teal : C.border}`,
    borderRadius: 8,
    cursor: "pointer",
  });

  const numCell = {
    width: 128, padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 6,
    fontSize: 12.5, textAlign: "right", fontFamily: "inherit", outline: "none",
    background: C.surface, color: C.textPri,
  };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: C.surface, borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", zIndex: 201, width: "min(780px, calc(100vw - 24px))", maxHeight: "90vh", overflowY: "auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Record an ownership change</div>
            <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
              It saves as a draft first — nothing moves until it is published.
            </div>
          </div>
          <div onClick={onClose} style={{ cursor: "pointer", fontSize: 18, color: C.textMuted }}>✕</div>
        </div>

        <div style={{ padding: 24 }}>
          {prefill?.note && (
            <div style={{ background: C.amberFaint, borderLeft: `3px solid ${C.amber}`, borderRadius: "0 8px 8px 0", padding: "11px 14px", marginBottom: 18, fontSize: 12.5, color: C.textSec }}>
              {prefill.note}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}
              options={EVENT_TYPES.map((t) => ({ value: t, label: t }))} />
            <Input label="Effective date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>

          <Input label="Reason — in the group's own words" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., Agreed on the call, 28 Mar — fleet grew to 9 vehicles" />

          {/* ── How the split is being decided ── */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <button type="button" style={tabBtn(entryMode === "valuation")}
              onClick={() => setEntryMode("valuation")}>
              From an agreed valuation
            </button>
            <button type="button" style={tabBtn(entryMode === "manual")} onClick={switchToManual}>
              Enter percentages directly
            </button>
          </div>

          {entryMode === "valuation" ? (
            <>
              {valuationNeeded ? (
                <Input
                  label="Agreed valuation before this money goes in (₹)"
                  type="number" value={preMoney} onChange={(e) => setPreMoney(e.target.value)}
                  placeholder="e.g., 12000000"
                />
              ) : (
                <div style={{ background: C.blueFaint, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: C.textSec }}>
                  This is the opening table, so there is nothing to dilute yet — the split is simply
                  the ratio of what each person is putting in. No valuation needed.
                </div>
              )}

              <div style={{ fontSize: 12, fontWeight: 600, color: C.textPri, marginBottom: 6 }}>
                What is going in now, and what everyone ends up with
              </div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflowX: "auto", marginBottom: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={th}>Investor</th>
                      <th style={{ ...th, textAlign: "right" }}>Now</th>
                      <th style={{ ...th, textAlign: "right", width: 160 }}>Putting in (₹)</th>
                      <th style={{ ...th, textAlign: "right" }}>After</th>
                      <th style={{ ...th, textAlign: "right" }}>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const delta = r.before === null ? null : (Number.isFinite(r.after) ? r.after : 0) - r.before;
                      return (
                        <tr key={r.inv.id}>
                          <td style={td}>{r.inv.name}</td>
                          <td style={{ ...td, textAlign: "right", color: C.textMuted }}>
                            {r.before === null ? "—" : fmtPct(r.before)}
                          </td>
                          <td style={{ ...td, textAlign: "right" }}>
                            <input
                              type="number" min="0" step="1000"
                              value={contribs[r.inv.id] ?? ""}
                              onChange={(e) => setContribs({ ...contribs, [r.inv.id]: e.target.value })}
                              placeholder="0"
                              style={numCell}
                            />
                          </td>
                          <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>
                            {computed ? fmtPct(r.after) : "—"}
                          </td>
                          <td style={{ ...td, textAlign: "right", color: delta === null ? C.textMuted : delta > 0 ? C.green : delta < 0 ? C.red : C.textMuted }}>
                            {!computed ? "—" : delta === null ? "new" : Math.abs(delta) < 0.005 ? "—" : (delta > 0 ? "+" : "") + delta.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ ...td, fontWeight: 700, borderBottom: "none", background: C.linen }}>Total</td>
                      <td style={{ ...td, borderBottom: "none", background: C.linen }} />
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, borderBottom: "none", background: C.linen }}>
                        {moneyIn > 0 ? fmtINR(moneyIn) : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none", background: C.linen, color: balanced ? C.green : C.textMuted }}>
                        {computed ? total.toFixed(2) + "%" : "—"}
                      </td>
                      <td style={{ ...td, borderBottom: "none", background: C.linen }} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {computed ? (
                <div style={{ background: C.greenFaint, border: `1px solid ${C.border}`, borderRadius: 8, padding: "11px 14px", marginBottom: 6, fontSize: 12, color: C.textSec }}>
                  {valuationNeeded ? (
                    <>
                      <b style={{ color: C.navy }}>{fmtCrLakh(V)}</b> before the money, plus{" "}
                      <b style={{ color: C.navy }}>{fmtCrLakh(moneyIn)}</b> going in, values the
                      business at <b style={{ color: C.navy }}>{fmtCrLakh(postMoney)}</b> after.
                      Everyone who is not putting money in keeps{" "}
                      <b style={{ color: C.navy }}>{((V / postMoney) * 100).toFixed(2)}%</b> of the
                      share they held.
                    </>
                  ) : (
                    <>Split in the ratio of the <b style={{ color: C.navy }}>{fmtCrLakh(moneyIn)}</b> being put in.</>
                  )}
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                    These percentages are worked out from the figures you entered — the valuation is
                    the group's, never FleetOpz's. Switch to entering percentages directly if you
                    want to adjust any of them by hand.
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 6 }}>
                  {valuationNeeded
                    ? "Enter the agreed valuation and at least one amount above to see the new split."
                    : "Enter what each investor is putting in to see the split."}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.textPri, marginBottom: 6 }}>
                Holdings after this change
              </div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflowX: "auto", marginBottom: 6 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
                  <thead>
                    <tr>
                      <th style={th}>Investor</th>
                      <th style={{ ...th, textAlign: "right" }}>Before</th>
                      <th style={{ ...th, textAlign: "right", width: 160 }}>After %</th>
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
                            style={numCell}
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
            </>
          )}

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
            {event.newMoneyAmount
              ? ` · ${fmtINR(event.newMoneyAmount)} in${event.newMoneyInvestorId ? ` from ${nameOf(event.newMoneyInvestorId)}` : ""}`
              : ""}
            {event.createdBy ? ` · drafted by ${event.createdBy}` : ""}
          </div>
          {/* The valuation the group agreed, when the split came from one. This
              is the number an investor will want to see years later. */}
          {event.preMoneyValuation ? (
            <div style={{ fontSize: 11.5, color: C.textSec, marginTop: 5 }}>
              Agreed valuation <b style={{ color: C.navy }}>{fmtCrLakh(event.preMoneyValuation)}</b> before the money
              {event.newMoneyAmount
                ? <> · <b style={{ color: C.navy }}>{fmtCrLakh(event.preMoneyValuation + event.newMoneyAmount)}</b> after</>
                : null}
            </div>
          ) : null}
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
  // Set when the admin arrives here straight from adding an investor or
  // recording a reinvestment, so the change is part-filled rather than retyped.
  prefill = null,
  onPrefillConsumed,
}) {
  const [showForm, setShowForm] = useState(false);

  // Arriving with a prefill opens the form on its own — that hand-off is the
  // whole point of it.
  useEffect(() => { if (prefill) setShowForm(true); }, [prefill]);
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
          prefill={prefill}
          onClose={() => { setShowForm(false); onPrefillConsumed?.(); }}
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
