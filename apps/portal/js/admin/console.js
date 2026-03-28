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

const STATUS_LABELS = {
  submitted: "Mới nhận",
  reviewing: "Đang xem",
  resolved: "Đã xử lý",
  rejected: "Bác bỏ",
};

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
  stats: { total: 0, submitted: 0, reviewing: 0, resolved: 0, rejected: 0 },
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
  if (metricApproved) metricApproved.textContent = counts.resolved ?? 0;
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

function normalizeReportField(value, fallback = "") {
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}

function mapReportView(req = {}) {
  const payload = req.payload || {};
  return {
    id: req.id,
    reporterName: normalizeReportField(req.reporterName, payload.reporterName),
    reporterEmail: normalizeReportField(req.reporterEmail, payload.reporterEmail),
    reporterId: normalizeReportField(req.reporterId, payload.reporterId),
    reportedName: normalizeReportField(req.reportedName, payload.reportedName),
    reportedEmail: normalizeReportField(req.reportedEmail, payload.reportedEmail),
    reportedId: normalizeReportField(req.reportedId, payload.reportedId),
    category: normalizeReportField(req.category, payload.category),
    reason: normalizeReportField(req.reason, payload.reason),
    content: normalizeReportField(req.content, payload.content),
    evidenceUrls: req.evidenceUrls || payload.evidenceUrls || [],
    status: req.status,
    note: req.note || "",
    createdAt: req.createdAt,
    updatedAt: req.updatedAt,
  };
}

