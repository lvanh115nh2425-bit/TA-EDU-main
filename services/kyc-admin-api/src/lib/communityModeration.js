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
  "đĩ điếm",
  "cho chet",
  "óc chó",
  "oc cho",
  "thằng ngu",
  "con ngu",
  "ngu lol",
  "ngu lon",
  "súc vật",
  "suc vat",
];

const ALLOWED_IMAGE_PREFIXES = [
  "data:image/jpeg;base64,",
  "data:image/png;base64,",
  "data:image/webp;base64,",
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

function sanitizeImageDataList(rawList) {
  if (!Array.isArray(rawList)) return { ok: true, value: [] };
  const clean = [];
  for (const item of rawList) {
    const result = sanitizeImageData(item);
    if (!result) {
      return { ok: false, code: "invalid_image_type", message: "Ảnh phải là JPG, PNG hoặc WebP." };
    }
    if (!result.ok) return result;
    if (result.value) clean.push(result.value);
  }
  return { ok: true, value: clean };
}

function parseDataUrl(dataUrl = "") {
  const match = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

function extractJsonObject(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {}

  const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (_) {}
  }

  return null;
}

async function moderateWithGemini({ texts = [], imageData = null, imageDataList = null } = {}) {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return { ok: true, provider: "local-only", skipped: true };

  const cleanTexts = texts.map((text) => String(text || "").trim()).filter(Boolean);
  const rawImages = Array.isArray(imageDataList) && imageDataList.length
    ? imageDataList
    : (imageData ? [imageData] : []);
  const imageParts = rawImages.map((item) => parseDataUrl(item)).filter(Boolean);
  if (!cleanTexts.length && !imageParts.length) {
    return { ok: true, provider: "gemini", skipped: true };
  }

  const instruction = [
    "You are a strict safety moderator for a Vietnamese education platform.",
    "Review the provided text and image if present.",
    "Flag sexual, pornographic, nude, gore, hateful, abusive, harassing, or otherwise unsafe content.",
    "Return ONLY valid JSON with keys flagged (boolean), reason (string), categories (array of strings).",
    "If content is safe, return flagged false and empty categories.",
  ].join(" ");

  const parts = [{ text: instruction }];
  cleanTexts.forEach((text, index) => {
    parts.push({ text: `TEXT_${index + 1}: ${text}` });
  });
  imageParts.forEach((imagePart, index) => {
    parts.push({ text: `IMAGE_${index + 1}` });
    parts.push({
      inline_data: {
        mime_type: imagePart.mimeType,
        data: imagePart.data,
      },
    });
  });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        code: "moderation_service_error",
        message: payload?.error?.message || "Dịch vụ kiểm duyệt Gemini đang tạm lỗi.",
      };
    }

    const text =
      payload?.candidates?.[0]?.content?.parts
        ?.map((part) => part?.text || "")
        .join("\n") || "";
    const parsed = extractJsonObject(text);
    if (!parsed) {
      return {
        ok: false,
        code: "moderation_service_error",
        message: "Gemini trả về kết quả kiểm duyệt không hợp lệ.",
      };
    }

    if (parsed.flagged) {
      return {
        ok: false,
        code: "moderated_by_ai",
        message: parsed.reason || "Nội dung hoặc hình ảnh bị Gemini đánh dấu là không phù hợp.",
        categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      };
    }

    return {
      ok: true,
      provider: "gemini",
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    };
  } catch (error) {
    return {
      ok: false,
      code: "moderation_service_error",
      message: "Không thể kết nối dịch vụ kiểm duyệt Gemini.",
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
  sanitizeImageDataList,
  isAdminProfile,
  moderateWithGemini,
  moderateWithOpenAI: moderateWithGemini,
};
