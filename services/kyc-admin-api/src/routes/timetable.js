const router = require("express").Router();
const { randomUUID } = require("crypto");
const { query } = require("../db");
const requireUser = require("../middleware/requireUser");

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function emptyWeek() {
  return DAY_KEYS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});
}

const DEADLINE_STATUS = new Set(["pending", "working", "done"]);

function sanitizeDeadlines(raw = []) {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeDeadline).filter(Boolean);
}

function sanitizeDeadline(item = {}) {
  const id = typeof item.id === "string" && item.id.trim() ? item.id : randomUUID();
  const title = constrainString(item.title, 160) || "Hoạt động";
  const dueDate = validateDate(item.dueDate) ? item.dueDate : null;
  const startDate = validateDate(item.startDate) ? item.startDate : null;
  const status = DEADLINE_STATUS.has(item.status) ? item.status : "pending";
  const note = constrainString(item.note, 280);
  if (!dueDate) return null;
  return {
    id,
    title,
    startDate,
    dueDate,
    status,
    note
  };
}

function validateDate(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function sanitizeWeek(rawWeek = {}) {
  const base = emptyWeek();
  DAY_KEYS.forEach((key) => {
    if (Array.isArray(rawWeek[key])) {
      base[key] = rawWeek[key]
        .map((slot) => sanitizeSlot(slot))
        .filter(Boolean)
        .sort(compareSlots);
    }
  });
  return base;
}

function sanitizeSlot(slot = {}) {
  if (!slot) return null;
  const id = typeof slot.id === "string" && slot.id.trim() ? slot.id : randomUUID();
  const start = validateTime(slot.start) ? slot.start : null;
  const end = validateTime(slot.end) ? slot.end : null;
  if (!start || !end) return null;
  return {
    id,
    title: constrainString(slot.title, 120) || "Hoạt động",
    note: constrainString(slot.note, 220),
    tone: slot.tone === "fun" ? "fun" : "focus",
    start,
    end,
    time: slot.time || `${start} - ${end}`,
  };
}

function sanitizeIncomingSlot(slot = {}) {
  const title = constrainString(slot.title, 120) || "Hoạt động mới";
  const note = constrainString(slot.note, 220);
  const start = slot.start;
  const end = slot.end;
  if (!validateTime(start) || !validateTime(end)) {
    const err = new Error("invalid_time");
    err.status = 400;
    throw err;
  }
  if (toMinutes(end) <= toMinutes(start)) {
    const err = new Error("time_range_invalid");
    err.status = 400;
    throw err;
  }
  const tone = slot.tone === "fun" ? "fun" : "focus";
  return { title, note, start, end, tone };
}

function sanitizeIncomingDeadline(payload = {}) {
  const title = constrainString(payload.title, 160) || "Deadline mới";
  const startDate = payload.startDate;
  const dueDate = payload.dueDate;
  if (!validateDate(startDate || "")) {
    const err = new Error("invalid_start_date");
    err.status = 400;
    throw err;
  }
  if (!validateDate(dueDate || "")) {
    const err = new Error("invalid_due_date");
    err.status = 400;
    throw err;
  }
  if (new Date(dueDate).getTime() < new Date(startDate).getTime()) {
    const err = new Error("date_range_invalid");
    err.status = 400;
    throw err;
  }
  const note = constrainString(payload.note, 280);
  const status = DEADLINE_STATUS.has(payload.status) ? payload.status : "pending";
  return { title, startDate, dueDate, note, status };
}

function compareSlots(a = {}, b = {}) {
  return toMinutes(a.start) - toMinutes(b.start);
}

function validateTime(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
}

function toMinutes(value) {
  if (!validateTime(value)) return Number.MAX_SAFE_INTEGER;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function constrainString(value, max = 140) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

async function fetchSchedule(uid) {
  const result = await query(
    "SELECT user_uid, week, share_enabled, share_code, deadlines, updated_at FROM timetables WHERE user_uid = $1",
    [uid]
  );
  return result.rows[0] || null;
}

async function ensureSchedule(uid) {
  const existing = await fetchSchedule(uid);
  if (existing) return existing;
  const week = emptyWeek();
  const inserted = await query(
    `
      INSERT INTO timetables (user_uid, week, deadlines)
      VALUES ($1, $2::jsonb, $3::jsonb)
      RETURNING user_uid, week, share_enabled, share_code, deadlines, updated_at
    `,
    [uid, JSON.stringify(week), JSON.stringify([])]
  );
  return inserted.rows[0];
}

async function saveSchedule(uid, data = {}) {
  const sets = [];
  const values = [uid];
  if (data.week) {
    values.push(JSON.stringify(data.week));
    sets.push(`week = $${values.length}::jsonb`);
  }
  if (data.deadlines) {
    values.push(JSON.stringify(data.deadlines));
    sets.push(`deadlines = $${values.length}::jsonb`);
  }
  if (typeof data.shareEnabled === "boolean") {
    values.push(data.shareEnabled);
    sets.push(`share_enabled = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(data, "shareCode")) {
    values.push(data.shareCode);
    sets.push(`share_code = $${values.length}`);
  }
  if (!sets.length) {
    return fetchSchedule(uid);
  }
  const result = await query(
    `
      UPDATE timetables
      SET ${sets.join(", ")}, updated_at = NOW()
      WHERE user_uid = $1
      RETURNING user_uid, week, share_enabled, share_code, deadlines, updated_at
    `,
    values
  );
  return result.rows[0];
}

async function updateShareState(uid, enabled) {
  const schedule = await ensureSchedule(uid);
  let shareCode = schedule.share_code;
  if (enabled && !shareCode) {
    shareCode = await generateUniqueShareCode();
  }
  if (!enabled) {
    shareCode = null;
  }
  const result = await saveSchedule(uid, {
    week: sanitizeWeek(schedule.week),
    deadlines: sanitizeDeadlines(schedule.deadlines),
    shareEnabled: enabled,
    shareCode,
  });
  return result;
}

async function generateUniqueShareCode() {
  while (true) {
    const code = randomUUID().replace(/-/g, "").slice(0, 12);
    const result = await query("SELECT share_code FROM timetables WHERE share_code = $1 LIMIT 1", [code]);
    if (result.rowCount === 0) return code;
  }
}

function toPayload(row, { includeShareCode = true } = {}) {
  const week = sanitizeWeek(row?.week || {});
  const deadlines = sanitizeDeadlines(row?.deadlines || []);
  return {
    week,
    deadlines,
    shareEnabled: Boolean(row?.share_enabled),
    shareCode: includeShareCode ? row?.share_code || null : null,
    updatedAt: row?.updated_at || null,
  };
}

router.get("/shared/:code", async (req, res) => {
  const code = (req.params.code || "").trim();
  if (!code) return res.status(400).json({ error: "missing_share_code" });
  const result = await query(
    "SELECT week, share_enabled, deadlines, updated_at FROM timetables WHERE share_code = $1 LIMIT 1",
    [code]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "schedule_not_found" });
  }
  const row = result.rows[0];
  if (!row.share_enabled) {
    return res.status(403).json({ error: "share_disabled" });
  }
  res.json(toPayload(row, { includeShareCode: false }));
});

router.get("/", requireUser, async (req, res) => {
  const uid = req.user.uid;
  const schedule = await ensureSchedule(uid);
  res.json(toPayload(schedule));
});

router.post("/slot", requireUser, async (req, res) => {
  const uid = req.user.uid;
  const day = typeof req.body?.day === "string" ? req.body.day.trim().toLowerCase() : "";
  if (!DAY_KEYS.includes(day)) {
    return res.status(400).json({ error: "invalid_day" });
  }
  let sanitized;
  try {
    sanitized = sanitizeIncomingSlot(req.body.slot || {});
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message || "invalid_slot" });
  }
  const schedule = await ensureSchedule(uid);
  const week = sanitizeWeek(schedule.week);
  week[day] = [
    ...week[day],
    {
      id: randomUUID(),
      title: sanitized.title,
      note: sanitized.note,
      tone: sanitized.tone,
      start: sanitized.start,
      end: sanitized.end,
      time: `${sanitized.start} - ${sanitized.end}`,
    },
  ].sort(compareSlots);
  const updated = await saveSchedule(uid, {
    week,
    deadlines: sanitizeDeadlines(schedule.deadlines),
  });
  res.json(toPayload(updated));
});

router.patch("/share", requireUser, async (req, res) => {
  const uid = req.user.uid;
  const enabled = Boolean(req.body?.enabled);
  const updated = await updateShareState(uid, enabled);
  res.json(toPayload(updated));
});

router.post("/deadline", requireUser, async (req, res) => {
  const uid = req.user.uid;
  let incoming;
  try {
    incoming = sanitizeIncomingDeadline(req.body || {});
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message || "invalid_deadline" });
  }
  const schedule = await ensureSchedule(uid);
  const deadlines = sanitizeDeadlines(schedule.deadlines);
  deadlines.push({
    id: randomUUID(),
    ...incoming,
    createdAt: new Date().toISOString(),
  });
  const updated = await saveSchedule(uid, {
    week: sanitizeWeek(schedule.week),
    deadlines,
  });
  res.json(toPayload(updated));
});

router.patch("/deadline/:id", requireUser, async (req, res) => {
  const uid = req.user.uid;
  const deadlineId = req.params.id;
  const requestedStatus = typeof req.body?.status === "string" ? req.body.status : "";
  const nextStatus = DEADLINE_STATUS.has(requestedStatus) ? requestedStatus : "working";
  const schedule = await ensureSchedule(uid);
  const deadlines = sanitizeDeadlines(schedule.deadlines);
  const idx = deadlines.findIndex((item) => item.id === deadlineId);
  if (idx === -1) {
    return res.status(404).json({ error: "deadline_not_found" });
  }
  deadlines[idx].status = nextStatus;
  const updated = await saveSchedule(uid, {
    week: sanitizeWeek(schedule.week),
    deadlines,
  });
  res.json(toPayload(updated));
});

module.exports = router;
