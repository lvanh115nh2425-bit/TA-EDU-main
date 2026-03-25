// js/core/role.js
// Chọn vai trò sau đăng ký cho TA-Edu 2.x
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const $ = (s, r = document) => r.querySelector(s);
let auth = null, db = null, user = null;
try { auth = getAuth(); db = getFirestore(); } catch {}

function toast(m) { alert(m); }
function setPressed(btn, on) {
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.classList.toggle("is-active", !!on);
}

document.addEventListener("DOMContentLoaded", () => {
  const studentBtn = $("#student-btn");
  const tutorBtn = $("#tutor-btn");
  if (!studentBtn || !tutorBtn) return;

  // Yêu cầu đăng nhập
  if (!auth) { toast("Vui lòng đăng nhập để tiếp tục."); location.href = "index.html"; return; }

  onAuthStateChanged(auth, async (u) => {
    if (!u) { toast("Vui lòng đăng nhập để tiếp tục."); location.href = "index.html"; return; }
    user = u;

    // Khôi phục lựa chọn trước (nếu có)
    const saved = localStorage.getItem(`taedu:role:${u.uid}`);
    if (saved === "student") setPressed(studentBtn, true);
    if (saved === "tutor") setPressed(tutorBtn, true);

    studentBtn.addEventListener("click", () => chooseRole("student", studentBtn, tutorBtn));
    tutorBtn.addEventListener("click", () => chooseRole("tutor", tutorBtn, studentBtn));
  });
});

async function chooseRole(role, activeBtn, otherBtn) {
  setPressed(activeBtn, true);
  setPressed(otherBtn, false);
  localStorage.setItem(`taedu:role:${user.uid}`, role);

  const payload = {
    role,
    verify: { status: "unverified", submittedAt: null, reviewNote: "" },
    updatedAt: Date.now()
  };

  try {
    if (db) {
      await setDoc(
        doc(db, "users", user.uid),
        { ...payload, email: user.email || null, displayName: user.displayName || null, createdAt: serverTimestamp() },
        { merge: true }
      );
    }
    toast(role === "student"
      ? "Đã chọn vai trò Học sinh. Tiếp theo bạn sẽ hoàn thành hồ sơ và thông tin phụ huynh."
      : "Đã chọn vai trò Gia sư. Tiếp theo bạn sẽ hoàn tất xác minh danh tính.");
    // Tạm thời đưa về Dashboard; bước kế tiếp mình sẽ thêm form KYC/onboarding theo vai trò
    location.href = "dashboard.html";
  } catch (e) {
    console.error(e);
    toast("Không thể lưu vai trò. Thử lại sau.");
  }
}
