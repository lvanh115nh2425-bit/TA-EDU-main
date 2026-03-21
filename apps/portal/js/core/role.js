// js/core/role.js
// Ch?n vai tr� sau dang k� cho TA-Edu 2.x
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const $ = (s, r=document) => r.querySelector(s);
let auth=null, db=null, user=null;
try { auth = getAuth(); db = getFirestore(); } catch {}

function toast(m){ alert(m); }
function setPressed(btn, on){
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.classList.toggle("is-active", !!on);
}

document.addEventListener("DOMContentLoaded", () => {
  const studentBtn = $("#student-btn");
  const tutorBtn   = $("#tutor-btn");
  if (!studentBtn || !tutorBtn) return;

  // Y�u c?u dang nh?p
  if (!auth) { toast("Vui l�ng dang nh?p d? ti?p t?c."); location.href="index.html"; return; }

  onAuthStateChanged(auth, async (u) => {
    if (!u) { toast("Vui l�ng dang nh?p d? ti?p t?c."); location.href="index.html"; return; }
    user = u;

    // Kh�i ph?c l?a ch?n tru?c (n?u c�)
    const saved = localStorage.getItem(`taedu:role:${u.uid}`);
    if (saved === "student") setPressed(studentBtn, true);
    if (saved === "tutor")   setPressed(tutorBtn, true);

    studentBtn.addEventListener("click", () => chooseRole("student", studentBtn, tutorBtn));
    tutorBtn.addEventListener("click",   () => chooseRole("tutor", tutorBtn, studentBtn));
  });
});

async function chooseRole(role, activeBtn, otherBtn){
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
      ? "D� ch?n vai tr� H?c sinh. Ti?p theo b?n s? ho�n th�nh h? so & th�ng tin ph? huynh."
      : "D� ch?n vai tr� Gia su. Ti?p theo b?n s? ho�n t?t x�c minh danh t�nh.");
    // T?m th?i dua v? Dashboard; bu?c k? ti?p m�nh s? th�m form KYC/onboarding theo vai tr�
    location.href = "dashboard.html";
  } catch (e) {
    console.error(e);
    toast("Kh�ng th? luu vai tr�. Th? l?i sau.");
  }
}
