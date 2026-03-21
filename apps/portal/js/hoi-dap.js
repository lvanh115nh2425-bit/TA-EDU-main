import {
  auth,
  provider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "/js/core/firebase.js";
// Firestore import removed; posts now served via REST API.

const defaultAvatar = "assets/default_avatar.svg";
const weekdays = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const POSTS_LIMIT = 30;
function qaApiBase() {
  const candidate =
    window.__TAEDU_QA_API__ ||
    window.__TAEDU_API__ ||
    window.__TAEDU_ADMIN_API__ ||
    "http://localhost:4001";
  return candidate.replace(/\/$/, "");
}

const feedEl = document.getElementById("feed");
const askForm = document.getElementById("askForm");
const askAvatar = document.getElementById("askAvatar");
const authSlot = document.getElementById("authSlot");
const toast = document.getElementById("toast");



const state = {
  user: null,
  posts: [],
  loading: true,
  error: null
};

init();

function init() {
  if (askForm) askForm.addEventListener("submit", handleAskSubmit);
  wireAuthTriggers(document);
  fetchPosts();
  onAuthStateChanged(auth, handleAuthChange);
}

async function fetchPosts() {
  state.loading = true;
  renderFeed();
  try {
    const token = (await auth.currentUser?.getIdToken?.()) || undefined;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const base = qaApiBase();
    const res = await fetch(`${base}/api/qa?limit=${POSTS_LIMIT}`, { headers });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || "Cannot load posts");
    }
    const data = await res.json();
    state.posts = Array.isArray(data.posts) ? data.posts.map((post) => normalizePost(post.id, post)) : [];
    state.error = null;
  } catch (error) {
    console.error("[hoi-dap] Cannot load posts", error);
    state.error = "Không tải được danh sách câu hỏi.";
  } finally {
    state.loading = false;
    renderFeed();
  }
}

function normalizePost(data = {}) {
  return {
    id: data.id,
    title: data.title || "",
    body: data.body || "",
    tags: Array.isArray(data.tags) ? data.tags.filter(Boolean).slice(0, 8) : [],
    createdAt: data.created_at || data.createdAt || null,
    author: {
      name: data.author?.name || data.author_name || "Thành viên TA-Edu",
      avatar: data.author?.avatar || data.author_avatar || defaultAvatar,
      role: data.author?.role || data.author_role || ""
    },
    comments: Array.isArray(data.comments) ? data.comments.map(normalizeComment) : [],
  };
}

function normalizeComment(data = {}) {
  return {
    id: data.id,
    content: data.content || "",
    createdAt: data.created_at || data.createdAt || null,
    author: {
      name: data.author?.name || data.author_name || "Thành viên TA-Edu",
      avatar: data.author?.avatar || data.author_avatar || defaultAvatar,
      role: data.author?.role || data.author_role || ""
    },
  };
}

function handleAuthChange(user) {
  state.user = user;
  if (askAvatar) {
    askAvatar.src = user?.photoURL || defaultAvatar;
    askAvatar.alt = user?.displayName || user?.email || "Avatar người hỏi";
  }
  renderAuthSlot();
  updateFormAccess();
  fetchPosts();
}

function renderAuthSlot() {
  if (!authSlot) return;
  if (!state.user) {
    authSlot.innerHTML = `<button class="btn btn--primary" type="button" data-auth-action="login">Đăng nhập</button>`;
  } else {
    const name = state.user.displayName || state.user.email || "Người dùng";
    const role = getRoleDisplay(state.user);
    const avatar = state.user.photoURL || defaultAvatar;
    authSlot.innerHTML = `
      <div class="auth-user">
        <img src="${avatar}" alt="${escapeHtml(name)}">
        <div class="auth-user__meta">
          <span class="auth-user__name">${escapeHtml(name)}</span>
          <span class="auth-user__role">${escapeHtml(role)}</span>
        </div>
        <button class="btn btn--ghost" type="button" data-auth-action="logout">Đăng xuất</button>
      </div>
    `;
  }
  wireAuthTriggers(authSlot);
}

