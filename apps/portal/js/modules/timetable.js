import { auth, onAuthStateChanged } from "/js/core/firebase.js";

const gridEl = document.getElementById("timetableGrid");
const emptyEl = document.getElementById("timetableEmpty");
const shareToggle = document.getElementById("timetableShareToggle");
const shareHint = document.getElementById("timetableShareHint");
const shareBtn = document.querySelector('[data-timetable-action="share"]');
const metaEl = document.getElementById("timetableMeta");
const boardActions = document.getElementById("boardActions");
const deadlineTable = document.getElementById("deadlineTable");
const deadlineEmpty = document.getElementById("deadlineEmpty");
const deadlineAddBtn = document.querySelector('[data-deadline-action="add"]');
const deadlineModal = document.getElementById("deadlineModal");
const deadlineModalBackdrop = document.getElementById("deadlineModalBackdrop");
const deadlineForm = document.getElementById("deadlineForm");
const deadlineTitleInput = document.getElementById("deadlineTitle");
const deadlineStartInput = document.getElementById("deadlineStart");
const deadlineDateInput = document.getElementById("deadlineDate");
const deadlineNoteInput = document.getElementById("deadlineNote");
const deadlineStatusSelect = document.getElementById("deadlineStatus");
const slotModal = document.getElementById("ttModal");
const slotModalBackdrop = document.getElementById("ttModalBackdrop");
const slotForm = document.getElementById("ttModalForm");
const slotTitleInput = document.getElementById("ttSlotTitle");
const slotStartInput = document.getElementById("ttSlotStart");
const slotEndInput = document.getElementById("ttSlotEnd");
const slotNoteInput = document.getElementById("ttSlotNote");
const slotToneSelect = document.getElementById("ttSlotTone");
const slotDayName = document.getElementById("ttModalDayName");
const shareParam = new URLSearchParams(location.search).get("share") || "";

const TIMETABLE_API_BASE =
  window.__TAEDU_TIMETABLE_API__ ||
  window.__TAEDU_API__ ||
  window.__TAEDU_ADMIN_API__ ||
  ((location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:4001"
    : "/api");
const API_TIMETABLE = `${TIMETABLE_API_BASE.replace(/\/$/, "")}/timetable`;
const API_SLOT = `${API_TIMETABLE}/slot`;
const API_SHARE = `${API_TIMETABLE}/share`;
const API_SHARED = `${API_TIMETABLE}/shared`;
const API_DEADLINE = `${API_TIMETABLE}/deadline`;

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = {
  mon: "Thứ 2",
  tue: "Thứ 3",
  wed: "Thứ 4",
  thu: "Thứ 5",
  fri: "Thứ 6",
  sat: "Thứ 7",
  sun: "Chủ nhật"
};

function createEmptyWeekSlots() {
  const week = {};
  DAY_ORDER.forEach((day) => {
    week[day] = [];
  });
  return week;
}

const state = {
  week: mapWeek(createEmptyWeekSlots()),
  deadlines: [],
  shareEnabled: false,
  shareCode: "",
  user: null,
  readonly: Boolean(shareParam),
  loading: false
};

let currentModalDay = null;

init();

function init() {
  renderWeek();
  renderDeadlines();
  updateShareControls();
  closeSlotModal();
  if (state.readonly) {
    loadSharedView();
  } else {
    onAuthStateChanged(auth, (user) => {
      state.user = user;
      updateShareControls();
      if (user) {
        loadPersonalTimetable();
      } else {
        setMetaText("Đăng nhập để lưu lịch biểu của bạn.");
        renderWeek();
        renderDeadlines();
      }
    });
  }
  if (shareToggle) {
    shareToggle.addEventListener("change", handleShareToggle);
  }
  if (shareBtn) {
    shareBtn.addEventListener("click", handleShareCopy);
  }
  slotForm?.addEventListener("submit", handleSlotSubmit);
  document.querySelectorAll('[data-tt-modal="cancel"]').forEach((btn) => {
    btn.addEventListener("click", () => closeSlotModal());
  });
  slotModalBackdrop?.addEventListener("click", () => closeSlotModal());

  deadlineAddBtn?.addEventListener("click", openDeadlineModal);
  document.querySelectorAll('[data-deadline-modal="cancel"]').forEach((btn) => {
    btn.addEventListener("click", () => closeDeadlineModal());
  });
  deadlineModalBackdrop?.addEventListener("click", () => closeDeadlineModal());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !slotModal?.hidden) {
      closeSlotModal();
    }
    if (event.key === "Escape" && !deadlineModal?.hidden) {
      closeDeadlineModal();
    }
  });

  deadlineForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!deadlineTitleInput?.value || !deadlineDateInput?.value || !deadlineStartInput?.value) return;
    try {
      const payload = {
        title: deadlineTitleInput.value.trim(),
        startDate: deadlineStartInput.value,
        dueDate: deadlineDateInput.value,
        note: deadlineNoteInput?.value.trim(),
        status: deadlineStatusSelect?.value || "pending"
      };
      const data = await authedFetch(API_DEADLINE, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      applySchedulePayload(data);
      closeDeadlineModal();
      setShareHint("Đã thêm deadline mới.", { success: true });
    } catch (error) {
      console.error("add deadline error", error);
      setShareHint(error.message || "Không thêm được deadline.", { error: true });
    }
  });
}

