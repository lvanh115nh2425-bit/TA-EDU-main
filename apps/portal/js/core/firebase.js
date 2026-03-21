// js/core/firebase.js
// Kh?i t?o Firebase cho TA-Edu, m?c d?nh d�ng Cloud (kh�ng emulator)
// C� th? b?t emulator t?m th?i: 
//   - localStorage.setItem('taedu:emu','1')  ho?c
//   - th�m ?emu=1 v�o URL

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getStorage, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-storage.js";

// ---- Config c?a b?n ----
const firebaseConfig = {
  apiKey: "AIzaSyCyvnLfIQ5iosFafZhCriPipDYVyVjSXr4",
  authDomain: "ta-edu-01.firebaseapp.com",
  projectId: "ta-edu-01",
  storageBucket: "ta-edu-01.firebasestorage.app",
  messagingSenderId: "309479852838",
  appId: "1:309479852838:web:7fa489a5becfd9c19b8fe7",
  measurementId: "G-FT18DWWLYV"
};

// Kh?i t?o (d?m b?o ch? 1 [DEFAULT])
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Core
const auth    = getAuth(app);
const provider= new GoogleAuthProvider();
const storage = getStorage(app);

// --------- Emulators (t�y ch?n) ---------
// B?t qua localStorage.setItem('taedu:emu','1') ho?c query ?emu=1
const urlHasEmu = new URLSearchParams(location.search).get("emu") === "1";
const wantEmu   = localStorage.getItem("taedu:emu") === "1" || urlHasEmu;

if (wantEmu) {
  const isLocal = /^(localhost|127\.|192\.168\.)/.test(location.hostname);
  if (isLocal) {
    try {
      connectAuthEmulator(auth, "http://127.0.0.1:9099");
      connectStorageEmulator(storage, "127.0.0.1", 9199);
      console.log("%c[TA-Edu] Using Firebase Auth/Storage Emulators", "color:#0aa");
    } catch (e) {
      console.warn("[TA-Edu] Emulator connect failed:", e);
    }
  }
}

async function ensureUserProfile() {
  // Legacy stub: profile now lưu ở Postgres qua API.
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
      return "Domain hien tai chua duoc phep trong Firebase Auth. Can them localhost vao Authorized domains.";
    case "auth/operation-not-allowed":
      return "Dang nhap bang Google chua duoc bat trong Firebase Console.";
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

window.__TAEDU_FIREBASE = { app, auth, storage };

export {
  app, auth, provider, storage,
  ensureUserProfile,
  mapFirebaseAuthError,
  loginWithGoogle,
  readRedirectLoginResult,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut
};
