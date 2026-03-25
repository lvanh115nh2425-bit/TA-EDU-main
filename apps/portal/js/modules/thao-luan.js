import {
  auth,
  onAuthStateChanged,
  signOut,
  loginWithGoogle,
  readRedirectLoginResult,
  mapFirebaseAuthError
} from "/js/core/firebase.js";

const API_BASE =
  window.__TAEDU_API__ ||
  window.__TAEDU_ADMIN_API__ ||
  "http://localhost:4001";
const QA_ENDPOINT = `${API_BASE.replace(/\/$/, "")}/api/qa`;
const DEFAULT_AVATAR = "/assets/default_avatar.svg";
const ADMIN_EMAIL_FALLBACK = ["khkt.anhtu@gmail.com", "lvanh.115nh2425@gmail.com"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const feedEl = document.getElementById("discussionFeed");
const formEl = document.getElementById("postForm");
const titleInput = document.getElementById("postTitle");
const bodyInput = document.getElementById("postBody");
const tagsInput = document.getElementById("postTags");
const imageInput = document.getElementById("postImage");
const fileNameEl = document.getElementById("fileName");
const authGuard = document.getElementById("postAuthGuard");
const authSlot = document.getElementById("discussionAuthSlot");
const toastEl = document.getElementById("discussionToast");
const suggestionsEl = document.getElementById("discussionSuggestions");
const composerButtons = document.querySelectorAll("[data-post-action=\"open\"]");
const postModal = document.getElementById("postModal");
const postModalBackdrop = document.getElementById("postModalBackdrop");
const composerAvatar = document.getElementById("composerAvatar");
const imagePreviewContainer = document.getElementById("imagePreviewContainer");
const imagePreview = document.getElementById("imagePreview");
const removeImageBtn = document.getElementById("removeImageBtn");

const state = {
  user: null,
  posts: [],
  loading: true,
  imageData: null
};

const fallbackSuggestions = [
  { title: "Hỏi bài khó đang vướng", snippet: "Mô tả rõ phần đã làm để mọi người hỗ trợ nhanh hơn." },
  { title: "Chia sẻ mẹo học hiệu quả", snippet: "Một mẹo hay của bạn có thể giúp nhiều người tiến bộ hơn." },
  { title: "Thảo luận tài liệu và đề thi", snippet: "Cùng trao đổi nguồn học tốt, kinh nghiệm ôn tập, cách tránh sai." }
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
  document.querySelectorAll("[data-post-modal=\"close\"]").forEach((btn) => {
    btn.addEventListener("click", closePostModal);
  });
  composerButtons.forEach((btn) => {
    btn.addEventListener("click", openPostModal);
  });

  onAuthStateChanged(auth, (user) => {
    state.user = user || null;
    updateAuthUI();
    loadPosts();
  });

  loadPosts();
}

function updateAuthUI() {
  if (!authSlot) return;

  if (!state.user) {
    authSlot.innerHTML = `<button class="btn btn-primary" type="button" data-auth-action="login">Đăng nhập</button>`;
    authGuard?.classList.remove("hidden");
    composerButtons.forEach((btn) => (btn.disabled = true));
    if (composerAvatar) composerAvatar.src = DEFAULT_AVATAR;
  } else {
    const name = state.user.displayName || state.user.email || "Bạn";
    const roleLabel = isAdminUser(state.user) ? "Quản trị viên" : (getStoredRole(state.user) || "Thành viên TA-Edu");
    authSlot.innerHTML = `
      <div class="auth-user">
        <img src="${escapeHtml(state.user.photoURL || DEFAULT_AVATAR)}" alt="${escapeHtml(name)}">
        <div class="auth-user__meta">
          <span class="auth-user__name">${escapeHtml(name)}</span>
          <span class="auth-user__role">${escapeHtml(roleLabel)}</span>
        </div>
        <button class="btn btn-ghost" type="button" data-auth-action="logout">Đăng xuất</button>
      </div>
    `;
    authGuard?.classList.add("hidden");
    composerButtons.forEach((btn) => (btn.disabled = false));
    if (composerAvatar) composerAvatar.src = state.user.photoURL || DEFAULT_AVATAR;
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
  const file = imageInput?.files?.[0];
  if (!file) {
    clearImagePreview();
    return;
  }

  try {
    await validateImageFile(file);
    const dataUrl = await fileToDataUrl(file);
    state.imageData = dataUrl;
    if (imagePreview) imagePreview.src = dataUrl;
    if (imagePreviewContainer) imagePreviewContainer.hidden = false;
    if (fileNameEl) fileNameEl.textContent = file.name;
  } catch (error) {
    console.error("validateImageFile failed", error);
    clearImagePreview();
    showToast(error.message || "Ảnh không hợp lệ.", "error");
  }
}

function clearImagePreview() {
  state.imageData = null;
  if (imageInput) imageInput.value = "";
  if (fileNameEl) fileNameEl.textContent = "Thêm hình ảnh";
  if (imagePreview) imagePreview.src = "";
  if (imagePreviewContainer) imagePreviewContainer.hidden = true;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!state.user) {
    showToast("Vui lòng đăng nhập để đăng bài.", "error");
    return;
  }

  const title = titleInput?.value.trim();
  const body = bodyInput?.value.trim();
  const tags = (tagsInput?.value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (!title || !body) {
    showToast("Nhập tiêu đề và nội dung bài viết.", "error");
    return;
  }

  toggleFormLoading(true);

  try {
    const headers = await buildAuthHeaders();
    const payload = { title, body, tags };
    if (state.imageData) payload.imageData = state.imageData;

    const response = await fetch(QA_ENDPOINT, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
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
  if (!state.user) {
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

async function handleLike(postId) {
  if (!state.user) {
    showToast("Đăng nhập để bày tỏ cảm xúc.", "error");
    return;
  }
  try {
    const headers = await buildAuthHeaders();
    const response = await fetch(`${QA_ENDPOINT}/${postId}/like`, {
      method: "POST",
      headers
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

async function handleComment(postId, inputEl) {
  if (!state.user) {
    showToast("Đăng nhập để bình luận.", "error");
    return;
  }
  const content = inputEl.value.trim();
  if (!content) return;

  try {
    const headers = await buildAuthHeaders();
    const response = await fetch(`${QA_ENDPOINT}/${postId}/comments`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    const data = await safeJson(response);
    if (!response.ok) throw new Error(resolveApiError(data, "Không thể gửi bình luận."));
    inputEl.value = "";
    const target = state.posts.find((post) => post.id === postId);
    if (target) {
      target.comments = [...(target.comments || []), data.comment];
      renderFeed();
    }
  } catch (error) {
    console.error("handleComment failed", error);
    showToast(error.message || "Lỗi bình luận.", "error");
  }
}

async function handleDelete(postId) {
  if (!state.user || !isAdminUser(state.user)) {
    showToast("Bạn không có quyền xóa bài này.", "error");
    return;
  }
  if (!window.confirm("Xóa bài đăng này? Hành động này không thể hoàn tác.")) return;

  try {
    const headers = await buildAuthHeaders();
    const response = await fetch(`${QA_ENDPOINT}/${postId}`, {
      method: "DELETE",
      headers
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
  if (!state.user || !isAdminUser(state.user)) {
    showToast("Bạn không có quyền xóa bình luận này.", "error");
    return;
  }
  if (!window.confirm("Xóa bình luận này?")) return;

  try {
    const headers = await buildAuthHeaders();
    const response = await fetch(`${QA_ENDPOINT}/${postId}/comments/${commentId}`, {
      method: "DELETE",
      headers
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
    const tagsHtml = Array.isArray(post.tags) && post.tags.length
      ? `<div class="tag-row">${post.tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("")}</div>`
      : "";
    const deleteHtml = isAdminUser(state.user)
      ? `<button type="button" class="post-delete-btn" data-delete="${post.id}"><i class="fa-solid fa-trash"></i> Xóa</button>`
      : "";

    card.innerHTML = `
      <div class="post-author">
        <img src="${escapeHtml(post.author?.avatar || DEFAULT_AVATAR)}" alt="${escapeHtml(post.author?.name || "")}">
        <div>
          <strong>${escapeHtml(post.author?.name || "Thành viên TA-Edu")}</strong>
          <div class="post-meta">${formatTime(post.created_at)}${post.author?.role ? ` • ${escapeHtml(post.author.role)}` : ""}</div>
        </div>
      </div>
      <div class="post-topbar">
        <h3>${escapeHtml(post.title || "")}</h3>
        ${deleteHtml}
      </div>
      <div class="post-body">${formatBody(post.body)}</div>
      ${tagsHtml}
      ${post.image_url ? `<div class="post-image"><img src="${escapeHtml(post.image_url)}" alt="Ảnh bài viết"></div>` : ""}
      <div class="post-actions">
        <button type="button" data-like="${post.id}">
          <i class="fa${post.liked ? "s" : "r"} fa-heart"></i> ${likesLabel}
        </button>
        <span>${post.comments?.length || 0} bình luận</span>
      </div>
      <div class="comments">
        ${(post.comments || [])
          .map((comment) => `
            <div class="comment-item">
              <div class="comment-meta">
                <span>${escapeHtml(comment.author?.name || "Bạn học")} • ${formatTime(comment.created_at)}</span>
                ${isAdminUser(state.user) ? `<button type="button" class="comment-delete-btn" data-delete-comment="${post.id}:${comment.id}">Xóa</button>` : ""}
              </div>
              <div>${escapeHtml(comment.content || "")}</div>
            </div>
          `)
          .join("")}
        <div class="comment-input">
          <input type="text" placeholder="Viết bình luận..." data-comment-input="${post.id}" ${state.user ? "" : "disabled"}>
          <button type="button" class="btn btn-primary btn-mini" data-comment-send="${post.id}" ${state.user ? "" : "disabled"}>Gửi</button>
        </div>
      </div>
    `;

    card.querySelector(`[data-like="${post.id}"]`)?.addEventListener("click", () => handleLike(post.id));
    card.querySelector(`[data-delete="${post.id}"]`)?.addEventListener("click", () => handleDelete(post.id));
    card.querySelectorAll("[data-delete-comment]").forEach((button) => {
      button.addEventListener("click", () => {
        const [postId, commentId] = String(button.dataset.deleteComment || "").split(":").map(Number);
        if (postId && commentId) handleDeleteComment(postId, commentId);
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

    feedEl.appendChild(card);
  });
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
  if (!submit.dataset.originalText) {
    submit.dataset.originalText = submit.textContent;
  }
  submit.textContent = isLoading ? "Đang đăng..." : submit.dataset.originalText;
}

function resetComposerForm() {
  if (titleInput) titleInput.value = "";
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
    month: "short"
  });
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

function wireAuthTriggers(root = document) {
  root.querySelectorAll("[data-auth-action]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (btn.dataset.authAction === "login") await login();
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
