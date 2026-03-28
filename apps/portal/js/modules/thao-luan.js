import {
  auth,
  onAuthStateChanged,
  signOut,
  loginWithGoogle,
  readRedirectLoginResult,
  mapFirebaseAuthError,
} from "/js/core/firebase.js";
import { submitUserReport } from "/js/utils/api.js";

const API_BASE =
  window.__TAEDU_API__ ||
  window.__TAEDU_ADMIN_API__ ||
  ((location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:4001/api"
    : "/api");
const QA_ENDPOINT = `${API_BASE.replace(/\/$/, "")}/qa`;
const DEFAULT_AVATAR = "/assets/default_avatar.svg";
const ADMIN_EMAIL_FALLBACK = ["khkt.anhtu@gmail.com", "lvanh.115nh2425@gmail.com"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGES_PER_PICK = 10;
const PROFILE_CACHE_KEY = (uid) => `taedu:profile:${uid}`;

const feedEl = document.getElementById("discussionFeed");
const formEl = document.getElementById("postForm");
const titleInput = document.getElementById("postTitle");
const subjectInput = document.getElementById("postSubject");
const gradeInput = document.getElementById("postGrade");
const bodyInput = document.getElementById("postBody");
const tagsInput = document.getElementById("postTags");
const imageInput = document.getElementById("postImage");
const fileNameEl = document.getElementById("fileName");
const authGuard = document.getElementById("postAuthGuard");
const authSlot = document.getElementById("discussionAuthSlot");
const toastEl = document.getElementById("discussionToast");
const suggestionsEl = document.getElementById("discussionSuggestions");
const composerButtons = document.querySelectorAll("[data-post-action='open']");
const postModal = document.getElementById("postModal");
const postModalBackdrop = document.getElementById("postModalBackdrop");
const composerAvatar = document.getElementById("composerAvatar");
const imagePreviewContainer = document.getElementById("imagePreviewContainer");
const imagePreview = document.getElementById("imagePreview");
const removeImageBtn = document.getElementById("removeImageBtn");
const confirmModal = document.getElementById("confirmModal");
const confirmModalBackdrop = document.getElementById("confirmModalBackdrop");
const confirmModalMessage = document.getElementById("confirmModalMessage");
const confirmModalAccept = document.getElementById("confirmModalAccept");
const reportFields = document.getElementById("reportFields");
const reportReasonInput = document.getElementById("reportReasonInput");
const reportDetailInput = document.getElementById("reportDetailInput");
const imageLightbox = document.getElementById("imageLightbox");
const imageLightboxBackdrop = document.getElementById("imageLightboxBackdrop");
const imageLightboxViewport = document.getElementById("imageLightboxViewport");
const imageLightboxImg = document.getElementById("imageLightboxImg");
const imageLightboxDownload = document.getElementById("imageLightboxDownload");
const imageLightboxZoomOut = document.getElementById("imageLightboxZoomOut");
const imageLightboxZoomIn = document.getElementById("imageLightboxZoomIn");

const state = {
  user: null,
  posts: [],
  loading: true,
  imageItems: [],
  commentImages: new Map(),
  confirmResolver: null,
  imageLightboxZoom: 1,
  imageLightboxPanX: 0,
  imageLightboxPanY: 0,
  imageLightboxDragging: false,
  imageLightboxPointerId: null,
  imageLightboxDragStartX: 0,
  imageLightboxDragStartY: 0,
  confirmMode: "confirm",
  reportResolver: null,
};

function getEffectiveUser() {
  return state.user || auth?.currentUser || window.__TAEDU_LAST_USER || null;
}

const fallbackSuggestions = [
  { title: "Hỏi bài khó đang vướng", snippet: "Mô tả rõ phần đã làm để mọi người hỗ trợ nhanh hơn." },
  { title: "Chia sẻ mẹo học hiệu quả", snippet: "Một mẹo hay của bạn có thể giúp nhiều người tiến bộ hơn." },
  { title: "Trao đổi tài liệu và đề thi", snippet: "Cùng trao đổi nguồn học tốt, kinh nghiệm ôn tập, cách tránh sai." },
];

init();

function init() {
  readRedirectLoginResult().catch((error) => {
    console.error("redirect login failed", error);
    showToast(mapFirebaseAuthError(error), "error");
  });

  wireAuthTriggers();
  imageInput?.addEventListener("change", handleImageSelect);
  removeImageBtn?.addEventListener("click", clearImagePreview);
  formEl?.addEventListener("submit", handleSubmit);
  postModalBackdrop?.addEventListener("click", closePostModal);
  confirmModalBackdrop?.addEventListener("click", () => closeConfirmModal(false));
  imageLightboxBackdrop?.addEventListener("click", closeImageLightbox);
  imageLightboxViewport?.addEventListener("pointerdown", handleLightboxPointerDown);
  imageLightboxViewport?.addEventListener("pointermove", handleLightboxPointerMove);
  imageLightboxViewport?.addEventListener("pointerup", handleLightboxPointerUp);
  imageLightboxViewport?.addEventListener("pointercancel", handleLightboxPointerUp);
  imageLightboxViewport?.addEventListener("wheel", handleLightboxWheel, { passive: false });
  document.querySelectorAll("[data-post-modal='close']").forEach((btn) => {
    btn.addEventListener("click", closePostModal);
  });
  document.querySelectorAll("[data-confirm-close], [data-confirm-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => closeConfirmModal(false));
  });
  document.querySelectorAll("[data-lightbox-close]").forEach((btn) => {
    btn.addEventListener("click", closeImageLightbox);
  });
  imageLightboxZoomOut?.addEventListener("click", () => adjustImageLightboxZoom(-0.2));
  imageLightboxZoomIn?.addEventListener("click", () => adjustImageLightboxZoom(0.2));
  document.addEventListener("keydown", handleGlobalKeydown);
  confirmModalAccept?.addEventListener("click", () => closeConfirmModal(true));
  composerButtons.forEach((btn) => {
    btn.addEventListener("click", openPostModal);
  });

  if (window.__TAEDU_LAST_USER) {
    state.user = window.__TAEDU_LAST_USER;
    updateAuthUI();
  }

  exposeCommunityAuthDebug();
  logCommunityAuthDebug("init");

  window.addEventListener("taedu:user-ready", (event) => {
    state.user = event.detail?.user || null;
    updateAuthUI();
    logCommunityAuthDebug("taedu:user-ready");
    loadPosts();
  });

  onAuthStateChanged(auth, (user) => {
    state.user = user || null;
    updateAuthUI();
    logCommunityAuthDebug("onAuthStateChanged");
    loadPosts();
  });

  loadPosts();
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

function exposeCommunityAuthDebug() {
  window.__TAEDU_DEBUG_COMMUNITY_AUTH__ = async () => {
    const authUser = auth?.currentUser || null;
    let tokenPreview = "";
    try {
      const token = await authUser?.getIdToken?.();
      tokenPreview = token ? `${token.slice(0, 16)}...` : "";
    } catch (_) {}

    const payload = {
      headerCachedUser: window.__TAEDU_LAST_USER
        ? {
            uid: window.__TAEDU_LAST_USER.uid || "",
            email: window.__TAEDU_LAST_USER.email || "",
          }
        : null,
      stateUser: state.user
        ? {
            uid: state.user.uid || "",
            email: state.user.email || "",
          }
        : null,
      authCurrentUser: authUser
        ? {
            uid: authUser.uid || "",
            email: authUser.email || "",
          }
        : null,
      tokenPreview,
      hostname: location.hostname,
      href: location.href,
    };

    console.log("[TA-Edu][community auth debug]", payload);
    return payload;
  };
}

function logCommunityAuthDebug(source) {
  const cached = window.__TAEDU_LAST_USER || null;
  const authUser = auth?.currentUser || null;
  console.log("[TA-Edu][community auth]", {
    source,
    cachedUser: cached ? { uid: cached.uid || "", email: cached.email || "" } : null,
    stateUser: state.user ? { uid: state.user.uid || "", email: state.user.email || "" } : null,
    authCurrentUser: authUser ? { uid: authUser.uid || "", email: authUser.email || "" } : null,
    hostname: location.hostname,
  });
}

function getDisplayIdentity(user) {
  const profile = getCachedProfile(user?.uid);
  return {
    name:
      profile?.display_name ||
      profile?.full_name ||
      user?.displayName ||
      (user?.email ? user.email.split("@")[0] : "") ||
      "Bạn",
    photo: profile?.photo_url || user?.photoURL || DEFAULT_AVATAR,
    role: isAdminUser(user) ? "Quản trị viên" : (getStoredRole(user) || "Thành viên TA-Edu"),
  };
}

function updateAuthUI() {
  const effectiveUser = getEffectiveUser();
  const canRenderAuthSlot = Boolean(authSlot);

  if (!canRenderAuthSlot) {
    if (!effectiveUser) {
      authGuard?.classList.remove("hidden");
      composerButtons.forEach((btn) => (btn.disabled = true));
      if (composerAvatar) composerAvatar.src = DEFAULT_AVATAR;
    } else {
      const identity = getDisplayIdentity(effectiveUser);
      authGuard?.classList.add("hidden");
      composerButtons.forEach((btn) => (btn.disabled = false));
      if (composerAvatar) composerAvatar.src = identity.photo;
    }
    return;
  }

  if (!effectiveUser) {
    authSlot.innerHTML = `<button class="btn btn-primary" type="button" data-auth-action="login">Đăng nhập</button>`;
    authGuard?.classList.remove("hidden");
    composerButtons.forEach((btn) => (btn.disabled = true));
    if (composerAvatar) composerAvatar.src = DEFAULT_AVATAR;
  } else {
    const identity = getDisplayIdentity(effectiveUser);
    authSlot.innerHTML = `
      <div class="auth-user auth-user--compact">
        <img src="${escapeHtml(identity.photo)}" alt="${escapeHtml(identity.name)}">
        <div class="auth-user__meta">
          <span class="auth-user__name">${escapeHtml(identity.name)}</span>
          <span class="auth-user__role">${escapeHtml(identity.role)}</span>
        </div>
        <button class="btn btn-ghost btn-mini" type="button" data-auth-action="logout">Đăng xuất</button>
      </div>
    `;
    authGuard?.classList.add("hidden");
    composerButtons.forEach((btn) => (btn.disabled = false));
    if (composerAvatar) composerAvatar.src = identity.photo;
  }

  wireAuthTriggers(authSlot);
}

async function loadPosts() {
  state.loading = true;
  renderFeed();
  try {
    const headers = await buildAuthHeaders();
    const response = await fetch(`${QA_ENDPOINT}?limit=30`, { headers });
    if (!response.ok) throw new Error("Không tải được bài viết cộng đồng.");
    const data = await response.json();
    state.posts = Array.isArray(data.posts) ? data.posts : [];
    renderSuggestions();
  } catch (error) {
    console.error("loadPosts failed", error);
    state.posts = [];
    renderSuggestions(true);
    showToast(error.message || "Không thể tải cộng đồng.", "error");
  } finally {
    state.loading = false;
    renderFeed();
  }
}

async function handleImageSelect() {
  const files = Array.from(imageInput?.files || []);
  if (!files.length) {
    clearImagePreview();
    return;
  }

  try {
    const picked = [];
    for (const file of files.slice(0, MAX_IMAGES_PER_PICK)) {
      await validateImageFile(file);
      picked.push({
        dataUrl: await fileToDataUrl(file),
        name: file.name || "Ảnh bài viết",
      });
    }
    state.imageItems = picked;
    renderPostImagePreview();
  } catch (error) {
    console.error("validateImageFile failed", error);
    clearImagePreview();
    showToast(error.message || "Ảnh không hợp lệ.", "error");
  }
}

function clearImagePreview() {
  state.imageItems = [];
  if (imageInput) imageInput.value = "";
  renderPostImagePreview();
}

function removePostImageAt(index) {
  state.imageItems = state.imageItems.filter((_, itemIndex) => itemIndex !== index);
  if (!state.imageItems.length && imageInput) imageInput.value = "";
  renderPostImagePreview();
}

function renderPostImagePreview() {
  if (!imagePreviewContainer || !fileNameEl) return;
  fileNameEl.textContent = state.imageItems.length
    ? `Đã chọn ${state.imageItems.length} ảnh`
    : "Thêm hình ảnh";

  if (!state.imageItems.length) {
    imagePreviewContainer.hidden = true;
    imagePreviewContainer.innerHTML = "";
    return;
  }

  imagePreviewContainer.hidden = false;
  imagePreviewContainer.innerHTML = state.imageItems.map((item, index) => `
    <div class="image-preview-tile">
      <img src="${escapeHtml(item.dataUrl)}" alt="${escapeHtml(item.name || "Ảnh bài viết")}">
      <button type="button" class="remove-image-btn" data-remove-post-image="${index}">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `).join("");

  imagePreviewContainer.querySelectorAll("[data-remove-post-image]").forEach((button) => {
    button.addEventListener("click", () => removePostImageAt(Number(button.dataset.removePostImage)));
  });
}

function buildCommentComposerKey(postId, parentCommentId = null) {
  return `${postId}:${parentCommentId || "root"}`;
}

function getCommentImageState(key) {
  return key ? state.commentImages.get(key) || null : null;
}

function setCommentImageState(key, payload) {
  if (!key) return;
  if (!Array.isArray(payload) || !payload.length) {
    state.commentImages.delete(key);
    return;
  }
  state.commentImages.set(key, payload);
}

function renderCommentImagePreview(scopeEl, key) {
  const previewWrap = scopeEl?.querySelector("[data-comment-image-preview]");
  if (!previewWrap) return;

  const imageState = getCommentImageState(key);
  if (!Array.isArray(imageState) || !imageState.length) {
    previewWrap.hidden = true;
    previewWrap.innerHTML = "";
    return;
  }

  previewWrap.hidden = false;
  previewWrap.innerHTML = imageState.map((item, index) => `
    <div class="comment-image-preview__tile">
      <img src="${escapeHtml(item.dataUrl)}" alt="${escapeHtml(item.name || "Ảnh bình luận")}">
      <div class="comment-image-preview__meta">
        <span>${escapeHtml(item.name || "Ảnh bình luận")}</span>
        <button type="button" class="comment-image-preview__remove" data-comment-image-remove-index="${index}">Xóa ảnh</button>
      </div>
    </div>
  `).join("");

  previewWrap.querySelectorAll("[data-comment-image-remove-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const removeIndex = Number(button.dataset.commentImageRemoveIndex);
      const nextImages = imageState.filter((_, itemIndex) => itemIndex !== removeIndex);
      setCommentImageState(key, nextImages);
      renderCommentImagePreview(scopeEl, key);
      const fileInput = scopeEl?.querySelector("[data-comment-image-input]");
      if (!nextImages.length && fileInput) fileInput.value = "";
    });
  });
}

