const API_BASE = window.__TAEDU_ADMIN_API__ || "http://localhost:4001";
const tokenKey = "taedu-admin-token";
const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
});

const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");
const loginForm = document.getElementById("adminLoginForm");
const authError = document.getElementById("authError");
const adminWelcome = document.getElementById("adminWelcome");
const statusFilter = document.getElementById("statusFilter");
const pageSizeSelect = document.getElementById("pageSizeSelect");
const searchInput = document.getElementById("searchInput");
const btnRefresh = document.getElementById("btnRefresh");
const btnExport = document.getElementById("btnExport");
const btnLogout = document.getElementById("btnLogout");
const tableBody = document.getElementById("kycTableBody");
const dashboardMessage = document.getElementById("dashboardMessage");
const sidebar = document.getElementById("adminSidebar");
const headerStatus = document.getElementById("headerStatus");
const metricPending = document.getElementById("metricPending");
const metricApproved = document.getElementById("metricApproved");
const metricRejected = document.getElementById("metricRejected");
const metricTotal = document.getElementById("metricTotal");
const paginationInfo = document.getElementById("paginationInfo");
const btnPrevPage = document.getElementById("btnPrevPage");
const btnNextPage = document.getElementById("btnNextPage");
const navButtons = document.querySelectorAll(".nav-item[data-tab]");
const layout = document.querySelector(".admin-layout");
const historyDialog = document.getElementById("historyDialog");
const historyTimeline = document.getElementById("historyTimeline");
const historyDialogSubtitle = document.getElementById("historyDialogSubtitle");
const btnCloseHistory = document.getElementById("btnCloseHistory");
const btnExportHistory = document.getElementById("btnExportHistory");

const state = {
  token: localStorage.getItem(tokenKey) || "",
  requests: [],
  search: "",
  status: "all",
  page: 1,
  pageSize: 25,
  total: 0,
  pageCount: 0,
  hasNext: false,
  hasPrev: false,
  stats: { total: 0, submitted: 0, approved: 0, rejected: 0 },
  historyCache: new Map(),
  historyDialogRequestId: null,
};

function setSidebarVisible(visible) {
  if (sidebar) sidebar.hidden = !visible;
  if (layout) layout.classList.toggle("is-auth", !!visible);
}

function setHeaderStatus(online) {
  if (!headerStatus) return;
  headerStatus.classList.toggle("status-online", !!online);
  headerStatus.classList.toggle("status-offline", !online);
  headerStatus.textContent = online ? "Đang trực tuyến" : "Ngoại tuyến";
}

function updateMetrics() {
  const counts = state.stats || {};
  if (metricPending) metricPending.textContent = counts.submitted ?? 0;
  if (metricApproved) metricApproved.textContent = counts.approved ?? 0;
  if (metricRejected) metricRejected.textContent = counts.rejected ?? 0;
  if (metricTotal) metricTotal.textContent = counts.total ?? state.total ?? 0;
}

function showLogin(msg) {
  loginView.hidden = false;
  dashboardView.hidden = true;
  setSidebarVisible(false);
  setHeaderStatus(false);
  if (msg) {
    authError.hidden = false;
    authError.textContent = msg;
  } else {
    authError.hidden = true;
  }
}

function showDashboard() {
  loginView.hidden = true;
  dashboardView.hidden = false;
  authError.hidden = true;
  setSidebarVisible(true);
}

async function apiRaw(path, options = {}) {
  const headers = Object.assign({}, options.headers);
  if (!headers["Content-Type"] && options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch (err) {
      try {
        message = await res.text();
      } catch (_) {
        // ignore
      }
    }
    throw new Error(message);
  }
  return res;
}

async function api(path, options = {}) {
  const res = await apiRaw(path, options);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

function buildFilterQuery(includePaging = true) {
  const params = new URLSearchParams();
  if (state.status && state.status !== "all") params.set("status", state.status);
  if (state.search) params.set("q", state.search);
  if (includePaging) {
    params.set("page", state.page);
    params.set("pageSize", state.pageSize);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const username = formData.get("username");
  const password = formData.get("password");
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
      headers: { "Content-Type": "application/json" },
    });
    state.token = data.token;
    localStorage.setItem(tokenKey, state.token);
    adminWelcome.textContent = `Xin chào, ${username}!`;
    showDashboard();
    await fetchRequests();
  } catch (err) {
    showLogin(err.message || "Đăng nhập thất bại");
  }
}

function updateWelcomeFromToken() {
  if (!state.token) return;
  try {
    const payload = JSON.parse(atob(state.token.split(".")[1]));
    adminWelcome.textContent = `Xin chào, ${payload.username || "Admin"}!`;
  } catch {
    adminWelcome.textContent = "Xin chào, Admin!";
  }
}

