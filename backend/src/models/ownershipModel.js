// Data-access for the cap table: ownership_events plus their holdings rows and
// sign-offs. Deliberately separate from investorTxModel — money movements and
// ownership are different things, and keeping them apart is what stops a
// dividend (or a late dividend) from quietly moving anyone's percentage.
//
// Every event carries the WHOLE holdings table as agreed, totalling 100%.
// Holdings on any date = the latest Effective event on or before that date,
// so history stays fixed once published.
const db = require("../config/db");
const Settings = require("./settingsModel");

// Percentages are stored to 4 dp; a table is accepted when it totals 100
// within this much. Anything looser is a data-entry mistake, not rounding.
const SUM_TOLERANCE = 0.01;

const EVENT_TYPES = [
  "Opening", "New Investor", "Reinvestment", "Exit", "Transfer", "Buyback", "Adjustment",
];
const STATES = ["Draft", "Pending", "Effective", "Rejected"];
const APPROVAL_MODES = ["off", "admin_attest", "investor_signoff"];

// Errors that are the caller's fault carry a status the error handler honours.
function badRequest(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toEvent(r) {
  if (!r) return null;
  return {
    id: r.id,
    effectiveDate: r.effective_date,
    type: r.type,
    state: r.state,
    reason: r.reason,
    newMoneyAmount: r.new_money_amount === null ? null : Number(r.new_money_amount),
    newMoneyInvestorId: r.new_money_investor_id,
    linkedTxId: r.linked_tx_id,
    attestation: r.attestation,
    attachmentPath: r.attachment_path,
    reversesEventId: r.reverses_event_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    effectiveAt: r.effective_at,
  };
}

const toHolding = (r) => ({ investorId: r.investor_id, pct: Number(r.pct) });

const toApproval = (r) => ({
  investorId: r.investor_id,
  decision: r.decision,
  note: r.note,
  decidedAt: r.decided_at,
});

// ── Validation ──────────────────────────────────────────────────────────────

// Checks the shape of a holdings table before it is written: known investors,
// no duplicates, sane percentages, and a total of 100.
async function validateHoldings(holdings) {
  if (!Array.isArray(holdings) || holdings.length === 0) {
    throw badRequest("At least one holding row is required");
  }

  const seen = new Set();
  let sum = 0;
  for (const h of holdings) {
    if (!h || !h.investorId) throw badRequest("Every holding row needs an investorId");
    if (seen.has(h.investorId)) {
      throw badRequest("Investor " + h.investorId + " appears twice in the holdings table");
    }
    seen.add(h.investorId);

    const pct = Number(h.pct);
    if (!Number.isFinite(pct)) throw badRequest("Holding for " + h.investorId + " is not a number");
    if (pct < 0 || pct > 100) {
      throw badRequest("Holding for " + h.investorId + " must be between 0 and 100");
    }
    sum += pct;
  }

  if (Math.abs(sum - 100) > SUM_TOLERANCE) {
    throw badRequest("Holdings must total 100% — this table totals " + sum.toFixed(4) + "%");
  }

  const ids = [...seen];
  const { rows } = await db.query("SELECT id FROM investors WHERE id = ANY($1::varchar[])", [ids]);
  if (rows.length !== ids.length) {
    const known = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !known.has(id));
    throw badRequest("Unknown investor(s): " + missing.join(", "));
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

async function getEventRow(id, client = db) {
  const { rows } = await client.query("SELECT * FROM ownership_events WHERE id = $1", [id]);
  return rows[0] || null;
}

// Attaches holdings + approvals to a set of event rows in two queries rather
// than one pair per event.
async function hydrate(eventRows) {
  if (eventRows.length === 0) return [];
  const ids = eventRows.map((r) => r.id);

  const [{ rows: hRows }, { rows: aRows }] = await Promise.all([
    db.query(
      `SELECT h.*, i.name AS investor_name FROM ownership_event_holdings h
       JOIN investors i ON i.id = h.investor_id
       WHERE h.event_id = ANY($1::varchar[])
       ORDER BY h.pct DESC, i.name ASC`,
      [ids]
    ),
    db.query(
      `SELECT a.*, i.name AS investor_name FROM ownership_event_approvals a
       JOIN investors i ON i.id = a.investor_id
       WHERE a.event_id = ANY($1::varchar[])
       ORDER BY i.name ASC`,
      [ids]
    ),
  ]);

  const byEvent = {};
  ids.forEach((id) => (byEvent[id] = { holdings: [], approvals: [] }));
  hRows.forEach((r) => byEvent[r.event_id].holdings.push({ ...toHolding(r), investorName: r.investor_name }));
  aRows.forEach((r) => byEvent[r.event_id].approvals.push({ ...toApproval(r), investorName: r.investor_name }));

  return eventRows.map((r) => ({ ...toEvent(r), ...byEvent[r.id] }));
}

// Chronological, so the frontend can render the timeline without re-sorting.
async function getAll() {
  const { rows } = await db.query(
    "SELECT * FROM ownership_events ORDER BY effective_date ASC, created_at ASC"
  );
  return hydrate(rows);
}

async function getById(id) {
  const row = await getEventRow(id);
  if (!row) return null;
  return (await hydrate([row]))[0];
}

// The event that governs `dateIso` — the latest Effective one on or before it.
// Dates are ISO strings (YYYY-MM-DD), so string ordering is date ordering.
async function effectiveEventAsOf(dateIso, client = db) {
  const { rows } = await client.query(
    `SELECT * FROM ownership_events
     WHERE state = 'Effective' AND effective_date <= $1
     ORDER BY effective_date DESC, created_at DESC
     LIMIT 1`,
    [dateIso]
  );
  return rows[0] || null;
}

// Who held what on a given date — this is what dividend splits and the
// ownership chart both read. Empty table before the first Effective event.
async function holdingsAsOf(dateIso) {
  const evt = await effectiveEventAsOf(dateIso);
  if (!evt) return { asOf: dateIso, event: null, holdings: [] };

  const { rows } = await db.query(
    `SELECT h.*, i.name AS investor_name FROM ownership_event_holdings h
     JOIN investors i ON i.id = h.investor_id
     WHERE h.event_id = $1
     ORDER BY h.pct DESC, i.name ASC`,
    [evt.id]
  );
  return {
    asOf: dateIso,
    event: toEvent(evt),
    holdings: rows.map((r) => ({ ...toHolding(r), investorName: r.investor_name })),
  };
}

// The latest Effective event overall — used to stop a back-dated publish from
// silently rewriting history that has already been acted on.
async function latestEffective(client = db) {
  const { rows } = await client.query(
    `SELECT * FROM ownership_events WHERE state = 'Effective'
     ORDER BY effective_date DESC, created_at DESC LIMIT 1`
  );
  return rows[0] || null;
}

// ── Writes ──────────────────────────────────────────────────────────────────

// Runs `fn` inside a transaction so an event and its holdings rows are written
// together or not at all — a half-written cap table is worse than none.
async function inTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function writeHoldings(client, eventId, holdings) {
  await client.query("DELETE FROM ownership_event_holdings WHERE event_id = $1", [eventId]);
  for (const h of holdings) {
    await client.query(
      "INSERT INTO ownership_event_holdings (event_id, investor_id, pct) VALUES ($1,$2,$3)",
      [eventId, h.investorId, Number(h.pct)]
    );
  }
}

async function create(payload, actor) {
  const { id, effectiveDate, type, holdings } = payload;
  if (!id) throw badRequest("id is required");
  if (!effectiveDate) throw badRequest("effectiveDate is required");
  if (!type || !EVENT_TYPES.includes(type)) {
    throw badRequest("type must be one of: " + EVENT_TYPES.join(", "));
  }
  await validateHoldings(holdings);

  // Exactly one Opening event — the starting cap table is by definition unique.
  if (type === "Opening") {
    const { rows } = await db.query("SELECT id FROM ownership_events WHERE type = 'Opening'");
    if (rows.length > 0) {
      throw badRequest(
        "An Opening cap table already exists; record later changes as other event types",
        409
      );
    }
  }

  return inTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO ownership_events
         (id, effective_date, type, state, reason, new_money_amount, new_money_investor_id,
          linked_tx_id, attestation, attachment_path, reverses_event_id, created_by)
       VALUES ($1,$2,$3,'Draft',$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        id, effectiveDate, type, payload.reason ?? null,
        payload.newMoneyAmount ?? null, payload.newMoneyInvestorId ?? null,
        payload.linkedTxId ?? null, payload.attestation ?? null,
        payload.attachmentPath ?? null, payload.reversesEventId ?? null,
        actor ?? null,
      ]
    );
    await writeHoldings(client, id, holdings);
    return toEvent(rows[0]);
  });
}

