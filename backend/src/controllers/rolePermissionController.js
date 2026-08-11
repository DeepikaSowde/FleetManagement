// Role permission grid — read the whole grid, or toggle one (role, module,
// action) cell. Shapes the flat rows into the nested object the frontend uses.
const RolePermissions = require("../models/rolePermissionModel");
const audit = require("../models/auditLogModel");

function rowsToNested(rows) {
  const out = {};
  for (const r of rows) {
    out[r.role] = out[r.role] || {};
    out[r.role][r.module] = {
      view: r.can_view, create: r.can_create, edit: r.can_edit, delete: r.can_delete,
    };
  }
  return out;
}

async function getAll(req, res, next) {
  try {
    const rows = await RolePermissions.listAll();
    res.json(rowsToNested(rows));
  } catch (err) { next(err); }
}

async function toggle(req, res, next) {
  try {
    const { role, module, action } = req.body;
    if (!role || !module || !action) {
      return res.status(400).json({ message: "role, module and action are required" });
    }
    const updated = await RolePermissions.toggleCell(role, module, action);
    if (!updated) return res.status(404).json({ message: "Permission row not found" });
    const nowOn = { view: updated.can_view, create: updated.can_create, edit: updated.can_edit, delete: updated.can_delete }[action];
    audit.record(req, {
      module: "User Management", action: "Updated",
      description: `${nowOn ? "Granted" : "Revoked"} ${role} · ${module} · ${action}`,
    });
    res.json({ view: updated.can_view, create: updated.can_create, edit: updated.can_edit, delete: updated.can_delete });
  } catch (err) { next(err); }
}

module.exports = { getAll, toggle };
