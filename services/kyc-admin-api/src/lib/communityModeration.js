const BLOCKED_WORDS = [
  "dm",
  "dmm",
  "đm",
  "đmm",
  "dit",
  "địt",
  "đụ",
  "du me",
  "đụ mẹ",
  "cặc",
  "cac",
  "lồn",
  "lon",
  "buoi",
  "buồi",
  "vcl",
  "vloz",
  "clm",
  "cmm",
  "đéo",
  "deo",
  "đĩ",
  "di~",
  "đĩ điếm",
  "cho chet",
  "óc chó",
  "oc cho",
  "thằng ngu",
  "con ngu",
  "ngu lol",
  "ngu lon",
  "súc vật",
  "suc vat"
];

const ALLOWED_IMAGE_PREFIXES = [
  "data:image/jpeg;base64,",
  "data:image/png;base64,",
  "data:image/webp;base64,"
];

function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsBlockedWords(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return BLOCKED_WORDS.some((word) => normalized.includes(normalizeText(word)));
}

function moderateTextFields(fields = []) {
  for (const field of fields) {
    if (containsBlockedWords(field?.value || "")) {
      return {
        ok: false,
        code: "blocked_language",
        message: `Nội dung ${field?.label || "bài đăng"} chứa từ ngữ không phù hợp.`,
      };
    }
  }
  return { ok: true };
}

function sanitizeTagList(tags) {
  if (!Array.isArray(tags)) return null;
  const clean = tags
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .filter((tag) => !containsBlockedWords(tag))
    .slice(0, 8);
  return clean.length ? clean : null;
}

function sanitizeImageData(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const allowed = ALLOWED_IMAGE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
  if (!allowed) {
    return { ok: false, code: "invalid_image_type", message: "Ảnh phải là JPG, PNG hoặc WebP." };
  }
  if (Buffer.byteLength(trimmed, "utf-8") > 4 * 1024 * 1024) {
    return { ok: false, code: "image_too_large", message: "Ảnh vượt quá dung lượng cho phép." };
  }
  return { ok: true, value: trimmed };
}

async function moderateWithOpenAI({ texts = [], imageData = null } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: true, provider: "local-only", skipped: true };

  const input = [];
  texts
    .map((text) => String(text || "").trim())
    .filter(Boolean)
    .forEach((text) => {
      input.push({ type: "text", text });
    });

  if (imageData) {
    input.push({
      type: "image_url",
      image_url: { url: imageData },
    });
  }

  if (!input.length) return { ok: true, provider: "openai", skipped: true };

  try {
    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        code: "moderation_service_error",
        message: payload?.error?.message || "Dịch vụ kiểm duyệt AI đang tạm lỗi.",
      };
    }

    const result = Array.isArray(payload?.results) ? payload.results[0] : null;
    if (result?.flagged) {
      return {
        ok: false,
        code: "moderated_by_ai",
        message: "Nội dung hoặc hình ảnh bị hệ thống AI đánh dấu là không phù hợp.",
        categories: result.categories || {},
      };
    }

    return { ok: true, provider: "openai", categories: result?.categories || {} };
  } catch (error) {
    return {
      ok: false,
      code: "moderation_service_error",
      message: "Không thể kết nối dịch vụ kiểm duyệt AI.",
      detail: error?.message || String(error),
    };
  }
}

function isAdminProfile(user, profile) {
  if (profile?.role === "admin") return true;
  if (user?.role === "admin") return true;
  const configured =
    typeof process.env.ADMIN_EMAILS === "string" && process.env.ADMIN_EMAILS.trim()
      ? process.env.ADMIN_EMAILS.split(",")
      : ["khkt.anhtu@gmail.com", "lvanh.115nh2425@gmail.com"];
  const emails = configured.map((item) => item.trim().toLowerCase()).filter(Boolean);
  return emails.includes(String(user?.email || "").toLowerCase());
}

module.exports = {
  moderateTextFields,
  sanitizeTagList,
  sanitizeImageData,
  isAdminProfile,
  moderateWithOpenAI,
};
