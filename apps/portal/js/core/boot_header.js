(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const on = (el, ev, cb) => el && el.addEventListener(ev, cb);

  const ADMIN_ROLE = "admin";
  const ADMIN_EMAIL_FALLBACK = ["khkt.anhtu@gmail.com", "lvanh.115nh2425@gmail.com"];
  const FALLBACK_AVATAR = "assets/default_avatar.svg";
  const HEADER_URL = "/partials/header.html";
  const MOBILE_QUERY = window.matchMedia("(max-width: 992px)");
  const THEME_STORAGE_KEY = "taedu:smarttutor:theme";
  const SUPPORTED_THEMES = new Set(["neon", "home"]);
  const GATE_SKIP_FILES = new Set(["smarttutor.html", "role.html", "role"]);
  let apiModulePromise = null;

  let themeButtons = [];
  let themeSliders = [];
  let currentTheme = "neon";
  let appReadyPromise = null;

  async function ensureFirebaseApp() {
    if (window.__TAEDU_FIREBASE?.app) return;
    if (appReadyPromise) {
      await appReadyPromise;
      return;
    }
    appReadyPromise = (async () => {
      const { initializeApp, getApps } = await import(
        "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js"
      );
      if (!getApps().length) {
        initializeApp({
          apiKey: "AIzaSyCyvnLfIQ5iosFafZhCriPipDYVyVjSXr4",
          authDomain: "ta-edu-01.firebaseapp.com",
          projectId: "ta-edu-01"
        });
      }
    })();
    await appReadyPromise;
  }

  function ensureMenuToggleLoaded() {
    if (window.__TAEDU_MENU_SCRIPT_LOADED) return;
    const hasScript = Array.from(document.scripts || []).some((s) =>
      (s.getAttribute("src") || "").includes("js/core/menu_toggle.js")
    );
    if (hasScript) {
      window.__TAEDU_MENU_SCRIPT_LOADED = true;
      return;
    }
    const tag = document.createElement("script");
    tag.type = "module";
    tag.src = "/js/core/menu_toggle.js";
    tag.onload = () => {
      window.__TAEDU_MENU_SCRIPT_LOADED = true;
    };
    document.head.appendChild(tag);
  }

  async function loadProfileApi() {
    if (!apiModulePromise) {
      apiModulePromise = import("../utils/api.js");
    }
    return apiModulePromise;
  }

  const DEFAULT_TRUST_POINTS = 100;

  let btnLogin,
    btnLogout,
    userInfo,
    userPhoto,
    userMenu,
    menuName,
    menuTrust,
    menuAdminKyc,
    dashboardLink;
  let isAuthenticated = false;

  const trustFormatter = new Intl.NumberFormat("vi-VN");
  const normalizeTrust = (value) =>
    Number.isFinite(+value) ? Math.max(0, Math.round(+value)) : 0;
  const setTrustBadgeValue = (value = DEFAULT_TRUST_POINTS) => {
    if (!menuTrust) return;
    // Only set the numeric value; label is provided by CSS for consistent styling
    menuTrust.textContent = trustFormatter.format(normalizeTrust(value));
  };
  const setTrustBadgeLoading = () => {
    if (!menuTrust) return;
    menuTrust.textContent = "..."; // simple loading indicator
  };
  const updateTrustBadgeFromData = (data) => {
    if (!menuTrust || !data) {
      setTrustBadgeValue(DEFAULT_TRUST_POINTS);
      return;
    }
    const raw =
      data.trustScore ??
      data.trust_points ??
      data.trust ??
      data.reputation ??
      data.wallet ??
      0;
    setTrustBadgeValue(raw);
  };

  function bindHeaderRefs() {
    btnLogin = $("#btnLogin");
    btnLogout = $("#btnLogout");
    userInfo = $("#userInfo");
    userPhoto = $("#userPhoto");
    userMenu = $("#userMenu");
    menuName = $("#menuName");
    menuTrust = $("#menuTrust");
    menuAdminKyc = $("#menuAdminKyc");
    dashboardLink = $("#dashboardLink");
    // mobile logout item removed — logout is inside #userMenu
  }

  function syncAuthFromCache() {
    const cachedUser = window.__TAEDU_LAST_USER || null;
    if (cachedUser) {
      setAuthUI(true);
      updateAvatar(cachedUser.photoURL || FALLBACK_AVATAR);
      if (menuName) {
        menuName.textContent = cachedUser.displayName || cachedUser.email || "Nguoi dung";
      }
      if (dashboardLink) dashboardLink.style.display = "";
    } else {
      setAuthUI(false);
      updateAvatar(FALLBACK_AVATAR);
      if (dashboardLink) dashboardLink.style.display = "none";
    }
  }

  async function mountHeader() {
    try {
      const res = await fetch(HEADER_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error("Cannot load header.html");
      const html = await res.text();
      const wrap = document.createElement("div");
      wrap.id = "taedu-header-mount";
      wrap.innerHTML = html;
      document.body.insertAdjacentElement("afterbegin", wrap);
      bindHeaderRefs();
      bindHeaderUIBasics();
      syncAuthFromCache();
      document.dispatchEvent(
        new CustomEvent("taedu:header:ready", {
          detail: { mount: wrap }
        })
      );
      ensureMenuToggleLoaded();
    } catch (err) {
      console.error("Mount header failed:", err);
    }
  }

  function setAuthUI(isAuth) {
    isAuthenticated = !!isAuth;
    const body = document.body;
    if (body) {
      body.classList.toggle("is-auth", !!isAuth);
      body.classList.toggle("is-guest", !isAuth);
      body.dataset.authState = isAuth ? "auth" : "guest";
    }

    if (isAuth) {
      if (btnLogin) btnLogin.hidden = true;
      if (userInfo) userInfo.hidden = false;
    } else {
      if (btnLogin) btnLogin.hidden = false;
      if (userInfo) userInfo.hidden = true;
      setAdminMenuVisible(false);
    }
  }

  const updateAvatar = (src) => {
    if (userPhoto) userPhoto.src = src || FALLBACK_AVATAR;
  };

  function setAdminMenuVisible(isAdmin) {
    if (menuAdminKyc) menuAdminKyc.hidden = !isAdmin;
  }

  function bindHeaderUIBasics() {
    const goDashboard = () => {
      const target = (dashboardLink && dashboardLink.getAttribute("href")) || "/dashboard.html";
      window.location.assign(target);
    };

    on(userPhoto, "click", (event) => {
      if (!userPhoto) return;
      if (MOBILE_QUERY?.matches) {
        event.preventDefault();
        goDashboard();
        return;
      }
      if (userMenu) userMenu.classList.toggle("is-open");
    });
    on(document, "click", (event) => {
      if (!userMenu) return;
      const inside = event.target.closest("#userMenu, #userPhoto");
      if (!inside) userMenu.classList.remove("is-open");
    });

    const file = (location.pathname.split("/").pop() || "").toLowerCase();
    if (file === "dashboard.html" && userPhoto) userPhoto.classList.add("is-current");
  }

  const storeTheme = (theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (_) {}
  };
  const getStoredTheme = () => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      return saved && SUPPORTED_THEMES.has(saved) ? saved : null;
    } catch (_) {
      return null;
    }
  };
  const detectInitialTheme = () => {
    const body = document.body;
    if (body?.classList?.contains("theme-home")) return "home";
    if (body?.classList?.contains("theme-neon")) return "neon";
    // Prefer TA-Edu (home) theme by default, but allow specific pages to override
    try {
      const p = (location.pathname || "").toLowerCase();
      const file = (p.split("/").pop() || "").toLowerCase();
      // If on index or root or under /mon, use home style
      if (file === "" || file === "index.html" || p.startsWith("/mon") || p.match(/^\/mon(\/|$)/)) {
        return "home";
      }
    } catch (_) {}
    return "home";
  };

  function syncThemeControls() {
    if (themeButtons.length) {
      themeButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.themeOption === currentTheme);
      });
    }
    if (themeSliders.length) {
      themeSliders.forEach((wrap) => {
        wrap.dataset.themeCurrent = currentTheme;
      });
    }
  }

  function bindThemeControls() {
    themeButtons = Array.from(document.querySelectorAll("[data-theme-option]"));
    themeSliders = Array.from(document.querySelectorAll("[data-theme-slider]"));
    themeButtons.forEach((btn) => {
      if (!btn || btn.dataset.themeBound === "1") return;
      btn.dataset.themeBound = "1";
      btn.addEventListener("click", () => {
        applyThemePreference(btn.dataset.themeOption || "neon");
      });
    });
    syncThemeControls();
  }

  function applyThemePreference(theme, options = {}) {
    const resolved = SUPPORTED_THEMES.has(theme) ? theme : "neon";
    currentTheme = resolved;
    const body = document.body;
    if (body) {
      body.classList.remove("theme-home", "theme-neon");
      body.classList.add(`theme-${resolved}`);
    }
    if (options.syncControls !== false) {
      syncThemeControls();
    }
    if (options.persist !== false) {
      storeTheme(resolved);
    }
  }

  function initThemePreference() {
    const stored = getStoredTheme();
    const initial = stored || detectInitialTheme();
    applyThemePreference(initial, { persist: false });
  }

  async function taeduGateAfterLogin(user) {
    const path = (location.pathname || "").toLowerCase();
    const file = (path.split("/").pop() || "index.html").toLowerCase();
    const isAdminRoute = path.includes("/admin/");
    const isGateExemptPage = GATE_SKIP_FILES.has(file);
    const shouldSkipGate = isGateExemptPage || isAdminRoute;

    let role = null;
    let status = null;
    let profileData = null;
    let isAdmin = false;

    try {
      const { getProfile } = await loadProfileApi();
      const token = await user.getIdToken();
      const res = await getProfile(token);
      profileData = res?.profile || null;
    } catch (err) {
      console.warn("Fetch profile failed:", err);
    }

    if (profileData) {
      updateTrustBadgeFromData(profileData);
      role = profileData.role || null;
      status = profileData.verify_status || null;
      isAdmin = role === ADMIN_ROLE;
    } else {
      setTrustBadgeValue(DEFAULT_TRUST_POINTS);
    }

    if (!isAdmin) {
      const adminEmailsRaw =
        typeof window.__TAEDU_ADMIN_EMAILS === "string" && window.__TAEDU_ADMIN_EMAILS.trim().length
          ? window.__TAEDU_ADMIN_EMAILS
          : ADMIN_EMAIL_FALLBACK.join(",");
      const adminEmails = adminEmailsRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (adminEmails.length && adminEmails.includes((user.email || "").toLowerCase())) {
        isAdmin = true;
      }
    }

    setAdminMenuVisible(isAdmin);

    if (isAdmin) {
      role = ADMIN_ROLE;
      status = status || "approved";
      try {
        localStorage.setItem(`taedu:role:${user.uid}`, ADMIN_ROLE);
      } catch (_) {}
      return true;
    }

    if (!role) {
      role = localStorage.getItem(`taedu:role:${user.uid}`) || null;
    }

    if (!role) {
      if (!shouldSkipGate) {
        location.replace("/role.html#step=select");
      }
      return shouldSkipGate;
    }
    if (status !== "approved") {
      if (!shouldSkipGate) {
        location.replace(`/role.html#step=${role}`);
      }
      return shouldSkipGate;
    }
    return true;
  }

  let auth = null;

  async function initAuth() {
    const { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } = await import(
      "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js"
    );
    auth = getAuth();

    const mapAuthError = (error) => {
      const code = error?.code || "";
      switch (code) {
        case "auth/popup-blocked":
        case "auth/cancelled-popup-request":
          return "Trinh duyet dang chan cua so dang nhap. He thong se chuyen sang Google theo che do redirect.";
        case "auth/popup-closed-by-user":
          return "Ban da dong cua so dang nhap truoc khi hoan tat.";
        case "auth/unauthorized-domain":
          return "Domain localhost chua duoc phep trong Firebase Auth. Can them vao Authorized domains.";
        case "auth/operation-not-allowed":
          return "Dang nhap bang Google chua duoc bat trong Firebase Console.";
        default:
          return code ? `Dang nhap that bai (${code}).` : "Khong the dang nhap. Vui long thu lai.";
      }
    };

    getRedirectResult(auth).catch((err) => {
      console.error(err);
      alert(mapAuthError(err));
    });

    on(btnLogin, "click", async () => {
      try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
      } catch (err) {
        console.error(err);
        if (err?.code === "auth/popup-blocked" || err?.code === "auth/cancelled-popup-request") {
          alert(mapAuthError(err));
          const provider = new GoogleAuthProvider();
          await signInWithRedirect(auth, provider);
          return;
        }
        alert(mapAuthError(err));
      }
    });

    const bindLogoutButtons = (...buttons) => {
      buttons.filter(Boolean).forEach((btn) => {
        on(btn, "click", async (event) => {
          event.preventDefault();
          try {
            await signOut(auth);
          } catch (err) {
            console.error(err);
          }
        });
      });
    };
    bindLogoutButtons(btnLogout);

    onAuthStateChanged(auth, (user) => {
      window.__TAEDU_LAST_USER = user || null;
      window.dispatchEvent(new CustomEvent("taedu:user-ready", { detail: { user } }));

      const isAuth = !!user;
      setAuthUI(isAuth);

      if (isAuth) {
        updateAvatar(user.photoURL || FALLBACK_AVATAR);
        if (menuName) {
          menuName.textContent = user.displayName || user.email || "Nguoi dung";
        }
        setTrustBadgeLoading();
        if (dashboardLink) dashboardLink.style.display = "";
        taeduGateAfterLogin(user);
      } else {
        updateAvatar(FALLBACK_AVATAR);
        if (dashboardLink) dashboardLink.style.display = "none";
        setTrustBadgeValue(DEFAULT_TRUST_POINTS);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    initThemePreference();
    await mountHeader();
    bindThemeControls();
    await initAuth();
  });

  document.addEventListener("taedu:header:ready", () => {
    bindThemeControls();
  });
})();
