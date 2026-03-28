const { query } = require("../db");

function mapAuditRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    reportId: row.report_id,
    adminId: row.admin_id,
    adminUsername: row.admin_username,
    action: row.action,
    previousStatus: row.previous_status,
    nextStatus: row.next_status,
    note: row.note,
    createdAt: row.created_at,
  };
}

async function recordReportAudit({
  reportId,
  adminId,
  adminUsername,
  action,
  previousStatus,
  nextStatus,
  note,
}) {
  if (!reportId) return null;
  const result = await query(
    `INSERT INTO report_audit_logs
      (report_id, admin_id, admin_username, action, previous_status, next_status, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      reportId,
      adminId || null,
      adminUsername || null,
      action || null,
      previousStatus || null,
      nextStatus || null,
      typeof note === "string" && note.length ? note : null,
    ]
  );
  return mapAuditRow(result.rows[0]);
}

async function listReportAuditLogs(reportId, limit = 50) {
  if (!reportId) return [];
  const result = await query(
    `SELECT * FROM report_audit_logs
      WHERE report_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [reportId, Math.min(Math.max(Number(limit) || 20, 1), 200)]
  );
  return result.rows.map(mapAuditRow);
}

module.exports = {
  recordReportAudit,
  listReportAuditLogs,
};
