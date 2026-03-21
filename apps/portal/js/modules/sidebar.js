// js/modules/sidebar.js
const KEY = 'taedu_sidebar_collapsed';

function applyState(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  const btn = document.getElementById('sidebarToggle');
  if (btn) btn.setAttribute('aria-label', collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar');
}

document.addEventListener('DOMContentLoaded', () => {
  const collapsed = localStorage.getItem(KEY) === '1';
  applyState(collapsed);

  const btn = document.getElementById('sidebarToggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const next = !document.body.classList.contains('sidebar-collapsed');
      localStorage.setItem(KEY, next ? '1' : '0');
      applyState(next);
    });
  }
});
