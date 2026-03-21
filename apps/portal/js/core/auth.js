// js/core/auth.js
// Logic dang nh?p / dang xu?t / b?o v? trang c� nh�n

import {
  auth,
  provider,
  db,
  signInWithEmailAndPassword,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  ensureUserProfile
} from "./firebase.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// ===== Dang nh?p b?ng email + m?t kh?u =====
async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById("email")?.value;
  const password = document.getElementById("password")?.value;

  if (!email || !password) {
    alert("Vui l�ng nh?p email v� m?t kh?u.");
    return;
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await ensureUserProfile(cred.user);

    // Ki?m tra role d? di?u hu?ng ph� h?p
    const ref = doc(db, "users", cred.user.uid);
    const snap = await getDoc(ref);
    const data = snap.data();

    if (!data.role || data.role === "H?c sinh") {
      window.location.href = "/role.html";
    } else {
      window.location.href = "/dashboard.html";
    }

  } catch (err) {
    console.error(err);
    alert("Dang nh?p th?t b?i.");
  }
}

// ===== Dang nh?p b?ng Google =====
async function loginWithGoogle() {
  try {
    const cred = await signInWithPopup(auth, provider);
    await ensureUserProfile(cred.user);

    // Ki?m tra role d? di?u hu?ng ph� h?p
    const ref = doc(db, "users", cred.user.uid);
    const snap = await getDoc(ref);
    const data = snap.data();

    if (!data.role || data.role === "H?c sinh") {
      window.location.href = "/role.html";
    } else {
      window.location.href = "/dashboard.html";
    }

  } catch (err) {
    console.error(err);
    alert("Kh�ng dang nh?p du?c b?ng Google.");
  }
}

// ===== Dang xu?t =====
async function logout() {
  await signOut(auth);
  window.location.href = "index.html";
}

// ===== B?o v? dashboard =====
async function initDashboardAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }

    await ensureUserProfile(user);

    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    const d = snap.data() || {};

    const elName = document.getElementById("dash-name");
    const elEmail = document.getElementById("dash-email");
    const elRole = document.getElementById("dash-role");
    const elRep = document.getElementById("dash-reputation");

    if (elName) elName.textContent = d.displayName || user.displayName || "(Chua d?t t�n)";
    if (elEmail) elEmail.textContent = d.email || user.email || "";
    if (elRole) elRole.textContent = d.role || "H?c sinh";
    if (elRep) elRep.textContent = (d.reputation ?? 0) + " di?m";
  });
}

// ===== Xu?t ra global =====
window.handleLogin = handleLogin;
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;


// ===== Dang xu?t d�ng chung (cho Header/Dashboard) =====
async function doLogoutAndRedirect(to = 'index.html') {
  try { await signOut(auth); }
  catch (err) { console.error(err); alert('Dang xu?t th?t b?i, vui l�ng th? l?i.'); }
  finally { window.location.href = to; }
}
window.doLogoutAndRedirect = doLogoutAndRedirect;
window.initDashboardAuth = initDashboardAuth;


