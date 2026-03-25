import { auth, firebaseConfig } from "../core/firebase.js";
import { getProfile, updateProfile } from "../utils/api.js";

const $ = (selector, root = document) => root.querySelector(selector);
const toast = (message) => alert(message);
const LAST_EMAIL_KEY = "taedu:last-auth-email";

let currentUser = null;

function setBusy(form, busy) {
  const submit = form?.querySelector('button[type="submit"]');
  if (!submit) return;
  submit.disabled = !!busy;
  if (!submit.dataset.originalText) {
    submit.dataset.originalText = submit.textContent.trim();
  }
  submit.textContent = busy ? "Đang lưu..." : submit.dataset.originalText;
}

function setStep(step) {
  document.querySelectorAll("section[data-step]").forEach((section) => {
    section.hidden = section.dataset.step !== step;
  });
}

function resolveUserEmail(profile = {}, user = null) {
  const providerEmail = Array.isArray(user?.providerData)
    ? user.providerData.map((item) => item?.email || "").find(Boolean)
    : "";
  const reloadInfoEmail = user?.reloadUserInfo?.email || "";
  const authCurrentEmail = auth?.currentUser?.email || "";
  const windowCachedEmail = window.__TAEDU_LAST_USER?.email || "";
  let cachedEmail = "";
  try {
    cachedEmail = localStorage.getItem(LAST_EMAIL_KEY) || "";
  } catch (_) {}
  return String(
    profile?.email ||
    user?.email ||
    providerEmail ||
    reloadInfoEmail ||
    authCurrentEmail ||
    windowCachedEmail ||
    cachedEmail ||
    ""
  ).trim();
}

async function resolveUserEmailAsync(profile = {}, user = null) {
  const syncValue = resolveUserEmail(profile, user);
  if (syncValue) return syncValue;

  try {
    const tokenResult = await user?.getIdTokenResult?.();
    const claimEmail = tokenResult?.claims?.email || "";
    if (claimEmail) return String(claimEmail).trim();
  } catch (_) {}

  try {
    const token = await user?.getIdToken?.();
    if (token) {
      const base64Url = token.split(".")[1] || "";
      const normalized = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
      const payload = JSON.parse(atob(padded));
      const tokenEmail = payload?.email || "";
      if (tokenEmail) return String(tokenEmail).trim();
    }
  } catch (_) {}

  try {
    const token = await user?.getIdToken?.();
    const apiKey = firebaseConfig?.apiKey || "";
    if (token && apiKey) {
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      });
      const data = await response.json().catch(() => ({}));
      const lookupEmail = data?.users?.[0]?.email || "";
      if (lookupEmail) return String(lookupEmail).trim();
    }
  } catch (_) {}

  return "";
}

function isProfileComplete(profile = {}, user = null) {
  const email = resolveUserEmail(profile, user);
  return Boolean(
    (profile.role || "").trim() &&
    (profile.display_name || "").trim() &&
    (profile.full_name || "").trim() &&
    (profile.student_grade || "").trim() &&
    (profile.student_phone || "").trim() &&
    email
  );
}

function validateRestrictedEmail(raw) {
  const email = String(raw || "").trim();
  if (!email) {
    return { ok: false, message: "Vui lòng nhập email." };
  }

  const atCount = (email.match(/@/g) || []).length;
  if (atCount !== 1 || !email.includes("@")) {
    return { ok: false, message: "Email phải có @example.com" };
  }

  const [localPart, domainPart] = email.split("@");
  if (!localPart || !domainPart) {
    return { ok: false, message: "Email phải có @example.com" };
  }

  if (/[.+]/.test(localPart)) {
    return { ok: false, message: 'Tên gmail không được chứa "." hoặc "+".' };
  }

  if (!/^[A-Za-z0-9]+$/.test(localPart)) {
    return { ok: false, message: "Tên gmail chỉ được dùng chữ và số." };
  }

  if (!domainPart.includes(".") || domainPart.startsWith(".") || domainPart.endsWith(".")) {
    return { ok: false, message: "Email phải có @example.com" };
  }

  return { ok: true, value: email.toLowerCase() };
}

