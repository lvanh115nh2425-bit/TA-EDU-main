import { getProfile } from "../utils/api.js";

// js/modules/dashboard.js
// TA-Edu 2.x - B?N S?A KH?P HTML HI?N T?I (kh�ng import)
// - Di?u hu?ng tab b?ng hash
// - Fill user cho c? Sidebar (#dash*) v� Profile (#profile*)
// - T� s�ng avatar header (.is-current)
// - Kh�ng ph� hi?u ?ng cu

const DEFAULT_AVATAR = "assets/default_avatar.svg";
const DEFAULT_TRUST_SCORE = 100;
const DEFAULT_ROLE_LABEL = "Học sinh";
const ROLE_LABELS = {
  admin: "Quản trị viên",
  administrator: "Quản trị viên",
  teacher: "Giáo viên",
  mentor: "Gia sư",
  tutor: "Gia sư",
  parent: "Phụ huynh",
  guardian: "Phụ huynh",
  student: DEFAULT_ROLE_LABEL,
};

/* Helpers */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const TRUST_STATES = [
  { min: 80, label: "An toàn", note: "Điểm ổn định, bạn đang sử dụng đầy đủ tính năng." },
  { min: 50, label: "Cần chú ý", note: "Điểm đang giảm, hãy tuân thủ quy định để tránh bị trừ thêm." },
  { min: 0,  label: "Nguy hiểm", note: "Điểm quá thấp, tài khoản có thể bị hạn chế hoặc khóa tính năng." },
];
let lastAuthUser = null;
let lastProfileData = null;

/* Hash ? Tab */
function getTabFromHash() {
  const m = location.hash.match(/#tab=([a-z0-9_-]+)/i);
  return m ? m[1] : "profile";
}
function setHash(tab) {
  const h = `#tab=${tab}`;
  if (location.hash !== h) history.replaceState(null, "", h);
}

/* K�ch ho?t UI theo tab */
function activateNav(tab) {
  $$(".dash__nav .nav-item[data-tab]").forEach((a) => {
    a.classList.toggle("is-active", a.dataset.tab === tab);
    if (!a.getAttribute("href") || !a.getAttribute("href").startsWith("#tab=")) {
      a.setAttribute("href", `#tab=${a.dataset.tab}`);
    }
  });
}
function activatePanel(tab) {
  $$('.panel[id^="tab-"]').forEach((p) => {
    p.classList.toggle("is-active", p.id === `tab-${tab}`);
  });
}
function activateTab(tab, { pushHash = true } = {}) {
  activateNav(tab);
  activatePanel(tab);
  if (pushHash) setHash(tab);
}
function bindNav() {
  $$(".dash__nav .nav-item[data-tab]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const tab = a.dataset.tab;
      if (tab) activateTab(tab, { pushHash: true });
    });
  });
  window.addEventListener("hashchange", () => {
    activateTab(getTabFromHash(), { pushHash: false });
  });
}

/* Fill User */
function fillText(selectors, value) {
  selectors.forEach((sel) => $$(sel).forEach((el) => (el.textContent = value || "")));
}
function fillPhoto(selectors, src, alt) {
  selectors.forEach((sel) =>
    $$(sel).forEach((img) => {
      if (!(img instanceof HTMLImageElement)) return;
      img.src = src || DEFAULT_AVATAR;
      img.alt = alt || "User";
      img.addEventListener("error", () => (img.src = DEFAULT_AVATAR), { once: true });
    })
  );
}

function formatPoints(n) {
  const v = Number.isFinite(+n) ? Math.max(0, Math.round(+n)) : 0;
  return v.toLocaleString("vi-VN");
}