function mapWeek(weekObj = {}) {
  return DAY_ORDER.map((day) => ({
    id: day,
    title: DAY_LABELS[day],
    slots: Array.isArray(weekObj[day]) ? weekObj[day].map(normalizeSlot) : []
  }));
}

function normalizeSlot(slot = {}) {
  return {
    id: slot.id || cryptoRandomId(),
    time: slot.time || buildTimeRange(slot.start, slot.end),
    title: slot.title || "Hoạt động",
    note: slot.note || "",
    tone: slot.tone === "fun" ? "fun" : "focus"
  };
}

function buildTimeRange(start, end) {
  if (!start || !end) return "";
  return `${start} - ${end}`;
}

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadSharedView() {
  try {
    if (boardActions) boardActions.hidden = true;
    if (!shareParam) {
      setShareHint("Liên kết chia sẻ không hợp lệ.", { error: true });
      return;
    }
    const res = await fetch(`${API_SHARED}/${encodeURIComponent(shareParam)}`);
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || "Không tìm thấy lịch biểu chia sẻ.");
    }
    const data = await res.json();
    applySchedulePayload(data, { readonly: true });
    setShareHint("Đang xem bản lịch biểu được chia sẻ.", { info: true });
  } catch (error) {
    console.error("[timetable] share view error", error);
    setShareHint(error.message || "Không thể tải lịch chia sẻ.", { error: true });
  }
}

async function loadPersonalTimetable() {
  if (!auth.currentUser) return;
  try {
    state.loading = true;
    const data = await authedFetch(API_TIMETABLE);
    applySchedulePayload(data);
  } catch (error) {
    console.error("[timetable] load error", error);
    setShareHint(error.message || "Không thể tải lịch biểu.", { error: true });
  } finally {
    state.loading = false;
  }
}

function applySchedulePayload(data = {}, options = {}) {
  state.week = mapWeek(data.week || {});
  state.deadlines = Array.isArray(data.deadlines)
    ? data.deadlines.slice().sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))
    : [];
  state.shareEnabled = Boolean(data.shareEnabled);
  if (typeof data.shareCode === "string") {
    state.shareCode = data.shareCode;
  }
  if (typeof options.readonly === "boolean") {
    state.readonly = options.readonly;
  }
  const totalSlots = countSlots(state.week);
  const updatedText = data.updatedAt ? formatTimestamp(data.updatedAt) : "chưa xác định";
  setMetaText(totalSlots > 0 ? `Có ${totalSlots} hoạt động • cập nhật ${updatedText}` : "");
  renderWeek();
  renderDeadlines();
  updateShareControls();
  updateShareHint();
}

function countSlots(weekArr = []) {
  return weekArr.reduce((sum, day) => sum + (Array.isArray(day.slots) ? day.slots.length : 0), 0);
}