async function fetchRequests() {
  try {
    const data = await api(`/api/kyc${buildFilterQuery(true)}`);
    state.requests = data.requests || [];
    const meta = data.meta || {};
    state.total = meta.total ?? state.requests.length;
    state.page = meta.page ?? state.page;
    state.pageSize = meta.pageSize ?? state.pageSize;
    state.pageCount = meta.pageCount ?? 0;
    state.hasNext = Boolean(meta.hasNext);
    state.hasPrev = Boolean(meta.hasPrev);
    state.stats = meta.stats || state.stats;
    renderTable();
    updateMetrics();
    updatePagination();
    updateWelcomeFromToken();
    setHeaderStatus(true);
    dashboardMessage.hidden = true;
  } catch (err) {
    if ((err.message || "").includes("invalid_token")) {
      btnLogout.click();
      return;
    }
    setHeaderStatus(false);
    dashboardMessage.hidden = false;
    dashboardMessage.textContent = err.message || "Không tải được danh sách.";
  }
}

function renderTable() {
  tableBody.innerHTML = "";
  if (!state.requests.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "Chưa có hồ sơ phù hợp.";
    tr.appendChild(td);
    tableBody.appendChild(tr);
    return;
  }

  state.requests.forEach((req) => {
    const tr = document.createElement("tr");

    const infoTd = document.createElement("td");
    infoTd.innerHTML = `<strong>${req.fullName || "(Không tên)"}</strong><br>${
      req.email || "Chưa có email"
    }<br><small>${req.role || "Chưa rõ vai trò"}</small>`;

    const statusTd = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `status-pill ${req.status}`;
    pill.textContent = req.status;
    statusTd.appendChild(pill);

    const noteTd = document.createElement("td");
    const note = document.createElement("textarea");
    note.className = "note-box";
    note.value = req.note || "";
    note.dataset.id = req.id;
    noteTd.appendChild(note);

    const actionTd = document.createElement("td");
    actionTd.className = "kyc-actions";

    const approveBtn = document.createElement("button");
    approveBtn.className = "action-btn approve";
    approveBtn.textContent = "Duyệt";
    approveBtn.addEventListener("click", () => updateRequest(req.id, "approved", note.value));

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "action-btn reject";
    rejectBtn.textContent = "Từ chối";
    rejectBtn.addEventListener("click", () => updateRequest(req.id, "rejected", note.value));

    const saveBtn = document.createElement("button");
    saveBtn.className = "action-btn save";
    saveBtn.textContent = "Lưu ghi chú";
    saveBtn.addEventListener("click", () => updateRequest(req.id, null, note.value));

    const historyBtn = document.createElement("button");
    historyBtn.className = "action-btn history";
    historyBtn.textContent = "Lịch sử";
    historyBtn.addEventListener("click", () => showHistory(req.id));

    actionTd.append(approveBtn, rejectBtn, saveBtn, historyBtn);

    tr.append(infoTd, statusTd, noteTd, actionTd);
    tableBody.appendChild(tr);
  });
}

function updatePagination() {
  if (paginationInfo) {
    if (!state.requests.length) {
      paginationInfo.textContent = "Không có dữ liệu";
    } else {
      const start = (state.page - 1) * state.pageSize + 1;
      const end = start + state.requests.length - 1;
      paginationInfo.textContent = `Hiển thị ${start} – ${end} / ${state.total}`;
    }
  }
  if (btnPrevPage) btnPrevPage.disabled = !state.hasPrev;
  if (btnNextPage) btnNextPage.disabled = !state.hasNext;
  if (pageSizeSelect) pageSizeSelect.value = String(state.pageSize);
  if (statusFilter) statusFilter.value = state.status;
}