function clearCommentImage(scopeEl, key) {
  const fileInput = scopeEl?.querySelector("[data-comment-image-input]");
  if (fileInput) fileInput.value = "";
  setCommentImageState(key, null);
  renderCommentImagePreview(scopeEl, key);
}

async function handleCommentImageSelect(fileInput, key) {
  const scopeEl = fileInput?.closest("[data-comment-composer], [data-reply-box]");
  const files = Array.from(fileInput?.files || []);
  if (!files.length) {
    clearCommentImage(scopeEl, key);
    return;
  }

  try {
    const picked = [];
    for (const file of files.slice(0, MAX_IMAGES_PER_PICK)) {
      await validateImageFile(file);
      picked.push({
        dataUrl: await fileToDataUrl(file),
        name: file.name || "Ảnh bình luận",
      });
    }
    setCommentImageState(key, picked);
    renderCommentImagePreview(scopeEl, key);
  } catch (error) {
    console.error("handleCommentImageSelect failed", error);
    clearCommentImage(scopeEl, key);
    showToast(error.message || "Ảnh bình luận không hợp lệ.", "error");
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!getEffectiveUser()) {
    showToast("Vui lòng đăng nhập để đăng bài.", "error");
    return;
  }

  const title = titleInput?.value.trim();
  const subject = subjectInput?.value.trim();
  const grade = gradeInput?.value.trim();
  const body = bodyInput?.value.trim();
  const tags = (tagsInput?.value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (!title || !subject || !grade || !body) {
    showToast("Nhập đủ tiêu đề, môn, lớp và nội dung.", "error");
    return;
  }

  toggleFormLoading(true);

  try {
    const headers = await buildAuthHeaders();
    const metaTags = [
      subject ? `@mon:${subject}` : "",
      grade ? `@lop:${grade}` : "",
    ].filter(Boolean);
    const payload = { title, body, tags: [...metaTags, ...tags], subject, grade };
    if (state.imageItems.length) payload.imageDataList = state.imageItems.map((item) => item.dataUrl);

    const response = await fetch(QA_ENDPOINT, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await safeJson(response);
    if (!response.ok) throw new Error(resolveApiError(data, "Đăng bài thất bại."));

    resetComposerForm();
    closePostModal();
    showToast("Đã đăng bài mới.", "success");
    await loadPosts();
  } catch (error) {
    console.error("handleSubmit failed", error);
    showToast(error.message || "Không thể đăng bài.", "error");
  } finally {
    toggleFormLoading(false);
  }
}

function openPostModal() {
  if (!getEffectiveUser()) {
    showToast("Đăng nhập để đăng bài.", "error");
    return;
  }
  if (postModalBackdrop) postModalBackdrop.hidden = false;
  if (postModal) postModal.hidden = false;
}

function closePostModal() {
  if (postModalBackdrop) postModalBackdrop.hidden = true;
  if (postModal) postModal.hidden = true;
}

function openImageLightbox(src, alt = "Ảnh bài viết") {
  if (!imageLightbox || !imageLightboxBackdrop || !imageLightboxImg || !src) return;
  state.imageLightboxZoom = 1;
  state.imageLightboxPanX = 0;
  state.imageLightboxPanY = 0;
  state.imageLightboxDragging = false;
  state.imageLightboxPointerId = null;
  imageLightboxImg.src = src;
  imageLightboxImg.alt = alt;
  applyLightboxTransform();
  if (imageLightboxDownload) {
    imageLightboxDownload.href = src;
    imageLightboxDownload.download = buildImageDownloadName(alt);
  }
  imageLightboxBackdrop.hidden = false;
  imageLightbox.hidden = false;
}

function closeImageLightbox() {
  if (imageLightboxBackdrop) imageLightboxBackdrop.hidden = true;
  if (imageLightbox) imageLightbox.hidden = true;
  if (imageLightboxViewport) {
    imageLightboxViewport.classList.remove("is-dragging");
  }
  if (imageLightboxImg) {
    imageLightboxImg.src = "";
    imageLightboxImg.alt = "";
    imageLightboxImg.style.setProperty("--lightbox-zoom", "1");
    imageLightboxImg.style.setProperty("--lightbox-pan-x", "0px");
    imageLightboxImg.style.setProperty("--lightbox-pan-y", "0px");
  }
  if (imageLightboxDownload) {
    imageLightboxDownload.href = "#";
    imageLightboxDownload.download = "ta-edu-image.jpg";
  }
  state.imageLightboxZoom = 1;
  state.imageLightboxPanX = 0;
  state.imageLightboxPanY = 0;
  state.imageLightboxDragging = false;
  state.imageLightboxPointerId = null;
}

function handleGlobalKeydown(event) {
  if (event.key === "Escape" && imageLightbox && !imageLightbox.hidden) {
    closeImageLightbox();
  }
}

function adjustImageLightboxZoom(delta) {
  if (!imageLightboxImg || !imageLightbox || imageLightbox.hidden) return;
  state.imageLightboxZoom = Math.min(3, Math.max(0.6, +(state.imageLightboxZoom + delta).toFixed(2)));
  clampLightboxPan();
  applyLightboxTransform();
}

function applyLightboxTransform() {
  if (!imageLightboxImg) return;
  imageLightboxImg.style.setProperty("--lightbox-zoom", String(state.imageLightboxZoom));
  imageLightboxImg.style.setProperty("--lightbox-pan-x", `${state.imageLightboxPanX}px`);
  imageLightboxImg.style.setProperty("--lightbox-pan-y", `${state.imageLightboxPanY}px`);
}

function getLightboxPanBounds() {
  if (!imageLightboxViewport || !imageLightboxImg) {
    return { maxX: 0, maxY: 0 };
  }
  const viewportRect = imageLightboxViewport.getBoundingClientRect();
  const imageRect = imageLightboxImg.getBoundingClientRect();
  const scaledWidth = imageRect.width * state.imageLightboxZoom;
  const scaledHeight = imageRect.height * state.imageLightboxZoom;
  return {
    maxX: Math.max(0, (scaledWidth - viewportRect.width) / 2 + 32),
    maxY: Math.max(0, (scaledHeight - viewportRect.height) / 2 + 32),
  };
}

function clampLightboxPan() {
  const { maxX, maxY } = getLightboxPanBounds();
  state.imageLightboxPanX = Math.max(-maxX, Math.min(maxX, state.imageLightboxPanX));
  state.imageLightboxPanY = Math.max(-maxY, Math.min(maxY, state.imageLightboxPanY));
}

function handleLightboxPointerDown(event) {
  if (!imageLightboxViewport || !imageLightboxImg?.src) return;
  const { maxX, maxY } = getLightboxPanBounds();
  if (maxX <= 0 && maxY <= 0) return;
  state.imageLightboxDragging = true;
  state.imageLightboxPointerId = event.pointerId;
  state.imageLightboxDragStartX = event.clientX - state.imageLightboxPanX;
  state.imageLightboxDragStartY = event.clientY - state.imageLightboxPanY;
  imageLightboxViewport.classList.add("is-dragging");
  imageLightboxViewport.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function handleLightboxPointerMove(event) {
  if (!state.imageLightboxDragging || state.imageLightboxPointerId !== event.pointerId) return;
  state.imageLightboxPanX = event.clientX - state.imageLightboxDragStartX;
  state.imageLightboxPanY = event.clientY - state.imageLightboxDragStartY;
  clampLightboxPan();
  applyLightboxTransform();
}

function handleLightboxPointerUp(event) {
  if (state.imageLightboxPointerId !== null && event.pointerId !== state.imageLightboxPointerId) return;
  state.imageLightboxDragging = false;
  state.imageLightboxPointerId = null;
  imageLightboxViewport?.classList.remove("is-dragging");
}

function handleLightboxWheel(event) {
  if (!imageLightbox || imageLightbox.hidden) return;
  event.preventDefault();
  adjustImageLightboxZoom(event.deltaY > 0 ? -0.12 : 0.12);
}

function buildImageDownloadName(altText) {
  const normalized = String(altText || "anh-bai-viet")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${normalized || "ta-edu-image"}.jpg`;
}

async function handleLike(postId) {
  if (!getEffectiveUser()) {
    showToast("Đăng nhập để bày tỏ cảm xúc.", "error");
    return;
  }
  try {
    const headers = await buildAuthHeaders();
    const response = await fetch(`${QA_ENDPOINT}/${postId}/like`, {
      method: "POST",
      headers,
    });
    const data = await safeJson(response);
    if (!response.ok) throw new Error(resolveApiError(data, "Không thể cập nhật lượt thích."));

    const target = state.posts.find((post) => post.id === postId);
    if (target) {
      target.likes = data.likes;
      target.liked = data.liked;
      renderFeed();
      renderSuggestions();
    }
  } catch (error) {
    console.error("handleLike failed", error);
    showToast(error.message || "Lỗi khi bày tỏ cảm xúc.", "error");
  }
}

function promptReportDetails(label) {
  return openReportModal(label);
}

async function sendUserReport(payload) {
  const effectiveUser = getEffectiveUser();
  if (!effectiveUser) {
    showToast("Vui lòng đăng nhập để gửi tố cáo.", "error");
    await openCommunityLogin();
    return;
  }
  try {
    const token = await auth.currentUser?.getIdToken?.();
    if (!token) throw new Error("missing_token");
    await submitUserReport(token, payload);
    showToast("Đã gửi tố cáo. Cảm ơn bạn!", "success");
  } catch (error) {
    console.error("submit report failed", error);
    showToast(error.message || "Không thể gửi tố cáo.", "error");
  }
}

function findCommentById(comments = [], commentId) {
  for (const comment of comments) {
    if (comment.id === commentId) return comment;
    const nested = findCommentById(comment.replies || [], commentId);
    if (nested) return nested;
  }
  return null;
}

async function handleReportPost(post) {
  if (!post) return;
  const detail = await promptReportDetails("bài viết này");
  if (!detail) return;
  const effectiveUser = getEffectiveUser();
  const identity = effectiveUser ? getDisplayIdentity(effectiveUser) : null;
  const payload = {
    category: "Bài viết",
    reason: detail.reason,
    content: detail.detail,
    reporterName: identity?.name || effectiveUser?.displayName || effectiveUser?.email || "",
    reporterEmail: effectiveUser?.email || "",
    reportedId: post.author?.uid || "",
    reportedName: post.author?.name || "",
    reportedEmail: post.author?.email || "",
    targetType: "post",
    targetId: post.id,
    evidenceUrls: post.image_urls || (post.image_url ? [post.image_url] : []),
    payload: {
      postId: post.id,
      title: post.title || "",
      body: String(post.body || "").slice(0, 400),
      tags: post.tags || [],
    },
  };
  await sendUserReport(payload);
}

async function handleReportComment(post, comment) {
  if (!post || !comment) return;
  const detail = await promptReportDetails("bình luận này");
  if (!detail) return;
  const effectiveUser = getEffectiveUser();
  const identity = effectiveUser ? getDisplayIdentity(effectiveUser) : null;
  const payload = {
    category: "Bình luận",
    reason: detail.reason,
    content: detail.detail,
    reporterName: identity?.name || effectiveUser?.displayName || effectiveUser?.email || "",
    reporterEmail: effectiveUser?.email || "",
    reportedId: comment.author?.uid || "",
    reportedName: comment.author?.name || "",
    reportedEmail: comment.author?.email || "",
    targetType: "comment",
    targetId: comment.id,
    evidenceUrls: comment.image_urls || (comment.image_url ? [comment.image_url] : []),
    payload: {
      postId: post.id,
      commentId: comment.id,
      content: String(comment.content || "").slice(0, 400),
    },
  };
  await sendUserReport(payload);
}

function renderSuggestions(useFallback = false) {
  if (!suggestionsEl) return;
  suggestionsEl.innerHTML = "";
  const source = !useFallback && state.posts.length
    ? state.posts.slice().sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 4)
    : fallbackSuggestions;

  source.forEach((item) => {
    const li = document.createElement("li");
    const title = item.title || "Gợi ý";
    const snippet = item.snippet || (item.body ? String(item.body).slice(0, 80) : "");
    const likes = typeof item.likes === "number" ? `<span>${item.likes} lượt thích</span>` : "";
    li.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(snippet)}</p>${likes}`;
    suggestionsEl.appendChild(li);
  });
}

function toggleFormLoading(isLoading) {
  const submit = formEl?.querySelector('button[type="submit"]');
  if (!submit) return;
  submit.disabled = !!isLoading;
  if (!submit.dataset.originalText) submit.dataset.originalText = submit.textContent;
  submit.textContent = isLoading ? "Đang đăng..." : submit.dataset.originalText;
}

function resetComposerForm() {
  if (titleInput) titleInput.value = "";
  if (subjectInput) subjectInput.value = "";
  if (gradeInput) gradeInput.value = "";
  if (bodyInput) bodyInput.value = "";
  if (tagsInput) tagsInput.value = "";
  clearImagePreview();
}

async function validateImageFile(file) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Chỉ chấp nhận ảnh JPG, PNG hoặc WebP.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Ảnh vượt quá 4MB.");
  }

  const meta = await readImageMeta(file);
  if (meta.width < 80 || meta.height < 80) {
    throw new Error("Ảnh quá nhỏ, vui lòng chọn ảnh rõ hơn.");
  }
  if (meta.width > 4096 || meta.height > 4096) {
    throw new Error("Ảnh quá lớn, vui lòng giảm kích thước trước khi đăng.");
  }
}

