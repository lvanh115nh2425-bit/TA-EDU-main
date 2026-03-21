/**
 * TA-Edu 2.x — boot_header.js
 * - N?p partial header
 * - Ðang nh?p Google, logout
 * - Hi?n th? avatar/menu, highlight avatar ? Dashboard
 * - Gate sau login: LOGIN -> ROLE -> KYC (approved m?i cho di ti?p)
 * (Gi? nguyên selector/ID chu?n TA-Edu)
 */

(() => {
  // ================= Helpers =================
  const $ = (s, r = document) => r.querySelector(s);
  const on = (el, ev, cb) => el && el.addEventListener(ev, cb);

  const FALLBACK_AVATAR = "assets/default_avatar.svg";
  const HEADER_URL = "/partials/header.html"; // luôn l?y t? g?c web, tránh l?i du?ng d?n khi ? subfolder

  // refs ph?n t? trong header (sau khi partial du?c n?p m?i có)
  const DEFAULT_TRUST_POINTS = 100;
  let btnLogin, btnLogout, userInfo, userPhoto, userMenu, menuName, menuTrust, dashboardLink;
  const trustFormatter = new Intl.NumberFormat("vi-VN");
  const normalizeTrust = (value) => (Number.isFinite(+value) ? Math.max(0, Math.round(+value)) : 0);
  function setMenuTrustValue(value = DEFAULT_TRUST_POINTS) {
    if (!menuTrust) return;
    menuTrust.textContent = `Ði?m uy tín: ${trustFormatter.format(normalizeTrust(value))}`;
  }
  function setMenuTrustLoading() {
    if (!menuTrust) return;
    menuTrust.textContent = "Ðang t?i di?m uy tín...";
  }
  function updateMenuTrustFromData(data) {
    if (!data) { setMenuTrustValue(DEFAULT_TRUST_POINTS); return; }
    const raw = data.trustScore ?? data.trust_points ?? data.trust ?? data.reputation ?? data.wallet ?? 0;
    setMenuTrustValue(raw);
  }


  function bindHeaderRefs() {
    btnLogin   = $("#btnLogin");
    btnLogout  = $("#btnLogout");
    userInfo   = $("#userInfo");
    userPhoto  = $("#userPhoto");
    userMenu   = $("#userMenu");
    menuName   = $("#menuName");
    menuTrust = $("#menuTrust");
    dashboardLink = $("#dashboardLink");
  }

  // ================= Header partial =================
  async function mountHeader() {
    try {
      const res = await fetch(HEADER_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error("Cannot load header.html");
      const html = await res.text();

      // chèn ngay sau <body>
      const wrap = document.createElement("div");
      wrap.id = "taedu-header-mount";
      wrap.innerHTML = html;
      document.body.insertAdjacentElement("afterbegin", wrap);

      bindHeaderRefs();
      bindHeaderUIBasics();
    } catch (e) {
      console.error("Mount header failed:", e);
    }
  }

  // ================= UI co b?n =================
  function setAuthUI(isAuth) {
    if (isAuth) {
      if (btnLogin)  btnLogin.hidden = true;
      if (userInfo)  userInfo.hidden = false;
    } else {
      if (btnLogin)  btnLogin.hidden = false;
      if (userInfo)  userInfo.hidden = true;
    }
  }

  function updateAvatar(src) {
    if (userPhoto) userPhoto.src = src || FALLBACK_AVATAR;
  }

  function bindHeaderUIBasics() {
    // toggle menu avatar
    on(userPhoto, "click", () => userMenu && userMenu.classList.toggle("is-open"));
    on(document, "click", (e) => {
      if (!userMenu) return;
      const inside = e.target.closest("#userMenu, #userPhoto");
      if (!inside) userMenu.classList.remove("is-open");
    });

    // highlight avatar ? dashboard
    const file = (location.pathname.split("/").pop() || "").toLowerCase();
    if (file === "dashboard.html" && userPhoto) userPhoto.classList.add("is-current");
  }

  // ================= Gate sau dang nh?p =================
  async function taeduGateAfterLogin(user) {
    // cho phép ? l?i m?t s? trang d? tránh vòng l?p
    const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const SKIP = new Set(["role.html", "smarttutor.html"]);
    if (SKIP.has(file)) return true;

    let role = null, status = null;

    // l?y t? Firestore (n?u s?n)
    try {
      const { getFirestore, doc, getDoc } =
        await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
      const db = getFirestore();
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const d = snap.data();
        updateMenuTrustFromData(d);
        role   = d.role || null;
        status = d.verify?.status || null;
      }
    } catch (_) {}

    // fallback localStorage (offline / chua có doc)
    if (!role) role = localStorage.getItem(`taedu:role:${user.uid}`) || null;

    if (!role) {
      location.replace("/role.html#step=select");
      return false;
    }
    if (status !== "approved") {
      location.replace(`/role.html#step=${role}`);
      return false;
    }
    return true;
  }

  // ================= Firebase Auth =================
  let auth = null;

  async function initAuth() {
    const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } =
    await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js");
    auth = getAuth();

    // login
    on(btnLogin, "click", async () => {
      try {
        const prov = new GoogleAuthProvider();
        await signInWithPopup(auth, prov);
      } catch (e) { console.error(e); alert("Không th? dang nh?p. Vui lòng th? l?i."); }
    });

    // logout
    on(btnLogout, "click", async () => {
      try { await signOut(auth); } catch (e) { console.error(e); }
    });

    // thay d?i tr?ng thái dang nh?p
    onAuthStateChanged(auth, (user) => {
      window.__TAEDU_LAST_USER = user || null;
      window.dispatchEvent(new CustomEvent("taedu:user-ready", { detail: { user } }));

      const isAuth = !!user;
      setAuthUI(isAuth);

      if (isAuth) {
        updateAvatar(user.photoURL || FALLBACK_AVATAR);
        if (menuName)   menuName.textContent   = user.displayName || "Ngu?i dùng";
        setMenuTrustLoading();
        if (dashboardLink) dashboardLink.style.display = "";

        // gate: LOGIN -> ROLE -> KYC
        taeduGateAfterLogin(user);
      } else {
        updateAvatar(FALLBACK_AVATAR);
        if (dashboardLink) dashboardLink.style.display = "none";
        setMenuTrustValue(DEFAULT_TRUST_POINTS);
      }
    });
  }

  // ================= Boot =================
  document.addEventListener("DOMContentLoaded", async () => {
    await mountHeader();   // 1) n?p header (và bind refs)
    await initAuth();      // 2) kh?i t?o auth & g?n s? ki?n
  });
})();









