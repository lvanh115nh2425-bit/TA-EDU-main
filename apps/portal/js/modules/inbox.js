import { auth } from "../core/firebase.js";
import {
  getInboxConversations,
  getInboxAdmins,
  searchInboxUsers,
  createInboxConversation,
  getInboxMessages,
  sendInboxMessage,
  markInboxConversationRead,
  toggleInboxConversationPin,
  submitUserReport,
} from "../utils/api.js?v=20260326b";

const DEFAULT_AVATAR = "assets/default_avatar.svg";
const POLL_INTERVAL = 12000;
const ADMIN_EMAILS = ["khkt.anhtu@gmail.com", "lvanh.115nh2425@gmail.com"];

const state = {
  user: null,
  admins: [],
  conversations: [],
  activeConversationId: null,
  activeMessages: [],
  searchTimer: null,
  pollTimer: null,
};

const els = {};

function $(selector) {
  return document.querySelector(selector);
}

function cacheEls() {
  els.guest = $("#inboxGuestState");
  els.content = $("#inboxContent");
  els.loginButton = $("#inboxLoginButton");
  els.searchInput = $("#inboxUserSearch");
  els.searchHint = $("#inboxSearchHint");
  els.searchResults = $("#inboxSearchResults");
  els.adminList = $("#inboxAdminList");
  els.conversationList = $("#inboxConversationList");
  els.refreshButton = $("#refreshInboxButton");
  els.peerAvatar = $("#inboxPeerAvatar");
  els.peerName = $("#inboxPeerName");
  els.peerMeta = $("#inboxPeerMeta");
  els.pinButton = $("#inboxPinButton");
  els.messages = $("#inboxMessages");
  els.composer = $("#inboxComposer");
  els.messageInput = $("#inboxMessageInput");
  els.sendButton = $("#inboxSendButton");
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatConversationTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = now.toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isAdminPeer(profile) {
  const role = String(profile?.role || "").toLowerCase();
  const email = String(profile?.email || "").toLowerCase();
  return role === "admin" || ADMIN_EMAILS.includes(email);
}

async function getToken() {
  const user = state.user || auth.currentUser || window.__TAEDU_LAST_USER;
  if (!user) throw new Error("missing_user");
  return user.getIdToken();
}

function setGuestMode(isGuest) {
  if (els.guest) els.guest.hidden = !isGuest;
  if (els.content) els.content.hidden = isGuest;
}

function openAuthModal() {
  const loginButton = document.querySelector("#btnLogin");
  if (loginButton) {
    loginButton.click();
  } else {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function getConversationById(conversationId) {
  return state.conversations.find((item) => item.id === conversationId) || null;
}

function renderStatus(message, type = "") {
  if (!els.messages) return;
  els.messages.innerHTML = `<div class="inbox-status ${type ? `is-${type}` : ""}">${escapeHtml(message)}</div>`;
}

function renderAdminList() {
  if (!els.adminList) return;
  if (!state.admins.length) {
    els.adminList.innerHTML = `<div class="inbox-admin__empty">Chưa có admin nào sẵn sàng để nhắn tin.</div>`;
    return;
  }

  els.adminList.innerHTML = state.admins
    .map(
      (admin) => `
        <button type="button" class="inbox-admin-card" data-admin-uid="${escapeHtml(admin.uid)}">
          <img src="${escapeHtml(admin.photo_url || DEFAULT_AVATAR)}" alt="${escapeHtml(admin.display_name || "Admin")}">
          <div class="inbox-admin-card__body">
            <strong>${escapeHtml(admin.display_name || "Admin")}</strong>
            <span>${escapeHtml(admin.email || admin.full_name || "Quản trị viên TA-Edu")}</span>
          </div>
          <span class="inbox-admin-card__action">Nhắn</span>
        </button>
      `
    )
    .join("");

  els.adminList.querySelectorAll("[data-admin-uid]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetUid = button.getAttribute("data-admin-uid");
      if (!targetUid) return;
      await createConversationAndOpen(targetUid);
    });
  });
}

function renderSearchResults(users = []) {
  if (!els.searchResults) return;
  if (!users.length) {
    els.searchResults.innerHTML = "";
    return;
  }

  els.searchResults.innerHTML = users
    .map(
      (user) => `
        <button type="button" class="inbox-user-result" data-user-uid="${escapeHtml(user.uid)}">
          <img class="inbox-user-result__avatar" src="${escapeHtml(user.photo_url || DEFAULT_AVATAR)}" alt="${escapeHtml(user.display_name || "Người dùng")}">
          <div class="inbox-user-result__body">
            <p class="inbox-user-result__name">${escapeHtml(user.display_name || "Người dùng")}</p>
            <p class="inbox-user-result__meta">${escapeHtml(user.email || user.full_name || "Bắt đầu trò chuyện")}</p>
          </div>
          <span class="inbox-user-result__action">Nhắn tin</span>
        </button>
      `
    )
    .join("");

  els.searchResults.querySelectorAll("[data-user-uid]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetUid = button.getAttribute("data-user-uid");
      if (!targetUid) return;
      await createConversationAndOpen(targetUid);
    });
  });
}

