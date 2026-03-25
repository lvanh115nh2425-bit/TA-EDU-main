// js/modules/progress.js
// TA-Edu 2.x - Biểu đồ tiến độ học tập cho tab "progress"
// - Tự động load Chart.js khi cần
// - Chỉ vẽ khi tab #tab=progress đang active
// - Không phá hiệu ứng cũ; không chặn UI nếu offline

const CHART_CDN = "https://cdn.jsdelivr.net/npm/chart.js";
let chartInstance = null;

// ---------- Helper DOM cục bộ ----------
const $ = (s, r = document) => r.querySelector(s);

// ---------- Tải Chart.js nếu chưa có ----------
function loadChartJS() {
  return new Promise((resolve, reject) => {
    if (window.Chart) return resolve(window.Chart);
    const s = document.createElement("script");
    s.src = CHART_CDN;
    s.async = true;
    s.onload = () => resolve(window.Chart);
    s.onerror = () => reject(new Error("Không tải được Chart.js"));
    document.head.appendChild(s);
  });
}

// ---------- Dữ liệu mock (an toàn, không cần Firestore) ----------
function getMockWeeklyData() {
  // 7 ngày gần nhất
  const labels = [];
  const data = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    labels.push(d.toLocaleDateString("vi-VN", { weekday: "short" }));
    data.push(Math.max(0, 50 + Math.round(Math.sin((i / 7) * Math.PI) * 40) + (Math.random() * 10 - 5)));
  }
  return { labels, data };
}

// ---------- Khởi tạo và vẽ biểu đồ ----------
async function renderProgressChart() {
  const canvas = $("#progressChart");
  if (!canvas) return; // không có canvas -> bỏ qua
  const ctx = canvas.getContext("2d");

  try {
    await loadChartJS();
  } catch (e) {
    console.warn(e.message);
    return;
  }

  const { labels, data } = getMockWeeklyData();

  // Hủy chart cũ nếu có
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Điểm tiến độ (tuần)",
        data,
        // Để mặc định màu của Chart.js, không áp màu để tránh phá theme
        tension: 0.35,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true },
        tooltip: { enabled: true }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

// ---------- Kiểm tra tab "progress" có đang active không ----------
function isProgressActive() {
  const p = document.getElementById("tab-progress");
  return p && p.classList.contains("is-active");
}

// ---------- Khởi động ----------
function initProgressModule() {
  // Nếu không có panel progress thì bỏ qua
  if (!document.getElementById("tab-progress")) return;

  // Chỉ vẽ khi tab đang mở
  const tryRender = () => {
    if (isProgressActive()) {
      renderProgressChart();
      window.removeEventListener("hashchange", tryRender);
    }
  };

  // Nếu đang ở tab progress thì vẽ luôn; nếu chưa thì chờ hashchange
  if (isProgressActive()) {
    renderProgressChart();
  } else {
    window.addEventListener("hashchange", tryRender);
  }

  // Nếu cần reflow khi resize
  window.addEventListener("resize", () => {
    if (isProgressActive() && chartInstance) {
      chartInstance.resize();
    }
  });
}

document.addEventListener("DOMContentLoaded", initProgressModule);
