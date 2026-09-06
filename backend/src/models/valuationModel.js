// Data-access for company_valuations — what the investors agreed the whole
// business is worth, as at a date.
//
// One figure for the company, never one per investor. An investor's stake is
// worth their holding percentage of it, so the parts always add up to the
// whole and nobody can be valued on a different basis from anybody else.
const db = require("../config/db");

function toValuation(r) {
  if (!r) return null;
  return {
    id: r.id,
    asOf: r.as_of,
    amount: Number(r.amount),
    basis: r.basis,
    agreedBy: r.agreed_by,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

// Newest first — the list is read as "what have we said the business is worth".
async function getAll() {
  const { rows } = await db.query(
    "SELECT * FROM company_valuations ORDER BY as_of DESC, created_at DESC"
  );
  return rows.map(toValuation);
}

async function getById(id) {
  const { rows } = await db.query("SELECT * FROM company_valuations WHERE id = $1", [id]);
  return toValuation(rows[0]);
}

async function create(v, actor) {
  const amount = Number(v.amount);
  if (!v.id) throw Object.assign(new Error("id is required"), { status: 400 });
  if (!v.asOf) throw Object.assign(new Error("asOf is required"), { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error("Enter what the business is worth, as a number above zero"), { status: 400 });
  }

  const { rows } = await db.query(
    `INSERT INTO company_valuations (id, as_of, amount, basis, agreed_by, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [v.id, v.asOf, amount, v.basis ?? null, v.agreedBy ?? null, actor ?? null]
  );
  return toValuation(rows[0]);
}

// A valuation is a supporting figure, not part of the ownership record, so a
// mistaken one can be removed. Ownership events remain immutable once published.
async function remove(id) {
  const { rowCount } = await db.query("DELETE FROM company_valuations WHERE id = $1", [id]);
  return rowCount > 0;
}

module.exports = { getAll, getById, create, remove };