function renderConversationList() {
  if (!els.conversationList) return;
  if (!state.conversations.length) {
    els.conversationList.innerHTML = `
      <div class="inbox-empty-state">
        <h2>Chưa có cuộc trò chuyện nào</h2>
        <p>Tìm một người dùng hoặc chọn admin ở trên để bắt đầu nhắn tin.</p>
      </div>
    `;
    return;
  }

  els.conversationList.innerHTML = state.conversations
    .map((conversation) => {
      const peer = conversation.peer || {};
      const isActive = conversation.id === state.activeConversationId;
      const pinnedClass = conversation.pinned ? "is-pinned" : "";
      const unreadBadge = conversation.unread_count
        ? `<span class="inbox-conversation-item__badge">${conversation.unread_count}</span>`
        : "";
      return `
        <button type="button" class="inbox-conversation-item ${isActive ? "is-active" : ""} ${pinnedClass}" data-conversation-id="${conversation.id}">
          <img class="inbox-conversation-item__avatar" src="${escapeHtml(peer.photo_url || DEFAULT_AVATAR)}" alt="${escapeHtml(peer.display_name || "Người dùng")}">
          <div class="inbox-conversation-item__body">
            <div class="inbox-conversation-item__top">
              <p class="inbox-conversation-item__name">${escapeHtml(peer.display_name || "Người dùng")}</p>
              <span class="inbox-conversation-item__time">${escapeHtml(formatConversationTime(conversation.updated_at))}</span>
            </div>
            <p class="inbox-conversation-item__preview">${escapeHtml(conversation.last_message_preview || "Chưa có tin nhắn")}</p>
          </div>
          <div class="inbox-conversation-item__aside">
            <button type="button" class="inbox-conversation-item__pin ${conversation.pinned ? "is-pinned" : ""}" data-pin-conversation="${conversation.id}" aria-label="${conversation.pinned ? "Bỏ ghim" : "Ghim"}">
              <i class="fa-solid fa-thumbtack"></i>
            </button>
            ${unreadBadge}
          </div>
        </button>
      `;
    })
    .join("");

  els.conversationList.querySelectorAll("[data-conversation-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      if (event.target.closest("[data-pin-conversation]")) return;
      const conversationId = Number(button.getAttribute("data-conversation-id"));
      if (!conversationId) return;
      await openConversation(conversationId);
    });
  });

  els.conversationList.querySelectorAll("[data-pin-conversation]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const conversationId = Number(button.getAttribute("data-pin-conversation"));
      if (!conversationId) return;
      await togglePin(conversationId);
    });
  });
}

function renderActiveConversationHeader(conversation) {
  const peer = conversation?.peer || {};
  if (els.peerAvatar) els.peerAvatar.src = peer.photo_url || DEFAULT_AVATAR;
  if (els.peerName) els.peerName.textContent = peer.display_name || "Chưa chọn cuộc trò chuyện";
  if (els.peerMeta) {
    const role = peer.role ? String(peer.role) : "Người dùng TA-Edu";
    const detail = [peer.full_name || "", peer.email || "", role].filter(Boolean).join(" • ");
    els.peerMeta.textContent = detail || "Bắt đầu trò chuyện riêng an toàn trong TA-Edu.";
  }
  if (els.pinButton) {
    if (!conversation) {
      els.pinButton.hidden = true;
    } else {
      els.pinButton.hidden = false;
      els.pinButton.dataset.conversationId = String(conversation.id);
      els.pinButton.classList.toggle("is-pinned", !!conversation.pinned);
      els.pinButton.querySelector("span").textContent = conversation.pinned ? "Đã ghim" : "Ghim lên đầu";
    }
  }
}