function readImageMeta(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = () => reject(new Error("Không đọc được ảnh."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Không đọc được ảnh."));
    reader.readAsDataURL(file);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Không thể xử lý ảnh."));
    reader.readAsDataURL(file);
  });
}

async function buildAuthHeaders() {
  const token = await auth.currentUser?.getIdToken?.();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function getStoredRole(user) {
  if (!user?.uid) return "";
  try {
    return localStorage.getItem(`taedu:role:${user.uid}`) || "";
  } catch (_) {
    return "";
  }
}

function canDeletePost(post) {
  const effectiveUser = getEffectiveUser();
  if (!effectiveUser || !post) return false;
  if (isAdminUser(effectiveUser)) return true;
  return Boolean(post.author?.uid && post.author.uid === effectiveUser.uid);
}

function canDeleteComment(post, comment) {
  const effectiveUser = getEffectiveUser();
  if (!effectiveUser || !comment) return false;
  if (isAdminUser(effectiveUser)) return true;
  if (comment.author?.uid && comment.author.uid === effectiveUser.uid) return true;
  return Boolean(post?.author?.uid && post.author.uid === effectiveUser.uid);
}

function isAdminUser(user) {
  if (!user) return false;
  const role = getStoredRole(user).toLowerCase();
  if (role === "admin") return true;
  const configured = typeof window.__TAEDU_ADMIN_EMAILS === "string" && window.__TAEDU_ADMIN_EMAILS.trim()
    ? window.__TAEDU_ADMIN_EMAILS.split(",")
    : ADMIN_EMAIL_FALLBACK;
  const emails = configured.map((item) => item.trim().toLowerCase()).filter(Boolean);
  return emails.includes((user.email || "").toLowerCase());
}

function formatBody(text = "") {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function normalizeGender(gender) {
  const value = String(gender || "").trim().toLowerCase();
  if (["male", "nam", "boy", "m"].includes(value)) return "male";
  if (["female", "nu", "nữ", "girl", "f"].includes(value)) return "female";
  if (["other", "khac", "khác"].includes(value)) return "other";
  return "";
}

function renderGenderIcon(gender) {
  const normalized = normalizeGender(gender);
  if (normalized === "male") {
    return '<i class="fa-solid fa-mars meta-line__gender meta-line__gender--male" aria-label="Nam" title="Nam"></i>';
  }
  if (normalized === "female") {
    return '<i class="fa-solid fa-venus meta-line__gender meta-line__gender--female" aria-label="Nữ" title="Nữ"></i>';
  }
  if (normalized === "other") {
    return '<i class="fa-solid fa-genderless meta-line__gender meta-line__gender--other" aria-label="Khác" title="Khác"></i>';
  }
  return "";
}

function buildMetaLine(name, gender, role, createdAt, options = {}) {
  const includeName = options.includeName !== false;
  const parts = [];
  const time = formatTime(createdAt);

  if (includeName && name) {
    parts.push(`
      <span class="meta-line__name-wrap">
        <span class="meta-line__name">${escapeHtml(name)}</span>
        ${renderGenderIcon(gender)}
      </span>
    `);
  }
  if (role) parts.push(`<span class="meta-line__role">${escapeHtml(role)}</span>`);
  if (time) parts.push(`<span class="meta-line__time">${escapeHtml(time)}</span>`);

  return `<span class="meta-line">${parts.join('<span class="meta-line__dot">•</span>')}</span>`;
}

function safeJson(response) {
  return response.text().then((text) => {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      return { message: text };
    }
  });
}

function resolveApiError(payload, fallback) {
  if (!payload) return fallback;
  return payload.message || payload.error || fallback;
}

function escapeHtml(text = "") {
  const span = document.createElement("span");
  span.textContent = text;
  return span.innerHTML;
}

function showToast(message, type = "") {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.className = `toast is-visible ${type}`.trim();
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastEl.classList.remove("is-visible"), 2600);
}

