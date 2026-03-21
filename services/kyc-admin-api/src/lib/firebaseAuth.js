const admin = require("firebase-admin");
const { getFirebaseApp } = require("./firebaseApp");

async function verifyIdToken(idToken) {
  const app = getFirebaseApp();
  const decoded = await admin.auth(app).verifyIdToken(idToken);
  return decoded;
}

module.exports = { verifyIdToken };