function renderMessages() {
  if (!els.messages) return;
  if (!state.activeConversationId) {
    els.messages.innerHTML = `
      <div class="inbox-empty-state">
        <h2>Chọn một cuộc trò chuyện</h2>
        <p>Bạn có thể tìm người dùng ở cột bên trái để mở hội thoại mới.</p>
      </div>
    `;
    return;
  }

  if (!state.activeMessages.length) {
    els.messages.innerHTML = `
      <div class="inbox-empty-state">
        <h2>Chưa có tin nhắn nào</h2>
        <p>Hãy gửi lời chào đầu tiên để bắt đầu cuộc trò chuyện.</p>
      </div>
    `;
    return;
  }

  els.messages.innerHTML = state.activeMessages
    .map((message) => {
      const sender = message.sender || {};
      const isSelf = message.sender_uid === state.user?.uid;
      return `
        <article class="inbox-message ${isSelf ? "is-self" : ""}">
          <img class="inbox-message__avatar" src="${escapeHtml(sender.photo_url || DEFAULT_AVATAR)}" alt="${escapeHtml(sender.display_name || "Người dùng")}">
          <div class="inbox-message__bubble">
            <div class="inbox-message__meta">
              <span>${escapeHtml(sender.display_name || "Người dùng")}</span>
              <span>•</span>
              <span>${escapeHtml(formatDateTime(message.created_at))}</span>
            </div>
            <div class="inbox-message__content">${escapeHtml(message.content)}</div>
          </div>
        </article>
      `;
    })
    .join("");
  els.messages.scrollTop = els.messages.scrollHeight;

  const messageEls = Array.from(els.messages.querySelectorAll(".inbox-message"));
  messageEls.forEach((el, index) => {
    const message = state.activeMessages[index];
    if (!message || message.sender_uid === state.user?.uid) return;
    const meta = el.querySelector(".inbox-message__meta");
    if (!meta) return;
    if (meta.querySelector(".inbox-message__report")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "inbox-message__report";
    btn.textContent = "Tố cáo";
    btn.addEventListener("click", async () => handleReportMessage(message));
    meta.appendChild(btn);
  });
}

async function handleReportMessage(message) {
  if (!state.user) {
    renderStatus("Vui lòng đăng nhập để gửi tố cáo.", "error");
    return;
  }
  const reason = window.prompt("Lý do tố cáo tin nhắn này?");
  if (!reason) return;
  const detail = window.prompt("Mô tả thêm (tùy chọn):") || "";
  try {
    const token = await getToken();
    const conversation = getConversationById(state.activeConversationId);
    const sender = message.sender || {};
    const payload = {
      category: "Tin nhắn",
      reason,
      content: detail,
      reporterName: state.user.displayName || state.user.email || "",
      reporterEmail: state.user.email || "",
      reportedId: sender.uid || message.sender_uid || "",
      reportedName: sender.display_name || sender.full_name || "",
      reportedEmail: sender.email || "",
      targetType: "message",
      targetId: message.id,
      payload: {
        conversationId: conversation?.id || null,
        messageId: message.id,
        messageContent: message.content || "",
        conversationPeer: conversation?.peer || null,
      },
    };
    await submitUserReport(token, payload);
    window.alert("Đã gửi tố cáo. Cảm ơn bạn!");
  } catch (err) {
    console.error("Report message failed", err);
    window.alert(err.message || "Không thể gửi tố cáo.");
  }
}

function updateComposerState(enabled) {
  if (els.messageInput) els.messageInput.disabled = !enabled;
  if (els.sendButton) els.sendButton.disabled = !enabled;
}

async function loadAdmins() {
  const token = await getToken();
  const response = await getInboxAdmins(token);
  state.admins = response?.admins || [];
  renderAdminList();
}

async function loadConversations({ preserveActive = true } = {}) {
  const token = await getToken();
  const response = await getInboxConversations(token);
  state.conversations = (response?.conversations || []).sort((a, b) => {
    const aAdmin = isAdminPeer(a?.peer);
    const bAdmin = isAdminPeer(b?.peer);
    if (aAdmin !== bAdmin) return aAdmin ? -1 : 1;
    if (Boolean(a?.pinned) !== Boolean(b?.pinned)) return a?.pinned ? -1 : 1;
    return new Date(b?.updated_at || 0).getTime() - new Date(a?.updated_at || 0).getTime();
  });
  const activeExists = state.conversations.some((item) => item.id === state.activeConversationId);
  if (!preserveActive || !activeExists) {
    state.activeConversationId = state.conversations[0]?.id || null;
  }
  renderConversationList();

  const active = getConversationById(state.activeConversationId);
  renderActiveConversationHeader(active);
  updateComposerState(Boolean(active));
  return active;
}

async function loadMessages(conversationId) {
  const token = await getToken();
  const response = await getInboxMessages(token, conversationId);
  state.activeMessages = response?.messages || [];
  renderMessages();
  await markInboxConversationRead(token, conversationId);
}

async function openConversation(conversationId) {
  state.activeConversationId = conversationId;
  renderConversationList();
  const active = getConversationById(conversationId);
  renderActiveConversationHeader(active);
  updateComposerState(Boolean(active));
  await loadMessages(conversationId);
  await loadConversations({ preserveActive: true });
}

async function createConversationAndOpen(targetUid) {
  const token = await getToken();
  const response = await createInboxConversation(token, targetUid);
  const createdConversation = response?.conversation;
  await loadConversations({ preserveActive: false });
  if (els.searchResults) els.searchResults.innerHTML = "";
  if (els.searchInput) els.searchInput.value = "";
  if (createdConversation?.id) {
    await openConversation(createdConversation.id);
  }
}

async function performUserSearch(keyword) {
  const trimmed = String(keyword || "").trim();
  if (els.searchHint) {
    els.searchHint.textContent = trimmed
      ? "Chọn người dùng phù hợp để mở cuộc trò chuyện mới."
      : "Nhập ít nhất 1 ký tự để tìm người dùng.";
  }
  if (!trimmed) {
    renderSearchResults([]);
    return;
  }

  try {
    const token = await getToken();
    const response = await searchInboxUsers(token, trimmed);
    renderSearchResults(response?.users || []);
  } catch (err) {
    console.error("Inbox search failed", err);
    if (els.searchHint) els.searchHint.textContent = "Không tìm được người dùng. Vui lòng thử lại.";
  }
}

async function togglePin(conversationId) {
  const conversation = getConversationById(conversationId);
  if (!conversation) return;
  try {
    const token = await getToken();
    await toggleInboxConversationPin(token, conversationId, !conversation.pinned);
    await loadConversations({ preserveActive: true });
    if (state.activeConversationId === conversationId) {
      renderActiveConversationHeader(getConversationById(conversationId));
    }
  } catch (err) {
    console.error("Toggle inbox pin failed", err);
  }
}

function bindSearch() {
  if (!els.searchInput) return;
  els.searchInput.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    const keyword = els.searchInput.value;
    state.searchTimer = setTimeout(() => {
      performUserSearch(keyword);
    }, 240);
  });
}

