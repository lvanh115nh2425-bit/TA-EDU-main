import { auth, signOut } from "../core/firebase.js";
import { getProfile, updateProfile } from "../utils/api.js?v=20260326b";

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

const PROFILE_CACHE_KEY = (uid) => `taedu:profile:${uid}`;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const TRUST_STATES = [
  { min: 80, label: "An toàn", note: "Điểm ổn định, bạn đang sử dụng đầy đủ tính năng." },
  { min: 50, label: "Cần chú ý", note: "Điểm đang giảm, hãy tuân thủ quy định để tránh bị trừ thêm." },
  { min: 0, label: "Nguy hiểm", note: "Điểm quá thấp, tài khoản có thể bị hạn chế hoặc khóa tính năng." },
];

let lastAuthUser = null;
let lastProfileData = null;
const avatarCropState = {
  file: null,
  naturalWidth: 1,
  naturalHeight: 1,
  baseScale: 1,
  zoom: 1,
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
  x: 0,
  y: 0,
  dragging: false,
  pointerId: null,
  dragStartX: 0,
  dragStartY: 0,
  startX: 0,
  startY: 0,
};

function getCachedProfile(uid) {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY(uid));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function setCachedProfile(uid, profile) {
  if (!uid || !profile) return;
  try {
    localStorage.setItem(PROFILE_CACHE_KEY(uid), JSON.stringify(profile));
  } catch (_) {}
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

function getTabFromHash() {
  const m = location.hash.match(/#tab=([a-z0-9_-]+)/i);
  const tab = m ? m[1] : "profile";
  return tab === "trust" || tab === "profile" ? tab : "profile";
}

function setHash(tab) {
  const h = `#tab=${tab}`;
  if (location.hash !== h) history.replaceState(null, "", h);
}

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

  const adminFlag = profileData?.isAdmin || sources.some((value) => normalizeRoleString(value) === "admin");
  if (adminFlag) return ROLE_LABELS.admin;

  for (const value of sources) {
    const label = mapRoleLabel(value);
    if (label) return label;
  }
  return DEFAULT_ROLE_LABEL;
}

function applyRoleLabel(authUser, profileData) {
  if (authUser !== undefined) lastAuthUser = authUser;
  if (profileData) lastProfileData = profileData;
  else if (profileData === null) lastProfileData = null;

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
  if (progressEl) progressEl.style.width = `${bounded}%`;
  const progressText = $("#trustProgressText");
  if (progressText) progressText.textContent = `${bounded}% điểm còn lại`;
}

function normalizeTrustHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const delta = Number(entry.delta ?? entry.amount ?? entry.value ?? 0);
  const ts = entry.ts ?? entry.timestamp ?? entry.date ?? Date.now();
  const reason = entry.reason || entry.note || entry.message || entry.description || "";
  const source = entry.source || entry.type || "Hoạt động";
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
    wrap.innerHTML = '<p class="history-empty">Chưa có ghi nhận mới.</p>';
    return;
  }

  wrap.innerHTML = normalized
    .map((item) => {
      const isPositive = item.delta >= 0;
      const sign = isPositive ? "+" : "-";
      const amount = formatPoints(Math.abs(item.delta));
      const dateText = new Date(item.ts).toLocaleString("vi-VN");
      const status = item.status
        ? `<span class="trust__history-status">${item.status}</span>`
        : "<span></span>";
      const note = item.reason ? `<div class="trust__history-note">${item.reason}</div>` : "";
      return (
        '<article class="trust__history-item">' +
        '<div class="trust__history-row">' +
        `<span class="trust__history-type">${item.source}</span>` +
        `<span class="trust__history-amount ${isPositive ? "is-plus" : "is-minus"}">${sign}${amount}</span>` +
        "</div>" +
        '<div class="trust__history-row trust__history-row--sub">' +
        `<span>${dateText}</span>` +
        status +
        "</div>" +
        note +
        "</article>"
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
  const nickname =
    profile?.display_name ||
    profile?.full_name ||
    user?.displayName ||
    (user?.email ? user.email.split("@")[0] : "") ||
    "Người dùng";
  const fullName = profile?.full_name || "Chưa cập nhật";
  const email = profile?.email || user?.email || "Chưa cập nhật";
  const phone = profile?.student_phone || "Chưa cập nhật";
  const grade = profile?.student_grade ? `Lớp ${profile.student_grade}` : "Chưa cập nhật";
  const photo = profile?.photo_url || user?.photoURL || DEFAULT_AVATAR;

  fillText(["#dashName", "[data-user-name]", ".dash__user-name"], nickname);
  fillText(["#dashEmail", "[data-user-email]", ".dash__user-email"], email);
  fillPhoto(["#dashAvatar", "img#dashAvatar", "[data-user-photo]"], photo, nickname);

  fillText(["#profileNickname"], nickname);
  fillText(["#profileFullName"], fullName);
  fillText(["#profileEmail", "[data-user-email]"], email);
  fillText(["#profilePhone"], phone);
  fillText(["#profileGrade"], grade);
  fillPhoto(["#profileAvatar", "#profilePhoto", "img[data-user-photo]"], photo, nickname);
}

function getCropperRefs() {
  return {
    modal: $("#avatarCropper"),
    viewport: $("#avatarCropStage .avatar-cropper__viewport"),
    image: $("#avatarCropImage"),
    zoom: $("#avatarCropZoom"),
    apply: $("#avatarCropApply"),
  };
}

function getCropFrameRect(viewport) {
  const viewportRect = viewport.getBoundingClientRect();
  const insetRatio = 0.16;
  const insetX = viewportRect.width * insetRatio;
  const insetY = viewportRect.height * insetRatio;
  return {
    left: viewportRect.left + insetX,
    top: viewportRect.top + insetY,
    right: viewportRect.right - insetX,
    bottom: viewportRect.bottom - insetY,
    width: viewportRect.width - insetX * 2,
    height: viewportRect.height - insetY * 2,
  };
}

function clampCropPosition() {
  avatarCropState.x = Math.min(avatarCropState.maxX, Math.max(avatarCropState.minX, avatarCropState.x));
  avatarCropState.y = Math.min(avatarCropState.maxY, Math.max(avatarCropState.minY, avatarCropState.y));
}

function renderCropper() {
  const { viewport, image } = getCropperRefs();
  if (!viewport || !image) return;
  const viewportSize = viewport.clientWidth || 320;
  const scale = avatarCropState.baseScale * avatarCropState.zoom;
  const scaledWidth = avatarCropState.naturalWidth * scale;
  const scaledHeight = avatarCropState.naturalHeight * scale;
  const extraSlack = viewportSize * 0.32;
  if (scaledWidth <= viewportSize) {
    const slackX = (viewportSize - scaledWidth) / 2 + extraSlack;
    avatarCropState.minX = -slackX;
    avatarCropState.maxX = slackX;
  } else {
    avatarCropState.minX = viewportSize - scaledWidth - extraSlack;
    avatarCropState.maxX = extraSlack;
  }
  if (scaledHeight <= viewportSize) {
    const slackY = (viewportSize - scaledHeight) / 2 + extraSlack;
    avatarCropState.minY = -slackY;
    avatarCropState.maxY = slackY;
  } else {
    avatarCropState.minY = viewportSize - scaledHeight - extraSlack;
    avatarCropState.maxY = extraSlack;
  }
  clampCropPosition();
  image.style.width = `${scaledWidth}px`;
  image.style.height = `${scaledHeight}px`;
  image.style.transform = `translate(calc(-50% + ${avatarCropState.x}px), calc(-50% + ${avatarCropState.y}px))`;
}

async function openAvatarCropper(file) {
  const { modal, image, zoom } = getCropperRefs();
  if (!modal || !image || !zoom) return false;

  const dataUrl = await readFileAsDataUrl(file);
  const loadedImage = await loadImageFromDataUrl(dataUrl);

  avatarCropState.file = file;
  avatarCropState.naturalWidth = loadedImage.width || 1;
  avatarCropState.naturalHeight = loadedImage.height || 1;
  avatarCropState.zoom = 1;
  avatarCropState.x = 0;
  avatarCropState.y = 0;
  avatarCropState.dragging = false;

  image.src = dataUrl;
  modal.hidden = false;
  document.body.style.overflow = "hidden";

  requestAnimationFrame(() => {
    const { viewport } = getCropperRefs();
    const viewportSize = viewport?.clientWidth || 320;
    avatarCropState.baseScale = viewportSize / Math.min(avatarCropState.naturalWidth, avatarCropState.naturalHeight);
    zoom.value = "1";
    renderCropper();
  });

  return true;
}

function closeAvatarCropper() {
  const { modal, image, viewport, zoom } = getCropperRefs();
  const input = $("#profileAvatarInput");
  if (modal) modal.hidden = true;
  if (image) image.src = "";
  if (viewport) viewport.classList.remove("is-dragging");
  if (zoom) zoom.value = "1";
  if (input) input.value = "";
  document.body.style.overflow = "";
  avatarCropState.file = null;
  avatarCropState.dragging = false;
  avatarCropState.pointerId = null;
}

async function buildCroppedAvatarDataUrl() {
  const { viewport, image } = getCropperRefs();
  if (!viewport || !image || !image.src) {
    throw new Error("crop_image_missing");
  }

  const outputSize = 512;
  const viewportRect = getCropFrameRect(viewport);
  const imageRect = image.getBoundingClientRect();
  const intersectionLeft = Math.max(viewportRect.left, imageRect.left);
  const intersectionTop = Math.max(viewportRect.top, imageRect.top);
  const intersectionRight = Math.min(viewportRect.right, imageRect.right);
  const intersectionBottom = Math.min(viewportRect.bottom, imageRect.bottom);
  const intersectionWidth = Math.max(0, intersectionRight - intersectionLeft);
  const intersectionHeight = Math.max(0, intersectionBottom - intersectionTop);

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("crop_canvas_unavailable");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, outputSize, outputSize);

  if (intersectionWidth > 0 && intersectionHeight > 0) {
    const scaleX = avatarCropState.naturalWidth / imageRect.width;
    const scaleY = avatarCropState.naturalHeight / imageRect.height;
    const sourceX = Math.max(0, (intersectionLeft - imageRect.left) * scaleX);
    const sourceY = Math.max(0, (intersectionTop - imageRect.top) * scaleY);
    const sourceWidth = Math.min(avatarCropState.naturalWidth - sourceX, intersectionWidth * scaleX);
    const sourceHeight = Math.min(avatarCropState.naturalHeight - sourceY, intersectionHeight * scaleY);
    const destX = ((intersectionLeft - viewportRect.left) / viewportRect.width) * outputSize;
    const destY = ((intersectionTop - viewportRect.top) / viewportRect.height) * outputSize;
    const destWidth = (intersectionWidth / viewportRect.width) * outputSize;
    const destHeight = (intersectionHeight / viewportRect.height) * outputSize;

    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight);
  }

  return canvas.toDataURL("image/png");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_decode_failed"));
    img.src = dataUrl;
  });
}