function renderImageGallery(images = [], altBase = "Ảnh", datasetPrefix = "post") {
  const list = (Array.isArray(images) ? images : []).filter(Boolean);
  if (!list.length) return "";
  const galleryClass = list.length > 1 ? "post-image-gallery is-multi" : "post-image-gallery";
  return `
    <div class="${galleryClass}">
      ${list.map((src, index) => `
        <div class="post-image">
          <img
            src="${escapeHtml(src)}"
            alt="${escapeHtml(`${altBase} ${index + 1}`)}"
            data-${datasetPrefix}-image-lightbox="${escapeHtml(src)}"
            data-${datasetPrefix}-image-alt="${escapeHtml(`${altBase} ${index + 1}`)}">
        </div>
      `).join("")}
    </div>
  `;
}

async function openCommunityLogin() {
  const sharedLoginButton = document.getElementById("btnLogin");
  const authModal = document.getElementById("authModal");

  if (sharedLoginButton) {
    sharedLoginButton.click();
    return;
  }

  if (authModal) {
    authModal.hidden = false;
    document.body.style.overflow = "hidden";
    authModal.querySelector('[name="email"]')?.focus();
    return;
  }

  await login();
}

function wireAuthTriggers(root = document) {
  root.querySelectorAll("[data-auth-action]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (btn.dataset.authAction === "login") await openCommunityLogin();
      if (btn.dataset.authAction === "logout") await logout();
    });
  });
}