function startPolling() {
  stopPolling();
  state.pollTimer = window.setInterval(async () => {
    if (!state.user) return;
    try {
      await loadConversations({ preserveActive: true });
      if (state.activeConversationId) {
        await loadMessages(state.activeConversationId);
      }
    } catch (_) {}
  }, POLL_INTERVAL);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function bootstrapInboxForUser(user) {
  state.user = user;
  setGuestMode(false);
  try {
    await loadAdmins();
    const active = await loadConversations({ preserveActive: true });
    if (active?.id) {
      await openConversation(active.id);
    } else {
      state.activeMessages = [];
      renderMessages();
      renderActiveConversationHeader(null);
      updateComposerState(false);
    }
    startPolling();
  } catch (err) {
    console.error("Inbox bootstrap failed", err);
    renderStatus("Không thể tải inbox lúc này. Vui lòng thử lại sau.", "error");
  }
}

function bindComposer() {
  if (!els.composer) return;

  els.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.activeConversationId || !state.user) return;
    const content = String(els.messageInput?.value || "").trim();
    if (!content) return;
    try {
      const token = await getToken();
      await sendInboxMessage(token, state.activeConversationId, content);
      if (els.messageInput) {
        els.messageInput.value = "";
        els.messageInput.focus();
      }
      await loadConversations({ preserveActive: true });
      await loadMessages(state.activeConversationId);
    } catch (err) {
      console.error("Send inbox message failed", err);
      renderStatus("Không thể gửi tin nhắn. Vui lòng thử lại.", "error");
    }
  });

  els.messageInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.composer?.requestSubmit();
    }
  });
}

function bindActions() {
  els.refreshButton?.addEventListener("click", async () => {
    if (!state.user) return;
    await loadAdmins();
    await loadConversations({ preserveActive: true });
    if (state.activeConversationId) {
      await loadMessages(state.activeConversationId);
    }
  });

  els.loginButton?.addEventListener("click", openAuthModal);

  els.pinButton?.addEventListener("click", async () => {
    const conversationId = Number(els.pinButton?.dataset.conversationId || 0);
    if (!conversationId) return;
    await togglePin(conversationId);
  });
}

function watchAuth() {
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      stopPolling();
      state.user = null;
      state.admins = [];
      state.conversations = [];
      state.activeConversationId = null;
      state.activeMessages = [];
      setGuestMode(true);
      renderAdminList();
      renderConversationList();
      renderMessages();
      renderActiveConversationHeader(null);
      updateComposerState(false);
      return;
    }

    await bootstrapInboxForUser(user);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  cacheEls();
  bindSearch();
  bindComposer();
  bindActions();
  watchAuth();
});
