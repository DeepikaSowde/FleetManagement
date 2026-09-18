// RBAC enforcement for the Role & Permission grid (User Management → Role &
// Permission). Hiding a sidebar item or disabling a button in the UI is not
// real access control — this is what actually stops a Staff/Investor token
// from calling a restricted endpoint directly.
//
// Maps the HTTP verb to the CRUD action the grid tracks, looks up the
// caller's role for the given module, and 403s when that action isn't
// granted. A short in-process cache avoids a DB round trip on every request
// while still picking up a toggle within a few seconds; toggling a
// permission also calls invalidateCache() so the very next request sees it.
const RolePermissions = require("../models/rolePermissionModel");

const ACTION_BY_METHOD = { GET: "view", POST: "create", PUT: "edit", PATCH: "edit", DELETE: "delete" };

let cache = null;
let cacheAt = 0;
const CACHE_MS = 5000;

async function loadGrid() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;
  const rows = await RolePermissions.listAll();
  const grid = {};
  for (const r of rows) {
    grid[r.role] = grid[r.role] || {};
    grid[r.role][r.module] = { view: r.can_view, create: r.can_create, edit: r.can_edit, delete: r.can_delete };
  }
  cache = grid;
  cacheAt = now;
  return grid;
}

function invalidateCache() {
  cache = null;
}

// requirePermission("Fleet") — action is derived from the HTTP method, so one
// call per route file (after requireAuth) covers view/create/edit/delete.
// Pass an explicit action to override the method-based default for a
// sub-route that doesn't follow plain REST (e.g. a POST that only edits).
function requirePermission(moduleName, actionOverride = null) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Not authenticated" });
      const action = actionOverride || ACTION_BY_METHOD[req.method] || "view";
      const grid = await loadGrid();
      const roleModule = grid[req.user.role]?.[moduleName];
      // A missing row (module added to the grid after this role's rows were
      // seeded) fails OPEN for Admin — so a schema gap can never lock out the
      // one account that manages the grid itself — and fails CLOSED for
      // every other role, which is the safe default for an unconfigured
      // permission.
      const allowed = roleModule ? !!roleModule[action] : req.user.role === "Admin";
      if (!allowed) {
        return res.status(403).json({ message: `Your role does not have ${action} access to ${moduleName}.` });
      }
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { requirePermission, invalidateCache };