async function login() {
  try {
    const result = await loginWithGoogle();
    if (!result) showToast("Đang chuyển sang Google để đăng nhập...");
  } catch (error) {
    console.error("login failed", error);
    showToast(mapFirebaseAuthError(error), "error");
  }
}

async function logout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("logout failed", error);
    showToast("Không thể đăng xuất.", "error");
  }
}

function openConfirmModal(message, acceptLabel = "Xóa") {
  return new Promise((resolve) => {
    state.confirmMode = "confirm";
    state.confirmResolver = resolve;
    if (confirmModalMessage) confirmModalMessage.textContent = message;
    if (confirmModalAccept) confirmModalAccept.textContent = acceptLabel;
    if (reportFields) reportFields.hidden = true;
    if (reportReasonInput) reportReasonInput.value = "";
    if (reportDetailInput) reportDetailInput.value = "";
    if (confirmModalBackdrop) confirmModalBackdrop.hidden = false;
    if (confirmModal) confirmModal.hidden = false;
  });
}

function openReportModal(label) {
  return new Promise((resolve) => {
    state.confirmMode = "report";
    state.reportResolver = resolve;
    if (confirmModalMessage) confirmModalMessage.textContent = `Lý do tố cáo ${label}?`;
    if (confirmModalAccept) confirmModalAccept.textContent = "Gửi tố cáo";
    if (reportFields) reportFields.hidden = false;
    if (reportReasonInput) reportReasonInput.value = "";
    if (reportDetailInput) reportDetailInput.value = "";
    if (confirmModalBackdrop) confirmModalBackdrop.hidden = false;
    if (confirmModal) confirmModal.hidden = false;
    setTimeout(() => reportReasonInput?.focus(), 30);
  });
}

