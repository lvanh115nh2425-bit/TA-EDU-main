const express = require("express");
const router = express.Router();
const { query, mapReportRow } = require("../db");
const { requireAuth } = require("../auth");
const requireUser = require("../middleware/requireUser");
const { recordReportAudit, listReportAuditLogs } = require("../store/reportLogs");

const VALID_STATUSES = ["submitted", "reviewing", "resolved", "rejected"];
const MAX_PAGE_SIZE = 100;
const CSV_REPORT_COLUMNS = [
  "id",
  "reporterId",
  "reporterName",
  "reporterEmail",
  "reportedId",
  "reportedName",
  "reportedEmail",
  "category",
  "reason",
  "content",
  "evidenceUrls",
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
  return trimmed.slice(0, 120);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeText(value, maxLength) {
  if (value === null || value === undefined) return "";
  const str = String(value).trim();
  if (!str) return "";
  if (typeof maxLength === "number" && maxLength > 0) {
    return str.slice(0, maxLength);
  }
  return str;
}

function buildFilterClause(queryInput = {}) {
  const clauses = [];
  const values = [];

  const status = queryInput.status;
  if (status && VALID_STATUSES.includes(status)) {
    values.push(status);
    clauses.push(`status = $${values.length}`);
  }

  const category = queryInput.category ? String(queryInput.category).trim() : "";
  if (category) {
    values.push(category);
    clauses.push(`category = $${values.length}`);
  }

  const search = normalizeSearch(queryInput.q || queryInput.search);
  if (search) {
    values.push(`%${search}%`);
    const placeholder = `$${values.length}`;
    clauses.push(
      `(reporter_name ILIKE ${placeholder} OR reporter_email ILIKE ${placeholder}
        OR reported_name ILIKE ${placeholder} OR reported_email ILIKE ${placeholder}
        OR category ILIKE ${placeholder} OR reason ILIKE ${placeholder} OR content ILIKE ${placeholder})`
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
    category,
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
    reviewing: Number(row.reviewing) || 0,
    resolved: Number(row.resolved) || 0,
    rejected: Number(row.rejected) || 0,
  };
}

router.post("/submit", requireUser, async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: "invalid_user" });
  const body = req.body || {};
  const reason = normalizeText(body.reason, 400);
  const content = normalizeText(body.content, 2000);
  if (!reason && !content) {
    return res.status(400).json({ error: "missing_reason" });
  }

  const evidenceUrls = Array.isArray(body.evidenceUrls)
    ? body.evidenceUrls.filter(Boolean).slice(0, 8)
    : [];
  const payload =
    body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? body.payload
      : {};
  if (body.targetType && !payload.targetType) payload.targetType = body.targetType;
  if (body.targetId && !payload.targetId) payload.targetId = body.targetId;

  try {
    const result = await query(
      `INSERT INTO user_reports
        (reporter_id, reporter_name, reporter_email, reported_id, reported_name, reported_email,
         category, reason, content, evidence_urls, status, note, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'submitted',NULL,$11)
       RETURNING *`,
      [
        uid,
        normalizeText(body.reporterName, 255) || normalizeText(req.user?.name, 255),
        normalizeText(body.reporterEmail, 255) || normalizeText(req.user?.email, 255),
        normalizeText(body.reportedId, 128),
        normalizeText(body.reportedName, 255),
        normalizeText(body.reportedEmail, 255),
        normalizeText(body.category, 64) || normalizeText(body.targetType, 64),
        reason || null,
        content || null,
        evidenceUrls.length ? evidenceUrls : null,
        payload,
      ]
    );
    const inserted = mapReportRow(result.rows[0]);
    if (inserted?.id) {
      await recordReportAudit({
        reportId: inserted.id,
        action: "submitted",
        previousStatus: null,
        nextStatus: inserted.status,
        note: "User submission",
        adminUsername: req.user?.email || req.user?.uid || null,
      });
    }
    res.status(201).json({ report: inserted });
  } catch (err) {
    console.error("submit report error", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.use(requireAuth);

router.get("/", async (req, res) => {
  const { values, where, search, status, category } = buildFilterClause(req.query);
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
         FROM user_reports
         ${where}
         ORDER BY ${orderBy}
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        listValues
      ),
      query(
        `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted,
            COUNT(*) FILTER (WHERE status = 'reviewing')::int AS reviewing,
            COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
            COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
         FROM user_reports`,
        []
      ),
    ]);

    const total = listResult.rowCount ? Number(listResult.rows[0].total_count) || 0 : 0;
    const pageCount = total ? Math.ceil(total / pageSize) : 0;
    res.json({
      reports: listResult.rows.map(mapReportRow),
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
          category,
          search,
        },
        stats: normalizeStats(statsResult.rows[0]),
      },
    });
  } catch (err) {
    console.error("list reports error", err);
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
       FROM user_reports
       ${filters.where}
       ORDER BY ${orderBy}
       LIMIT $${limitIdx}`,
      sqlValues
    );
    const rows = result.rows.map(mapReportRow);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"user-reports.csv\"");
    const lines = [];
    lines.push(CSV_REPORT_COLUMNS.join(","));
    rows.forEach((row) => {
      const payload = row.payload ? JSON.stringify(row.payload) : "";
      const evidenceUrls = row.evidenceUrls ? JSON.stringify(row.evidenceUrls) : "";
      lines.push(
        CSV_REPORT_COLUMNS.map((col) => {
          if (col === "payload") return escapeCsv(payload);
          if (col === "evidenceUrls") return escapeCsv(evidenceUrls);
          return escapeCsv(row[col]);
        }).join(",")
      );
    });
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("export reports error", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  try {
    const result = await query("SELECT * FROM user_reports WHERE id = $1", [id]);
    if (!result.rowCount) return res.status(404).json({ error: "not_found" });
    res.json({ report: mapReportRow(result.rows[0]) });
  } catch (err) {
    console.error("get report error", err);
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
    const existing = await query("SELECT * FROM user_reports WHERE id = $1", [id]);
    if (!existing.rowCount) return res.status(404).json({ error: "not_found" });
    const previous = mapReportRow(existing.rows[0]);
    const result = await query(
      `UPDATE user_reports
         SET status = COALESCE($2, status),
             note = COALESCE($3, note),
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status || null, typeof note === "string" ? note : null]
    );
    const row = mapReportRow(result.rows[0]);
    await recordReportAudit({
      reportId: row.id,
      adminId: req.admin?.sub || null,
      adminUsername: req.admin?.username || null,
      action: status ? "status_change" : "note_update",
      previousStatus: previous?.status || null,
      nextStatus: row.status,
      note: typeof note === "string" ? note : null,
    });
    res.json({ report: row });
  } catch (err) {
    console.error("update report error", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/:id/history", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "invalid_id" });
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const format = (req.query.format || "json").toLowerCase();
  try {
    const record = await query("SELECT * FROM user_reports WHERE id = $1", [id]);
    if (!record.rowCount) return res.status(404).json({ error: "not_found" });
    const report = mapReportRow(record.rows[0]);
    const history = await listReportAuditLogs(id, limit);
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="report-history-${report.id}.csv"`
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
    res.json({ report, history });
  } catch (err) {
    console.error("report history error", err);
    res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
