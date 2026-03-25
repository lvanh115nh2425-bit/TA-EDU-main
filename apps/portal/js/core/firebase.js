import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getStorage, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-storage.js";
import { firebaseConfig } from "./firebase_config.js";

const shouldPreferLocalhost =
  typeof window !== "undefined" &&
  window.location.protocol === "http:" &&
  window.location.hostname === "127.0.0.1";

if (shouldPreferLocalhost) {
  const redirectUrl = new URL(window.location.href);
  redirectUrl.hostname = "localhost";
  window.location.replace(redirectUrl.toString());
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const storage = getStorage(app);

const urlHasEmu = new URLSearchParams(location.search).get("emu") === "1";
const wantEmu = localStorage.getItem("taedu:emu") === "1" || urlHasEmu;

if (wantEmu) {
  const isLocal = /^(localhost|127\.|192\.168\.)/.test(location.hostname);
  if (isLocal) {
    try {
      connectAuthEmulator(auth, "http://127.0.0.1:9099");
      connectStorageEmulator(storage, "127.0.0.1", 9199);
      console.log("%c[TA-Edu] Using Firebase Auth/Storage Emulators", "color:#0aa");
    } catch (error) {
      console.warn("[TA-Edu] Emulator connect failed:", error);
    }
  }
}

async function ensureUserProfile() {
  return;
}

function mapFirebaseAuthError(error) {
  const code = error?.code || "";
  switch (code) {
    case "auth/popup-blocked":
    case "auth/cancelled-popup-request":
      return "Trinh duyet dang chan cua so dang nhap. He thong se chuyen sang dang nhap toan trang.";
    case "auth/popup-closed-by-user":
      return "Ban da dong cua so dang nhap truoc khi hoan tat.";
    case "auth/unauthorized-domain":
      return "Domain hien tai chua duoc phep trong Firebase Auth. Hay them domain nay vao Authorized domains.";
    case "auth/operation-not-allowed":
      return "Dang nhap bang Google chua duoc bat trong Firebase Console.";
    case "auth/configuration-not-found":
      return `Firebase Auth chua duoc cau hinh dung cho project '${firebaseConfig.projectId}'. Hay kiem tra lai apiKey, authDomain va cau hinh Sign-in method trong Firebase Console.`;
    case "auth/network-request-failed":
      return "Khong the ket noi toi Firebase. Kiem tra mang va thu lai.";
    default:
      return code ? `Dang nhap that bai (${code}).` : "Dang nhap that bai.";
  }
}

async function loginWithGoogle() {
  try {
    return await signInWithPopup(auth, provider);
  } catch (error) {
    const code = error?.code || "";
    if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request") {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw error;
  }
}

async function readRedirectLoginResult() {
  return getRedirectResult(auth);
}

window.__TAEDU_FIREBASE = { app, auth, storage, config: firebaseConfig };

export {
  app,
  auth,
  provider,
  storage,
  firebaseConfig,
  ensureUserProfile,
  mapFirebaseAuthError,
  loginWithGoogle,
  readRedirectLoginResult,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut
};