function closeConfirmModal(accepted) {
  if (state.confirmMode === "report") {
    if (accepted) {
      const reason = String(reportReasonInput?.value || "").trim();
      if (!reason) {
        showToast("Vui lòng nhập lý do tố cáo.", "error");
        reportReasonInput?.focus();
        return;
      }
      const detail = String(reportDetailInput?.value || "").trim();
      if (confirmModalBackdrop) confirmModalBackdrop.hidden = true;
      if (confirmModal) confirmModal.hidden = true;
      if (typeof state.reportResolver === "function") {
        state.reportResolver({ reason, detail });
        state.reportResolver = null;
      }
      return;
    }
    if (confirmModalBackdrop) confirmModalBackdrop.hidden = true;
    if (confirmModal) confirmModal.hidden = true;
    if (typeof state.reportResolver === "function") {
      state.reportResolver(null);
      state.reportResolver = null;
    }
    return;
  }
  if (confirmModalBackdrop) confirmModalBackdrop.hidden = true;
  if (confirmModal) confirmModal.hidden = true;
  if (typeof state.confirmResolver === "function") {
    state.confirmResolver(Boolean(accepted));
    state.confirmResolver = null;
  }
}

async function handleDelete(postId) {
  const targetPost = state.posts.find((post) => post.id === postId);
  if (!targetPost || !canDeletePost(targetPost)) {
    showToast("Bạn không có quyền xóa bài này.", "error");
    return;
  }
  const accepted = await openConfirmModal("Xóa bài đăng này? Hành động này không thể hoàn tác.", "Xóa bài");
  if (!accepted) return;

  try {
    const headers = await buildAuthHeaders();
    const response = await fetch(`${QA_ENDPOINT}/${postId}`, {
      method: "DELETE",
      headers,
    });
    const data = await safeJson(response);
    if (!response.ok) throw new Error(resolveApiError(data, "Không thể xóa bài đăng."));
    state.posts = state.posts.filter((post) => post.id !== postId);
    renderFeed();
    renderSuggestions();
    showToast("Đã xóa bài đăng.", "success");
  } catch (error) {
    console.error("handleDelete failed", error);
    showToast(error.message || "Không thể xóa bài đăng.", "error");
  }
}

