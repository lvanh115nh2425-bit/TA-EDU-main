
// /js/core/protect_dashboard.js
import { auth, onAuthStateChanged } from "./firebase.js";

onAuthStateChanged(auth, (user) => {
  const content = document.getElementById("dashboard-content");
  if (!content) return;

  if (user) {
    content.style.display = "block"; // hiện dashboard nếu đã đăng nhập
  } else {
    window.location.href = "index.html"; // quay lại trang chủ nếu chưa
  }
});
