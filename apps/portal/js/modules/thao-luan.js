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

const feedEl = document.getElementById("discussionFeed");
const formEl = document.getElementById("postForm");
const titleInput = document.getElementById("postTitle");
const bodyInput = document.getElementById("postBody");
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
  { title: "Chia sẻ giáo trình yêu thích", snippet: "Cùng cập nhật tài liệu học hay" },
  { title: "Hỏi đáp mẹo học nhanh", snippet: "Đặt câu hỏi và nhận phản hồi nhanh" },
  { title: "Tạo nhóm học trực tuyến", snippet: "Kết nối bạn học, tạo động lực" }
];

init();

function init() {
  readRedirectLoginResult().catch((error) => {
    console.error("redirect login failed", error);
    showToast(mapFirebaseAuthError(error));
  });
  wireAuthTriggers();
  if (imageInput) {
    imageInput.addEventListener("change", handleImageSelect);
  }
  if (removeImageBtn) {
    removeImageBtn.addEventListener("click", clearImagePreview);
  }
  if (formEl) {
    formEl.addEventListener("submit", handleSubmit);
  }
  if (postModalBackdrop) {
    postModalBackdrop.addEventListener("click", closePostModal);
  }
  document.querySelectorAll("[data-post-modal=\"close\"]").forEach((btn) => {
    btn.addEventListener("click", closePostModal);
  });
  composerButtons.forEach((btn) => {
    btn.addEventListener("click", () => openPostModal());
  });
  onAuthStateChanged(auth, (user) => {
    state.user = user;
    updateAuthUI();
    loadPosts();
  });
  loadPosts();
}

function handleImageSelect() {
  const file = imageInput.files?.[0];
  if (!file) {
    clearImagePreview();
    return;
  }
  // Show preview & store data
  const reader = new FileReader();
  reader.onload = (e) => {
    const result = e.target.result;
    state.imageData = typeof result === "string" ? result : null;
    if (imagePreview) imagePreview.src = result;
    if (imagePreviewContainer) imagePreviewContainer.hidden = false;
    // Hide file input label when preview is shown
    if (fileNameEl && fileNameEl.parentElement) {
      fileNameEl.parentElement.style.display = 'none';
    }
    if (fileNameEl) fileNameEl.textContent = file.name;
  };
  reader.readAsDataURL(file);
}

function clearImagePreview() {
  state.imageData = null;
  imageInput.value = "";
  if (fileNameEl) fileNameEl.textContent = "Thêm hình ảnh";
  if (imagePreview) imagePreview.src = "";
  if (imagePreviewContainer) imagePreviewContainer.hidden = true;
  // Show file input label again
  if (fileNameEl && fileNameEl.parentElement) {
    fileNameEl.parentElement.style.display = 'inline-flex';
  }
}

function updateAuthUI() {
  if (!authSlot) return;
  if (!state.user) {
    authSlot.innerHTML = `<button class="btn btn-primary" type="button" data-auth-action="login">Đăng nhập</button>`;
    authGuard?.classList.remove("hidden");
    composerButtons.forEach((btn) => (btn.disabled = true));
  } else {
    const name = state.user.displayName || state.user.email || "Bạn";
    authSlot.innerHTML = `<span>Xin chào, ${escapeHtml(name)}</span>`;
    authGuard?.classList.add("hidden");
    composerButtons.forEach((btn) => (btn.disabled = false));
    if (composerAvatar && state.user.photoURL) {
      composerAvatar.src = state.user.photoURL;
    }
  }
  wireAuthTriggers();
}

async function loadPosts() {
  state.loading = true;
  renderFeed();
  try {
    const headers = await buildAuthHeaders();
    const res = await fetch(`${QA_ENDPOINT}?limit=30`, { headers });
    if (!res.ok) throw new Error("Không tải được bài viết");
    const data = await res.json();
    state.posts = Array.isArray(data.posts) ? data.posts : [];
    renderSuggestions();
  } catch (err) {
    showToast(err.message || "Không thể tải danh sách thảo luận");
    state.posts = [];
    renderSuggestions(true);
  } finally {
    state.loading = false;
    renderFeed();
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!state.user) {
    showToast("Vui lòng đăng nhập để đăng bài.");
    return;
  }
  const title = titleInput?.value.trim();
  const body = bodyInput?.value.trim();
  if (!title || !body) {
    showToast("Nhập tiêu đề và nội dung bài viết.");
    return;
  }
  try {
    const headers = await buildAuthHeaders();
    const payload = { title, body };
    if (state.imageData) payload.imageData = state.imageData;
    const res = await fetch(QA_ENDPOINT, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Đăng bài thất bại");
    }
    titleInput.value = "";
    bodyInput.value = "";
    if (imageInput) {
      imageInput.value = "";
      state.imageData = null;
      fileNameEl.textContent = "Thêm hình ảnh";
    }
    closePostModal();
    showToast("Đã đăng bài mới.");
    await loadPosts();
  } catch (err) {
    console.error(err);
    showToast(err.message || "Không thể đăng bài.");
  }
}

