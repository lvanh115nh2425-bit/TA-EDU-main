// js/core/auth.js
// Logic đăng nhập / đăng xuất / bảo vệ trang cá nhân

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

// ===== Đăng nhập bằng email + mật khẩu =====
async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById("email")?.value;
  const password = document.getElementById("password")?.value;

  if (!email || !password) {
    alert("Vui lòng nhập email và mật khẩu.");
    return;
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await ensureUserProfile(cred.user);

    // Kiểm tra role để điều hướng phù hợp
    const ref = doc(db, "users", cred.user.uid);
    const snap = await getDoc(ref);
    const data = snap.data();

    if (!data.role || data.role === "Học sinh") {
      window.location.href = "/role.html";
    } else {
      window.location.href = "/dashboard.html";
    }

  } catch (err) {
    console.error(err);
    alert("Đăng nhập thất bại.");
  }
}

// ===== Đăng nhập bằng Google =====
async function loginWithGoogle() {
  try {
    const cred = await signInWithPopup(auth, provider);
    await ensureUserProfile(cred.user);

    // Kiểm tra role để điều hướng phù hợp
    const ref = doc(db, "users", cred.user.uid);
    const snap = await getDoc(ref);
    const data = snap.data();

    if (!data.role || data.role === "Học sinh") {
      window.location.href = "/role.html";
    } else {
      window.location.href = "/dashboard.html";
    }

  } catch (err) {
    console.error(err);
    alert("Không đăng nhập được bằng Google.");
  }
}

// ===== Đăng xuất =====
async function logout() {
  await signOut(auth);
  window.location.href = "index.html";
}

// ===== Bảo vệ dashboard =====
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

    if (elName) elName.textContent = d.displayName || user.displayName || "(Chưa đặt tên)";
    if (elEmail) elEmail.textContent = d.email || user.email || "";
    if (elRole) elRole.textContent = d.role || "Học sinh";
    if (elRep) elRep.textContent = (d.reputation ?? 0) + " điểm";
  });
}

// ===== Xuất ra global =====
window.handleLogin = handleLogin;
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;

// ===== Đăng xuất dùng chung (cho Header/Dashboard) =====
async function doLogoutAndRedirect(to = "index.html") {
  try { await signOut(auth); }
  catch (err) { console.error(err); alert("Đăng xuất thất bại, vui lòng thử lại."); }
  finally { window.location.href = to; }
}
window.doLogoutAndRedirect = doLogoutAndRedirect;
window.initDashboardAuth = initDashboardAuth;
