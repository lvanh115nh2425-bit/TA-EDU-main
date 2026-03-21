#!/usr/bin/env node
/**
 * Backfill Postgres user_profiles from Firestore `users` collection.
 *
 * Usage:
 *   node scripts/backfillUserProfiles.js [--dry-run]
 *
 * Requires FIREBASE_PROJECT_ID + service account (or GOOGLE_APPLICATION_CREDENTIALS)
 * and DATABASE_URL so we can reuse the existing pool/query helpers.
 */

require("dotenv").config();

const admin = require("firebase-admin");
const { getFirebaseApp } = require("../src/lib/firebaseApp");
const { ensureSchema } = require("../src/db");
const { upsertProfile } = require("../src/store/userProfiles");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const batchSize = Math.min(
  Math.max(Number(process.env.BACKFILL_BATCH_SIZE) || 200, 25),
  1000
);

function coerceDate(value) {
  if (!value) return null;
  try {
    if (typeof value.toDate === "function") return value.toDate();
  } catch (_) {
    // ignore
  }
  const ts = typeof value === "number" ? value : Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return new Date(ts);
}

function arrayOrNull(input) {
  if (!input) return null;
  if (Array.isArray(input)) return input;
  return null;
}

function mapUserToProfile(data = {}) {
  const profile = data.profile || {};
  const parent = data.parent || {};
  const tutor = data.tutor || {};
  const kyc = data.kyc || {};
  const verify = data.verify || {};
  return {
    email: data.email || profile.email || null,
    display_name: data.displayName || profile.name || null,
    photo_url: data.photoURL || profile.photoUrl || null,
    role: data.role || null,
    verify_status: verify.status || "unverified",
    verify_note: verify.reviewNote || null,
    submitted_at: coerceDate(verify.submittedAt),
    reviewed_at: coerceDate(verify.reviewedAt),
    student_grade: profile.grade || null,
    student_dob: profile.dob || null,
    student_phone: profile.phone || data.phoneNumber || null,
    student_address: profile.address || null,
    parent_name: parent.name || null,
    parent_email: parent.email || null,
    parent_phone: parent.phone || null,
    tutor_subjects: arrayOrNull(tutor.subjects),
    tutor_levels: arrayOrNull(tutor.levels),
    tutor_bio: tutor.bio || null,
    tutor_cccd: profile.cccd || tutor.cccd || null,
    tutor_dob: tutor.dob || profile.dob || null,
    kyc_cccd_front: kyc.cccd_front || null,
    kyc_cccd_back: kyc.cccd_back || null,
    kyc_selfie: kyc.selfie || null,
    kyc_certificates: tutor.certificates || null,
  };
}

async function run() {
  await ensureSchema();
  const app = getFirebaseApp();
  const firestore = admin.firestore(app);
  const fieldPath = admin.firestore.FieldPath.documentId();
  const base = firestore.collection("users").orderBy(fieldPath);

  let cursor = null;
  let processed = 0;
  let updated = 0;

  while (true) {
    let queryRef = base.limit(batchSize);
    if (cursor) {
      queryRef = queryRef.startAfter(cursor);
    }
    const snapshot = await queryRef.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      const payload = mapUserToProfile(doc.data());
      processed += 1;
      if (dryRun) {
        console.log("[dry-run]", doc.id, payload.role, payload.verify_status);
      } else {
        await upsertProfile(doc.id, payload);
        updated += 1;
      }
    }

    cursor = snapshot.docs[snapshot.docs.length - 1];
    console.log(
      dryRun
        ? `Scanned ${processed} profiles...`
        : `Synced ${updated}/${processed} profiles...`
    );
    if (snapshot.size < batchSize) break;
  }

  if (dryRun) {
    console.log(`Dry run complete. ${processed} Firestore docs inspected.`);
  } else {
    console.log(`Done. ${updated} profiles written to Postgres.`);
  }
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