function normalizeRoleString(value) {
  if (!value) return "";
  return value
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function mapRoleLabel(raw) {
  const key = normalizeRoleString(raw);
  if (!key) return null;
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  if (key.includes("admin")) return ROLE_LABELS.admin;
  if (key.includes("giao") && key.includes("vien")) return ROLE_LABELS.teacher;
  if (key.includes("mentor") || key.includes("tutor") || key.includes("gia su")) return ROLE_LABELS.mentor;
  if (key.includes("phu huynh") || key.includes("parent") || key.includes("guardian")) return ROLE_LABELS.parent;
  return null;
}

function resolveRoleLabel(authUser, profileData) {
  const sources = [];
  if (profileData) {
    if (profileData.roleLabel) sources.push(profileData.roleLabel);
    if (Array.isArray(profileData.roles)) sources.push(...profileData.roles);
    if (profileData.role) sources.push(profileData.role);
    if (profileData.position) sources.push(profileData.position);
    if (profileData.type) sources.push(profileData.type);
    if (profileData.verify?.role) sources.push(profileData.verify.role);
  }
  if (authUser) {
    if (authUser.role) sources.push(authUser.role);
    const claims = authUser.customClaims || authUser.stsTokenManager?.claims;
    if (claims?.role) sources.push(claims.role);
  }

  const adminFlag =
    profileData?.isAdmin ||
    sources.some((value) => normalizeRoleString(value) === "admin");
  if (adminFlag) return ROLE_LABELS.admin;

  for (const value of sources) {
    const label = mapRoleLabel(value);
    if (label) return label;
  }
  return DEFAULT_ROLE_LABEL;
}

function applyRoleLabel(authUser, profileData) {
  if (authUser !== undefined) {
    lastAuthUser = authUser;
  }
  if (profileData) {
    lastProfileData = profileData;
  } else if (profileData === null) {
    lastProfileData = null;
  }
  const label = resolveRoleLabel(lastAuthUser, lastProfileData);
  fillText(["#dashRole", "#profileRole"], label || DEFAULT_ROLE_LABEL);
}

function getTrustData(user = {}) {
  const raw = Math.round(
    [
      user.trustScore,
      user.trust_points,
      user.trust_score,
      user.trust,
      user.reputation,
      user.wallet,
    ].find((v) => Number.isFinite(+v)) ?? DEFAULT_TRUST_SCORE
  );
  const score = Math.max(0, Math.min(100, raw));

  const history =
    (Array.isArray(user.trustHistory) && user.trustHistory) ||
    (Array.isArray(user.trust_history) && user.trust_history) ||
    (Array.isArray(user.reputationHistory) && user.reputationHistory) ||
    (Array.isArray(user.walletHistory) && user.walletHistory) ||
    [];

  return { score, history };
}

function getTrustState(score) {
  for (const state of TRUST_STATES) {
    if (score >= state.min) return state;
  }
  return TRUST_STATES[TRUST_STATES.length - 1];
}

function renderTrustSummary(score) {
  const bounded = Math.max(0, Math.min(100, score));
  const scoreEl = $("#trustScore");
  if (scoreEl) scoreEl.textContent = formatPoints(bounded);

  const state = getTrustState(bounded);
  const stateEl = $("#trustState");
  if (stateEl) stateEl.textContent = state.label;
  const warnEl = $("#trustWarning");
  if (warnEl) warnEl.textContent = state.note;

  const progressEl = $("#trustProgress");
  if (progressEl) progressEl.style.width = bounded + "%";
  const progressText = $("#trustProgressText");
  if (progressText) progressText.textContent = `${bounded}% di?m c�n l?i`;
}


function normalizeTrustHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const delta = Number(entry.delta ?? entry.amount ?? entry.value ?? 0);
  const ts = entry.ts ?? entry.timestamp ?? entry.date ?? Date.now();
  const reason = entry.reason || entry.note || entry.message || entry.description || "";
  const source = entry.source || entry.type || "Ho?t d?ng";
  const status = entry.status || entry.state || "";
  return { delta, ts, reason, source, status };
}

function renderTrustHistory(historyList) {
  const wrap = $("#trustHistory");
  if (!wrap) return;

  const normalized = (historyList || [])
    .map(normalizeTrustHistoryEntry)
    .filter(Boolean)
    .slice(0, 5);

  if (!normalized.length) {
    wrap.innerHTML = '<p class="history-empty">Chua c� ghi nh?n m?i.</p>';
    return;
  }

  wrap.innerHTML = normalized
    .map((item) => {
      const isPositive = item.delta >= 0;
      const sign = isPositive ? "+" : "-";
      const amount = formatPoints(Math.abs(item.delta));
      const dateText = new Date(item.ts).toLocaleString("vi-VN");
      const status = item.status
        ? '<span class="trust__history-status">' + item.status + '</span>'
        : '<span></span>';
      const note = item.reason ? '<div class="trust__history-note">' + item.reason + '</div>' : '';
      return (
        '<article class="trust__history-item">' +
        '<div class="trust__history-row">' +
        '<span class="trust__history-type">' + item.source + '</span>' +
        '<span class="trust__history-amount ' + (isPositive ? "is-plus" : "is-minus") + '">' +
        sign + amount +
        '</span></div>' +
        '<div class="trust__history-row trust__history-row--sub">' +
        '<span>' + dateText + '</span>' +
        status +
        '</div>' +
        note +
        '</article>'
      );
    })
    .join("");
}

