// Data-access layer for investors — one row per investor (their profile). The
// money movements live in investor_transactions (investorTxModel.js).
const db = require("../config/db");

function toInvestor(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    investorSince: r.investor_since,
    investorCode: r.investor_code,
    pan: r.pan,
    email: r.email,
    phone: r.phone,
    notes: r.notes,
  };
}

async function getAll() {
  const { rows } = await db.query("SELECT * FROM investors ORDER BY created_at ASC");
  return rows.map(toInvestor);
}

async function getById(id) {
  const { rows } = await db.query("SELECT * FROM investors WHERE id = $1", [id]);
  return toInvestor(rows[0]);
}

const formatInvestorId = (n) => "INV-" + String(n).padStart(3, "0");

// What the NEXT investor will be called, without using it up — this feeds the
// read-only Investor ID on the Add Investor form. It's only a preview: the ID
// is really allocated by create(), the moment the investor is actually saved.
async function peekNextId() {
  const { rows } = await db.query("SELECT last_value, is_called FROM investor_id_seq");
  const { last_value, is_called } = rows[0];
  return formatInvestorId(is_called ? Number(last_value) + 1 : Number(last_value));
}

// The server owns the ID: whatever the client sent is ignored. It's drawn from
// the sequence (so it is never reused) and doubles as the display code, and a
// collision with an existing row just draws the next number.
async function create(i) {
  for (let attempt = 0; ; attempt++) {
    const { rows: seq } = await db.query("SELECT nextval('investor_id_seq') AS n");
    const id = formatInvestorId(Number(seq[0].n));
    try {
      const { rows } = await db.query(
        `INSERT INTO investors (id, name, status, investor_since, investor_code, pan, email, phone, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          id, i.name, i.status ?? "Active", i.investorSince ?? null, id,
          i.pan ?? null, i.email ?? null, i.phone ?? null, i.notes ?? null,
        ]
      );
      return toInvestor(rows[0]);
    } catch (err) {
      if (err.code === "23505" && attempt < 5) continue;
      throw err;
    }
  }
}

// Read-merge-write so a partial update changes only what was sent.
async function update(id, updates) {
  const current = await getById(id);
  if (!current) return null;
  const i = { ...current, ...updates };
  const { rows } = await db.query(
    `UPDATE investors SET
       name = $2, status = $3, investor_since = $4, investor_code = $5,
       pan = $6, email = $7, phone = $8, notes = $9
     WHERE id = $1
     RETURNING *`,
    [
      id, i.name, i.status ?? "Active", i.investorSince ?? null, i.investorCode ?? null,
      i.pan ?? null, i.email ?? null, i.phone ?? null, i.notes ?? null,
    ]
  );
  return toInvestor(rows[0]);
}

async function remove(id) {
  // investor_transactions cascade-delete via the FK.
  const { rowCount } = await db.query("DELETE FROM investors WHERE id = $1", [id]);
  return rowCount > 0;
}

module.exports = { getAll, getById, peekNextId, create, update, remove };