async function compressAvatar(file) {
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(originalDataUrl);
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(image.width || 1, image.height || 1));
  const width = Math.max(1, Math.round((image.width || 1) * scale));
  const height = Math.max(1, Math.round((image.height || 1) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return originalDataUrl;

  ctx.drawImage(image, 0, 0, width, height);

  const attempts = [
    ["image/webp", 0.82],
    ["image/jpeg", 0.82],
    ["image/jpeg", 0.72],
    ["image/jpeg", 0.6],
  ];

  for (const [type, quality] of attempts) {
    const compressed = canvas.toDataURL(type, quality);
    if (compressed.length <= 1_400_000) {
      return compressed;
    }
  }

  return canvas.toDataURL("image/jpeg", 0.52);
}

async function compressAvatarDataUrl(dataUrl) {
  const image = await loadImageFromDataUrl(dataUrl);
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(image.width || 1, image.height || 1));
  const width = Math.max(1, Math.round((image.width || 1) * scale));
  const height = Math.max(1, Math.round((image.height || 1) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  ctx.drawImage(image, 0, 0, width, height);
  const attempts = [
    ["image/webp", 0.82],
    ["image/jpeg", 0.82],
    ["image/jpeg", 0.72],
    ["image/jpeg", 0.6],
  ];

  for (const [type, quality] of attempts) {
    const compressed = canvas.toDataURL(type, quality);
    if (compressed.length <= 1_400_000) {
      return compressed;
    }
  }

  return canvas.toDataURL("image/jpeg", 0.52);
}

async function uploadAvatarDataUrl(user, profile, photoUrl) {
  const token = await user.getIdToken();
  const res = await updateProfile(token, { photo_url: photoUrl });
  const merged = mergeProfile(res?.profile || { photo_url: photoUrl }, profile);
  setCachedProfile(user.uid, merged);
  lastProfileData = merged;
  fillUser(user, merged);
  return merged;
}

function bindAvatarUploader(user, profile) {
  const trigger = $("#profileAvatarButton");
  const input = $("#profileAvatarInput");
  if (!trigger || !input || !user) return;

  trigger.onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      alert("Vui lòng chọn file ảnh.");
      input.value = "";
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      alert("Ảnh quá lớn. Vui lòng chọn ảnh dưới 8MB.");
      input.value = "";
      return;
    }

    try {
      await openAvatarCropper(file);
    } catch (err) {
      console.error("Avatar update failed:", err);
      input.value = "";
    }
  };
}