function renderFeed() {
  if (!feedEl) return;
  if (state.loading) {
    feedEl.innerHTML = `<div class="feed__loading">Đang tải câu hỏi...</div>`;
    return;
  }
  if (state.error) {
    feedEl.innerHTML = `<div class="empty-card">${escapeHtml(state.error)}</div>`;
    return;
  }
  if (!state.posts.length) {
    feedEl.innerHTML = `<div class="empty-card">Chưa có bài đăng nào. Hãy là người đầu tiên đặt câu hỏi!</div>`;
    return;
  }

  const markup = state.posts.map(buildPostHtml).join("");
  feedEl.innerHTML = markup;
  bindCommentForms();
  wireAuthTriggers(feedEl);
  updateFormAccess();
}

function buildPostHtml(post) {
  const title = escapeHtml(post.title || "");
  const body = escapeHtml(post.body || "");
  const postTime = formatDate(post.createdAt);
  const authorName = escapeHtml(post.author?.name || "Thành viên TA-Edu");
  const authorAvatar = post.author?.avatar || defaultAvatar;
  const authorRole = post.author?.role ? `${escapeHtml(post.author.role)} • ` : "";
  const tagsHtml = post.tags.length
    ? `<div class="tag-row">${post.tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
  const commentsHtml = renderComments(post.comments);

  return `
    <article class="post-card">
      <div class="post-head">
        <img src="${authorAvatar}" alt="${authorName}">
        <div class="post-head__meta">
          <div class="post-name">${authorName}</div>
          <div class="post-sub">${authorRole}${postTime}</div>
        </div>
      </div>
      <h3 class="post-title">${title}</h3>
      <p class="post-body">${body}</p>
      ${tagsHtml}
      <div class="post-stats">${post.comments.length} bình luận</div>
      ${commentsHtml}
      ${buildCommentForm(post.id)}
    </article>
  `;
}

function renderComments(comments = []) {
  if (!comments.length) {
    return `<div class="comment-list"><p class="hint">Chưa có bình luận nào.</p></div>`;
  }
  const sorted = [...comments].sort((a, b) => toJsDate(a.createdAt) - toJsDate(b.createdAt));
  return `<div class="comment-list">
    ${sorted
      .map((comment) => {
        const name = escapeHtml(comment.author?.name || "Thành viên TA-Edu");
        const avatar = comment.author?.avatar || defaultAvatar;
        const time = formatDate(comment.createdAt);
        const content = escapeHtml(comment.content || "");
        return `
          <div class="comment-item">
            <img src="${avatar}" alt="${name}">
            <div class="comment-body">
              <div class="comment-body__head">
                <span class="comment-name">${name}</span>
                <span class="comment-time">${time}</span>
              </div>
              <p>${content}</p>
            </div>
          </div>
        `;
      })
      .join("")}
  </div>`;
}

function buildCommentForm(postId) {
  const guardClass = state.user ? "hidden" : "";
  return `
    <form class="comment-form" data-auth-form data-post-id="${postId}">
      <textarea placeholder="Viết bình luận của bạn..." name="comment" required></textarea>
      <div class="comment-form__foot">
        <span class="hint">Shift + Enter để xuống dòng</span>
        <button class="btn btn--subtle" type="submit">Gửi bình luận</button>
      </div>
      <div class="auth-guard ${guardClass}">
        <p>Cần <button class="btn--text" type="button" data-auth-action="login">đăng nhập</button> để bình luận.</p>
      </div>
    </form>
  `;
}

function bindCommentForms() {
  const forms = feedEl?.querySelectorAll(".comment-form") || [];
  forms.forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      handleCommentSubmit(form);
    });
  });
}

async function handleAskSubmit(event) {
  event.preventDefault();
  if (!state.user) {
    showToast("Vui lòng đăng nhập để đăng câu hỏi", "error");
    return;
  }
  const formData = new FormData(askForm);
  const title = (formData.get("title") || "").trim();
  const details = (formData.get("details") || "").trim();
  const tags = (formData.get("tags") || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (!title || !details) {
    showToast("Thiếu tiêu đề hoặc nội dung", "error");
    return;
  }

  toggleFormLoading(askForm, true, "Đang đăng...");
  try {
    const token = await state.user.getIdToken();
    const res = await fetch(`${qaApiBase()}/api/qa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ title, body: details, tags })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || "qa_create_failed");
    }
    askForm.reset();
    showToast("Đã đăng câu hỏi", "success");
    fetchPosts();
  } catch (error) {
    console.error("[hoi-dap] Cannot create post", error);
    showToast("Không thể đăng câu hỏi", "error");
  } finally {
    toggleFormLoading(askForm, false);
  }
}