async function handleDeleteComment(postId, commentId) {
  const targetPost = state.posts.find((post) => post.id === postId);
  const targetComment = (targetPost?.comments || []).find((comment) => comment.id === commentId);
  if (!targetPost || !targetComment || !canDeleteComment(targetPost, targetComment)) {
    showToast("Bạn không có quyền xóa bình luận này.", "error");
    return;
  }
  const accepted = await openConfirmModal("Xóa bình luận này?", "Xóa bình luận");
  if (!accepted) return;

  try {
    const headers = await buildAuthHeaders();
    const response = await fetch(`${QA_ENDPOINT}/${postId}/comments/${commentId}`, {
      method: "DELETE",
      headers,
    });
    const data = await safeJson(response);
    if (!response.ok) throw new Error(resolveApiError(data, "Không thể xóa bình luận."));

    const target = state.posts.find((post) => post.id === postId);
    if (target) {
      target.comments = (target.comments || []).filter((comment) => comment.id !== commentId);
      renderFeed();
    }
    showToast("Đã xóa bình luận.", "success");
  } catch (error) {
    console.error("handleDeleteComment failed", error);
    showToast(error.message || "Không thể xóa bình luận.", "error");
  }
}

async function handleComment(postId, inputEl, parentCommentId = null) {
  if (!getEffectiveUser()) {
    showToast("Đăng nhập để bình luận.", "error");
    return;
  }

  const content = inputEl.value.trim();
  const composerKey = buildCommentComposerKey(postId, parentCommentId);
  const imageState = getCommentImageState(composerKey);
  if (!content && !(Array.isArray(imageState) && imageState.length)) return;

  try {
    const headers = await buildAuthHeaders();
    const response = await fetch(`${QA_ENDPOINT}/${postId}/comments`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        parentCommentId,
        imageDataList: Array.isArray(imageState) ? imageState.map((item) => item.dataUrl) : [],
      }),
    });
    const data = await safeJson(response);
    if (!response.ok) throw new Error(resolveApiError(data, "Không thể gửi bình luận."));

    inputEl.value = "";
    const scopeEl = inputEl.closest("[data-comment-composer], [data-reply-box]");
    clearCommentImage(scopeEl, composerKey);
    if (parentCommentId && scopeEl) scopeEl.hidden = true;
    await loadPosts();
  } catch (error) {
    console.error("handleComment failed", error);
    showToast(error.message || "Lỗi bình luận.", "error");
  }
}

function renderCommentBranch(post, comment, depth = 0) {
  const effectiveUser = getEffectiveUser();
  const replyTargetName = comment.author?.name || "Bạn học";
  const replyButton = effectiveUser
    ? `<button type="button" class="comment-reply-btn" data-reply-toggle="${post.id}:${comment.id}" data-reply-target-name="${escapeHtml(replyTargetName)}">Trả lời</button>`
    : "";
  const deleteButton = canDeleteComment(post, comment)
    ? `<button type="button" class="comment-delete-btn" data-delete-comment="${post.id}:${comment.id}">Xóa</button>`
    : "";
  const canReport = Boolean(effectiveUser && comment.author?.uid && comment.author.uid !== effectiveUser.uid);
  const reportButton = canReport
    ? `<button type="button" class="comment-report-btn" data-report-comment="${post.id}:${comment.id}">Tố cáo</button>`
    : "";
  const replies = Array.isArray(comment.replies)
    ? comment.replies.map((reply) => renderCommentBranch(post, reply, depth + 1)).join("")
    : "";
  const replyComposer = effectiveUser
    ? `
      <div class="reply-composer" data-reply-box="${post.id}:${comment.id}" hidden>
        <input type="text" placeholder="Trả lời bình luận..." data-reply-input="${post.id}:${comment.id}" data-reply-target-name="${escapeHtml(replyTargetName)}">
        <div class="comment-image-tools">
          <label class="comment-attach-btn">
            <i class="fa-regular fa-image"></i> Thêm ảnh
            <input type="file" accept="image/jpeg,image/png,image/webp" data-comment-image-input="${post.id}:${comment.id}" multiple hidden>
          </label>
        </div>
        <div class="comment-image-preview" data-comment-image-preview hidden></div>
        <div class="reply-composer__actions">
          <button type="button" class="btn btn-primary btn-mini" data-reply-send="${post.id}:${comment.id}">Gửi</button>
          <button type="button" class="btn btn-ghost btn-mini" data-reply-cancel="${post.id}:${comment.id}">Hủy</button>
        </div>
      </div>
    `
    : "";

  return `
    <div class="comment-item comment-depth-${Math.min(depth, 3)}">
      <div class="comment-item__author">
        <img src="${escapeHtml(comment.author?.avatar || DEFAULT_AVATAR)}" alt="${escapeHtml(comment.author?.name || "Bạn học")}">
        <div class="comment-item__body">
          <div class="comment-meta">
            ${buildMetaLine(
              comment.author?.name || "Bạn học",
              comment.author?.gender || "",
              comment.author?.role || "",
              comment.created_at
            )}
            <div class="comment-meta__actions">
              ${replyButton}
              ${deleteButton}
              ${reportButton}
            </div>
          </div>
          <div>${escapeHtml(comment.content || "")}</div>
          ${renderImageGallery(comment.image_urls || (comment.image_url ? [comment.image_url] : []), comment.author?.name || "Ảnh bình luận", "comment")}
          ${replyComposer}
          ${replies ? `<div class="comment-replies">${replies}</div>` : ""}
        </div>
      </div>
    </div>
  `;
}

function attachReplyHandlers(card, post) {
  card.querySelectorAll("[data-reply-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.replyToggle || "";
      const box = card.querySelector(`[data-reply-box="${key}"]`);
      const input = card.querySelector(`[data-reply-input="${key}"]`);
      const targetName = button.dataset.replyTargetName || input?.dataset.replyTargetName || "Bạn học";
      const mentionPrefix = `@${targetName} `;
      if (!box) return;
      box.hidden = !box.hidden;
      if (!box.hidden && input) {
        if (!input.value.trim()) {
          input.value = mentionPrefix;
        } else if (!input.value.startsWith("@")) {
          input.value = `${mentionPrefix}${input.value}`;
        }
        renderCommentImagePreview(box, key);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  });

  card.querySelectorAll("[data-reply-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.replyCancel || "";
      const box = card.querySelector(`[data-reply-box="${key}"]`);
      const input = card.querySelector(`[data-reply-input="${key}"]`);
      if (input) input.value = "";
      if (box) clearCommentImage(box, key);
      if (box) box.hidden = true;
    });
  });

  card.querySelectorAll("[data-reply-send]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.replySend || "";
      const [postIdValue, commentIdValue] = key.split(":").map(Number);
      const input = card.querySelector(`[data-reply-input="${key}"]`);
      if (postIdValue && commentIdValue && input) {
        handleComment(postIdValue, input, commentIdValue);
      }
    });
  });

  card.querySelectorAll("[data-comment-image-input]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.commentImageInput || "";
      handleCommentImageSelect(input, key);
    });
  });

  card.querySelectorAll("[data-comment-image-lightbox]").forEach((img) => {
    img.addEventListener("click", () => {
      const src = img.dataset.commentImageLightbox || img.getAttribute("src") || "";
      const alt = img.dataset.commentImageAlt || "Ảnh bình luận";
      if (src) openImageLightbox(src, alt);
    });
  });
}

