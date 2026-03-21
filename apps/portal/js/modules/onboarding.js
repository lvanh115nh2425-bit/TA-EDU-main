import { auth } from "../core/firebase.js";
import { getProfile, updateProfile, submitKyc } from "../utils/api.js";

// js/modules/onboarding.js
// ======================================================
// TA-Edu 2.x - Onboarding (Role + KYC)
// - Uu ti�n upload qua backend (ImgBB) d? tr�nh l?i CORS Storage
// - Luu local tr?ng th�i bu?c/role, t? d?ng h?i ph?c form

// ======================================================
// 0) Helpers DOM & UI
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const toast = (m) => alert(m);

const MAX_FILE_MB = 5;
const ALLOW_IMG  = ["image/jpeg", "image/png", "image/webp"];
const ALLOW_CERT = [...ALLOW_IMG, "application/pdf"];

const STEP_PARAM = "step";
const USE_FIREBASE_STORAGE = false; // b?t true n?u bucket Storage d� s?n s�ng

function checkFile(file, label, allow = ALLOW_IMG) {
  if (!file) return { ok: false, msg: `Thi?u ${label}.` };
  if (!allow.includes(file.type)) {
    const extra = allow.includes("application/pdf") ? " ho?c PDF" : "";
    return { ok: false, msg: `${label} ch? h? tr? JPG/PNG/WebP${extra}.` };
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    return { ok: false, msg: `${label} vu?t qu� ${MAX_FILE_MB}MB.` };
  }
  return { ok: true };
}

function setBusy(form, busy) {
  const btn = form.querySelector('button[type="submit"], .btn-primary, [data-kyc-submit]');
  if (!btn) return;
  btn.disabled = !!busy;
  if (!btn.dataset.original) btn.dataset.original = btn.textContent.trim();
  btn.textContent = busy ? "Dang g?i." : btn.dataset.original;
}

function val(form, names) {
  const arr = Array.isArray(names) ? names : [names];
  for (const n of arr) {
    const el = form.querySelector(`[name="${n}"]`);
    if (el) return (el.value || "").trim();
  }
  return "";
}
function fileOne(form, names) {
  const arr = Array.isArray(names) ? names : [names];
  for (const n of arr) {
    const el = form.querySelector(`input[name="${n}"]`);
    if (el?.files?.[0]) return el.files[0];
  }
  return null;
}
function fileMany(form, names) {
  const arr = Array.isArray(names) ? names : [names];
  for (const n of arr) {
    const el = form.querySelector(`input[name="${n}"]`);
    if (el?.files) return Array.from(el.files);
  }
  return [];
}

