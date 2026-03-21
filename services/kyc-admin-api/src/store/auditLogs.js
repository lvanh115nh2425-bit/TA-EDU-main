const { query } = require("../db");

function mapAuditRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id,
    adminId: row.admin_id,
    adminUsername: row.admin_username,
    action: row.action,
    previousStatus: row.previous_status,
    nextStatus: row.next_status,
    note: row.note,
    createdAt: row.created_at,
  };
}

async function recordKycAudit({
  requestId,
  adminId,
  adminUsername,
  action,
  previousStatus,
  nextStatus,
  note,
}) {
  if (!requestId) return null;
  const result = await query(
    `INSERT INTO kyc_audit_logs
      (request_id, admin_id, admin_username, action, previous_status, next_status, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      requestId,
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

async function listKycAuditLogs(requestId, limit = 50) {
  if (!requestId) return [];
  const result = await query(
    `SELECT * FROM kyc_audit_logs
      WHERE request_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [requestId, Math.min(Math.max(Number(limit) || 20, 1), 200)]
  );
  return result.rows.map(mapAuditRow);
}

module.exports = {
  recordKycAudit,
  listKycAuditLogs,
};