function initGradePicker(form) {
  const picker = form?.querySelector("[data-grade-picker]");
  if (!picker) return;

  const nativeSelect = picker.querySelector('.grade-picker__native[name="student_grade"]');
  const toggle = picker.querySelector("[data-grade-toggle]");
  const list = picker.querySelector("[data-grade-list]");
  const label = picker.querySelector("[data-grade-label]");
  const optionButtons = Array.from(picker.querySelectorAll("[data-grade-option]"));

  if (!nativeSelect || !toggle || !list || !label || !optionButtons.length) return;

  const syncGradePicker = () => {
    const value = nativeSelect.value || "";
    const activeOption = optionButtons.find((button) => button.dataset.gradeOption === value) || optionButtons[0];
    label.textContent = activeOption.textContent.trim();
    picker.classList.toggle("has-value", Boolean(value));
    optionButtons.forEach((button) => {
      button.classList.toggle("is-selected", button === activeOption);
    });
  };

  const closePicker = () => {
    picker.classList.remove("is-open");
    list.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };

  const openPicker = () => {
    picker.classList.add("is-open");
    list.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  };

  toggle.addEventListener("click", () => {
    if (picker.classList.contains("is-open")) closePicker();
    else openPicker();
  });

  optionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      nativeSelect.value = button.dataset.gradeOption || "";
      syncGradePicker();
      closePicker();
      nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  nativeSelect.addEventListener("change", syncGradePicker);

  document.addEventListener("click", (event) => {
    if (!picker.contains(event.target)) closePicker();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePicker();
  });

  syncGradePicker();
}

function fillForm(profile = {}, user = null) {
  const form = $("#profileForm");
  if (!form) return;

  const displayName = form.querySelector('[name="display_name"]');
  const fullName = form.querySelector('[name="full_name"]');
  const roleInputs = form.querySelectorAll('[name="role"]');
  const grade = form.querySelector('[name="student_grade"]');
  const email = form.querySelector('[name="email"]');
  const phone = form.querySelector('[name="student_phone"]');
  const privacy = form.querySelector('[name="privacy_commitment"]');

  roleInputs.forEach((input) => {
    input.checked = input.value === (profile.role || "student");
  });

  if (displayName) {
    displayName.value = profile.display_name || user?.displayName || "";
  }
  if (fullName) {
    fullName.value = profile.full_name || user?.displayName || "";
  }
  if (grade) {
    grade.value = profile.student_grade || "";
    grade.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (email) {
    email.value = resolveUserEmail(profile, user);
  }
  if (phone) {
    phone.value = profile.student_phone || "";
  }
  if (privacy) {
    privacy.checked = isProfileComplete(profile, user);
  }
}

function fillEmailField(profile = {}, user = null) {
  const form = $("#profileForm");
  const emailInput = form?.querySelector('[name="email"]');
  const debugNote = $("#emailDebugNote");
  if (!emailInput) return;
  const resolved = resolveUserEmail(profile, user);
  if (resolved) {
    emailInput.value = resolved;
    if (debugNote) debugNote.textContent = `Đã lấy email: ${resolved}`;
  } else if (debugNote) {
    const authEmail = auth?.currentUser?.email || "";
    const providerEmail = Array.isArray(user?.providerData)
      ? user.providerData.map((item) => item?.email || "").find(Boolean)
      : "";
    const cached = (() => {
      try {
        return localStorage.getItem(LAST_EMAIL_KEY) || "";
      } catch (_) {
        return "";
      }
    })();
    debugNote.textContent =
      `Chưa lấy được email. auth=${authEmail || "rỗng"}, provider=${providerEmail || "rỗng"}, cache=${cached || "rỗng"}`;
  }
}

async function ensureEmailVisible(profile = {}, user = null) {
  fillEmailField(profile, user);
  const form = $("#profileForm");
  const emailInput = form?.querySelector('[name="email"]');
  const asyncEmail = await resolveUserEmailAsync(profile, user);
  if (asyncEmail && emailInput) {
    emailInput.value = asyncEmail;
    try {
      localStorage.setItem(LAST_EMAIL_KEY, asyncEmail);
    } catch (_) {}
    const debugNote = $("#emailDebugNote");
    if (debugNote) debugNote.textContent = `Đã lấy email async: ${asyncEmail}`;
  }
  if (!emailInput?.value && user?.reload) {
    try {
      await user.reload();
    } catch (_) {}
    const refreshedUser = auth.currentUser || user;
    const refreshedEmail = await resolveUserEmailAsync(profile, refreshedUser);
    if (emailInput && refreshedEmail) {
      emailInput.value = refreshedEmail;
      try {
        localStorage.setItem(LAST_EMAIL_KEY, refreshedEmail);
      } catch (_) {}
      const debugNote = $("#emailDebugNote");
      if (debugNote) debugNote.textContent = `Đã lấy email sau reload: ${refreshedEmail}`;
    } else {
      fillEmailField(profile, refreshedUser);
    }
  }

  if (emailInput?.value) return;

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    fillEmailField(profile, auth.currentUser || user || window.__TAEDU_LAST_USER || null);
    if (emailInput?.value || attempts >= 8) {
      clearInterval(timer);
    }
  }, 300);
}