function formatTimestamp(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "chưa xác định";
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function renderWeek() {
  if (!gridEl) return;
  gridEl.innerHTML = "";
  const canEdit = Boolean(state.user) && !state.readonly;
  state.week.forEach((day) => {
    const column = document.createElement("div");
    column.className = "day-column";
    const heading = document.createElement("h3");
    heading.textContent = day.title;
    column.appendChild(heading);
    if (!day.slots.length) {
      const placeholder = document.createElement("p");
      placeholder.className = "slot-note";
      placeholder.textContent = "Chưa đặt lịch";
      column.appendChild(placeholder);
    } else {
      day.slots.forEach((slot) => {
        const card = document.createElement("div");
        card.className = "slot-card";
        card.dataset.tone = slot.tone || "focus";
        card.innerHTML = `
          <div class="slot-time">${escapeHtml(slot.time || "")}</div>
          <div class="slot-title">${escapeHtml(slot.title || "Hoạt động")}</div>
          <p class="slot-note">${escapeHtml(slot.note || "")}</p>
        `;
        column.appendChild(card);
      });
    }
    if (canEdit) {
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "day-add";
      addButton.setAttribute("aria-label", `Thêm hoạt động cho ${day.title}`);
      addButton.textContent = "+";
      addButton.addEventListener("click", () => openSlotModal(day.id));
      column.appendChild(addButton);
    }
    gridEl.appendChild(column);
  });
  if (emptyEl) {
    emptyEl.hidden = countSlots(state.week) > 0;
  }
}

function openDeadlineModal() {
  if (!state.user) {
    setShareHint("Đăng nhập để thêm deadline.", { error: true });
    return;
  }
  if (!deadlineModal || !deadlineModalBackdrop) return;
  deadlineForm?.reset();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  if (deadlineStartInput) deadlineStartInput.value = todayStr;
  if (deadlineDateInput) deadlineDateInput.value = tomorrowStr;
  if (deadlineNoteInput) deadlineNoteInput.value = "";
  if (deadlineStatusSelect) deadlineStatusSelect.value = "pending";
  deadlineModalBackdrop.hidden = false;
  deadlineModal.hidden = false;
  setTimeout(() => deadlineTitleInput?.focus(), 30);
}

function closeDeadlineModal() {
  if (deadlineModalBackdrop) deadlineModalBackdrop.hidden = true;
  if (deadlineModal) deadlineModal.hidden = true;
}

async function updateDeadlineStatus(id, status) {
  try {
    const data = await authedFetch(`${API_DEADLINE}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    applySchedulePayload(data);
    setShareHint("Đã cập nhật deadline.", { success: true });
  } catch (error) {
    console.error("deadline status error", error);
    setShareHint(error.message || "Không cập nhật được deadline.", { error: true });
  }
}

function renderDeadlines() {
  if (!deadlineTable) return;
  deadlineTable.innerHTML = "";
  const canEdit = Boolean(state.user) && !state.readonly;
  const list = state.deadlines || [];
  if (!list.length) {
    if (deadlineEmpty) {
      deadlineEmpty.hidden = false;
      deadlineTable.appendChild(deadlineEmpty);
    }
    return;
  }
  if (deadlineEmpty) deadlineEmpty.hidden = true;
  const head = document.createElement("div");
  head.className = "deadline-head";
  head.innerHTML = "<span>Công việc</span><span>Trạng thái</span><span>Bắt đầu</span><span>Đến hạn</span><span></span>";
  deadlineTable.appendChild(head);
  const todayStr = new Date().toISOString().slice(0, 10);
  list.forEach((item) => {
    const row = document.createElement("div");
    row.className = "deadline-row";
    const meta = getStatusVisual(item, todayStr);
    const noteHtml = item.note ? `<span class="deadline-note">${escapeHtml(item.note)}</span>` : "";
    row.innerHTML = `
      <span>${escapeHtml(item.title || "")}${noteHtml}</span>
      <span><span class="status-pill ${meta.className}">${meta.label}</span></span>
      <span>${formatShortDate(item.startDate)}</span>
      <span>${formatShortDate(item.dueDate)}</span>
      <span class="deadline-actions"></span>
    `;
    const actionSlot = row.querySelector(".deadline-actions");
    if (canEdit) {
      if (item.status === "pending") {
        const startBtn = document.createElement("button");
        startBtn.type = "button";
        startBtn.className = "btn btn-primary btn-mini";
        startBtn.textContent = "Bắt đầu";
        startBtn.addEventListener("click", () => updateDeadlineStatus(item.id, "working"));
        actionSlot.appendChild(startBtn);
      } else if (item.status === "working") {
        const doneBtn = document.createElement("button");
        doneBtn.type = "button";
        doneBtn.className = "btn btn-primary btn-mini";
        doneBtn.textContent = "Hoàn thành";
        doneBtn.addEventListener("click", () => updateDeadlineStatus(item.id, "done"));
        actionSlot.appendChild(doneBtn);
      } else {
        actionSlot.textContent = "✓";
      }
    } else if (item.status === "done") {
      actionSlot.textContent = "✓";
    }
    deadlineTable.appendChild(row);
  });
}

function getStatusVisual(item = {}, todayStr) {
  const isDone = item.status === "done";
  const overdue = !isDone && item.dueDate && item.dueDate < todayStr;
  if (isDone) return { className: "is-done", label: "Hoàn thành" };
  if (overdue) return { className: "is-overdue", label: "Quá hạn" };
  if (item.status === "working") return { className: "is-working", label: "Đang làm" };
  return { className: "is-pending", label: "Chưa bắt đầu" };
}

function updateShareControls() {
  const canEdit = Boolean(state.user) && !state.readonly;
  if (boardActions) {
    boardActions.hidden = state.readonly;
  }
  if (shareToggle) {
    shareToggle.checked = state.shareEnabled;
    shareToggle.disabled = !canEdit;
  }
  if (shareBtn) {
    shareBtn.disabled = !canEdit;
  }
  if (deadlineAddBtn) {
    deadlineAddBtn.disabled = !canEdit;
    deadlineAddBtn.style.display = canEdit ? "" : "none";
  }
}

function updateShareHint() {
  if (!shareHint) return;
  if (state.shareEnabled && state.shareCode && !state.readonly) {
    const url = buildShareUrl(state.shareCode);
    setShareHint(`Chia sẻ bật • Link: ${url}`);
  } else if (!state.shareEnabled && !state.readonly) {
    setShareHint("", {});
  }
}

async function handleShareToggle(event) {
  if (!state.user) {
    event.preventDefault();
    setShareHint("Đăng nhập để bật chia sẻ.", { error: true });
    return;
  }
  if (state.readonly) {
    event.preventDefault();
    return;
  }
  const desired = event.target.checked;
  try {
    shareToggle.disabled = true;
    const data = await authedFetch(API_SHARE, {
      method: "PATCH",
      body: JSON.stringify({ enabled: desired })
    });
    applySchedulePayload(data);
  } catch (error) {
    console.error("[timetable] share toggle error", error);
    event.target.checked = !desired;
    setShareHint(error.message || "Không cập nhật được chia sẻ.", { error: true });
  } finally {
    shareToggle.disabled = false;
  }
}

async function handleShareCopy() {
  if (!state.user || state.readonly) return;
  if (!state.shareEnabled) {
    try {
      const data = await authedFetch(API_SHARE, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true })
      });
      applySchedulePayload(data);
    } catch (error) {
      console.error("[timetable] enable share error", error);
      setShareHint(error.message || "Không bật được chia sẻ.", { error: true });
      return;
    }
  }
  const url = buildShareUrl(state.shareCode);
  try {
    await navigator.clipboard?.writeText(url);
    setShareHint(`Đã sao chép liên kết: ${url}`, { success: true });
  } catch (error) {
    console.warn("Clipboard error", error);
    setShareHint(`Sao chép thủ công: ${url}`);
  }
}

function openSlotModal(dayId) {
  if (!state.user) {
    setShareHint("Đăng nhập để thêm hoạt động.", { error: true });
    return;
  }
  currentModalDay = dayId;
  const dayLabel = DAY_LABELS[dayId] || "Ngày mới";
  if (slotDayName) slotDayName.textContent = dayLabel;
  slotForm?.reset();
  slotToneSelect.value = "focus";
  slotModalBackdrop.hidden = false;
  slotModal.hidden = false;
  setTimeout(() => slotTitleInput?.focus(), 40);
}

function closeSlotModal() {
  if (slotModalBackdrop) slotModalBackdrop.hidden = true;
  if (slotModal) slotModal.hidden = true;
  currentModalDay = null;
}

async function handleSlotSubmit(event) {
  event.preventDefault();
  if (!currentModalDay) {
    closeSlotModal();
    return;
  }
  try {
    const payload = {
      day: currentModalDay,
      slot: {
        title: slotTitleInput?.value.trim(),
        start: slotStartInput?.value,
        end: slotEndInput?.value,
        note: slotNoteInput?.value.trim(),
        tone: slotToneSelect?.value || "focus"
      }
    };
    const data = await authedFetch(API_SLOT, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    applySchedulePayload(data);
    closeSlotModal();
    setShareHint("Đã thêm hoạt động mới.", { success: true });
  } catch (error) {
    console.error("[timetable] add slot error", error);
    setShareHint(error.message || "Không thêm được hoạt động.", { error: true });
  }
}

function setShareHint(message, options = {}) {
  if (!shareHint) return;
  if (!message) {
    shareHint.hidden = true;
    shareHint.textContent = "";
    shareHint.classList.remove("is-error", "is-success", "is-info");
    return;
  }
  shareHint.hidden = false;
  shareHint.textContent = message;
  shareHint.classList.toggle("is-error", Boolean(options.error));
  shareHint.classList.toggle("is-success", Boolean(options.success));
  shareHint.classList.toggle("is-info", Boolean(options.info));
}

function setMetaText(text) {
  if (!metaEl) return;
  metaEl.textContent = text || "";
}

function buildShareUrl(code) {
  if (!code) return "";
  const base = `${window.location.origin}/thoi-gian-bieu.html`;
  return `${base}?share=${code}`;
}

function formatShortDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "short" });
}

async function authedFetch(url, options = {}) {
  const token = await auth.currentUser?.getIdToken?.();
  if (!token) {
    throw new Error("Bạn cần đăng nhập để thao tác.");
  }
  const headers = Object.assign({ "Content-Type": "application/json" }, options.headers, {
    Authorization: `Bearer ${token}`
  });
  const res = await fetch(url, { ...options, headers });
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  if (!res.ok) {
    const errorPayload = isJson ? await res.json().catch(() => ({})) : {};
    const fallbackText = isJson ? "" : await res.text().catch(() => "");
    const msg = errorPayload?.error || fallbackText || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return isJson ? res.json() : null;
}

function escapeHtml(text = "") {
  const span = document.createElement("span");
  span.textContent = text;
  return span.innerHTML;
}