// Only a Draft can be edited. Pending means people are voting on a specific
// table, and Effective is history — both are changed by a new event instead.
async function update(id, updates) {
  const current = await getEventRow(id);
  if (!current) return null;
  if (current.state !== "Draft") {
    const article = current.state === "Effective" ? "An" : "A";
    throw badRequest(
      article + " " + current.state + " event cannot be edited — record a correcting event instead",
      409
    );
  }
  if (updates.type && !EVENT_TYPES.includes(updates.type)) {
    throw badRequest("type must be one of: " + EVENT_TYPES.join(", "));
  }
  if (updates.holdings !== undefined) await validateHoldings(updates.holdings);

  const e = { ...toEvent(current), ...updates };
  return inTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE ownership_events SET
         effective_date = $2, type = $3, reason = $4, new_money_amount = $5,
         new_money_investor_id = $6, linked_tx_id = $7, attestation = $8,
         attachment_path = $9, reverses_event_id = $10
       WHERE id = $1
       RETURNING *`,
      [
        id, e.effectiveDate, e.type, e.reason ?? null, e.newMoneyAmount ?? null,
        e.newMoneyInvestorId ?? null, e.linkedTxId ?? null, e.attestation ?? null,
        e.attachmentPath ?? null, e.reversesEventId ?? null,
      ]
    );
    if (updates.holdings !== undefined) await writeHoldings(client, id, updates.holdings);
    return toEvent(rows[0]);
  });
}

// Draft → Pending. Seeds the sign-off list with the holders as they stood
// before this event (for the Opening event, everyone named in it) — they are
// the people whose stake this changes.
async function submit(id) {
  const current = await getEventRow(id);
  if (!current) return null;
  if (current.state !== "Draft") {
    throw badRequest(
      "Only a Draft can be sent for approval — this event is " + current.state,
      409
    );
  }

  const prior = await effectiveEventAsOf(current.effective_date);
  return inTransaction(async (client) => {
    const { rows: approverRows } = await client.query(
      "SELECT investor_id FROM ownership_event_holdings WHERE event_id = $1 AND pct > 0",
      [prior ? prior.id : id]
    );

    await client.query("DELETE FROM ownership_event_approvals WHERE event_id = $1", [id]);
    for (const r of approverRows) {
      await client.query(
        "INSERT INTO ownership_event_approvals (event_id, investor_id) VALUES ($1,$2)",
        [id, r.investor_id]
      );
    }

    const { rows } = await client.query(
      "UPDATE ownership_events SET state = 'Pending' WHERE id = $1 RETURNING *",
      [id]
    );
    return toEvent(rows[0]);
  });
}

// One investor's answer. A single rejection sends the whole event back as
// Rejected — the group renegotiates and records a fresh event.
async function decide(eventId, investorId, decision, note) {
  if (!["Accepted", "Rejected"].includes(decision)) {
    throw badRequest("decision must be Accepted or Rejected");
  }
  const current = await getEventRow(eventId);
  if (!current) return null;
  if (current.state !== "Pending") {
    throw badRequest(
      "Only a Pending event can be signed off — this event is " + current.state,
      409
    );
  }

  const { rowCount } = await db.query(
    `UPDATE ownership_event_approvals
     SET decision = $3, note = $4, decided_at = now()
     WHERE event_id = $1 AND investor_id = $2`,
    [eventId, investorId, decision, note ?? null]
  );
  if (rowCount === 0) throw badRequest("That investor is not an approver on this event", 404);

  if (decision === "Rejected") {
    await db.query("UPDATE ownership_events SET state = 'Rejected' WHERE id = $1", [eventId]);
  }
  return getById(eventId);
}

// Draft/Pending → Effective, gated by the tenant's approval mode. Also refuses
// to publish behind the latest Effective event, since back-dating would change
// splits that may already have been paid out.
async function publish(id, { attestation } = {}) {
  const current = await getEventRow(id);
  if (!current) return null;
  if (current.state === "Effective") throw badRequest("This event is already Effective", 409);
  if (current.state === "Rejected") throw badRequest("A Rejected event cannot be published", 409);

  const mode = await Settings.get("ownership_approval_mode");

  if (mode === "investor_signoff") {
    if (current.state !== "Pending") {
      throw badRequest("Send this event for approval before publishing it", 409);
    }
    const { rows } = await db.query(
      "SELECT investor_id, decision FROM ownership_event_approvals WHERE event_id = $1",
      [id]
    );
    const outstanding = rows.filter((r) => r.decision !== "Accepted");
    if (outstanding.length > 0) {
      throw badRequest(
        outstanding.length + " investor(s) have not accepted this change yet",
        409
      );
    }
  } else if (mode === "admin_attest") {
    const attest = attestation ?? current.attestation;
    if (!attest || !String(attest).trim()) {
      throw badRequest("Record who agreed to this change before publishing it");
    }
  }

  const latest = await latestEffective();
  if (latest && current.effective_date < latest.effective_date) {
    throw badRequest(
      "This event is dated " + current.effective_date + ", before the current cap table (" +
      latest.effective_date + "). Record a correcting event dated on or after that instead.",
      409
    );
  }

  const { rows } = await db.query(
    `UPDATE ownership_events
     SET state = 'Effective', effective_at = now(), attestation = COALESCE($2, attestation)
     WHERE id = $1
     RETURNING *`,
    [id, attestation ?? null]
  );
  return toEvent(rows[0]);
}

// Effective events are permanent; anything else can be discarded.
async function remove(id) {
  const current = await getEventRow(id);
  if (!current) return false;
  if (current.state === "Effective") {
    throw badRequest("An Effective event is part of the audit trail and cannot be deleted", 409);
  }
  const { rowCount } = await db.query("DELETE FROM ownership_events WHERE id = $1", [id]);
  return rowCount > 0;
}

// True when the investor appears in any Effective cap table — the investor
// controller uses this to explain why such a profile cannot be deleted.
async function investorIsInCapTable(investorId) {
  const { rows } = await db.query(
    `SELECT 1 FROM ownership_event_holdings h
     JOIN ownership_events e ON e.id = h.event_id
     WHERE h.investor_id = $1 AND e.state = 'Effective'
     LIMIT 1`,
    [investorId]
  );
  return rows.length > 0;
}

module.exports = {
  getAll, getById, holdingsAsOf, create, update, submit, decide, publish, remove,
  investorIsInCapTable, validateHoldings,
  EVENT_TYPES, STATES, APPROVAL_MODES, SUM_TOLERANCE,
};
