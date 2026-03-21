// js/utils/format.js
// ... (gi? nguy�n c�c export s?n c�)

export const formatCurrencyVN = (n) => {
  const v = Number.isFinite(+n) ? +n : 0;
  return v.toLocaleString('vi-VN') + '?';
};