// ======================================================
// 0b) Local storage helpers & step routing
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}
function lsGet(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}
function rememberLastStep(step) {
  if (!user || !step) return;
  lsSet(`taedu_onboarding:${user.uid}:lastStep`, step);
}
function readLastStep() {
  if (!user) return null;
  return lsGet(`taedu_onboarding:${user.uid}:lastStep`);
}
function storePayloadCache(kind, payload) {
  if (!user || !payload) return;
  lsSet(`taedu_onboarding:${user.uid}:${kind}_payload`, JSON.stringify(payload));
}
function readPayloadCache(kind) {
  if (!user) return null;
  const raw = lsGet(`taedu_onboarding:${user.uid}:${kind}_payload`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}
function storedRole() {
  if (!user) return null;
  return lsGet(`taedu:role:${user.uid}`);
}
function highlightRole(role) {
  if (!role) return;
  $$(".ob__role[data-role]").forEach(btn => {
    const active = btn.dataset.role === role;
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.classList.toggle("is-active", active);
  });
}

function currentStepFromHash() {
  const params = new URLSearchParams((location.hash || `#${STEP_PARAM}=select`).slice(1));
  return params.get(STEP_PARAM) || "select";
}
function goToStep(step) {
  if (!step) step = "select";
  const target = `#${STEP_PARAM}=${step}`;
  if (location.hash === target) {
    show(step);
  } else {
    location.hash = target;
  }
}
function show(step) {
  $$('section[data-step]').forEach(sec => {
    sec.hidden = sec.dataset.step !== step;
  });
  rememberLastStep(step);
}
function routeByHash() {
  show(currentStepFromHash());
}

function bindBackButtons() {
  $$('[data-back]').forEach(btn => btn.addEventListener('click', () => goToStep('select')));
}

function bindStatusControls() {
  const secondary = $("#statusSecondary");
  if (secondary) {
    secondary.addEventListener("click", () => {
      const target = secondary.dataset.targetStep || "select";
      goToStep(target);
    });
  }
}

function updateStatusCard(status = "submitted", role = "student", note = "") {
  const title = $("#statusTitle");
  const desc = $("#statusDesc");
  const noteEl = $("#statusNote");
  const primary = $("#statusPrimary");
  const secondary = $("#statusSecondary");

  let titleText = "D� g?i h? so!";
  let descText = "H? so dang du?c x? l�.";
  let noteText = note || "Th?i gian duy?t d? ki?n: 24 gi? l�m vi?c.";
  let noteIsErr = false;
  let secondaryLabel = "";

  if (status === "approved") {
    titleText = "T�i kho?n d� du?c x�c minh";
    descText = "B?n c� th? s? d?ng d?y d? t�nh nang TA-Edu.";
    noteText = note || "";
  } else if (status === "rejected") {
    titleText = "C?n c?p nh?t h? so";
    descText = "Vui l�ng ki?m tra l?i th�ng tin/?nh v� g?i l?i.";
    secondaryLabel = "S?a & g?i l?i";
    noteIsErr = true;
    if (!noteText) noteText = "Ki?m tra l?i ?nh CCCD v� th�ng tin c� nh�n.";
  }

  if (title) title.textContent = titleText;
  if (desc) desc.textContent = descText;
  if (noteEl) {
    if (noteText) {
      noteEl.hidden = false;
      noteEl.textContent = noteText;
      noteEl.classList.toggle("is-error", noteIsErr);
    } else {
      noteEl.hidden = true;
      noteEl.classList.remove("is-error");
    }
  }
  if (primary) primary.textContent = status === "approved" ? "T?i Dashboard" : "V? Dashboard";
  if (secondary) {
    if (secondaryLabel) {
      secondary.hidden = false;
      secondary.textContent = secondaryLabel;
      secondary.dataset.targetStep = role;
    } else {
      secondary.hidden = true;
      secondary.dataset.targetStep = "";
    }
  }
}

function fillStudentForm(data) {
  const form = $("#formStudent") || $("#form-student");
  if (!form || !data) return;
  const profile = data.profile || {};
  const parent = data.parent || {};
  const assign = (name, value) => {
    if (value == null) return;
    const el = form.querySelector(`[name="${name}"]`);
    if (el) el.value = value;
  };
  assign("name", profile.name);
  assign("dob", profile.dob);
  assign("phone", profile.phone);
  assign("grade", profile.grade);
  assign("address", profile.address);
  assign("parent_name", parent.name);
  assign("parent_email", parent.email);
  assign("parent_phone", parent.phone);
  syncGradePicker(profile.grade || "");
}

function fillTutorForm(data) {
  const form = $("#formTutor") || $("#form-tutor");
  if (!form || !data) return;
  const profile = data.profile || {};
  const tutor = data.tutor || {};
  const assign = (name, value) => {
    if (value == null) return;
    const el = form.querySelector(`[name="${name}"]`);
    if (el) el.value = value;
  };
  assign("name", profile.name);
  assign("dob", profile.dob);
  assign("cccd", profile.cccd);
  assign("phone", profile.phone);
  assign("address", profile.address);
  assign("subjects", tutor.subjects);
  assign("bio", tutor.bio);
  const levels = new Set(tutor.levels || []);
  form.querySelectorAll('input[name="levels[]"]').forEach(cb => {
    cb.checked = levels.has(cb.value);
  });
}

// ======================================================
// 1) Upload qua backend (ImgBB)
async function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function functionsBase() {
  const custom = (window.__TAEDU_API_BASE || "").trim();
  if (custom) return custom.replace(/\/$/, "");

  const project = "ta-edu-01";
  const region = "asia-southeast1";
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    return `http://127.0.0.1:5001/${project}/${region}`;
  }
  return `https://${region}-${project}.cloudfunctions.net`;
}

