import { auth } from "../core/firebase.js";
import { getProfile } from "../utils/api.js";

const $ = (selector, root = document) => root.querySelector(selector);
const PROFILE_CACHE_KEY = (uid) => `taedu:profile:${uid}`;
const PROFILE_COMPLETE_KEY = (uid) => `taedu:profile-complete:${uid}`;

function showBanner({ level, text, primaryHref, primaryLabel, canDismiss }) {
  const box = $("#verifyBanner");
  if (!box) return;

  box.hidden = false;
  box.classList.remove("notice--warn", "notice--err", "notice--ok");
  if (level === "ok") box.classList.add("notice--ok");
  else if (level === "error") box.classList.add("notice--err");
  else box.classList.add("notice--warn");

  const textEl = $("#verifyText");
  if (textEl) textEl.textContent = text;

  const primary = $("#verifyPrimary");
  if (primaryHref) {
    primary.href = primaryHref;
    primary.textContent = primaryLabel || "Cap nhat";
    primary.hidden = false;
  } else if (primary) {
    primary.hidden = true;
  }

  const dismiss = $("#verifyDismiss");
  if (dismiss) {
    dismiss.hidden = !canDismiss;
    dismiss.onclick = canDismiss ? () => { box.hidden = true; } : null;
  }
}

function hideBanner() {
  const box = $("#verifyBanner");
  if (box) box.hidden = true;
}

function dispatchStatus(payload) {
  window.dispatchEvent(new CustomEvent("taedu:verify-status", { detail: payload }));
}

function getCachedProfile(uid) {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY(uid));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function getCachedProfileComplete(uid) {
  if (!uid) return false;
  try {
    return localStorage.getItem(PROFILE_COMPLETE_KEY(uid)) === "1";
  } catch (_) {
    return false;
  }
}

function mergeProfile(profile, cachedProfile) {
  if (!profile && !cachedProfile) return null;
  const merged = { ...(cachedProfile || {}) };
  for (const [key, value] of Object.entries(profile || {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    merged[key] = value;
  }
  return merged;
}

function isProfileComplete(profile = {}, user = null) {
  profile = profile || {};
  const email = (profile.email || user?.email || "").trim();
  return Boolean(
    (profile.role || "").trim() &&
    (profile.display_name || "").trim() &&
    (profile.full_name || "").trim() &&
    (profile.gender || "").trim() &&
    (profile.student_grade || "").trim() &&
    (profile.student_phone || "").trim() &&
    email
  );
}

async function fetchProfile(user) {
  const cachedProfile = getCachedProfile(user?.uid);
  try {
    const token = await user.getIdToken();
    const result = await getProfile(token);
    return mergeProfile(result?.profile || null, cachedProfile);
  } catch (error) {
    console.warn("getProfile failed", error);
    return cachedProfile;
  }
}

async function getStatus(user) {
  const profile = await fetchProfile(user);
  const completed = isProfileComplete(profile, user) || getCachedProfileComplete(user?.uid);

  if (!completed) {
    return {
      level: "warn",
      text: "Ban chua hoan tat thong tin tai khoan. Hay chon vai tro va bo sung Biet danh, Ho ten, Gioi tinh, Lop, Email, So dien thoai de dung day du he thong.",
      primaryHref: "/role.html",
      primaryLabel: "Cap nhat thong tin",
      canDismiss: false,
      profileComplete: false,
      profile,
    };
  }

  return {
    level: "ok",
    text: "Thong tin tai khoan da day du.",
    primaryHref: null,
    primaryLabel: null,
    canDismiss: true,
    profileComplete: true,
    profile,
  };
}

document.addEventListener("DOMContentLoaded", () => {
  if (!auth) {
    hideBanner();
    return;
  }

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      hideBanner();
      return;
    }

    const status = await getStatus(user);
    dispatchStatus(status);

    if (status.level === "ok") hideBanner();
    else showBanner(status);
  });
});