async function handleCommentSubmit(form) {
  if (!state.user) {
    showToast("Vui lòng đăng nhập để bình luận", "error");
    return;
  }
  const textarea = form.querySelector("textarea");
  const content = (textarea?.value || "").trim();
  if (!content) {
    showToast("Nội dung bình luận trống", "error");
    return;
  }
  const postId = form.dataset.postId;
  if (!postId) return;

  toggleFormLoading(form, true, "Đang gửi...");
  try {
    const token = await state.user.getIdToken();
    const res = await fetch(`${qaApiBase()}/api/qa/${postId}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ content })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || "comment_failed");
    }
    textarea.value = "";
    showToast("Đã gửi bình luận", "success");
    fetchPosts();
  } catch (error) {
    console.error("[hoi-dap] Cannot add comment", error);
    showToast("Không thể gửi bình luận", "error");
  } finally {
    toggleFormLoading(form, false);
  }
}


function updateFormAccess() {
  const forms = document.querySelectorAll("[data-auth-form]");
  forms.forEach((form) => {
    const guard = form.querySelector(".auth-guard");
    if (guard) guard.classList.toggle("hidden", !!state.user);
    const shouldDisable = !state.user || form.dataset.loading === "true";
    form.querySelectorAll("input, textarea").forEach((control) => {
      control.disabled = shouldDisable;
    });
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = shouldDisable;
  });
}

function toggleFormLoading(form, isLoading, loadingText) {
  if (!form) return;
  form.dataset.loading = isLoading ? "true" : "false";
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) {
    if (isLoading) {
      submitBtn.dataset.defaultText = submitBtn.textContent;
      if (loadingText) submitBtn.textContent = loadingText;
    } else if (submitBtn.dataset.defaultText) {
      submitBtn.textContent = submitBtn.dataset.defaultText;
    }
  }
  updateFormAccess();
}

function wireAuthTriggers(root = document) {
  if (!root) return;
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
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("[hoi-dap] Login failed", error);
    showToast("Không thể đăng nhập. Thử lại sau.", "error");
  }
}

async function logout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("[hoi-dap] Logout failed", error);
    showToast("Không thể đăng xuất", "error");
  }
}

function showToast(message, type) {
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast is-visible ${type === "success" ? "success" : ""} ${type === "error" ? "error" : ""}`.trim();
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2400);
}

function formatDate(rawDate) {
  const date = toJsDate(rawDate);
  const time = date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const weekday = weekdays[date.getDay()] || "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${time}, ${weekday} (${day}/${month}/${year})`;
}

function toJsDate(value) {
  if (!value) return new Date();
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
}

function escapeHtml(input = "") {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getRoleDisplay(user) {
  if (!user) return "Thành viên TA-Edu";
  try {
    return localStorage.getItem(`taedu:role:${user.uid}`) || "Thành viên TA-Edu";
  } catch (error) {
    console.warn("[hoi-dap] Cannot read role from storage", error);
    return "Thành viên TA-Edu";
  }
}

