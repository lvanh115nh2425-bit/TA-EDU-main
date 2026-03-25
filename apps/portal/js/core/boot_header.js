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
      const runtimeConfig =
        (typeof window.__TAEDU_FIREBASE_CONFIG__ === "object" && window.__TAEDU_FIREBASE_CONFIG__) ||
        {
          apiKey: "AIzaSyCyvnLfIQ5iosFafZhCriPipDYVyVjSXr4",
          authDomain: "ta-edu-01.firebaseapp.com",
          projectId: "ta-edu-01"
        };
      if (!getApps().length) {
        initializeApp(runtimeConfig);
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
  const LAST_EMAIL_KEY = "taedu:last-auth-email";
  const isProfileComplete = (profile, user) => {
    const email = (profile?.email || user?.email || "").trim();
    return Boolean(
      (profile?.role || "").trim() &&
      (profile?.display_name || "").trim() &&
      (profile?.full_name || "").trim() &&
      (profile?.student_grade || "").trim() &&
      (profile?.student_phone || "").trim() &&
      email
    );
  };

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
        menuName.textContent = cachedUser.displayName || cachedUser.email || "Người dùng";
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
      try {
        localStorage.setItem(`taedu:role:${user.uid}`, ADMIN_ROLE);
      } catch (_) {}
      return true;
    }

    if (!role) {
      role = localStorage.getItem(`taedu:role:${user.uid}`) || null;
    }

    const completed = isProfileComplete(profileData, user);

    if (!completed) {
      if (!shouldSkipGate) {
        location.replace("/role.html");
      }
      return shouldSkipGate;
    }

    try {
      localStorage.setItem(`taedu:role:${user.uid}`, role || "student");
      localStorage.setItem(`taedu:profile-complete:${user.uid}`, "1");
    } catch (_) {}

    if (!role && profileData) {
      role = "student";
    }

    return true;
  }

  function rememberAuthEmail(email) {
    const value = String(email || "").trim();
    if (!value) return;
    try {
      localStorage.setItem(LAST_EMAIL_KEY, value);
    } catch (_) {}
  }

  function fillRolePageEmail(user) {
    const emailInput = document.querySelector('#profileForm input[name="email"]');
    const debugNote = document.querySelector("#emailDebugNote");
    if (!emailInput) return;
    const providerEmail = Array.isArray(user?.providerData)
      ? user.providerData.map((item) => item?.email || "").find(Boolean)
      : "";
    const email = String(user?.email || providerEmail || "").trim();
    if (email) {
      emailInput.value = email;
      rememberAuthEmail(email);
      if (debugNote) debugNote.textContent = `Đã lấy email từ đăng nhập: ${email}`;
    } else if (debugNote) {
      debugNote.textContent = "Chưa lấy được email từ Firebase Auth.";
    }
  }

  function validateRestrictedEmail(raw) {
    const email = String(raw || "").trim();
    if (!email) {
      return { ok: false, message: "Vui lòng nhập email." };
    }

    const atCount = (email.match(/@/g) || []).length;
    if (atCount !== 1 || !email.includes("@")) {
      return { ok: false, message: "Email phải có @example.com" };
    }

    const [localPart, domainPart] = email.split("@");
    if (!localPart || !domainPart) {
      return { ok: false, message: "Email phải có @example.com" };
    }

    if (/[.+]/.test(localPart)) {
      return { ok: false, message: 'Tên gmail không được chứa "." hoặc "+".' };
    }

    if (!/^[A-Za-z0-9]+$/.test(localPart)) {
      return { ok: false, message: "Phần trước dấu @ chỉ được dùng chữ và số." };
    }

    if (!domainPart.includes(".") || domainPart.startsWith(".") || domainPart.endsWith(".")) {
      return { ok: false, message: "Email phải có @example.com" };
    }

    return { ok: true, value: email.toLowerCase() };
  }

  function getPasswordStrengthMeta(password = "") {
    const value = String(password || "");
    let score = 0;
    if (value.length >= 8) score += 1;
    if (value.length >= 12) score += 1;
    if (/[A-Z]/.test(value)) score += 1;
    if (/[a-z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;

    if (!value) {
      return { width: 0, tone: "", text: "Độ mạnh mật khẩu" };
    }
    if (score <= 2) {
      return { width: 33, tone: "weak", text: "Mật khẩu yếu" };
    }
    if (score <= 4) {
      return { width: 66, tone: "medium", text: "Mật khẩu trung bình" };
    }
    return { width: 100, tone: "strong", text: "Mật khẩu mạnh" };
  }

  let auth = null;

  async function initAuth() {
    const { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } = await import(
      "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js"
    );
    auth = getAuth();
    const authModal = $("#authModal");
    const authEmailForm = $("#authEmailForm");
    const authSubmitBtn = $("#authSubmitBtn");
    const authGoogleBtn = $("#authGoogleBtn");
    const authModeHint = $("#authModeHint");
    const authModalError = $("#authModalError");
    const authModeButtons = Array.from(document.querySelectorAll("[data-auth-mode]"));
    const authConfirmField = authEmailForm?.querySelector(".auth-field--confirm");
    const passwordInput = authEmailForm?.querySelector('[name="password"]');
    const confirmInput = authEmailForm?.querySelector('[name="confirmPassword"]');
    const passwordStrength = $("#authPasswordStrength");
    const passwordStrengthFill = $("#authPasswordStrengthFill");
    const passwordStrengthText = $("#authPasswordStrengthText");
    const passwordToggles = Array.from(document.querySelectorAll("[data-password-toggle]"));
    let authMode = "login";

    const updatePasswordStrength = () => {
      if (!passwordStrength || !passwordStrengthFill || !passwordStrengthText) return;
      const meta = getPasswordStrengthMeta(passwordInput?.value || "");
      passwordStrength.hidden = authMode !== "register";
      passwordStrength.dataset.strength = meta.tone;
      passwordStrengthFill.style.width = `${meta.width}%`;
      passwordStrengthText.textContent = meta.text;
    };

    const syncPasswordToggle = (button, input) => {
      if (!button || !input) return;
      const visible = input.type === "text";
      button.setAttribute("aria-label", visible ? "Ẩn mật khẩu" : "Hiện mật khẩu");
      button.innerHTML = visible
        ? '<i class="fa-regular fa-eye-slash"></i>'
        : '<i class="fa-regular fa-eye"></i>';
    };

    const setAuthMode = (mode) => {
      authMode = mode === "register" ? "register" : "login";
      authModeButtons.forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.authMode === authMode);
      });
      if (authConfirmField) authConfirmField.hidden = authMode !== "register";
      if (authSubmitBtn) authSubmitBtn.textContent = authMode === "register" ? "Đăng ký" : "Đăng nhập";
      if (authModeHint) {
        authModeHint.textContent = authMode === "register"
          ? "Tạo tài khoản bằng email và mật khẩu, sau đó hoàn tất thông tin lần đầu."
          : "Dùng email và mật khẩu để đăng nhập vào tài khoản đã có.";
      }
      if (authModalError) {
        authModalError.hidden = true;
        authModalError.textContent = "";
      }
      if (passwordInput) passwordInput.autocomplete = authMode === "register" ? "new-password" : "current-password";
      if (confirmInput) confirmInput.required = authMode === "register";
      updatePasswordStrength();
    };

    const openAuthModal = () => {
      if (!authModal) return;
      authModal.hidden = false;
      document.body.style.overflow = "hidden";
      setAuthMode("login");
      setTimeout(() => authEmailForm?.querySelector('[name="email"]')?.focus(), 30);
    };

    const closeAuthModal = () => {
      if (!authModal) return;
      authModal.hidden = true;
      document.body.style.overflow = "";
      authEmailForm?.reset();
      if (passwordInput) passwordInput.type = "password";
      if (confirmInput) confirmInput.type = "password";
      passwordToggles.forEach((button) => {
        const targetName = button.dataset.passwordToggle;
        const input = authEmailForm?.querySelector(`[name="${targetName}"]`);
        syncPasswordToggle(button, input);
      });
      updatePasswordStrength();
      if (authModalError) {
        authModalError.hidden = true;
        authModalError.textContent = "";
      }
    };

    const setAuthError = (message) => {
      if (!authModalError) return;
      authModalError.hidden = !message;
      authModalError.textContent = message || "";
    };

    const mapAuthError = (error) => {
      const code = error?.code || "";
      switch (code) {
        case "auth/popup-blocked":
        case "auth/cancelled-popup-request":
          return "Trình duyệt đang chặn cửa sổ đăng nhập. Hệ thống sẽ chuyển sang Google theo chế độ redirect.";
        case "auth/popup-closed-by-user":
          return "Bạn đã đóng cửa sổ đăng nhập trước khi hoàn tất.";
        case "auth/unauthorized-domain":
          return "Domain hiện tại chưa được phép trong Firebase Auth. Nếu đang chạy local, hãy mở bằng localhost thay vì 127.0.0.1 hoặc thêm domain này vào Authorized domains.";
        case "auth/operation-not-allowed":
          return "Đăng nhập bằng Google chưa được bật trong Firebase Console.";
        case "auth/email-already-in-use":
          return "Email này đã được dùng để tạo tài khoản.";
        case "auth/invalid-credential":
        case "auth/wrong-password":
        case "auth/user-not-found":
          return "Email hoặc mật khẩu chưa đúng.";
        case "auth/weak-password":
          return "Mật khẩu quá yếu. Hãy dùng ít nhất 6 ký tự.";
        case "auth/invalid-email":
          return "Email chưa đúng định dạng.";
        case "auth/configuration-not-found": {
          const cfg = window.__TAEDU_FIREBASE_CONFIG__ || {};
          const project = cfg.projectId || "unknown-project";
          return `Firebase Auth chưa được cấu hình đúng cho project '${project}'. Hãy kiểm tra apiKey, authDomain và Sign-in method.`;
        }
        default:
          return code ? `Đăng nhập thất bại (${code}).` : "Không thể đăng nhập. Vui lòng thử lại.";
      }
    };

    getRedirectResult(auth).catch((err) => {
      console.error(err);
      alert(mapAuthError(err));
    });

    on(btnLogin, "click", async () => {
      openAuthModal();
    });

    authModeButtons.forEach((btn) => {
      on(btn, "click", () => setAuthMode(btn.dataset.authMode));
    });

    document.querySelectorAll("[data-auth-modal='close']").forEach((btn) => {
      on(btn, "click", closeAuthModal);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && authModal && !authModal.hidden) {
        closeAuthModal();
      }
    });

    on(authGoogleBtn, "click", async () => {
      try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        closeAuthModal();
      } catch (err) {
        console.error(err);
        if (err?.code === "auth/popup-blocked" || err?.code === "auth/cancelled-popup-request") {
          closeAuthModal();
          alert(mapAuthError(err));
          const provider = new GoogleAuthProvider();
          await signInWithRedirect(auth, provider);
          return;
        }
        setAuthError(mapAuthError(err));
      }
    });

    passwordToggles.forEach((button) => {
      const targetName = button.dataset.passwordToggle;
      const input = authEmailForm?.querySelector(`[name="${targetName}"]`);
      syncPasswordToggle(button, input);
      on(button, "click", () => {
        if (!input) return;
        input.type = input.type === "password" ? "text" : "password";
        syncPasswordToggle(button, input);
      });
    });

    on(passwordInput, "input", updatePasswordStrength);

    on(authEmailForm, "submit", async (event) => {
      event.preventDefault();
      const email = authEmailForm?.querySelector('[name="email"]')?.value?.trim() || "";
      const password = authEmailForm?.querySelector('[name="password"]')?.value || "";
      const confirmPassword = authEmailForm?.querySelector('[name="confirmPassword"]')?.value || "";
      if (!email || !password) {
        setAuthError("Vui lòng nhập đầy đủ email và mật khẩu.");
        return;
      }
      const emailValidation = validateRestrictedEmail(email);
      if (!emailValidation.ok) {
        setAuthError(emailValidation.message);
        return;
      }
      if (authMode === "register" && password !== confirmPassword) {
        setAuthError("Mật khẩu nhập lại chưa khớp.");
        return;
      }

      try {
        if (authSubmitBtn) {
          authSubmitBtn.disabled = true;
          authSubmitBtn.dataset.originalText = authSubmitBtn.dataset.originalText || authSubmitBtn.textContent;
          authSubmitBtn.textContent = authMode === "register" ? "Đang tạo..." : "Đang vào...";
        }
        setAuthError("");

        if (authMode === "register") {
          await createUserWithEmailAndPassword(auth, emailValidation.value, password);
        } else {
          await signInWithEmailAndPassword(auth, emailValidation.value, password);
        }
        rememberAuthEmail(emailValidation.value);
        closeAuthModal();
      } catch (err) {
        console.error(err);
        setAuthError(mapAuthError(err));
      } finally {
        if (authSubmitBtn) {
          authSubmitBtn.disabled = false;
          authSubmitBtn.textContent = authSubmitBtn.dataset.originalText || "Đăng nhập";
        }
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
        rememberAuthEmail(user.email);
        fillRolePageEmail(user);
        closeAuthModal();
        updateAvatar(user.photoURL || FALLBACK_AVATAR);
        if (menuName) {
          menuName.textContent = user.displayName || user.email || "Người dùng";
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