function updateTrustUI(profile) {
  const { score, history } = getTrustData(profile || {});
  renderTrustSummary(score);
  renderTrustHistory(history);
}

function resetTrustUI() {
  renderTrustSummary(DEFAULT_TRUST_SCORE);
  renderTrustHistory([]);
}

function fillUser(user, profile) {
  const name =
    profile?.display_name ||
    user?.displayName ||
    (user?.email ? user.email.split("@")[0] : "") ||
    "Người dùng";
  const email = profile?.email || user?.email || "";
  const photo = profile?.photo_url || user?.photoURL || DEFAULT_AVATAR;

  fillText(["#dashName", "[data-user-name]", ".dash__user-name"], name);
  fillText(["#dashEmail", "[data-user-email]", ".dash__user-email"], email);
  fillPhoto(["#dashAvatar", "img#dashAvatar", "[data-user-photo]"], photo, name);

  fillText(["#profileName", "[data-user-name]"], name);
  fillText(["#profileEmail", "[data-user-email]"], email);
  fillPhoto(["#profileAvatar", "#profilePhoto", "img[data-user-photo]"], photo, name);
}

async function handleDashboardUser(user) {
  if (!user) {
    resetTrustUI();
    applyRoleLabel(null, null);
    fillUser(null, null);
    return;
  }
  lastAuthUser = user;
  fillUser(user, null);
  applyRoleLabel(user, null);
  try {
    const token = await user.getIdToken();
    const res = await getProfile(token);
    const profile = res?.profile || null;
    lastProfileData = profile;
    fillUser(user, profile);
    updateTrustUI(profile);
    applyRoleLabel(user, profile);
  } catch (err) {
    console.warn("Dashboard profile fetch failed:", err);
    updateTrustUI({});
    applyRoleLabel(user, null);
  }
}



/* Watch user (tuong th�ch nhi?u c�ch) */
function watchUser(callback) {
  // Fill ngay n?u header d� c� user
  if (window.__TAEDU_LAST_USER) {
    try { callback(window.__TAEDU_LAST_USER); } catch (_) {}
  }
  // Nghe s? ki?n do header ph�t
  window.addEventListener("taedu:user-ready", (e) => callback(e.detail?.user));

  // Fallback: n?u c� Firebase global
  try {
    if (window.auth && typeof window.auth.onAuthStateChanged === "function") {
      return window.auth.onAuthStateChanged(callback);
    }
    if (window.firebase?.auth) {
      return window.firebase.auth().onAuthStateChanged(callback);
    }
  } catch (err) {
    console.warn("watchUser fallback error:", err);
  }
}

/* Header highlight */
function highlightHeaderForDashboard() {
  const avatar = $("img#userPhoto.header-avatar") || $("#userPhoto");
  if (avatar) avatar.classList.add("is-current");
  const homeCandidates = [
    'a[href$=\"index.html\"].active',
    'a[href=\"/\"].active',
    '#navHome.active',
    '.nav-home.active',
  ];
  for (const sel of homeCandidates) {
    const el = document.querySelector(sel);
    if (el) { el.classList.remove("active"); break; }
  }
}

/* Logout trong Dashboard (n?u c� n�t) */
function bindLogout() {
  const btn = $("#dashLogout");
  if (!btn) return;
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      if (window.doLogoutAndRedirect) {
        await window.doLogoutAndRedirect("index.html");
        return;
      }
      if (window.auth?.signOut) {
        await window.auth.signOut();
      } else if (window.firebase?.auth) {
        await window.firebase.auth().signOut();
      }
    } catch (err) {
      console.error(err);
      alert("Dang xu?t th?t b?i, vui l�ng th? l?i.");
    } finally {
      location.href = "index.html";
    }
  });
}

/* Init */
document.addEventListener("DOMContentLoaded", () => {
  bindNav();
  bindLogout();
  activateTab(getTabFromHash(), { pushHash: false });
  highlightHeaderForDashboard();

  watchUser(handleDashboardUser);
});










