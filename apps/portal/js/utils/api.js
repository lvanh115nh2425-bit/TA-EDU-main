const DEFAULT_BASE =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:4001"
    : "/api";
const RAW_BASE = window.__TAEDU_API__ || window.__TAEDU_ADMIN_API__ || DEFAULT_BASE;
const BASE = String(RAW_BASE || "").replace(/\/+$/, "");

function buildUrl(path) {
  const normalizedPath = `/${String(path || "").replace(/^\/+/, "")}`;
  if (BASE.endsWith("/api") && normalizedPath.startsWith("/api/")) {
    return `${BASE}${normalizedPath.slice(4)}`;
  }
  return `${BASE}${normalizedPath}`;
}

async function apiFetch(path, options = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, options.headers);
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const res = await fetch(buildUrl(path), {
    ...options,
    headers,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    const rawText = await res.text().catch(() => "");
    if (rawText) {
      try {
        const data = JSON.parse(rawText);
        message = data.error || message;
      } catch (err) {
        message = rawText;
      }
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export async function getProfile(token) {
  return apiFetch("/api/profile/me", { token });
}

export async function updateProfile(token, payload) {
  return apiFetch("/api/profile/me", { method: "PUT", body: JSON.stringify(payload), token });
}

export async function submitKyc(token, payload) {
  return apiFetch("/api/kyc/submit", { method: "POST", body: JSON.stringify(payload), token });
}

export async function submitUserReport(token, payload) {
  return apiFetch("/api/reports/submit", { method: "POST", body: JSON.stringify(payload), token });
}

export async function getInboxConversations(token) {
  return apiFetch("/api/inbox/conversations", { token });
}

export async function getInboxSummary(token) {
  return apiFetch("/api/inbox/summary", { token });
}

export async function getInboxAdmins(token) {
  return apiFetch("/api/inbox/admins", { token });
}

export async function searchInboxUsers(token, keyword) {
  const query = encodeURIComponent(String(keyword || "").trim());
  return apiFetch(`/api/inbox/users?q=${query}`, { token });
}

export async function createInboxConversation(token, targetUid) {
  return apiFetch("/api/inbox/conversations", {
    method: "POST",
    body: JSON.stringify({ targetUid }),
    token,
  });
}

export async function getInboxMessages(token, conversationId) {
  return apiFetch(`/api/inbox/conversations/${conversationId}/messages`, { token });
}

export async function sendInboxMessage(token, conversationId, content) {
  return apiFetch(`/api/inbox/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
    token,
  });
}

export async function markInboxConversationRead(token, conversationId) {
  return apiFetch(`/api/inbox/conversations/${conversationId}/read`, {
    method: "POST",
    body: JSON.stringify({}),
    token,
  });
}

export async function toggleInboxConversationPin(token, conversationId, pinned) {
  return apiFetch(`/api/inbox/conversations/${conversationId}/pin`, {
    method: "POST",
    body: JSON.stringify({ pinned: !!pinned }),
    token,
  });
}
