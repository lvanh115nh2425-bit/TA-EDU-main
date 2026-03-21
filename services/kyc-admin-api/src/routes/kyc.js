const express = require("express");
const router = express.Router();
const { query, mapKycRow } = require("../db");
const { requireAuth } = require("../auth");
const { upsertFromKyc, setVerifyStatus } = require("../store/userProfiles");
const { recordKycAudit, listKycAuditLogs } = require("../store/auditLogs");
const requireUser = require("../middleware/requireUser");

const VALID_STATUSES = ["submitted", "approved", "rejected", "unverified"];
const MAX_PAGE_SIZE = 100;
const CSV_REQUEST_COLUMNS = [
  "id",
  "userId",
  "fullName",
  "email",
  "role",
  "status",
  "note",
  "createdAt",
  "updatedAt",
  "payload",
];

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function normalizeSearch(str) {
  if (!str) return "";
  const trimmed = String(str).trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 80);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildFilterClause(queryInput = {}) {
  const clauses = [];
  const values = [];

  const status = queryInput.status;
  if (status && VALID_STATUSES.includes(status)) {
    values.push(status);
    clauses.push(`status = $${values.length}`);
  }

  const role = queryInput.role ? String(queryInput.role).trim() : "";
  if (role) {
    values.push(role);
    clauses.push(`role = $${values.length}`);
  }

  const search = normalizeSearch(queryInput.q || queryInput.search);
  if (search) {
    values.push(`%${search}%`);
    const placeholder = `$${values.length}`;
    clauses.push(
      `(full_name ILIKE ${placeholder} OR email ILIKE ${placeholder} OR user_id ILIKE ${placeholder})`
    );
  }

  const fromDate = parseDate(queryInput.from || queryInput.start);
  if (fromDate) {
    values.push(fromDate);
    clauses.push(`updated_at >= $${values.length}`);
  }

  const toDate = parseDate(queryInput.to || queryInput.end);
  if (toDate) {
    values.push(toDate);
    clauses.push(`updated_at <= $${values.length}`);
  }

  return {
    status: status && VALID_STATUSES.includes(status) ? status : "all",
    role,
    search,
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

function buildOrderBy(sort) {
  switch ((sort || "").toLowerCase()) {
    case "created_asc":
      return "created_at ASC";
    case "created_desc":
      return "created_at DESC";
    case "updated_asc":
      return "updated_at ASC";
    default:
      return "updated_at DESC";
  }
}

function normalizeStats(row = {}) {
  return {
    total: Number(row.total) || 0,
    submitted: Number(row.submitted) || 0,
    approved: Number(row.approved) || 0,
    rejected: Number(row.rejected) || 0,
  };
}

router.post("/submit", requireUser, async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: "invalid_user" });
  const { fullName, email, role, payload } = req.body || {};
  if (!fullName) {
    return res.status(400).json({ error: "missing_fullName" });
  }

  try {
    await upsertFromKyc(uid, {
      email: email || req.user.email || null,
      role,
      profile: payload?.profile,
      parent: payload?.parent,
      tutor: payload?.tutor,
      kyc: payload?.kyc,
      verify: { status: "submitted", submittedAt: Date.now() },
    });
    const result = await query(
      `INSERT INTO kyc_requests (user_id, full_name, email, role, status, payload)
       VALUES ($1, $2, $3, $4, 'submitted', $5)
       ON CONFLICT (user_id)
       DO UPDATE SET
         full_name = EXCLUDED.full_name,
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         status = 'submitted',
         payload = EXCLUDED.payload,
         note = NULL,
         updated_at = NOW()
       RETURNING *`,
      [uid, fullName, email || req.user.email || null, role || null, payload || null]
    );
    const inserted = mapKycRow(result.rows[0]);
    if (inserted?.id) {
      await recordKycAudit({
        requestId: inserted.id,
        action: "submitted",
        previousStatus: null,
        nextStatus: inserted.status,
        note: "User submission",
        adminUsername: req.user?.email || req.user?.uid || null,
      });
    }
    res.status(201).json({ request: inserted });
  } catch (err) {
    console.error("submit kyc error", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.use(requireAuth);

router.get("/", async (req, res) => {
  const { values, where, search, status, role } = buildFilterClause(req.query);
  const pageSize = Math.min(
    Math.max(Number(req.query.pageSize) || 50, 1),
    MAX_PAGE_SIZE
  );
  const page = Math.max(Number(req.query.page) || 1, 1);
  const offset = (page - 1) * pageSize;
  const sort = (req.query.sort || "updated_desc").toLowerCase();
  const orderBy = buildOrderBy(sort);
  const listValues = values.slice();
  const limitIdx = listValues.length + 1;
  const offsetIdx = listValues.length + 2;
  listValues.push(pageSize, offset);

  try {
    const [listResult, statsResult] = await Promise.all([
      query(
        `SELECT *, COUNT(*) OVER() AS total_count
         FROM kyc_requests
         ${where}
         ORDER BY ${orderBy}
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        listValues
      ),
      query(
        `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted,
            COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
            COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
         FROM kyc_requests`,
        []
      ),
    ]);

    const total = listResult.rowCount ? Number(listResult.rows[0].total_count) || 0 : 0;
    const pageCount = total ? Math.ceil(total / pageSize) : 0;
    res.json({
      requests: listResult.rows.map(mapKycRow),
      meta: {
        total,
        page,
        pageSize,
        pageCount,
        hasNext: offset + pageSize < total,
        hasPrev: offset > 0,
        sort,
        filters: {
          status,
          role,
          search,
        },
        stats: normalizeStats(statsResult.rows[0]),
      },
    });
  } catch (err) {
    console.error("list kyc error", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/export", async (req, res) => {
  const format = (req.query.format || "csv").toLowerCase();
  if (format !== "csv") {
    return res.status(400).json({ error: "invalid_format" });
  }
  const filters = buildFilterClause(req.query);
  const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 5000);
  const sort = (req.query.sort || "updated_desc").toLowerCase();
  const orderBy = buildOrderBy(sort);
  const sqlValues = filters.values.slice();
  sqlValues.push(limit);
  const limitIdx = sqlValues.length;

  try {
    const result = await query(
      `SELECT *
       FROM kyc_requests
       ${filters.where}
       ORDER BY ${orderBy}
       LIMIT $${limitIdx}`,
      sqlValues
    );
    const rows = result.rows.map(mapKycRow);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"kyc-requests.csv\"");
    const lines = [];
    lines.push(CSV_REQUEST_COLUMNS.join(","));
    rows.forEach((row) => {
      const payload = row.payload ? JSON.stringify(row.payload) : "";
      lines.push(
        CSV_REQUEST_COLUMNS.map((col) =>
          escapeCsv(col === "payload" ? payload : row[col])
        ).join(",")
      );
    });
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("export kyc error", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  try {
    const result = await query("SELECT * FROM kyc_requests WHERE id = $1", [id]);
    if (!result.rowCount) return res.status(404).json({ error: "not_found" });
    res.json({ request: mapKycRow(result.rows[0]) });
  } catch (err) {
    console.error("get kyc error", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const { status, note } = req.body || {};
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: "invalid_status" });
  }
  try {
    const existing = await query("SELECT * FROM kyc_requests WHERE id = $1", [id]);
    if (!existing.rowCount) return res.status(404).json({ error: "not_found" });
    const previous = mapKycRow(existing.rows[0]);
    const result = await query(
      `UPDATE kyc_requests
         SET status = COALESCE($2, status),
             note = COALESCE($3, note),
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status || null, typeof note === "string" ? note : null]
    );
    const row = mapKycRow(result.rows[0]);
    if (row.userId) {
      await setVerifyStatus(row.userId, row.status, row.note);
    }
    await recordKycAudit({
      requestId: row.id,
      adminId: req.admin?.sub || null,
      adminUsername: req.admin?.username || null,
      action: status ? "status_change" : "note_update",
      previousStatus: previous?.status || null,
      nextStatus: row.status,
      note: typeof note === "string" ? note : null,
    });
    res.json({ request: row });
  } catch (err) {
    console.error("update kyc error", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/:id/history", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const format = (req.query.format || "json").toLowerCase();
  try {
    const record = await query("SELECT * FROM kyc_requests WHERE id = $1", [id]);
    if (!record.rowCount) return res.status(404).json({ error: "not_found" });
    const request = mapKycRow(record.rows[0]);
    const history = await listKycAuditLogs(id, limit);
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="kyc-history-${request.id}.csv"`
      );
      const header = [
        "createdAt",
        "action",
        "adminUsername",
        "previousStatus",
        "nextStatus",
        "note",
      ];
      const lines = [header.join(",")];
      history.forEach((event) => {
        lines.push(
          header
            .map((key) => escapeCsv(event[key]))
            .join(",")
        );
      });
      res.send(lines.join("\n"));
      return;
    }
    res.json({ request, history });
  } catch (err) {
    console.error("kyc history error", err);
    res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
