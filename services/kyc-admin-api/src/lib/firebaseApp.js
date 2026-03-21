const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

let firebaseApp = null;

function readServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    if (raw.trim().startsWith("{")) {
      return JSON.parse(raw);
    }
    const resolved = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
    const file = fs.readFileSync(resolved, "utf8");
    return JSON.parse(file);
  } catch (err) {
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT value");
  }
}

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID missing");
  }
  const serviceAccount = readServiceAccount();
  const credential = serviceAccount
    ? admin.credential.cert(serviceAccount)
    : admin.credential.applicationDefault();
  firebaseApp = admin.initializeApp({
    credential,
    projectId,
  });
  return firebaseApp;
}

module.exports = { getFirebaseApp };
