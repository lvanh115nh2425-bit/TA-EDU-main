// js/modules/progress.js
// TA-Edu 2.x - Bi?u d? ti?n d? h?c t?p cho tab "progress"
// - T? d?ng load Chart.js khi c?n
// - Ch? v? khi tab #tab=progress dang active
// - Kh�ng ph� hi?u ?ng cu; kh�ng ch?n UI n?u offline

const CHART_CDN = 'https://cdn.jsdelivr.net/npm/chart.js';
let chartInstance = null;

// ---------- Helper DOM c?c b? ----------
const $ = (s, r = document) => r.querySelector(s);

// ---------- T?i Chart.js n?u chua c� ----------
function loadChartJS() {
  return new Promise((resolve, reject) => {
    if (window.Chart) return resolve(window.Chart);
    const s = document.createElement('script');
    s.src = CHART_CDN;
    s.async = true;
    s.onload = () => resolve(window.Chart);
    s.onerror = () => reject(new Error('Kh�ng t?i du?c Chart.js'));
    document.head.appendChild(s);
  });
}

// ---------- D? li?u mock (an to�n, kh�ng c?n Firestore) ----------
function getMockWeeklyData() {
  // 7 ng�y g?n nh?t
  const labels = [];
  const data = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    labels.push(d.toLocaleDateString('vi-VN', { weekday: 'short' })); // T2, T3, ...
    data.push(Math.max(0, 50 + Math.round(Math.sin((i / 7) * Math.PI) * 40) + (Math.random() * 10 - 5)));
  }
  return { labels, data };
}

// ---------- Kh?i t?o & v? bi?u d? ----------
async function renderProgressChart() {
  const canvas = $('#progressChart');
  if (!canvas) return; // kh�ng c� canvas -> b? qua
  const ctx = canvas.getContext('2d');

  try {
    await loadChartJS();
  } catch (e) {
    console.warn(e.message);
    return;
  }

  const { labels, data } = getMockWeeklyData();

  // H?y chart cu n?u c�
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Di?m ti?n d? (tu?n)',
        data,
        // D? m?c d?nh m�u c?a Chart.js (kh�ng �p m�u, kh�ng ph� theme)
        tension: 0.35,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
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

// ---------- Ki?m tra tab "progress" c� dang active kh�ng ----------
function isProgressActive() {
  const p = document.getElementById('tab-progress');
  return p && p.classList.contains('is-active');
}

// ---------- Kh?i d?ng ----------
function initProgressModule() {
  // N?u kh�ng c� panel progress -> b? qua
  if (!document.getElementById('tab-progress')) return;

  // Ch? v? khi tab dang m?
  const tryRender = () => {
    if (isProgressActive()) {
      renderProgressChart();
      window.removeEventListener('hashchange', tryRender);
    }
  };

  // N?u dang ? tab progress th� v? lu�n; n?u chua th� ch? hashchange
  if (isProgressActive()) {
    renderProgressChart();
  } else {
    window.addEventListener('hashchange', tryRender);
  }

  // N?u c?n reflow khi resize
  window.addEventListener('resize', () => {
    if (isProgressActive() && chartInstance) {
      chartInstance.resize();
    }
  });
}

document.addEventListener('DOMContentLoaded', initProgressModule);
