const { query } = require("../db");

async function upsertProfile(uid, data = {}) {
  const fields = [
    "email","display_name","photo_url","role","verify_status","verify_note",
    "submitted_at","reviewed_at",
    "student_grade","student_dob","student_phone","student_address",
    "parent_name","parent_email","parent_phone",
    "tutor_subjects","tutor_levels","tutor_bio","tutor_cccd","tutor_dob",
    "kyc_cccd_front","kyc_cccd_back","kyc_selfie","kyc_certificates"
  ];

  const sets = [];
  const values = [];
  let idx = 1;
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      sets.push(`${field} = $${idx}`);
      values.push(data[field]);
      idx += 1;
    }
  }
  if (!sets.length) return null;
  sets.push("updated_at = NOW()");
  values.push(uid);
  const sql = `UPDATE user_profiles SET ${sets.join(", ")} WHERE uid = $${idx} RETURNING *`;
  const result = await query(sql, values);
  if (!result.rowCount) {
    const insertFields = ["uid", ...fields.filter((f) => Object.prototype.hasOwnProperty.call(data, f))];
    const params = insertFields.map((_, i) => `$${i + 1}`);
    const insertValues = insertFields.map((field) => (field === "uid" ? uid : data[field]));
    const insertSql = `INSERT INTO user_profiles (${insertFields.join(",")}) VALUES (${params.join(",")}) RETURNING *`;
    const inserted = await query(insertSql, insertValues);
    return inserted.rows[0];
  }
  return result.rows[0];
}

async function upsertFromKyc(userId, payload = {}) {
  const profile = payload.profile || {};
  const parent = payload.parent || {};
  const tutor = payload.tutor || {};
  const kyc = payload.kyc || {};
  return upsertProfile(userId, {
    email: payload.email || profile.email || null,
    role: payload.role || null,
    verify_status: payload.verify?.status || "submitted",
    verify_note: payload.verify?.reviewNote || null,
    submitted_at: payload.verify?.submittedAt ? new Date(payload.verify.submittedAt) : new Date(),
    reviewed_at: payload.verify?.reviewedAt ? new Date(payload.verify.reviewedAt) : null,
    student_grade: profile.grade || null,
    student_dob: profile.dob || null,
    student_phone: profile.phone || null,
    student_address: profile.address || null,
    parent_name: parent.name || null,
    parent_email: parent.email || null,
    parent_phone: parent.phone || null,
    tutor_subjects: tutor.subjects ? [].concat(tutor.subjects) : null,
    tutor_levels: tutor.levels ? [].concat(tutor.levels) : null,
    tutor_bio: tutor.bio || null,
    tutor_cccd: profile.cccd || tutor.cccd || null,
    tutor_dob: tutor.dob || profile.dob || null,
    kyc_cccd_front: kyc.cccd_front || null,
    kyc_cccd_back: kyc.cccd_back || null,
    kyc_selfie: kyc.selfie || null,
    kyc_certificates: tutor.certificates || null,
  });
}

async function setVerifyStatus(userId, status, note) {
  return upsertProfile(userId, {
    verify_status: status,
    verify_note: note || null,
    reviewed_at: new Date(),
  });
}

module.exports = {
  upsertProfile,
  upsertFromKyc,
  setVerifyStatus,
};
