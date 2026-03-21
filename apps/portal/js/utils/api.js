const BASE = window.__TAEDU_API__ || window.__TAEDU_ADMIN_API__ || "http://localhost:4001";

async function apiFetch(path, options = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, options.headers);
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch (err) {
      message = await res.text();
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