async function updateRequest(id, status, note) {
  try {
    await api(`/api/kyc/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status, note }),
    });
    state.historyCache.delete(id);
    await fetchRequests();
  } catch (err) {
    dashboardMessage.hidden = false;
    dashboardMessage.textContent = err.message || "Không cập nhật được hồ sơ.";
  }
}

async function exportRequestsCsv() {
  try {
    const res = await apiRaw(`/api/kyc/export${buildFilterQuery(false)}`);
    const blob = await res.blob();
    downloadBlob(blob, `kyc-requests-${Date.now()}.csv`);
  } catch (err) {
    dashboardMessage.hidden = false;
    dashboardMessage.textContent = err.message || "Không xuất được CSV.";
  }
}

async function showHistory(id) {
  try {
    const cached = state.historyCache.get(id);
    const payload = cached || (await api(`/api/kyc/${id}/history`));
    if (!cached) state.historyCache.set(id, payload);
    if (!historyDialog || typeof historyDialog.showModal !== "function") {
      const lines = (payload.history || []).map(
        (evt) =>
          `${formatDateTime(evt.createdAt)} · ${evt.action} · ${evt.adminUsername || "Hệ thống"} · ${
            evt.note || ""
          }`
      );
      alert(lines.join("\n") || "Chưa có lịch sử cho hồ sơ này.");
      return;
    }
    renderHistoryDialog(payload);
  } catch (err) {
    dashboardMessage.hidden = false;
    dashboardMessage.textContent = err.message || "Không tải được lịch sử.";
  }
}

function renderHistoryDialog(data) {
  if (!historyTimeline) return;
  historyTimeline.innerHTML = "";
  state.historyDialogRequestId = data.request?.id || null;
  if (historyDialogSubtitle) {
    const label = data.request
      ? `${data.request.fullName || data.request.email || data.request.userId || ""}`
      : "";
    historyDialogSubtitle.textContent = label;
  }
  if (!data.history || !data.history.length) {
    const empty = document.createElement("p");
    empty.className = "history-event__note";
    empty.textContent = "Chưa có lịch sử.";
    historyTimeline.appendChild(empty);
  } else {
    data.history.forEach((event) => {
      const block = document.createElement("div");
      block.className = "history-event";
      const meta = document.createElement("p");
      meta.className = "history-event__meta";
      meta.textContent = `${formatDateTime(event.createdAt)} • ${
        event.adminUsername || "Hệ thống"
      } • ${event.action}`;
      const note = document.createElement("p");
      note.className = "history-event__note";
      note.textContent = event.note || "(Không có ghi chú)";
      block.append(meta, note);
      historyTimeline.appendChild(block);
    });
  }
  if (historyDialog && typeof historyDialog.showModal === "function") {
    historyDialog.showModal();
  }
}

function closeHistory() {
  state.historyDialogRequestId = null;
  if (historyDialog && historyDialog.open) {
    historyDialog.close();
  }
}

async function exportHistoryCsv() {
  const requestId = state.historyDialogRequestId;
  if (!requestId) return;
  try {
    const res = await apiRaw(`/api/kyc/${requestId}/history?format=csv`);
    const blob = await res.blob();
    downloadBlob(blob, `kyc-history-${requestId}.csv`);
  } catch (err) {
    dashboardMessage.hidden = false;
    dashboardMessage.textContent = err.message || "Không tải được lịch sử.";
  }
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return dateFormatter.format(new Date(value));
  } catch {
    return "-";
  }
}

function init() {
  if (statusFilter) statusFilter.value = state.status;
  if (pageSizeSelect) pageSizeSelect.value = String(state.pageSize);
  loginForm.addEventListener("submit", handleLogin);
  if (statusFilter) {
    statusFilter.addEventListener("change", () => {
      state.status = statusFilter.value;
      state.page = 1;
      fetchRequests();
    });
  }
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      state.pageSize = Number(pageSizeSelect.value) || 25;
      state.page = 1;
      fetchRequests();
    });
  }
  if (searchInput) {
    let searchTimer = null;
    searchInput.addEventListener("input", () => {
      state.search = searchInput.value.trim();
      state.page = 1;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(fetchRequests, 350);
    });
  }
  if (btnPrevPage) {
    btnPrevPage.addEventListener("click", () => {
      if (!state.hasPrev) return;
      state.page = Math.max(1, state.page - 1);
      fetchRequests();
    });
  }
  if (btnNextPage) {
    btnNextPage.addEventListener("click", () => {
      if (!state.hasNext) return;
      state.page += 1;
      fetchRequests();
    });
  }
  if (btnRefresh) {
    btnRefresh.addEventListener("click", () => {
      state.historyCache.clear();
      fetchRequests();
    });
  }
  if (btnExport) {
    btnExport.addEventListener("click", exportRequestsCsv);
  }
  if (btnCloseHistory) {
    btnCloseHistory.addEventListener("click", closeHistory);
  }
  if (btnExportHistory) {
    btnExportHistory.addEventListener("click", exportHistoryCsv);
  }
  btnLogout.addEventListener("click", () => {
    localStorage.removeItem(tokenKey);
    state.token = "";
    state.requests = [];
    state.historyCache.clear();
    showLogin();
  });
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      navButtons.forEach((item) => item.classList.remove("is-active"));
      btn.classList.add("is-active");
    });
  });

  if (state.token) {
    showDashboard();
    updateWelcomeFromToken();
    fetchRequests();
  } else {
    showLogin();
  }
}

init();