async function loadExistingProfile(user) {
  try {
    const token = await user.getIdToken();
    const response = await getProfile(token);
    return response?.profile || null;
  } catch (error) {
    console.warn("loadExistingProfile failed", error);
    return null;
  }
}

async function initUser() {
  return new Promise((resolve) => {
    auth.onAuthStateChanged((user) => {
      if (!user) {
        toast("Vui lòng đăng nhập để tiếp tục.");
        location.href = "index.html";
        return;
      }
      currentUser = user;
      resolve(user);
    });
  });
}

async function saveProfile(form) {
  if (!currentUser) {
    toast("Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.");
    location.href = "index.html";
    return;
  }

  setBusy(form, true);

  try {
    const formData = new FormData(form);
    const selectedRole = (formData.get("role") || "").toString().trim();
    const payload = {
      display_name: (formData.get("display_name") || "").toString().trim(),
      full_name: (formData.get("full_name") || "").toString().trim(),
      student_grade: (formData.get("student_grade") || "").toString().trim(),
      email: resolveUserEmail({}, currentUser) || (formData.get("email") || "").toString().trim(),
      student_phone: (formData.get("student_phone") || "").toString().trim(),
      role: selectedRole,
      verify_status: "approved",
      verify_note: null,
    };

    if (!payload.role || !payload.display_name || !payload.full_name || !payload.student_grade || !payload.email || !payload.student_phone) {
      toast("Vui lòng chọn vai trò và nhập đầy đủ Biệt danh, Họ và tên, Lớp, Email và Số điện thoại.");
      return;
    }

    const emailValidation = validateRestrictedEmail(payload.email);
    if (!emailValidation.ok) {
      toast(emailValidation.message);
      return;
    }
    payload.email = emailValidation.value;

    if (!formData.get("privacy_commitment")) {
      toast("Vui lòng xác nhận điều khoản bảo mật thông tin.");
      return;
    }

    const token = await currentUser.getIdToken();
    await updateProfile(token, payload);

    try {
      localStorage.setItem(`taedu:role:${currentUser.uid}`, payload.role);
      localStorage.setItem(`taedu:profile-complete:${currentUser.uid}`, "1");
    } catch (_) {}

    setStep("success");
    setTimeout(() => {
      location.href = "dashboard.html";
    }, 500);
  } catch (error) {
    console.error("saveProfile failed", error);
    toast("Không lưu được thông tin. Vui lòng thử lại.");
  } finally {
    setBusy(form, false);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  setStep("profile");

  const form = $("#profileForm");
  if (!form) return;

  initGradePicker(form);

  const user = await initUser();
  const profile = await loadExistingProfile(user);
  fillForm(profile, user);
  await ensureEmailVisible(profile, user);

  if (isProfileComplete(profile, user)) {
    try {
      localStorage.setItem(`taedu:role:${user.uid}`, profile?.role || "student");
      localStorage.setItem(`taedu:profile-complete:${user.uid}`, "1");
    } catch (_) {}
    setStep("success");
    setTimeout(() => {
      location.href = "dashboard.html";
    }, 300);
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveProfile(form);
  });
});