async function uploadViaBackend(file, name = `kyc-${Date.now()}`) {
  if (!file) return null;
  const dataUrl = await fileToDataURL(file);
  const resp = await fetch(`${functionsBase()}/imgbbUpload.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, name })
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error || "uploadViaBackend failed");
  return json.url;
}

// ======================================================
// 2) Firebase handles
let st = null, user = null;
let cachedDoc = null, cachedRole = null;
let gradePickerCtrl = null;

async function ensureFirebaseReady() {
  const { onAuthStateChanged } =
    await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js");
  const fbStorage = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-storage.js");

  st = fbStorage.getStorage();

  return new Promise(resolve => {
    onAuthStateChanged(auth, u => {
      user = u || null;
      if (!user) {
        toast("Vui lòng đăng nhập để tiếp tục.");
        location.href = "index.html";
        return;
      }
      resolve(user);
    });
  });
}

async function uploadToFirebase(path, file) {
  if (!file || !st) return null;
  const { ref, uploadBytes, getDownloadURL } =
    await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-storage.js");
  const r = ref(st, path);
  await uploadBytes(r, file);
  return await getDownloadURL(r);
}

async function safeUpload(path, file, label, allow) {
  const ck = checkFile(file, label, allow);
  if (!ck.ok) { toast(ck.msg); throw new Error(ck.msg); }

  const backendName = path.replace(/[\\/]/g, "_");

  if (USE_FIREBASE_STORAGE && st) {
    try {
      return await uploadToFirebase(path, file);
    } catch (e) {
      console.warn(`Storage upload failed for ${label}:`, e);
    }
  }

  try {
    return await uploadViaBackend(file, backendName);
  } catch (err) {
    console.warn("Upload backend cung l?i:", err);
    return null;
  }
}

async function fetchProfileFromApi() {
  if (!user) return null;
  try {
    const token = await user.getIdToken();
    const res = await getProfile(token);
    return adaptProfile(res?.profile);
  } catch (err) {
    console.warn("getProfile failed", err);
    return null;
  }
}

function adaptProfile(profile) {
  if (!profile) return null;
  return {
    role: profile.role || null,
    verify: {
      status: profile.verify_status || "unverified",
      reviewNote: profile.verify_note || "",
    },
    profile: {
      name: profile.display_name || "",
      dob: profile.student_dob || "",
      grade: profile.student_grade || "",
      phone: profile.student_phone || "",
      address: profile.student_address || "",
    },
    parent: {
      name: profile.parent_name || "",
      email: profile.parent_email || "",
      phone: profile.parent_phone || "",
    },
    tutor: {
      subjects: profile.tutor_subjects || [],
      levels: profile.tutor_levels || [],
      bio: profile.tutor_bio || "",
      cccd: profile.tutor_cccd || "",
      dob: profile.tutor_dob || "",
      certificates: profile.kyc_certificates || [],
    },
    kyc: {
      cccd_front: profile.kyc_cccd_front || "",
      cccd_back: profile.kyc_cccd_back || "",
      selfie: profile.kyc_selfie || "",
    },
  };
}

function docFromPayload(payload) {
  if (!payload) return null;
  return {
    role: payload.role,
    verify: payload.verify || { status: "submitted", reviewNote: "" },
    profile: payload.profile || {},
    parent: payload.parent || {},
    tutor: payload.tutor || {},
    kyc: payload.kyc || {},
  };
}

async function hydrateExistingData() {
  cachedDoc = await fetchProfileFromApi();
  const localStudent = readPayloadCache("student");
  const localTutor   = readPayloadCache("tutor");

  if (!cachedDoc) {
    cachedDoc = localStudent || localTutor || null;
  }

  cachedRole = cachedDoc?.role || storedRole() || localStudent?.role || localTutor?.role || null;
  if (cachedRole && user) lsSet(`taedu:role:${user.uid}`, cachedRole);
  highlightRole(cachedRole);

  if (cachedRole === "student") {
    fillStudentForm(cachedDoc?.role === "student" ? cachedDoc : localStudent);
  } else if (cachedRole === "tutor") {
    fillTutorForm(cachedDoc?.role === "tutor" ? cachedDoc : localTutor);
  }

  applyVerifyState(cachedDoc);
}

function applyVerifyState(doc) {
  const status = doc?.verify?.status;
  if (!status || status === "unverified") return;
  updateStatusCard(status, doc?.role || cachedRole || "student", doc?.verify?.reviewNote || "");
  goToStep("submitted");
}

function ensureInitialStep() {
  if (location.hash) {
    routeByHash();
    return;
  }
  const status = cachedDoc?.verify?.status;
  if (status && status !== "unverified") {
    goToStep("submitted");
    return;
  }
  const last = readLastStep();
  if (last) {
    goToStep(last);
    return;
  }
  if (cachedRole) {
    goToStep(cachedRole);
    return;
  }
  goToStep("select");
}

// ======================================================
// Grade picker (custom dropdown)
function initGradePicker() {
  const form = $("#formStudent") || $("#form-student");
  if (!form) return;
  const wrap   = form.querySelector('[data-grade-picker]');
  const toggle = wrap?.querySelector('[data-grade-toggle]');
  const label  = wrap?.querySelector('[data-grade-label]');
  const list   = wrap?.querySelector('[data-grade-list]');
  const select = form.querySelector('select[name="grade"]');
  if (!wrap || !toggle || !label || !list || !select) return;

  const options = Array.from(list.querySelectorAll('[data-grade-option]'));

  function closeList() {
    wrap.classList.remove("is-open");
    list.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }
  function openList() {
    wrap.classList.add("is-open");
    list.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  }

  toggle.addEventListener("click", e => {
    e.preventDefault();
    wrap.classList.contains("is-open") ? closeList() : openList();
  });
  document.addEventListener("click", e => {
    if (!wrap.contains(e.target)) closeList();
  });

  function applyValue(val) {
    select.value = val || "";
    label.textContent = val ? `L?p ${val}` : "Ch?n l?p";
    if (val) wrap.dataset.selected = "true";
    else wrap.dataset.selected = "";
    options.forEach(btn => btn.classList.toggle("is-selected", btn.dataset.value === val));
  }

  options.forEach(btn => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.value || "";
      applyValue(val);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeList();
    });
  });

  applyValue(select.value);
  closeList();

  gradePickerCtrl = { setValue: applyValue };
}

function syncGradePicker(val) {
  if (gradePickerCtrl) gradePickerCtrl.setValue(val || "");
}

// ======================================================
// 4) Role select
function bindRoleSelect() {
  $$(".ob__role[data-role]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!user) { toast("Vui l�ng dang nh?p."); location.href = "index.html"; return; }
      const role = btn.dataset.role;
      highlightRole(role);
      lsSet(`taedu:role:${user.uid}`, role);
      try {
        const token = await user.getIdToken();
        const res = await updateProfile(token, { role, verify_status: "unverified" });
        cachedDoc = adaptProfile(res?.profile);
        cachedRole = role;
      } catch (e) {
        console.warn("save role failed", e);
      }
      goToStep(role);
    });
  });
}

// ======================================================
// 5) Student form
function bindStudent() {
  const form = $("#formStudent") || $("#form-student");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!user) return toast("Phi�n dang nh?p d� h?t, vui l�ng dang nh?p l?i.");
    setBusy(form, true);

    try {
      const name   = val(form, "name");
      const dob    = val(form, "dob");
      const phone  = val(form, "phone");
      const grade  = val(form, "grade");
      const addr   = val(form, "address");
      const pName  = val(form, ["parent_name", "parentName"]);
      const pEmail = val(form, ["parent_email", "parentEmail"]);
      const pPhone = val(form, ["parent_phone", "parentPhone"]);
      const fFront = fileOne(form, ["cccd_front", "cccdFront"]);
      const fBack  = fileOne(form, ["cccd_back", "cccdBack"]);
      const fSelf  = fileOne(form, ["selfie", "kyc_selfie"]);

      if (!name || !dob || !phone || !grade || !pEmail || !fFront || !fBack) {
        toast("Vui l�ng di?n d? th�ng tin b?t bu?c v� t?i ?nh CCCD.");
        return;
      }

      const urlFront = await safeUpload(`kyc/${user.uid}/student_cccd_front.jpg`, fFront, "?nh CCCD/Th? HS (m?t tru?c)", ALLOW_IMG);
      const urlBack  = await safeUpload(`kyc/${user.uid}/student_cccd_back.jpg`,  fBack,  "?nh CCCD/Th? HS (m?t sau)", ALLOW_IMG);
      const urlSelf  = fSelf ? await safeUpload(`kyc/${user.uid}/student_selfie.jpg`, fSelf, "?nh selfie", ALLOW_IMG) : null;

      const payload = {
        role: "student",
        verify: { status: "submitted", submittedAt: Date.now(), reviewNote: "" },
        profile: { name, dob, phone, address: addr, grade },
        parent:  { name: pName, email: pEmail, phone: pPhone },
        kyc:     { cccd_front: urlFront, cccd_back: urlBack, selfie: urlSelf }
      };

      const token = await user.getIdToken();
      await updateProfile(token, {
        role: "student",
        verify_status: "submitted",
        student_grade: grade,
        student_phone: phone,
        student_address: addr,
        student_dob: dob,
        parent_name: pName,
        parent_email: pEmail,
        parent_phone: pPhone,
      });
      await submitKyc(token, {
        fullName: name,
        email: user.email || "",
        role: "student",
        payload,
      });
      storePayloadCache("student", payload);
      cachedDoc = docFromPayload(payload);
      cachedRole = "student";

      toast("Đã gửi hồ sơ học sinh. Vui lòng chờ duyệt.");
      updateStatusCard("submitted", "student");
      goToStep("submitted");
    } catch (err) {
      console.error("❌ Submit student KYC failed:", err);
      const msg = err.message || String(err);
      toast(`Lỗi gửi hồ sơ học sinh:\n${msg}\n\nKiểm tra Console (F12) để xem chi tiết.`);
    } finally {
      setBusy(form, false);
    }
  });
}

// ======================================================
// 6) Tutor form
function bindTutor() {
  const form = $("#formTutor") || $("#form-tutor");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!user) return toast("Phi�n dang nh?p d� h?t, vui l�ng dang nh?p l?i.");
    setBusy(form, true);

    try {
      const name     = val(form, "name");
      const dob      = val(form, "dob");
      const cccd     = val(form, ["cccd", "idNumber"]);
      const phone    = val(form, "phone");
      const address  = val(form, "address");
      const subjects = val(form, "subjects");
      const bio      = val(form, "bio");
      const levels   = Array.from(form.querySelectorAll('input[name="levels[]"]:checked')).map(el => el.value);
      const fFront   = fileOne(form, ["cccd_front", "cccdFront"]);
      const fBack    = fileOne(form, ["cccd_back", "cccdBack"]);
      const fSelf    = fileOne(form, ["selfie", "avatar"]);
      const fCerts   = fileMany(form, ["certs", "certificates"]);

      if (!name || !dob || !cccd || !phone || !subjects || levels.length === 0 || !fFront || !fBack || !fSelf) {
        toast("Vui l�ng di?n d? th�ng tin v� ch?n �t nh?t 1 l?p d?y.");
        return;
      }

      const urlFront = await safeUpload(`kyc/${user.uid}/tutor_cccd_front.jpg`, fFront, "?nh CCCD/CMND (m?t tru?c)", ALLOW_IMG);
      const urlBack  = await safeUpload(`kyc/${user.uid}/tutor_cccd_back.jpg`,  fBack,  "?nh CCCD/CMND (m?t sau)", ALLOW_IMG);
      const urlSelf  = await safeUpload(`kyc/${user.uid}/tutor_selfie.jpg`,     fSelf,  "?nh ch�n dung/selfie",      ALLOW_IMG);

      const certUrls = [];
      for (let i = 0; i < fCerts.length; i++) {
        const u = await safeUpload(`kyc/${user.uid}/cert_${i + 1}`, fCerts[i], `Ch?ng ch? #${i + 1}`, ALLOW_CERT);
        if (u) certUrls.push(u);
      }

      const payload = {
        role: "tutor",
        verify:  { status: "submitted", submittedAt: Date.now(), reviewNote: "" },
        profile: { name, dob, cccd, phone, address },
        tutor:   { subjects, levels, bio, certificates: certUrls },
        kyc:     { cccd_front: urlFront, cccd_back: urlBack, selfie: urlSelf }
      };

      const token = await user.getIdToken();
      await updateProfile(token, {
        role: "tutor",
        verify_status: "submitted",
        tutor_subjects: subjects ? subjects.split(",").map((s) => s.trim()).filter(Boolean) : null,
        tutor_levels: levels,
        tutor_bio: bio,
        tutor_cccd: cccd,
        tutor_dob: dob,
        student_address: address,
        student_phone: phone,
      });
      await submitKyc(token, {
        fullName: name,
        email: user.email || "",
        role: "tutor",
        payload,
      });
      storePayloadCache("tutor", payload);
      cachedDoc = docFromPayload(payload);
      cachedRole = "tutor";

      toast("Đã gửi hồ sơ gia sư. Vui lòng chờ duyệt.");
      updateStatusCard("submitted", "tutor");
      goToStep("submitted");
    } catch (err) {
      console.error("❌ Submit tutor KYC failed:", err);
      const msg = err.message || String(err);
      toast(`Lỗi gửi hồ sơ gia sư:\n${msg}\n\nKiểm tra Console (F12) để xem chi tiết.`);
    } finally {
      setBusy(form, false);
    }
  });
}

// ======================================================
// 7) Boot
function bindStatusCard() {
  window.addEventListener("hashchange", routeByHash);
}

document.addEventListener("DOMContentLoaded", async () => {
  bindStatusCard();
  bindBackButtons();
  bindStatusControls();
  initGradePicker();

  await ensureFirebaseReady();
  await hydrateExistingData();

  bindRoleSelect();
  bindStudent();
  bindTutor();

  if (location.hash) routeByHash();
  else ensureInitialStep();
});