async function fetchRequests() {
  try {
    const data = await api(`/api/reports${buildFilterQuery(true)}`);
    state.requests = data.reports || [];
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
    td.textContent = "Chưa có tố cáo phù hợp.";
    tr.appendChild(td);
    tableBody.appendChild(tr);
    return;
  }

  state.requests.forEach((req) => {
    const report = mapReportView(req);
    const tr = document.createElement("tr");

    const infoTd = document.createElement("td");
    const reporterLabel =
      report.reporterName || report.reporterEmail || report.reporterId || "(Chưa rõ)";
    const reportedLabel =
      report.reportedName || report.reportedEmail || report.reportedId || "(Chưa rõ)";
    const title = document.createElement("strong");
    title.textContent = `${reporterLabel} → ${reportedLabel}`;
    infoTd.appendChild(title);
    infoTd.appendChild(document.createElement("br"));
    const reporterMeta = document.createElement("small");
    reporterMeta.className = "report-meta";
    reporterMeta.textContent = `Người tố cáo: ${report.reporterEmail || report.reporterId || "-"}`;
    infoTd.appendChild(reporterMeta);
    infoTd.appendChild(document.createElement("br"));
    const reportedMeta = document.createElement("small");
    reportedMeta.className = "report-meta";
    reportedMeta.textContent = `Người bị tố cáo: ${report.reportedEmail || report.reportedId || "-"}`;
    infoTd.appendChild(reportedMeta);
    infoTd.appendChild(document.createElement("br"));
    const categoryMeta = document.createElement("small");
    categoryMeta.className = "report-meta";
    categoryMeta.textContent = `Danh mục: ${report.category || "Không rõ"}`;
    infoTd.appendChild(categoryMeta);

    const statusTd = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `status-pill ${report.status || "submitted"}`;
    pill.textContent = STATUS_LABELS[report.status] || report.status || "Mới nhận";
    statusTd.appendChild(pill);

    const noteTd = document.createElement("td");
    const reasonSection = document.createElement("div");
    reasonSection.className = "report-section";
    const reasonLabel = document.createElement("strong");
    reasonLabel.textContent = "Lý do tố cáo";
    const reasonText = document.createElement("p");
    reasonText.textContent = report.reason || "Chưa có nội dung tố cáo.";
    reasonSection.append(reasonLabel, reasonText);
    noteTd.appendChild(reasonSection);

    if (report.content) {
      const contentSection = document.createElement("div");
      contentSection.className = "report-section";
      const contentLabel = document.createElement("strong");
      contentLabel.textContent = "Mô tả chi tiết";
      const contentText = document.createElement("p");
      contentText.textContent = report.content;
      contentSection.append(contentLabel, contentText);
      noteTd.appendChild(contentSection);
    }

    if (report.evidenceUrls && report.evidenceUrls.length) {
      const evidenceSection = document.createElement("div");
      evidenceSection.className = "report-section";
      const evidenceLabel = document.createElement("strong");
      evidenceLabel.textContent = "Minh chứng";
      const evidenceWrap = document.createElement("div");
      evidenceWrap.className = "report-evidence";
      report.evidenceUrls.forEach((url) => {
        if (!url) return;
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Tệp đính kèm";
        evidenceWrap.appendChild(link);
      });
      evidenceSection.append(evidenceLabel, evidenceWrap);
      noteTd.appendChild(evidenceSection);
    }

    const noteSection = document.createElement("div");
    noteSection.className = "report-section";
    const noteLabel = document.createElement("strong");
    noteLabel.textContent = "Ghi chú nội bộ";
    const note = document.createElement("textarea");
    note.className = "note-box";
    note.value = report.note || "";
    note.dataset.id = report.id;
    noteSection.append(noteLabel, note);
    noteTd.appendChild(noteSection);

    const actionTd = document.createElement("td");
    actionTd.className = "kyc-actions";

    const reviewingBtn = document.createElement("button");
    reviewingBtn.className = "action-btn review";
    reviewingBtn.textContent = "Đang xem";
    reviewingBtn.addEventListener("click", () =>
      updateRequest(report.id, "reviewing", note.value)
    );

    const resolveBtn = document.createElement("button");
    resolveBtn.className = "action-btn approve";
    resolveBtn.textContent = "Đã xử lý";
    resolveBtn.addEventListener("click", () =>
      updateRequest(report.id, "resolved", note.value)
    );

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "action-btn reject";
    rejectBtn.textContent = "Bác bỏ";
    rejectBtn.addEventListener("click", () => updateRequest(report.id, "rejected", note.value));

    const saveBtn = document.createElement("button");
    saveBtn.className = "action-btn save";
    saveBtn.textContent = "Lưu ghi chú";
    saveBtn.addEventListener("click", () => updateRequest(report.id, null, note.value));

    const historyBtn = document.createElement("button");
    historyBtn.className = "action-btn history";
    historyBtn.textContent = "Lịch sử";
    historyBtn.addEventListener("click", () => showHistory(report.id));

    actionTd.append(reviewingBtn, resolveBtn, rejectBtn, saveBtn, historyBtn);

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
    await api(`/api/reports/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status, note }),
    });
    state.historyCache.delete(id);
    await fetchRequests();
  } catch (err) {
    dashboardMessage.hidden = false;
    dashboardMessage.textContent = err.message || "Không cập nhật được tố cáo.";
  }
}

async function exportRequestsCsv() {
  try {
    const res = await apiRaw(`/api/reports/export${buildFilterQuery(false)}`);
    const blob = await res.blob();
    downloadBlob(blob, `user-reports-${Date.now()}.csv`);
  } catch (err) {
    dashboardMessage.hidden = false;
    dashboardMessage.textContent = err.message || "Không xuất được CSV.";
  }
}

async function showHistory(id) {
  try {
    const cached = state.historyCache.get(id);
    const payload = cached || (await api(`/api/reports/${id}/history`));
    if (!cached) state.historyCache.set(id, payload);
    if (!historyDialog || typeof historyDialog.showModal !== "function") {
      const lines = (payload.history || []).map(
        (evt) =>
          `${formatDateTime(evt.createdAt)} · ${evt.action} · ${evt.adminUsername || "Hệ thống"} · ${
            evt.note || ""
          }`
      );
      alert(lines.join("\n") || "Chưa có lịch sử cho tố cáo này.");
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
  state.historyDialogRequestId = data.report?.id || null;
  if (historyDialogSubtitle) {
    const label = data.report
      ? `${data.report.reporterName || data.report.reporterEmail || data.report.reporterId || ""}`
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
    const res = await apiRaw(`/api/reports/${requestId}/history?format=csv`);
    const blob = await res.blob();
    downloadBlob(blob, `report-history-${requestId}.csv`);
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
