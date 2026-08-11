// Audit log listing — returns entries shaped for the User Management module's
// Audit Logs tab (it filters/paginates client-side over this list).
const AuditLog = require("../models/auditLogModel");

function fmtLabel(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return "";
  const pad = (n) => String(n).padStart(2, "0");
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(h)}:${pad(d.getMinutes())} ${ampm}`;
}

async function list(req, res, next) {
  try {
    const rows = await AuditLog.list(500);
    res.json(rows.map((r) => ({
      id: r.id,
      dateTime: r.created_at,
      dateTimeLabel: fmtLabel(r.created_at),
      user: r.user_name || "—",
      module: r.module || "—",
      action: r.action || "—",
      description: r.description || "",
      ip: r.ip || "—",
    })));
  } catch (err) { next(err); }
}

module.exports = { list };
