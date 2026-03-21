// js/core/router.js
// Di?u hu?ng gi?a c�c tab trong dashboard + hi?u ?ng chuy?n mu?t

function changeTab(tabId) {
  // ?n t?t c? tab
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active', 'fade-in');
  });

  // Hi?n th? tab du?c ch?n
  const activeTab = document.getElementById(tabId);
  if (activeTab) {
    activeTab.classList.add('active');
    // ?? Th�m animation sau m?t khung h�nh (d?m b?o ho?t d?ng mu?t)
    setTimeout(() => activeTab.classList.add('fade-in'), 20);
  }

  // C?p nh?t sidebar
  document.querySelectorAll('.sidebar li').forEach(li => li.classList.remove('active'));
  const activeMenu = document.querySelector(`.sidebar li[onclick*='${tabId}']`);
  if (activeMenu) activeMenu.classList.add('active');

  // ?? L�m mu?t chi?u cao khi d?i tab
  const content = document.querySelector('.dashboard-content');
  if (content && activeTab) {
    const newHeight = activeTab.scrollHeight;
    const minHeight = 600;
    const targetHeight = Math.max(newHeight, minHeight);
    content.style.transition = 'height 0.35s ease';
    content.style.height = targetHeight + 'px';
  }
}

// Can chi?u cao khi trang load
window.addEventListener('load', () => {
  const firstTab = document.querySelector('.tab.active');
  const content = document.querySelector('.dashboard-content');
  if (content && firstTab) {
    const firstHeight = firstTab.scrollHeight;
    content.style.height = Math.max(firstHeight, 600) + 'px';
  }
});
