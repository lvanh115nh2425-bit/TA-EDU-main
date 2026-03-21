// js/core/ui.js
// Helpers DOM dùng chung cho TA-Edu 2.x

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

// Lắng nghe sự kiện tiện lợi (uỷ quyền tuỳ chọn)
export function on(event, selector, handler, root = document) {
  root.addEventListener(event, (e) => {
    const match = e.target.closest(selector);
    if (match) handler(e, match);
  });
}