function bindAvatarCropper() {
  const { modal, viewport, zoom, apply } = getCropperRefs();
  if (!modal || !viewport || !zoom || !apply) return;

  document.querySelectorAll("[data-avatar-crop='close']").forEach((button) => {
    button.addEventListener("click", closeAvatarCropper);
  });

  zoom.addEventListener("input", () => {
    avatarCropState.zoom = Number(zoom.value || 1);
    renderCropper();
  });

  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const current = Number(zoom.value || 1);
      const next = Math.min(
        Number(zoom.max || 3.4),
        Math.max(Number(zoom.min || 0.55), current + (event.deltaY < 0 ? 0.08 : -0.08))
      );
      zoom.value = String(next);
      avatarCropState.zoom = next;
      renderCropper();
    },
    { passive: false }
  );

  viewport.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    avatarCropState.dragging = true;
    avatarCropState.pointerId = event.pointerId;
    avatarCropState.dragStartX = event.clientX;
    avatarCropState.dragStartY = event.clientY;
    avatarCropState.startX = avatarCropState.x;
    avatarCropState.startY = avatarCropState.y;
    viewport.classList.add("is-dragging");
    viewport.setPointerCapture?.(event.pointerId);
  });

  viewport.addEventListener("pointermove", (event) => {
    if (!avatarCropState.dragging) return;
    avatarCropState.x = avatarCropState.startX + (event.clientX - avatarCropState.dragStartX);
    avatarCropState.y = avatarCropState.startY + (event.clientY - avatarCropState.dragStartY);
    renderCropper();
  });

  const endDrag = (event) => {
    if (avatarCropState.pointerId !== null && event?.pointerId !== undefined && avatarCropState.pointerId !== event.pointerId) {
      return;
    }
    avatarCropState.dragging = false;
    avatarCropState.pointerId = null;
    viewport.classList.remove("is-dragging");
  };

  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);
  viewport.addEventListener("pointerleave", endDrag);

  window.addEventListener("resize", () => {
    if (!modal.hidden) renderCropper();
  });

  apply.addEventListener("click", async () => {
    if (!lastAuthUser) return;
    try {
      apply.disabled = true;
      const croppedDataUrl = await buildCroppedAvatarDataUrl();
      const compressed = await compressAvatarDataUrl(croppedDataUrl);
      await uploadAvatarDataUrl(lastAuthUser, lastProfileData, compressed);
      closeAvatarCropper();
    } catch (err) {
      console.error("Avatar crop apply failed:", err);
      const message = String(err?.message || "");
      if (message.includes("413") || message.includes("payload")) {
        alert("Ảnh đại diện vẫn còn quá lớn sau khi nén. Hãy chọn ảnh nhỏ hơn.");
      } else {
        alert("Không cập nhật được ảnh đại diện. Vui lòng thử lại.");
      }
    } finally {
      apply.disabled = false;
    }
  });
}

