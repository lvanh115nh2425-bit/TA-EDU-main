// functions/index.js
// Clean, consolidated Functions v2 (Node 18). Keep CommonJS.
const { onRequest } = require("firebase-functions/v2/https");
const nodemailer = require("nodemailer");
const { GoogleGenerativeAI } = require("@google/generative-ai");

function pickGeminiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GENERATIVE_AI_KEY
  );
}

function extractJsonPayload(raw) {
  if (!raw) return "";
  const fence = raw.match(/```(?:json)?([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const firstBrace = body.indexOf("{");
  const lastBrace = body.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    return body.trim();
  }
  return body.slice(firstBrace, lastBrace + 1).trim();
}

function ensureMindmapNode(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 5) return null;
  const id =
    typeof node.id === "string" && node.id.trim()
      ? node.id.trim()
      : `${depth === 0 ? "root" : "node"}-${Math.random().toString(36).slice(2, 9)}`;
  const content =
    typeof node.content === "string" && node.content.trim()
      ? node.content.trim().slice(0, 140)
      : depth === 0
        ? "Ý tưởng chính"
        : `Ý tưởng ${depth}`;
  const sanitized = {
    id,
    content,
    children: [],
  };
  if (node.shape && typeof node.shape === "string") sanitized.shape = node.shape;
  if (node.position && typeof node.position === "object") sanitized.position = node.position;
  if (node.size && typeof node.size === "object") sanitized.size = node.size;
  if (node.style && typeof node.style === "object") sanitized.style = node.style;
  if (Array.isArray(node.children) && node.children.length) {
    sanitized.children = node.children
      .map((child) => ensureMindmapNode(child, depth + 1))
      .filter(Boolean)
      .slice(0, 6);
  }
  return sanitized;
}

function normalizeMockText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^tạo\s+mindmap\s*(về|cho)?\s*/i, "")
    .trim();
}

function createMockBranch(index, content, preset, children) {
  const shapes = ["rect", "oval", "cloud", "rect", "oval"];
  return {
    id: `branch-${index + 1}`,
    content,
    shape: shapes[index % shapes.length],
    style: { preset },
    children: children.map((child, childIndex) => ({
      id: `branch-${index + 1}-${childIndex + 1}`,
      content: child,
      shape: childIndex === 2 ? "oval" : "rect",
      children: []
    }))
  };
}

function buildMockMindmapTree(sourceText, rootTopic) {
  const seedText = normalizeMockText(sourceText || rootTopic || "Kế hoạch học tập");
  const lowerSeed = seedText.toLowerCase();
  const rootLabel = normalizeMockText(rootTopic || seedText || "Chủ đề chính").slice(0, 52) || "Chủ đề chính";

  let branches;

  if (lowerSeed.includes("ielts")) {
    branches = [
      createMockBranch(0, "Mục tiêu 6.5", "mint", ["Band hiện tại", "Band mục tiêu", "Mốc kiểm tra"]),
      createMockBranch(1, "Lộ trình 6 tháng", "peach", ["Tháng 1-2 nền tảng", "Tháng 3-4 tăng tốc", "Tháng 5-6 luyện đề"]),
      createMockBranch(2, "Nghe và đọc", "rose", ["Nghe chép chính tả", "Reading theo dạng bài", "Làm đề hằng tuần"]),
      createMockBranch(3, "Viết và nói", "yellow", ["Task 1, Task 2", "Speaking Part 1-3", "Chữa lỗi định kỳ"]),
      createMockBranch(4, "Tài liệu và kỷ luật", "lilac", ["Cambridge/IELTS App", "Lịch học tuần", "Theo dõi tiến độ"])
    ];
  } else if (lowerSeed.includes("toeic")) {
    branches = [
      createMockBranch(0, "Mục tiêu điểm", "mint", ["Điểm hiện tại", "Điểm mục tiêu", "Mốc thi thử"]),
      createMockBranch(1, "Từ vựng", "peach", ["Chủ đề quen thuộc", "Flashcard", "Ôn lặp lại"]),
      createMockBranch(2, "Listening", "rose", ["Part 1-2", "Part 3-4", "Nghe tốc độ thật"]),
      createMockBranch(3, "Reading", "yellow", ["Part 5", "Part 6", "Part 7"]),
      createMockBranch(4, "Luyện đề", "lilac", ["1 đề/tuần", "Chữa lỗi", "Rà soát chiến lược"])
    ];
  } else if (/(kế hoạch|lộ trình|trong \d+ tháng|theo tháng|theo tuần)/i.test(lowerSeed)) {
    branches = [
      createMockBranch(0, "Mục tiêu", "mint", ["Kết quả mong muốn", "Đầu ra cụ thể", "Thời hạn hoàn thành"]),
      createMockBranch(1, "Giai đoạn học", "peach", ["Nền tảng", "Tăng tốc", "Về đích"]),
      createMockBranch(2, "Lịch tuần", "rose", ["Buổi học chính", "Ôn tập", "Làm bài kiểm tra"]),
      createMockBranch(3, "Tài liệu", "yellow", ["Nguồn chính", "Bài tập thực hành", "Ghi chú cá nhân"]),
      createMockBranch(4, "Đánh giá", "lilac", ["Mốc kiểm tra", "Điều chỉnh kế hoạch", "Tự thưởng động lực"])
    ];
  } else {
    const keywords = seedText
      .split(/[\n,;:!?]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5);
    const topics = keywords.length
      ? keywords
      : ["Tổng quan", "Kiến thức chính", "Ví dụ", "Thực hành", "Đánh giá"];
    branches = topics.map((topic, index) =>
      createMockBranch(
        index,
        topic.slice(0, 28),
        ["mint", "peach", "rose", "yellow", "lilac"][index % 5],
        ["Ý chính 1", "Ý chính 2", "Ví dụ / ghi chú"]
      )
    );
  }

  return ensureMindmapNode({
    id: "root",
    content: rootLabel,
    shape: "pill",
    style: { preset: "purple" },
    children: branches
  });
}

// ========= SmartTutor (OpenAI) =========
exports.smarttutor = onRequest({ region: "asia-southeast1", cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).send("Server missing OPENAI_API_KEY");

    const OpenAI = require("openai");
    const openai = new OpenAI({ apiKey });

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const system = {
      role: "system",
      content: "Bạn là SmartTutor, giải thích ngắn gọn, dễ hiểu, từng bước.",
    };

    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [system, ...messages].slice(-12),
    });

    res.json({
      reply: (r.choices?.[0]?.message?.content || "").trim() || "Mình chưa có câu trả lời.",
    });
  } catch (e) {
    console.error("SmartTutor error:", e);
    res.status(500).send(e?.message || "OpenAI error");
  }
});

const GEMINI_SYSTEM_PROMPT = [
  "Bạn là trợ lý TA-Edu tạo sơ đồ tư duy cho học sinh phổ thông.",
  "Xuất duy nhất JSON thuần (không Markdown, không giải thích).",
  "Mẫu JSON:",
  "{",
  '  "id": "root",',
  '  "content": "Chủ đề",',
  '  "shape": "pill",',
  '  "children": [ { "id": "branch-1", "content": "Ý chính", "shape": "rect", "children": [] } ]',
  "}",
  "Quy tắc:",
  "1) Root tối đa 5 nhánh chính, mỗi nhánh tối đa 4 nhánh con, sâu tối đa 4 tầng.",
  "2) Viết tiếng Việt thân thiện, tối đa ~6 từ mỗi node.",
  "3) `shape` chỉ dùng: pill, rect, oval, cloud (root nên là pill).",
  "4) Có thể gợi ý màu bằng style.preset (purple, mint, peach, rose, yellow, lilac).",
  "5) Nếu nguồn là file, hãy cô đọng ý chính rồi ánh xạ thành node.",
  "6) Luôn có thuộc tính children (mảng, có thể rỗng) cho tất cả node.",
  "7) Không thêm thuộc tính lạ ngoài {id, content, shape, children, style}.",
].join("\n");

exports.mindmapAi = onRequest({ region: "asia-southeast1", cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (err) {
        body = {};
      }
    }
    body = body || {};

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const fileText = typeof body.fileText === "string" ? body.fileText.trim() : "";
    const rootTopic = typeof body.rootTopic === "string" ? body.rootTopic.trim() : "";
    if (!prompt && !fileText) {
      return res.status(400).json({ error: "missing_input" });
    }
    if (prompt && fileText) {
      return res.status(400).json({ error: "only_one_input" });
    }
    if (fileText.length > 15000) {
      return res.status(400).json({ error: "file_too_large" });
    }

    const mockMode =
      process.env.MINDMAP_AI_MOCK === "1" ||
      process.env.MINDMAP_AI_MOCK === "true" ||
      body.mock === true;

    if (mockMode) {
      return res.json({
        tree: buildMockMindmapTree(prompt || fileText, rootTopic),
        meta: {
          model: "mock-local",
          inputType: prompt ? "prompt" : "file",
          mock: true,
        },
      });
    }

    const apiKey = pickGeminiKey();
    if (!apiKey) {
      return res.status(500).json({
        error: "missing_gemini_key",
        message: "Chưa có GEMINI_API_KEY. Nếu muốn test local không cần quota, hãy bật MINDMAP_AI_MOCK=1.",
      });
    }

    const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { temperature: 0.85, topK: 32, topP: 0.9, maxOutputTokens: 2048 },
    });

    const inputDescriptor = prompt ? "Yêu cầu người dùng" : "Nội dung file TXT";
    const extra =
      typeof body.rootTopic === "string" && body.rootTopic.trim()
        ? `\nChủ đề gợi ý cho node gốc: ${body.rootTopic.trim()}`
        : "";

    const response = await model.generateContent([
      { text: GEMINI_SYSTEM_PROMPT },
      {
        text: `${inputDescriptor}:\n${prompt || fileText}${extra}`,
      },
    ]);

    const rawText = response?.response?.text?.() || "";
    const jsonCandidate = extractJsonPayload(rawText);
    let parsed;
    try {
      parsed = JSON.parse(jsonCandidate);
    } catch (err) {
      console.error("Gemini returned non-JSON:", rawText);
      return res.status(502).json({ error: "invalid_json_from_gemini" });
    }

    const tree = ensureMindmapNode(parsed);
    if (!tree) {
      return res.status(502).json({ error: "empty_tree" });
    }

    res.json({
      tree,
      meta: {
        model: modelName,
        inputType: prompt ? "prompt" : "file",
      },
    });
  } catch (err) {
    console.error("mindmapAi error:", err);
    const status = err.status || 500;
    const message = String(err?.message || "");
    const quotaExceeded =
      status === 429 ||
      message.includes("Too Many Requests") ||
      message.includes("Quota exceeded");

    if (quotaExceeded) {
      return res.status(429).json({
        error: "gemini_quota_exceeded",
        message: "AI tạm thời hết quota. Hãy đổi key/project Gemini khác hoặc bật billing rồi thử lại.",
      });
    }

    res.status(status).json({
      error: "mindmap_ai_error",
      message: message || "Không thể tạo mindmap bằng AI lúc này.",
    });
  }
});

// ========= Notify Parent (email) =========
function isEmail(x) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x || "").trim());
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || "false") === "true", // true = 465
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

exports.notifyParent = onRequest({ region: "asia-southeast1", cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const { event, parentEmail, user, data } = req.body || {};
    if (!isEmail(parentEmail)) return res.status(400).json({ error: "invalid parentEmail" });

    const subject =
      event === "withdraw_request"
        ? "[TA-Edu] Xác nhận yêu cầu rút tiền"
        : "[TA-Edu] Thông báo nạp tiền";

    const html = `
      <p>Phụ huynh thân mến,</p>
      <p>Học sinh: <b>${user?.name || user?.email || user?.uid || "Không rõ"}</b></p>
      <p>Sự kiện: <b>${event}</b></p>
      <p>Nội dung: <pre style="background:#f6f8f9;padding:10px;border-radius:8px">${JSON.stringify(data || {}, null, 2)}</pre></p>
      ${
        event === "withdraw_request"
          ? "<p><i>Yêu cầu rút đang chờ bạn xác nhận (trả lời email này hoặc xác nhận trên hệ thống).</i></p>"
          : ""
      }
      <p>Trân trọng,<br/>TA-Edu</p>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || `TA-Edu <${process.env.SMTP_USER}>`,
      to: parentEmail,
      subject,
      html,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("notifyParent error:", err);
    res.status(500).json({ ok: false, error: "email_send_failed" });
  }
});

// ========= ImgBB secure upload (server-side) =========
exports.imgbbUpload = onRequest({ region: "asia-southeast1", cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    const { dataUrl, name } = req.body || {};
    if (!dataUrl || typeof dataUrl !== "string") {
      return res.status(400).json({ error: "missing dataUrl" });
    }

    const key = process.env.IMGBB_KEY;
    if (!key) return res.status(500).json({ error: "IMGBB_KEY not set" });

    const base64 = dataUrl.includes("base64,") ? dataUrl.split("base64,")[1] : dataUrl;

    // Node 18 has global fetch & FormData
    const fd = new FormData();
    fd.append("image", base64);
    if (name) fd.append("name", name);

    const r = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, {
      method: "POST",
      body: fd,
    });
    const j = await r.json();
    if (!j?.success) {
      const msg = j?.error?.message || "ImgBB upload failed";
      return res.status(502).json({ error: msg, raw: j });
    }
    res.json({ url: j.data.url || j.data.display_url, raw: j.data });
  } catch (e) {
    console.error("imgbbUpload error:", e);
    res.status(500).json({ error: e.message || "server error" });
  }
});
