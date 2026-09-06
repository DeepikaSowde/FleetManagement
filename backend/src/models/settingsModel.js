// Data-access for app_settings — a tiny key/value store for tenant-level
// toggles. The Investors module reads ownership_approval_mode from here to
// decide how much sign-off a cap-table change needs.
const db = require("../config/db");

const DEFAULTS = {
  ownership_approval_mode: "admin_attest",
};

async function get(key) {
  const { rows } = await db.query("SELECT value FROM app_settings WHERE key = $1", [key]);
  return rows[0] ? rows[0].value : (DEFAULTS[key] ?? null);
}

async function getAll() {
  const { rows } = await db.query("SELECT key, value FROM app_settings ORDER BY key ASC");
  const out = { ...DEFAULTS };
  rows.forEach((r) => (out[r.key] = r.value));
  return out;
}

async function set(key, value) {
  const { rows } = await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     RETURNING key, value`,
    [key, value]
  );
  return rows[0];
}

module.exports = { get, getAll, set, DEFAULTS };
