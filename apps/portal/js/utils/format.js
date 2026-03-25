// js/utils/format.js
// ... (giữ nguyên các export sẵn có)

export const formatCurrencyVN = (n) => {
  const v = Number.isFinite(+n) ? +n : 0;
  return v.toLocaleString("vi-VN") + "₫";
};
