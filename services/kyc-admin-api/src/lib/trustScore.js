const { query } = require("../db");

const DEFAULT_TRUST_POINTS = 100;
const MIN_TRUST_POINTS = 0;
const MAX_TRUST_POINTS = 100;
const TRUST_HISTORY_LIMIT = 50;
const CLEAN_RECOVERY_HOURS = 24;

const TRUST_RULES = {
  profanity: {
    delta: -12,
    source: "Kiem duyet cong dong",
    status: "Bi tru diem",
    reason: "Noi dung co tu ngu tuc tiu hoac cong kich."
  },
  sensitive_image: {
    delta: -20,
    source: "Kiem duyet hinh anh",
    status: "Bi tru diem",
    reason: "Anh dang len bi danh dau la nhay cam hoac khong phu hop."
  },
  clean_contribution: {
    delta: 2,
    source: "Phuc hoi uy tin",
    status: "Duoc cong diem",
    reason: "Dong gop sach sau 24 gio khong vi pham."
  }
};

function clampTrustPoints(value) {
  const numeric = Number.isFinite(+value) ? Math.round(+value) : DEFAULT_TRUST_POINTS;
  return Math.max(MIN_TRUST_POINTS, Math.min(MAX_TRUST_POINTS, numeric));
}

function normalizeHistory(history) {
  if (Array.isArray(history)) return history;
  if (typeof history === "string") {
    try {
      const parsed = JSON.parse(history);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

async function ensureTrustProfile(uid) {
  await query(
    `INSERT INTO user_profiles (uid, trust_points, trust_history)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (uid) DO NOTHING`,
    [uid, DEFAULT_TRUST_POINTS, JSON.stringify([])]
  );
}

async function getTrustProfile(uid) {
  if (!uid) return null;
  await ensureTrustProfile(uid);
  const result = await query(
    `SELECT uid, trust_points, trust_history, last_trust_recovery_at
     FROM user_profiles
     WHERE uid = $1`,
    [uid]
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    uid: row.uid,
    trust_points: clampTrustPoints(row.trust_points),
    trust_history: normalizeHistory(row.trust_history),
    last_trust_recovery_at: row.last_trust_recovery_at,
  };
}

function getTrustRestrictions(score) {
  const trust = clampTrustPoints(score);
  return {
    readOnlyCommunity: trust < 30,
    imageUploadBlocked: trust < 50,
    warning: trust < 80,
  };
}

function buildRestrictionMessage(score, action, withImage = false) {
  const trust = clampTrustPoints(score);
  const restrictions = getTrustRestrictions(trust);
  if (restrictions.readOnlyCommunity) {
    return `Diem uy tin cua ban dang o muc ${trust}/100. Ban tam thoi chi duoc xem cong dong, chua the dang bai hoac binh luan. Hay giu tai khoan sach de diem duoc phuc hoi dan.`;
  }
  if (withImage && restrictions.imageUploadBlocked) {
    return `Diem uy tin cua ban dang o muc ${trust}/100. Tam thoi ban chua the dang anh, nhung van co the dang bai chi co van ban cho den khi diem quay lai tu 50 tro len.`;
  }
  if (action === "comment" && trust < 30) {
    return `Diem uy tin cua ban dang o muc ${trust}/100. Ban tam thoi chua the binh luan.`;
  }
  if (action === "post" && trust < 30) {
    return `Diem uy tin cua ban dang o muc ${trust}/100. Ban tam thoi chua the dang bai moi.`;
  }
  return null;
}

async function enforceTrustAction(uid, { action, withImage = false } = {}) {
  const profile = await getTrustProfile(uid);
  const trust = profile?.trust_points ?? DEFAULT_TRUST_POINTS;
  const message = buildRestrictionMessage(trust, action, withImage);
  if (!message) {
    return { ok: true, trust, restrictions: getTrustRestrictions(trust), profile };
  }
  return {
    ok: false,
    code: withImage && trust < 50 ? "trust_image_blocked" : "trust_restricted",
    trust,
    restrictions: getTrustRestrictions(trust),
    message,
    profile,
  };
}

async function recordTrustEvent(uid, rule, overrides = {}) {
  if (!uid || !rule) return null;
  const profile = await getTrustProfile(uid);
  if (!profile) return null;

  const currentPoints = clampTrustPoints(profile.trust_points);
  const requestedDelta = Number(rule.delta || 0);
  const nextPoints = clampTrustPoints(currentPoints + requestedDelta);
  const appliedDelta = nextPoints - currentPoints;
  if (!appliedDelta) return profile;

  const entry = {
    delta: appliedDelta,
    reason: overrides.reason || rule.reason,
    source: overrides.source || rule.source,
    status: overrides.status || rule.status,
    timestamp: new Date().toISOString(),
    trustAfter: nextPoints,
    action: overrides.action || null,
  };

  const history = [entry, ...normalizeHistory(profile.trust_history)].slice(0, TRUST_HISTORY_LIMIT);
  const resetRecoveryClock = overrides.resetRecoveryClock !== false;
  const recoveryAt = appliedDelta > 0
    ? new Date()
    : (resetRecoveryClock ? new Date() : profile.last_trust_recovery_at);

  const result = await query(
    `UPDATE user_profiles
     SET trust_points = $2,
         trust_history = $3::jsonb,
         last_trust_recovery_at = $4,
         updated_at = NOW()
     WHERE uid = $1
     RETURNING uid, trust_points, trust_history, last_trust_recovery_at`,
    [uid, nextPoints, JSON.stringify(history), recoveryAt]
  );
  const row = result.rows[0];
  return {
    uid: row.uid,
    trust_points: clampTrustPoints(row.trust_points),
    trust_history: normalizeHistory(row.trust_history),
    last_trust_recovery_at: row.last_trust_recovery_at,
  };
}

async function applyTrustPenalty(uid, violation, overrides = {}) {
  if (violation === "sensitive_image") {
    return recordTrustEvent(uid, TRUST_RULES.sensitive_image, overrides);
  }
  return recordTrustEvent(uid, TRUST_RULES.profanity, overrides);
}

async function rewardCleanContribution(uid, action = "community") {
  const profile = await getTrustProfile(uid);
  if (!profile) return null;
  if (clampTrustPoints(profile.trust_points) >= MAX_TRUST_POINTS) return profile;

  const lastRecovery = profile.last_trust_recovery_at
    ? new Date(profile.last_trust_recovery_at).getTime()
    : 0;
  const now = Date.now();
  if (lastRecovery && now - lastRecovery < CLEAN_RECOVERY_HOURS * 60 * 60 * 1000) {
    return profile;
  }

  return recordTrustEvent(uid, TRUST_RULES.clean_contribution, {
    action,
    reason: `${TRUST_RULES.clean_contribution.reason} Ban da dang hoac tuong tac dung quy dinh.`,
  });
}

module.exports = {
  DEFAULT_TRUST_POINTS,
  getTrustRestrictions,
  enforceTrustAction,
  applyTrustPenalty,
  rewardCleanContribution,
};