function renderFeed() {
  if (!feedEl) return;

  if (state.loading) {
    feedEl.innerHTML = `<div class="discussion-card empty-feed">Đang tải bài viết...</div>`;
    return;
  }

  if (!state.posts.length) {
    feedEl.innerHTML = `<div class="discussion-card empty-feed">Chưa có bài viết nào. Hãy là người đầu tiên mở chủ đề!</div>`;
    return;
  }

  feedEl.innerHTML = "";
  state.posts.forEach((post) => {
    const card = document.createElement("article");
    card.className = "discussion-post";
    const likesLabel = post.likes === 1 ? "1 lượt thích" : `${post.likes || 0} lượt thích`;
    const visibleTags = Array.isArray(post.tags)
      ? post.tags.filter((tag) => !String(tag).startsWith("@mon:") && !String(tag).startsWith("@lop:"))
      : [];
    const tagsHtml = visibleTags.length
      ? `<div class="tag-row">${visibleTags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("")}</div>`
      : "";
    const deleteHtml = canDeletePost(post)
      ? `<button type="button" class="post-delete-btn" data-delete="${post.id}"><i class="fa-solid fa-trash"></i> Xóa</button>`
      : "";
    const effectiveUser = getEffectiveUser();
    const canReportPost = Boolean(effectiveUser && post.author?.uid && post.author.uid !== effectiveUser.uid);
    const reportHtml = canReportPost
      ? `<button type="button" class="post-report-btn" data-report-post="${post.id}"><i class="fa-solid fa-flag"></i> Tố cáo</button>`
      : "";
    const commentsHtml = (post.comments || []).map((comment) => renderCommentBranch(post, comment)).join("");

    card.innerHTML = `
      <div class="post-author">
        <img src="${escapeHtml(post.author?.avatar || DEFAULT_AVATAR)}" alt="${escapeHtml(post.author?.name || "")}">
        <div>
          <strong>${escapeHtml(post.author?.name || "Thành viên TA-Edu")}</strong>
          <div class="post-meta">${buildMetaLine(
            post.author?.name || "Thành viên TA-Edu",
            post.author?.gender || "",
            post.author?.role || "",
            post.created_at,
            { includeName: false }
          )}</div>
        </div>
      </div>
      <div class="post-topbar">
        <h3>${escapeHtml(post.title || "")}</h3>
        <div class="post-topbar__actions">
          ${reportHtml}
          ${deleteHtml}
        </div>
      </div>
      <div class="post-body">${formatBody(post.body)}</div>
      ${tagsHtml}
      ${renderImageGallery(post.image_urls || (post.image_url ? [post.image_url] : []), post.title || "Ảnh bài viết", "post")}
      <div class="post-actions">
        <button type="button" data-like="${post.id}">
          <i class="fa${post.liked ? "s" : "r"} fa-heart"></i> ${likesLabel}
        </button>
        <span>${countComments(post.comments || [])} bình luận</span>
      </div>
      <div class="comments">
        ${commentsHtml}
        <div class="comment-input" data-comment-composer="${post.id}:root">
          <input type="text" placeholder="Viết bình luận..." data-comment-input="${post.id}" ${getEffectiveUser() ? "" : "disabled"}>
          <label class="comment-attach-btn ${getEffectiveUser() ? "" : "is-disabled"}">
            <i class="fa-regular fa-image"></i>
            <input type="file" accept="image/jpeg,image/png,image/webp" data-comment-image-input="${post.id}:root" ${getEffectiveUser() ? "" : "disabled"} multiple hidden>
          </label>
          <button type="button" class="btn btn-primary btn-mini" data-comment-send="${post.id}" ${getEffectiveUser() ? "" : "disabled"}>Gửi</button>
          <div class="comment-image-preview" data-comment-image-preview hidden></div>
        </div>
      </div>
    `;

    card.querySelector(`[data-like="${post.id}"]`)?.addEventListener("click", () => handleLike(post.id));
    card.querySelector(`[data-delete="${post.id}"]`)?.addEventListener("click", () => handleDelete(post.id));
    card.querySelector(`[data-report-post="${post.id}"]`)?.addEventListener("click", () => handleReportPost(post));
    card.querySelectorAll("[data-post-image-lightbox]").forEach((img) => {
      img.addEventListener("click", () => {
        const src = img.dataset.postImageLightbox || img.getAttribute("src") || "";
        const alt = img.dataset.postImageAlt || post.title || "Ảnh bài viết";
        if (src) openImageLightbox(src, alt);
      });
    });
    card.querySelectorAll("[data-delete-comment]").forEach((button) => {
      button.addEventListener("click", () => {
        const [rowPostId, commentId] = String(button.dataset.deleteComment || "").split(":").map(Number);
        if (rowPostId && commentId) handleDeleteComment(rowPostId, commentId);
      });
    });
    card.querySelectorAll("[data-report-comment]").forEach((button) => {
      button.addEventListener("click", () => {
        const [rowPostId, commentId] = String(button.dataset.reportComment || "").split(":").map(Number);
        if (!rowPostId || !commentId) return;
        const targetPost = state.posts.find((item) => item.id === rowPostId);
        const targetComment = findCommentById(targetPost?.comments || [], commentId);
        handleReportComment(targetPost, targetComment);
      });
    });

    const input = card.querySelector(`[data-comment-input="${post.id}"]`);
    const sendBtn = card.querySelector(`[data-comment-send="${post.id}"]`);
    if (input && sendBtn) {
      sendBtn.addEventListener("click", () => handleComment(post.id, input));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          handleComment(post.id, input);
        }
      });
    }

    const rootComposer = card.querySelector(`[data-comment-composer="${post.id}:root"]`);
    renderCommentImagePreview(rootComposer, buildCommentComposerKey(post.id));

    attachReplyHandlers(card, post);
    feedEl.appendChild(card);
  });
}

function countComments(comments = []) {
  return comments.reduce((total, comment) => total + 1 + countComments(comment.replies || []), 0);
}



