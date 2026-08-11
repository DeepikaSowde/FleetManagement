// Data-access for the role permission grid. Rows are (role, module) with four
// boolean action columns. The controller shapes these into the nested
// { role: { module: { view, create, edit, delete } } } the frontend uses.
const db = require("../config/db");

// Only these action names may ever reach the SQL column name — guards the
// toggle's dynamic column against injection.
const ACTION_COLUMN = { view: "can_view", create: "can_create", edit: "can_edit", delete: "can_delete" };

async function listAll() {
  const { rows } = await db.query(
    "SELECT role, module, can_view, can_create, can_edit, can_delete FROM role_permissions"
  );
  return rows;
}

// Flip one cell (role, module, action) to its opposite, in a single statement.
// The row is guaranteed to exist for seeded roles/modules; if a brand-new
// module is ever toggled, we insert it first (view-only default) then flip.
async function toggleCell(role, module, action) {
  const col = ACTION_COLUMN[action];
  if (!col) throw new Error(`Invalid permission action: ${action}`);
  await db.query(
    `INSERT INTO role_permissions (role, module) VALUES ($1, $2)
     ON CONFLICT (role, module) DO NOTHING`,
    [role, module]
  );
  const { rows } = await db.query(
    `UPDATE role_permissions SET ${col} = NOT ${col}
     WHERE role = $1 AND module = $2
     RETURNING role, module, can_view, can_create, can_edit, can_delete`,
    [role, module]
  );
  return rows[0] || null;
}

module.exports = { listAll, toggleCell };
