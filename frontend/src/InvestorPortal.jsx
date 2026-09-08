import { useEffect, useState, useCallback } from "react";
import { C } from "./theme";
import { Btn } from "./components";
import { useAuth } from "./context/AuthContext";
import api from "./services/api";

/* =====================================================================================
   INVESTOR PORTAL
   -------------------------------------------------------------------------------------
   What an investor sees when they sign in. Not the fleet app with things hidden —
   a different screen entirely, backed by one endpoint (/api/ownership/me) that
   returns only what belongs to them. The API refuses an investor account
   everything else, so there is nothing here to hide in the first place.

   Its whole job is the sentence "that is not what I expected": their stake now,
   anything waiting on their agreement, and every change that ever moved their
   percentage, with who agreed and why.
   ===================================================================================== */

const fmtINR = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const fmtPct = (n) => (Number(n) || 0).toFixed(2) + "%";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d} ${MON[Number(m) - 1]} ${y}`;
};
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${fmtDate(iso)} at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

const SERIES_COLORS = ["#2563EB", "#15803D", "#7C3AED", "#B45309", "#0E7490", "#9D174D", "#4338CA", "#65A30D"];

const STATE_STYLE = {
  Pending:   { color: C.amber, bg: C.amberFaint },
  Effective: { color: C.green, bg: C.greenFaint },
  Rejected:  { color: C.red, bg: C.redFaint },
};

const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 };
const th = { fontSize: 10.5, fontWeight: 700, color: C.textMuted, letterSpacing: 0.4, textTransform: "uppercase", textAlign: "left", padding: "8px 12px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
const td = { fontSize: 12.5, color: C.textPri, padding: "9px 12px", borderBottom: `1px solid ${C.linen}` };

function StatePill({ state }) {
  const s = STATE_STYLE[state] || { color: C.textMuted, bg: C.linen };
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: s.color, background: s.bg, padding: "3px 9px", borderRadius: 20 }}>
      {state}
    </span>
  );
}

const Swatch = ({ color }) => (
  <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: "inline-block", flex: "none" }} />
);

/* ------------------------------------------------------- the ask, when there is one --- */
// A change waiting on this investor. Deliberately the loudest thing on the page:
// nothing takes effect until they answer, so burying it would defeat the point.
function ApprovalRequest({ event, meId, colorOf, priorTable, onDecide, busy }) {
  const [note, setNote] = useState("");
  const beforeOf = (id) => {
    const row = (priorTable || []).find((h) => h.investorId === id);
    return row ? Number(row.pct) : null;
  };
  const myBefore = beforeOf(meId);
  const myAfter = Number((event.holdings.find((h) => h.investorId === meId) || {}).pct || 0);

  return (
    <div style={{ ...card, borderLeft: `3px solid ${C.amber}`, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>{event.type}</span>
          <StatePill state="Pending" />
          <span style={{ fontSize: 11.5, color: C.textMuted }}>would take effect {fmtDate(event.effectiveDate)}</span>
        </div>
        <div style={{ fontSize: 13, color: C.textSec, marginTop: 8 }}>
          Your holding would go from{" "}
          <b style={{ color: C.navy }}>{myBefore === null ? "—" : fmtPct(myBefore)}</b> to{" "}
          <b style={{ color: myAfter < (myBefore ?? 0) ? C.amber : C.green }}>{fmtPct(myAfter)}</b>.
        </div>
        {event.reason && (
          <div style={{ fontSize: 12.5, color: C.textSec, marginTop: 8, fontStyle: "italic" }}>“{event.reason}”</div>
        )}
        {event.newMoneyAmount ? (
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 6 }}>
            {fmtINR(event.newMoneyAmount)} coming into the business with this change.
          </div>
        ) : null}
        {/* The basis, not just the outcome — this is what makes the proposal
            something an investor can actually judge. */}
        {event.preMoneyValuation ? (
          <div style={{ fontSize: 12, color: C.textSec, marginTop: 6 }}>
            Priced on an agreed valuation of{" "}
            <b style={{ color: C.navy }}>{fmtINR(event.preMoneyValuation)}</b> before the money
            {event.newMoneyAmount
              ? <>, <b style={{ color: C.navy }}>{fmtINR(event.preMoneyValuation + event.newMoneyAmount)}</b> after</>
              : null}.
          </div>
        ) : null}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Investor</th>
            <th style={{ ...th, textAlign: "right" }}>Now</th>
            <th style={{ ...th, textAlign: "right" }}>Proposed</th>
          </tr>
        </thead>
        <tbody>
          {event.holdings.map((h) => {
            const b = beforeOf(h.investorId);
            const isMe = h.investorId === meId;
            return (
              <tr key={h.investorId} style={isMe ? { background: C.tealFaint } : undefined}>
                <td style={td}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Swatch color={colorOf(h.investorId)} />
                    {h.investorName}{isMe && <b style={{ color: C.teal, fontSize: 11 }}>you</b>}
                  </span>
                </td>
                <td style={{ ...td, textAlign: "right", color: C.textMuted }}>{b === null ? "—" : fmtPct(b)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{fmtPct(h.pct)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ padding: "16px 20px", background: C.bg, borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note (optional) — it is kept with your answer"
          style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: C.surface, color: C.textPri }}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Btn primary disabled={busy} onClick={() => onDecide(event.id, "Accepted", note)}>Accept this change</Btn>
          <Btn secondary disabled={busy} onClick={() => onDecide(event.id, "Rejected", note)}>Reject</Btn>
          <span style={{ fontSize: 11.5, color: C.textMuted }}>
            Rejecting sends the whole change back to be renegotiated — nothing moves.
          </span>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- history card --- */
function HistoryCard({ event, meId, colorOf, priorTable }) {
  const beforeOf = (id) => {
    const row = (priorTable || []).find((h) => h.investorId === id);
    return row ? Number(row.pct) : null;
  };
  const myAnswer = (event.approvals || []).find((a) => a.investorId === meId);

  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: C.navy }}>{event.type}</span>
          <StatePill state={event.state} />
          <span style={{ fontSize: 11.5, color: C.textMuted }}>{fmtDate(event.effectiveDate)}</span>
        </div>
        {event.reason && <div style={{ fontSize: 12, color: C.textSec, marginTop: 5 }}>{event.reason}</div>}
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 5 }}>
          {event.id}
          {event.newMoneyAmount ? ` · ${fmtINR(event.newMoneyAmount)} in` : ""}
        </div>
        {event.attestation && (
          <div style={{ fontSize: 11.5, color: C.textSec, marginTop: 5, fontStyle: "italic" }}>Agreed: {event.attestation}</div>
        )}
        {myAnswer && myAnswer.decision !== "Pending" && (
          <div style={{ fontSize: 11.5, marginTop: 5, color: myAnswer.decision === "Accepted" ? C.green : C.red, fontWeight: 700 }}>
            You {myAnswer.decision.toLowerCase()} this{myAnswer.decidedAt ? ` on ${fmtDateTime(myAnswer.decidedAt)}` : ""}{myAnswer.note ? ` — “${myAnswer.note}”` : ""}
          </div>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 380 }}>
          <tbody>
            {event.holdings.map((h) => {
              const b = beforeOf(h.investorId);
              const delta = b === null ? null : Number(h.pct) - b;
              const isMe = h.investorId === meId;
              return (
                <tr key={h.investorId} style={isMe ? { background: C.tealFaint } : undefined}>
                  <td style={td}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Swatch color={colorOf(h.investorId)} />
                      {h.investorName}{isMe && <b style={{ color: C.teal, fontSize: 11 }}>you</b>}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "right", color: C.textMuted, width: 90 }}>{b === null ? "—" : fmtPct(b)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700, width: 90 }}>{fmtPct(h.pct)}</td>
                  <td style={{ ...td, textAlign: "right", width: 80, color: delta === null ? C.textMuted : delta > 0 ? C.green : delta < 0 ? C.red : C.textMuted }}>
                    {delta === null ? "new" : delta === 0 ? "—" : (delta > 0 ? "+" : "") + delta.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ================================================================== THE PORTAL === */
export default function InvestorPortal() {
  const { user, logout } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get("/ownership/me"));
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const colorOf = (id) => {
    const order = [...new Set((data?.currentTable || []).map((h) => h.investorId).concat(
      (data?.events || []).flatMap((e) => e.holdings.map((h) => h.investorId))
    ))];
    const i = order.indexOf(id);
    return SERIES_COLORS[(i < 0 ? 0 : i) % SERIES_COLORS.length];
  };

  // The table each event was measured against — the one in force the day before.
  const priorTableFor = (event) => {
    const day = new Date(Date.parse(event.effectiveDate) - 86400000).toISOString().slice(0, 10);
    const earlier = (data?.events || [])
      .filter((e) => e.state === "Effective" && e.id !== event.id && e.effectiveDate <= day)
      .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
    const latest = earlier[earlier.length - 1];
    return latest ? latest.holdings : [];
  };

  const decide = async (eventId, decision, note) => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/ownership/${eventId}/decide`, { decision, note });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const shell = (children) => (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
      <header style={{ background: C.navy, color: "#fff", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: 0.2 }}>FleetOpz</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>Investor access</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{user?.name || user?.username}</div>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)" }}>Investor</div>
          </div>
          <button
            onClick={logout}
            style={{ padding: "7px 13px", fontSize: 12, fontWeight: 700, color: "#fff", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8, cursor: "pointer" }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "26px 20px 70px" }}>{children}</main>
    </div>
  );

  if (loading) return shell(<div style={{ color: C.textMuted, fontSize: 13 }}>Loading your investment record…</div>);

  if (!data) {
    return shell(
      <div style={{ ...card }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 6 }}>We couldn't load your record</div>
        <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 14 }}>
          {error || "Please try again."} If this keeps happening, ask the fleet owner to check that your login is linked to your investor record.
        </div>
        <Btn onClick={load}>Try again</Btn>
      </div>
    );
  }

  const meId = data.investor.id;
  const pending = data.pending || [];
  const history = [...(data.events || [])]
    .filter((e) => !pending.some((p) => p.id === e.id))
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1));

  const totalIn = (data.transactions || []).filter((t) => t.flow === "IN").reduce((s, t) => s + t.amount, 0);
  const dividends = (data.transactions || []).filter((t) => t.type && t.type.startsWith("Dividend")).reduce((s, t) => s + t.amount, 0);

  return shell(
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      <div>
        <div style={{ fontSize: 19, fontWeight: 800, color: C.navy }}>{data.investor.name}</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
          Your stake in the business, and every change that has moved it.
        </div>
      </div>

      {error && (
        <div style={{ background: C.redFaint, color: C.red, fontSize: 12.5, padding: "10px 14px", borderRadius: 8 }}>{error}</div>
      )}

      {/* Headline figures. Ownership is the point of this page, so it leads. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div style={{ ...card }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMuted, letterSpacing: 0.4, textTransform: "uppercase" }}>Your holding</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: C.navy, marginTop: 6, lineHeight: 1.1 }}>{fmtPct(data.currentPct)}</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>as at {fmtDate(data.asOf)}</div>
        </div>
        {/* Their share of the ONE valuation the group agreed — shown with the
            company figure it came from, so the sum is checkable by eye. */}
        <div style={{ ...card }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMuted, letterSpacing: 0.4, textTransform: "uppercase" }}>Your stake is worth</div>
          {data.currentValue !== null && data.currentValue !== undefined ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.navy, marginTop: 8 }}>{fmtINR(data.currentValue)}</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                {fmtPct(data.currentPct)} of {fmtINR(data.valuation.amount)}, agreed as at {fmtDate(data.valuation.asOf)}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 8 }}>
              No company valuation has been agreed yet, so your stake is not priced.
            </div>
          )}
        </div>
        <div style={{ ...card }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMuted, letterSpacing: 0.4, textTransform: "uppercase" }}>You have invested</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.navy, marginTop: 8 }}>{fmtINR(totalIn)}</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>across {(data.transactions || []).filter((t) => t.flow === "IN").length} payment(s)</div>
        </div>
        <div style={{ ...card }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textMuted, letterSpacing: 0.4, textTransform: "uppercase" }}>Dividends received</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.green, marginTop: 8 }}>{fmtINR(dividends)}</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>never affects your holding %</div>
        </div>
      </div>

      {pending.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>
              Waiting on you ({pending.length})
            </div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              This change does not take effect until every current holder accepts it.
            </div>
          </div>
          {pending.map((e) => (
            <ApprovalRequest
              key={e.id}
              event={e}
              meId={meId}
              colorOf={colorOf}
              priorTable={priorTableFor(e)}
              onDecide={decide}
              busy={busy}
            />
          ))}
        </div>
      )}

      {/* Who owns what right now — an investor can only judge their own share
          against the whole table. */}
      {(data.currentTable || []).length > 0 && (
        <div style={{ ...card }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.navy, marginBottom: 12 }}>Cap table today</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {data.currentTable.map((h) => (
              <div key={h.investorId} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 180px) 1fr 68px", alignItems: "center", gap: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.textPri }}>
                  <Swatch color={colorOf(h.investorId)} />
                  {h.investorName}
                  {h.investorId === meId && <b style={{ color: C.teal, fontSize: 11 }}>you</b>}
                </span>
                <span style={{ background: C.linen, borderRadius: 3, height: 16, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${h.pct}%`, background: colorOf(h.investorId), borderRadius: "0 3px 3px 0" }} />
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, textAlign: "right" }}>{fmtPct(h.pct)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>Every change to the register</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2, marginBottom: 12 }}>
          Newest first. Published entries cannot be edited or deleted — a correction is a new dated entry.
        </div>
        {history.length === 0 ? (
          <div style={{ ...card, fontSize: 12.5, color: C.textMuted }}>Nothing recorded yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {history.map((e) => (
              <HistoryCard key={e.id} event={e} meId={meId} colorOf={colorOf} priorTable={priorTableFor(e)} />
            ))}
          </div>
        )}
      </div>

      {(data.transactions || []).length > 0 && (
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: C.navy }}>Your money</div>
            <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
              Kept separately from the register above — none of these move your percentage.
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Type</th>
                  <th style={th}>Description</th>
                  <th style={{ ...th, textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {[...data.transactions].reverse().map((t) => (
                  <tr key={t.id}>
                    <td style={td}>{fmtDate(t.date)}</td>
                    <td style={td}>{t.type}</td>
                    <td style={{ ...td, color: C.textMuted }}>{t.description || "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: t.flow === "IN" ? C.navy : C.green }}>
                      {t.flow === "IN" ? "" : "+"}{fmtINR(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