function openPostModal() {
  if (!state.user) {
    showToast("Đăng nhập để chia sẻ bài viết.");
    return;
  }
  if (postModalBackdrop) postModalBackdrop.hidden = false;
  if (postModal) postModal.hidden = false;
}

function closePostModal() {
  if (postModalBackdrop) postModalBackdrop.hidden = true;
  if (postModal) postModal.hidden = true;
  clearImagePreview();
}

async function handleLike(postId) {
  if (!state.user) {
    showToast("Đăng nhập để bày tỏ cảm xúc.");
    return;
  }
  try {
    const headers = await buildAuthHeaders();
    const res = await fetch(`${QA_ENDPOINT}/${postId}/like`, {
      method: "POST",
      headers
    });
    if (!res.ok) throw new Error("Không thể cập nhật lượt thích");
    const data = await res.json();
    const target = state.posts.find((p) => p.id === postId);
    if (target) {
      target.likes = data.likes;
      target.liked = data.liked;
      renderFeed();
    }
  } catch (err) {
    showToast(err.message || "Lỗi khi bày tỏ cảm xúc.");
  }
}

async function handleComment(postId, inputEl) {
  if (!state.user) {
    showToast("Đăng nhập để bình luận.");
    return;
  }
  const content = inputEl.value.trim();
  if (!content) return;
  try {
    const headers = await buildAuthHeaders();
    const res = await fetch(`${QA_ENDPOINT}/${postId}/comments`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error("Không thể gửi bình luận");
    inputEl.value = "";
    const { comment } = await res.json();
    const target = state.posts.find((p) => p.id === postId);
    if (target) {
      target.comments = [...(target.comments || []), comment];
      renderFeed();
    }
  } catch (err) {
    showToast(err.message || "Lỗi bình luận.");
  }
}

function renderFeed() {
  if (!feedEl) return;
  if (state.loading) {
    feedEl.innerHTML = `<div class="discussion-card empty-feed">Đang tải bài viết...</div>`;
    return;
  }
  if (!state.posts.length) {
    feedEl.innerHTML = `<div class="discussion-card empty-feed">Chưa có bài viết nào. Hãy là người đầu tiên chia sẻ!</div>`;
    return;
  }
  feedEl.innerHTML = "";
  state.posts.forEach((post) => {
    const card = document.createElement("article");
    card.className = "discussion-post";
    const likesLabel = post.likes === 1 ? "1 lượt thích" : `${post.likes || 0} lượt thích`;
    card.innerHTML = `
      <div class="post-author">
        <img src="${escapeHtml(post.author?.avatar || "/assets/default_avatar.svg")}" alt="${escapeHtml(post.author?.name || "")}">
        <div>
          <strong>${escapeHtml(post.author?.name || "Thành viên TA-Edu")}</strong>
          <div class="post-meta">${formatTime(post.created_at)}</div>
        </div>
      </div>
      <h3>${escapeHtml(post.title || "")}</h3>
      <div class="post-body">${formatBody(post.body)}</div>
      ${post.image_url ? `<div class="post-image"><img src="${escapeHtml(post.image_url)}" alt="Ảnh bài viết"></div>` : ""}
      <div class="post-actions">
        <button type="button" data-like="${post.id}">
          <i class="fa${post.liked ? "s" : "r"} fa-heart"></i> ${likesLabel}
        </button>
        <span>${post.comments?.length || 0} bình luận</span>
      </div>
      <div class="comments" id="comments-${post.id}">
        ${(post.comments || [])
          .map((c) => `
            <div class="comment-item">
              <div class="comment-meta">${escapeHtml(c.author?.name || "Bạn học")} • ${formatTime(c.created_at)}</div>
              <div>${escapeHtml(c.content || "")}</div>
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
    const input = card.querySelector(`[data-comment-input="${post.id}"]`);
    const sendBtn = card.querySelector(`[data-comment-send="${post.id}"]`);
    if (input && sendBtn) {
      sendBtn.addEventListener("click", () => handleComment(post.id, input));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
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
    const snippet = item.snippet || (item.body ? item.body.slice(0, 80) : "");
    const likes = typeof item.likes === "number" ? `<span>${item.likes} lượt thích</span>` : "";
    li.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(snippet)}</p>${likes}`;
    suggestionsEl.appendChild(li);
  });
}

function formatBody(text = "") {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
}

async function buildAuthHeaders() {
  const token = await auth.currentUser?.getIdToken?.();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function escapeHtml(text = "") {
  const span = document.createElement("span");
  span.textContent = text;
  return span.innerHTML;
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("is-visible");
  setTimeout(() => toastEl.classList.remove("is-visible"), 2500);
}

function wireAuthTriggers(root = document) {
  root.querySelectorAll("[data-auth-action]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      const action = btn.dataset.authAction;
      if (action === "login") await login();
      if (action === "logout") await logout();
    });
  });
}

async function login() {
  try {
    const result = await loginWithGoogle();
    if (!result) {
      showToast("Dang chuyen sang Google de dang nhap...");
    }
  } catch (error) {
    console.error("login failed", error);
    return showToast(mapFirebaseAuthError(error));
    showToast("Không thể đăng nhập.");
  }
}

async function logout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("logout failed", error);
    showToast("Không thể đăng xuất.");
  }
}
