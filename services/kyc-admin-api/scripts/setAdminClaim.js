const admin = require("firebase-admin");
const { getFirebaseApp } = require("../src/lib/firebaseApp");

async function main() {
  const emails = process.argv.slice(2).map((e) => e.trim()).filter(Boolean);
  if (!emails.length) {
    console.error("Usage: node scripts/setAdminClaim.js email1@example.com [email2@example.com]");
    process.exit(1);
  }

  const app = getFirebaseApp();
  const auth = admin.auth(app);

  for (const email of emails) {
    try {
      const user = await auth.getUserByEmail(email);
      const currentClaims = user.customClaims || {};
      const nextClaims = { ...currentClaims, role: "admin" };
      await auth.setCustomUserClaims(user.uid, nextClaims);
      console.log(`Set admin claim for ${email} (uid=${user.uid})`);
    } catch (err) {
      console.error(`Failed to set admin for ${email}:`, err.message || err);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