async function handleDashboardUser(user) {
  if (!user) {
    resetTrustUI();
    applyRoleLabel(null, null);
    fillUser(null, null);
    return;
  }

  lastAuthUser = user;
  const cachedProfile = getCachedProfile(user.uid);
  fillUser(user, cachedProfile);
  applyRoleLabel(user, cachedProfile);
  bindAvatarUploader(user, cachedProfile);

  try {
    const token = await user.getIdToken();
    const res = await getProfile(token);
    const profile = mergeProfile(res?.profile || null, cachedProfile);
    lastProfileData = profile;
    if (profile) setCachedProfile(user.uid, profile);
    fillUser(user, profile);
    updateTrustUI(profile);
    applyRoleLabel(user, profile);
    bindAvatarUploader(user, profile);
  } catch (err) {
    console.warn("Dashboard profile fetch failed:", err);
    updateTrustUI(cachedProfile || {});
    applyRoleLabel(user, cachedProfile);
    fillUser(user, cachedProfile);
    bindAvatarUploader(user, cachedProfile);
  }
}

function watchUser(callback) {
  if (window.__TAEDU_LAST_USER) {
    try {
      callback(window.__TAEDU_LAST_USER);
    } catch (_) {}
  }

  window.addEventListener("taedu:user-ready", (e) => callback(e.detail?.user));

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

function highlightHeaderForDashboard() {
  const avatar = $("img#userPhoto.header-avatar") || $("#userPhoto");
  if (avatar) avatar.classList.add("is-current");

  const homeCandidates = [
    'a[href$="index.html"].active',
    'a[href="/"].active',
    "#navHome.active",
    ".nav-home.active",
  ];

  for (const sel of homeCandidates) {
    const el = document.querySelector(sel);
    if (el) {
      el.classList.remove("active");
      break;
    }
  }
}

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
      await signOut(auth);
    } catch (err) {
      console.error(err);
      alert("Đăng xuất thất bại, vui lòng thử lại.");
    } finally {
      location.href = "index.html";
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindNav();
  bindLogout();
  bindAvatarCropper();
  activateTab(getTabFromHash(), { pushHash: false });
  highlightHeaderForDashboard();
  watchUser(handleDashboardUser);
});
