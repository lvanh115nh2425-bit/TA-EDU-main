const express = require("express");
const router = express.Router();
const { query } = require("../db");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { generateEmbedding, TaskType } = require("../lib/embeddings");
const { EXAM_SYSTEM_PROMPT, GRADE_ESSAY_SYSTEM_PROMPT, EXERCISE_SYSTEM_PROMPT, buildExamGeneratePrompt, buildGradeEssayPrompt, buildExerciseGeneratePrompt } = require("../lib/examPrompts");
const { examSafetyMiddleware } = require("../middleware/examSafety");

// Initialize Gemini
const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
const hasValidKey = geminiKey.length > 0 && geminiKey !== "YOUR_API_KEY_HERE";
if (hasValidKey) {
  console.log(`[Exam] GEMINI_API_KEY: ${geminiKey.substring(0, 8)}... (${geminiKey.length} chars)`);
} else {
  console.log(`[Exam] GEMINI_API_KEY: NOT SET`);
}

const genAI = hasValidKey ? new GoogleGenerativeAI(geminiKey) : null;
const GEMINI_MODEL = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
/** Model dự phòng cho Tạo bài tập — free tier tính quota theo từng model; 2.0 thường có ngân riêng với 2.5 */
const GEMINI_MODEL_EXERCISE_FALLBACK = (process.env.GEMINI_MODEL_EXERCISE_FALLBACK || "gemini-2.0-flash").trim();

const generateModel = genAI ? genAI.getGenerativeModel({
  model: GEMINI_MODEL,
  systemInstruction: EXAM_SYSTEM_PROMPT,
  generationConfig: { temperature: 0.7, maxOutputTokens: 4096, topP: 0.9 },
}) : null;
const gradeModel = genAI ? genAI.getGenerativeModel({
  model: GEMINI_MODEL,
  systemInstruction: GRADE_ESSAY_SYSTEM_PROMPT,
  generationConfig: { temperature: 0.3, maxOutputTokens: 2048, topP: 0.8 },
}) : null;

// ── KTPL Keyword Mappings ────────────────────────────────────────────
const KTPL_KEYWORD_MAPPINGS = {
  'ngân sách': ['ngân sách', 'ngân sách nhà nước', 'thu chi', 'thuế'],
  'thị trường': ['thị trường', 'cung cầu', 'giá cả', 'cạnh tranh'],
  'cạnh tranh': ['cạnh tranh', 'độc quyền', 'thị trường'],
  'cung cầu': ['cung cầu', 'cung', 'cầu', 'giá cả', 'thị trường'],
  'việc làm': ['việc làm', 'lao động', 'tuyển dụng', 'thất nghiệp'],
  'kinh doanh': ['kinh doanh', 'doanh nghiệp', 'sản xuất', 'lợi nhuận'],
  'bảo hiểm': ['bảo hiểm', 'bảo hiểm xã hội', 'bảo hiểm y tế'],
  'an sinh': ['an sinh', 'an sinh xã hội', 'phúc lợi', 'bảo hiểm'],
  'hội nhập': ['hội nhập', 'hội nhập quốc tế', 'toàn cầu hóa'],
  'thuế': ['thuế', 'nộp thuế', 'thuế suất', 'ngân sách'],
  'tiêu dùng': ['tiêu dùng', 'người tiêu dùng', 'quyền lợi'],
  'sản xuất': ['sản xuất', 'kinh doanh', 'hàng hóa', 'dịch vụ'],
  'lạm phát': ['lạm phát', 'giá cả', 'tiền tệ'],
  'ngân hàng': ['ngân hàng', 'tín dụng', 'tiền tệ', 'lãi suất'],
  'pháp luật': ['pháp luật', 'quy phạm', 'văn bản pháp luật'],
  'hiến pháp': ['hiến pháp', 'quyền con người', 'quyền công dân'],
  'quyền': ['quyền', 'nghĩa vụ', 'quyền lợi', 'quyền công dân'],
  'bình đẳng': ['bình đẳng', 'bình đẳng giới', 'công bằng'],
  'dân chủ': ['dân chủ', 'bầu cử', 'ứng cử'],
  'hôn nhân': ['hôn nhân', 'gia đình', 'kết hôn'],
  'lao động': ['lao động', 'người lao động', 'hợp đồng lao động', 'việc làm'],
};

const STOP_WORDS = new Set([
  'theo', 'của', 'trong', 'này', 'cho', 'với', 'các', 'những', 'được', 'như',
  'hoặc', 'bao', 'nhiêu', 'là', 'có', 'không', 'một', 'và', 'về', 'tại',
  'khi', 'thì', 'nếu', 'để', 'từ', 'đến', 'đó', 'mà', 'nào', 'gì',
  'rằng', 'cũng', 'đã', 'sẽ', 'phải', 'còn', 'hay', 'nhưng', 'bạn',
  'nên', 'đây', 'thế', 'vậy', 'sau', 'trước', 'trên', 'dưới',
]);

// ── Vector search against exam_knowledge ─────────────────────────────
async function performVectorSearch(topic, grade, limit = 20) {
  const embedding = await generateEmbedding(topic, TaskType.RETRIEVAL_QUERY);
  if (!embedding) return [];

  try {
    const { rows } = await query(
      `SELECT id, source_name, grade, chapter, section_title, content,
              1 - (embedding <=> $1::vector) as vector_similarity
       FROM exam_knowledge
       WHERE embedding IS NOT NULL
         AND grade = $2
         AND 1 - (embedding <=> $1::vector) >= 0.15
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [JSON.stringify(embedding), String(grade), limit]
    );
    return rows;
  } catch (err) {
    console.error("[Exam] Vector search error:", err.message);
    return [];
  }
}

// ── Keyword search against exam_knowledge ────────────────────────────
async function performKeywordSearch(topic, grade, limit = 15) {
  const normalized = topic.toLowerCase().trim();

  const highTerms = new Set();
  const lowTerms = new Set();

  Object.entries(KTPL_KEYWORD_MAPPINGS).forEach(([key, values]) => {
    if (normalized.includes(key)) {
      values.forEach(v => highTerms.add(v));
    }
  });

  normalized.split(/\s+/).forEach(w => {
    if (w.length >= 3 && !STOP_WORDS.has(w) && !highTerms.has(w)) {
      lowTerms.add(w);
    }
  });

  const allTerms = [...highTerms, ...lowTerms];
  if (allTerms.length === 0) return [];

  let results = [];

  try {
    if (highTerms.size > 0) {
      const hTerms = [...highTerms];
      // grade param at index 1, terms start at index 2
      const termPlaceholders = hTerms.map((_, i) => `$${i + 2}`);
      const searchConditions = termPlaceholders.map(p =>
        `(content ILIKE ${p} OR section_title ILIKE ${p})`
      ).join(' OR ');
      const countConditions = termPlaceholders.map(p =>
        `(CASE WHEN section_title ILIKE ${p} THEN 5 ELSE 0 END) +
         (CASE WHEN content ILIKE ${p} THEN 2 ELSE 0 END)`
      ).join(' + ');

      const params = [String(grade), ...hTerms.map(t => `%${t}%`)];
      const { rows } = await query(
        `SELECT DISTINCT id, source_name, grade, chapter, section_title, content,
                (${countConditions}) as relevance_score
         FROM exam_knowledge
         WHERE grade = $1 AND (${searchConditions})
         ORDER BY relevance_score DESC
         LIMIT 10`,
        params
      );
      results.push(...rows);
    }

    if (results.length < 5 && lowTerms.size > 0) {
      const lTerms = [...lowTerms];
      const existingIds = results.map(r => r.id);
      const offset = 2;
      const termPlaceholders = lTerms.map((_, i) => `$${i + offset}`);
      const searchConditions = termPlaceholders.map(p =>
        `(content ILIKE ${p} OR section_title ILIKE ${p})`
      ).join(' OR ');
      const countConditions = termPlaceholders.map(p =>
        `(CASE WHEN section_title ILIKE ${p} THEN 2 ELSE 0 END) +
         (CASE WHEN content ILIKE ${p} THEN 1 ELSE 0 END)`
      ).join(' + ');

      const params = [String(grade), ...lTerms.map(t => `%${t}%`)];
      const { rows } = await query(
        `SELECT DISTINCT id, source_name, grade, chapter, section_title, content,
                (${countConditions}) as relevance_score
         FROM exam_knowledge
         WHERE grade = $1 AND (${searchConditions})
           AND id NOT IN (${existingIds.join(',') || '0'})
         ORDER BY relevance_score DESC
         LIMIT 5`,
        params
      );
      results.push(...rows);
    }

    return results
      .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
      .slice(0, limit);
  } catch (err) {
    console.error("[Exam] Keyword search error:", err.message);
    return [];
  }
}

// ── Hybrid search with RRF ───────────────────────────────────────────
async function performHybridSearch(topic, grade) {
  const [vectorResults, keywordResults] = await Promise.all([
    performVectorSearch(topic, grade, 20),
    performKeywordSearch(topic, grade, 15),
  ]);

  const k = 60;
  const scores = new Map();
  const articleMap = new Map();

  const VECTOR_WEIGHT = 1.0;
  const KEYWORD_WEIGHT = 2.0;

  vectorResults.forEach((row, rank) => {
    scores.set(row.id, (scores.get(row.id) || 0) + VECTOR_WEIGHT / (k + rank + 1));
    articleMap.set(row.id, row);
  });

  keywordResults.forEach((row, rank) => {
    scores.set(row.id, (scores.get(row.id) || 0) + KEYWORD_WEIGHT / (k + rank + 1));
    if (!articleMap.has(row.id)) articleMap.set(row.id, row);
  });

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, score]) => ({
      ...articleMap.get(id),
      relevance_score: score,
    }));
}

// ── Fetch exam template ──────────────────────────────────────────────
async function getExamTemplate(grade) {
  try {
    const { rows } = await query(
      `SELECT raw_content, mc_example, tf_example, essay_example FROM exam_templates WHERE grade = $1 LIMIT 1`,
      [String(grade)]
    );
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.warn("[Exam] Failed to fetch template:", err.message);
    return null;
  }
}

// ── Parse JSON from Gemini response (strip markdown fences) ──────────
function parseExamJSON(text) {
  let cleaned = text.trim();

  // Strip markdown fences (```json ... ```)
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else {
    // Fallback: extract first { ... } or [ ... ] block
    const braceStart = cleaned.indexOf('{');
    const bracketStart = cleaned.indexOf('[');
    const start = braceStart >= 0 && (bracketStart < 0 || braceStart < bracketStart)
      ? braceStart : bracketStart;
    if (start > 0) cleaned = cleaned.substring(start);
  }

  // Strip trailing text after the last matching } or ]
  // (Gemini sometimes appends explanatory text after the JSON)
  const firstChar = cleaned.charAt(0);
  if (firstChar === '{' || firstChar === '[') {
    const closeChar = firstChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    let endPos = -1;
    const openStack = [];          // track nesting for truncation repair
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') openStack.push('}');
      else if (ch === '[') openStack.push(']');
      else if (ch === '}' || ch === ']') openStack.pop();
      if (ch === firstChar) depth++;
      else if (ch === closeChar) { depth--; if (depth === 0) { endPos = i; break; } }
    }
    if (endPos > 0 && endPos < cleaned.length - 1) {
      cleaned = cleaned.substring(0, endPos + 1);
    }

    // Repair truncated JSON: if Gemini hit token limit and the JSON is incomplete,
    // try to salvage it by closing open strings and brackets
    if (endPos < 0 && openStack.length > 0) {
      console.warn(`[parseExamJSON] Truncated JSON detected (${openStack.length} unclosed brackets), attempting repair...`);
      // Close any open string
      if (inString) cleaned += '"';
      // Remove trailing incomplete key-value (e.g. "question": "some trun...)
      cleaned = cleaned.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}[\]]*$/, '');
      cleaned = cleaned.replace(/,\s*$/, '');
      // Close all open brackets in reverse order
      while (openStack.length > 0) cleaned += openStack.pop();
    }
  }

  // Sanitise control characters ONLY inside JSON string values
  // (Gemini sometimes emits raw \n \r \t inside strings)
  // We walk the string tracking whether we're inside a quoted value;
  // structural whitespace outside strings is left untouched.
  let sanitized = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const code = cleaned.charCodeAt(i);
    if (esc) { esc = false; sanitized += ch; continue; }
    if (ch === '\\' && inStr) { esc = true; sanitized += ch; continue; }
    if (ch === '"') { inStr = !inStr; sanitized += ch; continue; }
    if (inStr && code >= 0x00 && code <= 0x1f) {
      // Replace control characters inside string values
      if (ch === '\n') { sanitized += '\\n'; }
      else if (ch === '\r') { /* drop carriage returns */ }
      else if (ch === '\t') { sanitized += '\\t'; }
      else { sanitized += ''; }
    } else {
      sanitized += ch;
    }
  }

  try {
    return JSON.parse(sanitized);
  } catch (e) {
    console.warn("[parseExamJSON] JSON.parse failed:", e.message, "| head:", sanitized.substring(0, 480));
    return null;
  }
}

/** Chuẩn hóa output Gemini khi lệch tên field (vd. multiple_choice thay vì mcq). */
function normalizeExerciseGeminiOutput(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mcq = Array.isArray(raw.mcq)
    ? raw.mcq
    : Array.isArray(raw.multiple_choice)
      ? raw.multiple_choice
      : null;
  const essay = Array.isArray(raw.essay)
    ? raw.essay
    : Array.isArray(raw.Essay)
      ? raw.Essay
      : null;
  if (mcq === null && essay === null) return raw;
  return { ...raw, mcq: mcq || raw.mcq || [], essay: essay || raw.essay || [] };
}

// ── Validate exam structure ──────────────────────────────────────────
function validateExamStructure(exam) {
  if (!exam || typeof exam !== 'object') return false;
  if (!Array.isArray(exam.multiple_choice)) return false;
  if (!Array.isArray(exam.true_false)) return false;
  if (!Array.isArray(exam.essay)) return false;
  return true;
}

// ── Normalize Gemini exam output for frontend ───────────────────────
function normalizeExamForFrontend(exam, config) {
  // Ensure options are arrays (frontend expects array, Gemini may return object)
  if (exam.multiple_choice) {
    exam.multiple_choice = exam.multiple_choice.map((q) => {
      if (q.options && !Array.isArray(q.options)) {
        q.options = ["A", "B", "C", "D"].map((key) => `${key}. ${q.options[key] || ""}`);
      }
      return q;
    });
  }

  // Ensure TF answers use D/S format (frontend expects "D"/"S", Gemini might use true/false)
  if (exam.true_false) {
    exam.true_false = exam.true_false.map((q) => {
      if (q.answers) {
        const normalized = {};
        for (const [key, val] of Object.entries(q.answers)) {
          if (typeof val === "boolean") {
            normalized[key] = val ? "D" : "S";
          } else if (typeof val === "string") {
            const upper = val.trim().toUpperCase();
            normalized[key] = upper === "TRUE" || upper === "ĐÚNG" || upper === "D" ? "D" : "S";
          } else {
            normalized[key] = String(val);
          }
        }
        q.answers = normalized;
      }
      return q;
    });
  }

  // Add meta if missing
  if (!exam.meta) {
    exam.meta = {
      subject: "Kinh tế & Pháp luật",
      grade: `Lớp ${config.grade}`,
      topic: config.topic,
      difficulty: config.difficulty === "easy" ? "Dễ" : config.difficulty === "hard" ? "Khó" : "Trung bình",
    };
  }

  return exam;
}

// ── Mock exam fallback ───────────────────────────────────────────────
function generateMockExam(config) {
  const mcCount = config.multipleChoiceCount || 12;
  const tfCount = config.trueFalseCount || 4;
  const essayCount = config.essayCount || 1;
  return {
    meta: {
      subject: "Kinh tế & Pháp luật",
      grade: `Lớp ${config.grade}`,
      topic: config.topic,
      difficulty: config.difficulty === "easy" ? "Dễ" : config.difficulty === "hard" ? "Khó" : "Trung bình",
    },
    multiple_choice: Array.from({ length: mcCount }).map((_, i) => ({
      question: `Câu hỏi minh họa ${i + 1} về ${config.topic} (KTPL Lớp ${config.grade})`,
      options: ["A. Đáp án 1", "B. Đáp án 2", "C. Đáp án 3", "D. Đáp án 4"],
      correct: "A",
      level: i < 4 ? "nhận biết" : i < 8 ? "thông hiểu" : "vận dụng",
      explanation: "Đây là câu hỏi minh họa (AI không khả dụng).",
    })),
    true_false: Array.from({ length: tfCount }).map((_, i) => ({
      question: `Nhận định về ${config.topic} (câu ${i + 1})`,
      items: {
        a: `Phát biểu a liên quan đến ${config.topic}.`,
        b: `Phát biểu b liên quan đến ${config.topic}.`,
        c: `Phát biểu c liên quan đến ${config.topic}.`,
        d: `Phát biểu d liên quan đến ${config.topic}.`,
      },
      answers: { a: "D", b: "S", c: "D", d: "S" },
      level: i < 2 ? "thông hiểu" : "vận dụng",
      explanation: "Đây là nhận định minh họa (AI không khả dụng).",
    })),
    essay: Array.from({ length: essayCount }).map(() => ({
      question: `Trình bày hiểu biết của em về ${config.topic} (KTPL Lớp ${config.grade}).`,
      level: "vận dụng cao",
      points: 2,
      rubric: "Nêu được khái niệm, ý nghĩa, liên hệ thực tế.",
    })),
  };
}

// ── Exercise generation models (primary + fallback quota) ───────────
const exerciseGenerationConfig = {
  temperature: 0.7,
  maxOutputTokens: 8192,
  topP: 0.9,
  responseMimeType: "application/json",
};

const exerciseModel = genAI
  ? genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: EXERCISE_SYSTEM_PROMPT,
      generationConfig: exerciseGenerationConfig,
    })
  : null;

const exerciseModelFallback =
  genAI && GEMINI_MODEL_EXERCISE_FALLBACK && GEMINI_MODEL_EXERCISE_FALLBACK !== GEMINI_MODEL
    ? genAI.getGenerativeModel({
        model: GEMINI_MODEL_EXERCISE_FALLBACK,
        systemInstruction: EXERCISE_SYSTEM_PROMPT,
        generationConfig: exerciseGenerationConfig,
      })
    : null;

function parseGeminiRetryDelayMs(message) {
  const m = String(message || "").match(/retry in ([\d.]+)\s*s/i);
  if (!m) return 0;
  const sec = parseFloat(m[1], 10);
  if (!Number.isFinite(sec) || sec < 0) return 0;
  return Math.min(60000, Math.max(3000, Math.round(sec * 1000)));
}

// ── GET /api/exam/lessons ────────────────────────────────────────────
router.get("/lessons", async (req, res) => {
  const grade = String(req.query.grade || "10");
  try {
    const { rows } = await query(
      `SELECT lesson_name, MAX(chapter) AS chapter, COUNT(*) AS chunk_count
       FROM exam_knowledge
       WHERE grade = $1 AND lesson_name IS NOT NULL AND lesson_name != ''
       GROUP BY lesson_name
       ORDER BY lesson_name`,
      [grade]
    );
    res.json({ grade, lessons: rows.map(r => ({ lesson_name: r.lesson_name, chapter: r.chapter, chunk_count: parseInt(r.chunk_count, 10) })) });
  } catch (err) {
    console.error("[Exam] Lessons error:", err.message);
    res.status(500).json({ error: "lessons_failed", message: "Không thể tải danh sách bài học." });
  }
});

// ── POST /api/exam/exercise/generate ─────────────────────────────────
router.post("/exercise/generate", async (req, res) => {
  const { grade, lesson_name, difficulty, counts } = req.body;

  if (!grade || !lesson_name) {
    return res.status(400).json({ error: "invalid_input", message: "Cần chọn lớp và bài học." });
  }

  const mcqCount = counts?.mcq || 5;
  const essayCount = counts?.essay || 2;

  try {
    // 1. Fetch lesson-specific chunks, prioritizing luyen_tap and van_dung
    const { rows: lessonChunks } = await query(
      `SELECT id, source_name, grade, chapter, section_title, content, section_type, lesson_name
       FROM exam_knowledge
       WHERE grade = $1 AND lesson_name = $2
       ORDER BY
         CASE section_type
           WHEN 'luyen_tap' THEN 1
           WHEN 'van_dung' THEN 2
           WHEN 'kham_pha' THEN 3
           ELSE 4
         END,
         chunk_index`,
      [String(grade), lesson_name]
    );

    // 2. Build context text
    let contextText = "";
    const contextResults = lessonChunks.length > 0 ? lessonChunks : [];

    if (lessonChunks.length > 0) {
      for (const r of lessonChunks) {
        const tag = r.section_type !== 'content' ? ` [${r.section_type}]` : '';
        const entry = `[${r.section_title}${tag}]: ${r.content}`;
        if (contextText.length + entry.length > 10000) break;
        contextText += (contextText ? "\n\n" : "") + entry;
      }
    }

    // 3. Fallback: hybrid search if lesson-specific chunks are insufficient
    if (lessonChunks.length < 3) {
      const hybridResults = await performHybridSearch(lesson_name, String(grade));
      for (const r of hybridResults) {
        if (contextResults.some(c => c.id === r.id)) continue;
        const entry = `[${r.section_title}]: ${r.content}`;
        if (contextText.length + entry.length > 12000) break;
        contextText += (contextText ? "\n\n" : "") + entry;
        contextResults.push(r);
      }
    }

    if (!contextText) {
      contextText = "Không tìm thấy tài liệu KTPL cho bài học này trong cơ sở dữ liệu.";
    }

    const baseContext = contextText;
    const config = { grade: String(grade), lesson_name, difficulty: difficulty || "medium", mcqCount, essayCount };

    let exercises = null;
    let usedLLM = false;
    /** @type {{ source: 'gemini'|'mock', reason: string|null }} */
    let generationMeta = {
      source: "mock",
      reason: exerciseModel ? "gemini_error_or_invalid_json" : "missing_gemini_api_key",
    };

    console.log(`[Exam] exercise/generate: grade=${grade}, lesson="${lesson_name}", difficulty=${difficulty}, chunks=${contextResults.length}`);

    let lastAiErrorMsg = "";
    if (exerciseModel) {
      let lastRawText = null;
      const retryMaxCtx = parseInt(process.env.EXERCISE_CONTEXT_RETRY_CHARS || "8000", 10);
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const ctxForAi =
            attempt === 2 && baseContext.length > retryMaxCtx
              ? `${baseContext.slice(0, retryMaxCtx)}\n\n[...rút gọn tài liệu — thử gọi AI lại]`
              : baseContext;
          const userPrompt = buildExerciseGeneratePrompt(config, ctxForAi);
          const useAlt = attempt === 2 && exerciseModelFallback;
          const activeModel = useAlt ? exerciseModelFallback : exerciseModel;
          const activeName = useAlt ? GEMINI_MODEL_EXERCISE_FALLBACK : GEMINI_MODEL;
          console.log(
            `[Exam] Calling Gemini for exercise generation (attempt ${attempt}), model=${activeName}, promptChars=${userPrompt.length}`
          );
          const result = await activeModel.generateContent(userPrompt);
          const response = await result.response;
          const text = response.text();
          lastRawText = text;
          exercises = normalizeExerciseGeminiOutput(parseExamJSON(text));

          const okMcq = Array.isArray(exercises?.mcq) && exercises.mcq.length > 0;
          const okEssay = Array.isArray(exercises?.essay) && exercises.essay.length > 0;
          if (!exercises || (!okMcq && !okEssay)) {
            console.warn("[Exam] Invalid or empty exercise JSON, retrying...", JSON.stringify(exercises).substring(0, 320));
            exercises = null;
            if (attempt < 2) continue;
          } else {
            usedLLM = true;
            generationMeta = { source: "gemini", reason: null };
            const gotMcq = (exercises.mcq || []).length;
            const gotEssay = (exercises.essay || []).length;
            console.log(`[Exam] Exercise generated OK: ${gotMcq} MCQ, ${gotEssay} essay`);
            if (gotMcq < mcqCount || gotEssay < essayCount) {
              console.warn(`[Exam] Gemini returned fewer questions than requested: wanted ${mcqCount} MCQ / ${essayCount} essay, got ${gotMcq} MCQ / ${gotEssay} essay`);
            }
            break;
          }
        } catch (aiError) {
          const msg = aiError.message || String(aiError);
          lastAiErrorMsg = msg;
          console.error(`[Exam] Exercise generation error (attempt ${attempt}):`, msg);
          if (lastRawText) {
            console.error(`[Exam] Raw Gemini response (first 500 chars):`, lastRawText.substring(0, 500));
          }
          const retryable =
            attempt < 2 &&
            (/429|500|503|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(msg) ||
              /JSON|SyntaxError|Unexpected token|parse/i.test(msg) ||
              /block|BLOCK|candidat|safety|empty response|No content/i.test(msg));
          if (retryable) {
            const fromHint = parseGeminiRetryDelayMs(msg);
            const willSwitchModel = attempt === 1 && exerciseModelFallback;
            // Hết quota model A: lần 2 đổi sang model B — không cần chờ 30s+ của Google
            const waitMs =
              willSwitchModel && /429|quota|Quota exceeded/i.test(msg)
                ? 1000
                : fromHint > 0
                  ? fromHint
                  : /429|quota|Quota exceeded|Too Many Requests/i.test(msg)
                    ? 3500
                    : 2000;
            console.log(`[Exam] Waiting ${waitMs}ms before retry...`);
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
          }
        }
      }
    }

    // 5. Mock fallback
    if (!exercises) {
      if (lastAiErrorMsg && /429|quota|Quota exceeded|Too Many Requests|free_tier|rate.limit/i.test(lastAiErrorMsg)) {
        generationMeta.reason = "gemini_quota_exceeded";
      }
      console.warn("[Exam] Using mock exercise fallback");
      exercises = {
        mcq: Array.from({ length: mcqCount }).map((_, i) => ({
          question: `Câu hỏi minh họa ${i + 1} về ${lesson_name} (KTPL Lớp ${grade})`,
          options: { A: "Đáp án A", B: "Đáp án B", C: "Đáp án C", D: "Đáp án D" },
          correct: "A",
          explanation: "Đây là câu hỏi minh họa (AI không khả dụng).",
          difficulty: i < 2 ? "nhan_biet" : i < 4 ? "thong_hieu" : "van_dung",
        })),
        essay: Array.from({ length: essayCount }).map((_, i) => ({
          question: `Trình bày hiểu biết của em về ${lesson_name} (câu ${i + 1}).`,
          model_answer: "Đáp án mẫu sẽ được cung cấp khi AI khả dụng.",
          rubric: "Nêu được khái niệm, ý nghĩa, liên hệ thực tế.",
          points: 2,
          difficulty: "van_dung",
        })),
      };
    }

    // Normalize MCQ options to object format
    if (exercises.mcq) {
      exercises.mcq = exercises.mcq.map(q => {
        if (Array.isArray(q.options)) {
          const obj = {};
          const letters = ["A", "B", "C", "D"];
          q.options.forEach((opt, i) => {
            const stripped = opt.replace(/^[A-D][.)]\s*/, '');
            obj[letters[i]] = stripped;
          });
          q.options = obj;
        }
        return q;
      });
    }

    // 6. Log generation
    const contextIds = contextResults.map(r => r.id);
    try {
      await query(
        `INSERT INTO exam_generations (user_uid, grade, topic, difficulty, generated_exam, context_ids) VALUES ($1, $2, $3, $4, $5, $6)`,
        ["exercise-builder", String(grade), lesson_name, difficulty || "medium", JSON.stringify(exercises), contextIds]
      );
    } catch (logErr) {
      console.error("[Exam] Failed to log exercise generation:", logErr.message);
    }

    res.json({ ...exercises, _meta: generationMeta });
  } catch (err) {
    console.error("[Exam] Exercise generate error:", err);
    res.status(500).json({ error: "exercise_generate_failed", message: "Không thể tạo bài tập. Vui lòng thử lại." });
  }
});

// ── POST /api/exam/generate ──────────────────────────────────────────
router.post("/generate", examSafetyMiddleware, async (req, res) => {
  const topic = req.sanitizedTopic;
  const { grade, difficulty, userUid, counts } = req.body;
  const notes = req.sanitizedNotes;

  const config = {
    grade: String(grade),
    topic,
    difficulty: difficulty || "medium",
    multipleChoiceCount: counts?.multiple_choice || 12,
    trueFalseCount: counts?.true_false || 4,
    essayCount: counts?.essay?.min || 1,
    notes,
  };

  try {
    // 1. Hybrid search for relevant KTPL context
    const contextResults = await performHybridSearch(topic, config.grade);

    // 2. Build context text (max 10000 chars)
    let contextText = "";
    if (contextResults.length > 0) {
      for (const r of contextResults) {
        const entry = `[${r.source_name} - ${r.section_title || r.chapter}]: ${r.content}`;
        if (contextText.length + entry.length > 10000) break;
        contextText += (contextText ? "\n\n" : "") + entry;
      }
    } else {
      contextText = "Không tìm thấy tài liệu KTPL trong cơ sở dữ liệu cho chủ đề này.";
    }

    // 3. Get exam template for format example
    const template = await getExamTemplate(config.grade);
    let formatExample = null;
    if (template) {
      const parts = [];
      if (template.mc_example) parts.push(`Trắc nghiệm mẫu: ${JSON.stringify(template.mc_example)}`);
      if (template.tf_example) parts.push(`Đúng/sai mẫu: ${JSON.stringify(template.tf_example)}`);
      if (template.essay_example) parts.push(`Tự luận mẫu: ${JSON.stringify(template.essay_example)}`);
      if (parts.length > 0) formatExample = parts.join('\n');
    }

    // 4. Build prompt
    const userPrompt = buildExamGeneratePrompt(config, contextText, formatExample);

    // 5. Call Gemini
    let exam = null;
    let usedLLM = false;

    console.log(`[Exam] generate: grade=${config.grade}, topic="${topic.substring(0, 50)}", difficulty=${config.difficulty}, results=${contextResults.length}`);

    if (generateModel) {
      let lastRawText = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`[Exam] Calling Gemini 2.5 Flash (attempt ${attempt})...`);
          const result = await generateModel.generateContent(userPrompt);
          const response = await result.response;
          const text = response.text();
          lastRawText = text;
          exam = parseExamJSON(text);

          if (!validateExamStructure(exam)) {
            console.warn("[Exam] Invalid exam structure from Gemini, retrying...");
            exam = null;
            if (attempt < 2) continue;
          } else {
            // Normalize for frontend compatibility
            exam = normalizeExamForFrontend(exam, config);
            usedLLM = true;
            console.log(`[Exam] Gemini generated OK: ${exam.multiple_choice.length} MC, ${exam.true_false.length} TF, ${exam.essay.length} essay`);
            break;
          }
        } catch (aiError) {
          const msg = aiError.message || String(aiError);
          console.error(`[Exam] Gemini error (attempt ${attempt}):`, msg);
          if (lastRawText) {
            console.error(`[Exam] Raw Gemini response (first 500 chars):`, lastRawText.substring(0, 500));
          }
          if (attempt < 2 && /429|500|503|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(msg)) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
        }
      }
    } else {
      console.log("[Exam] No AI provider configured");
    }

    // 6. Fallback to mock exam
    if (!exam) {
      console.warn("[Exam] Using mock exam fallback");
      exam = generateMockExam(config);
    }

    // 7. Log to exam_generations
    const contextIds = contextResults.map(r => r.id);
    try {
      await query(
        `INSERT INTO exam_generations (user_uid, grade, topic, difficulty, generated_exam, context_ids) VALUES ($1, $2, $3, $4, $5, $6)`,
        [userUid || "anonymous", config.grade, topic, difficulty, JSON.stringify(exam), contextIds]
      );
    } catch (logErr) {
      console.error("[Exam] Failed to log generation:", logErr.message);
    }

    // 8. Return exam directly (frontend normalizeExam expects top-level multiple_choice/true_false/essay)
    res.json(exam);
  } catch (err) {
    console.error("[Exam] Generate error:", err);
    res.status(500).json({ error: "generate_failed", message: "Không thể tạo đề kiểm tra. Vui lòng thử lại." });
  }
});

// ── POST /api/exam/grade ─────────────────────────────────────────────
router.post("/grade", async (req, res) => {
  const { exam, answers } = req.body;

  if (!exam || !answers) {
    return res.status(400).json({ error: "invalid_input", message: "Cần có đề thi và bài làm." });
  }

  try {
    const mcQuestions = exam.multiple_choice || [];
    const tfQuestions = exam.true_false || [];
    const essayQuestions = exam.essay || [];
    const mcAnswers = answers.multiple_choice || [];
    const tfAnswers = answers.true_false || [];
    const essayAnswers = answers.essay || [];

    // Score weights: MC=3pts, TF=3pts, Essay=4pts — total 10
    const MC_WEIGHT = 3.0;
    const TF_WEIGHT = 3.0;
    const ESSAY_WEIGHT = 4.0;

    // ── Grade MC deterministically ───────────────────────────────
    // Frontend expects: { question, level, student_answer, correct, score, explanation }
    const mcPointsPer = mcQuestions.length > 0 ? MC_WEIGHT / mcQuestions.length : 0;
    const multiple_choice_results = mcQuestions.map((q, i) => {
      const studentAnswer = (Array.isArray(mcAnswers) ? mcAnswers[i] : mcAnswers[String(i)]) || "";
      const correctAnswer = (q.correct || "").trim().toUpperCase();
      const isCorrect = studentAnswer.trim().toUpperCase() === correctAnswer && studentAnswer !== "";
      return {
        question: q.question,
        level: q.level || "nhận biết",
        student_answer: studentAnswer || "-",
        correct: correctAnswer,
        score: isCorrect ? mcPointsPer : 0,
        explanation: q.explanation || "",
      };
    });

    // ── Grade TF deterministically ───────────────────────────────
    // Frontend expects: { question, level, items, student_answers, answers, score, explanation }
    const tfPointsPer = tfQuestions.length > 0 ? TF_WEIGHT / tfQuestions.length : 0;
    const true_false_results = tfQuestions.map((q, i) => {
      const studentTF = (Array.isArray(tfAnswers) ? tfAnswers[i] : tfAnswers[String(i)]) || {};
      const correctTF = q.answers || {};
      const keys = ["a", "b", "c", "d"];
      let correctCount = 0;
      let totalItems = 0;

      for (const key of keys) {
        if (q.items && q.items[key]) {
          totalItems++;
          const sVal = (studentTF[key] || "").trim().toUpperCase();
          const cVal = (correctTF[key] || "").trim().toUpperCase();
          if (sVal && cVal && sVal === cVal) correctCount++;
        }
      }

      const fraction = totalItems > 0 ? correctCount / totalItems : 0;
      return {
        question: q.question,
        level: q.level || "thông hiểu",
        items: q.items,
        student_answers: studentTF,
        answers: correctTF,
        score: fraction * tfPointsPer,
        explanation: q.explanation || "",
      };
    });

    // ── Grade essays via Gemini ──────────────────────────────────
    // Frontend expects: { question, level, student_answer, score, points, analysis, comment, improved_answer }
    const essayPointsPer = essayQuestions.length > 0 ? ESSAY_WEIGHT / essayQuestions.length : 0;
    const essay_results = [];

    for (let i = 0; i < essayQuestions.length; i++) {
      const q = essayQuestions[i];
      const studentAnswer = (Array.isArray(essayAnswers) ? essayAnswers[i] : essayAnswers[String(i)]) || "";
      const points = essayPointsPer;

      if (!studentAnswer.trim()) {
        essay_results.push({
          question: q.question,
          level: q.level || "vận dụng cao",
          student_answer: "",
          score: 0,
          points,
          analysis: "Học sinh chưa trả lời câu hỏi này.",
          comment: "Hãy cố gắng trả lời dù chỉ vài ý chính.",
          improved_answer: "",
        });
        continue;
      }

      // Try Gemini grading
      let gradeResult = null;
      if (gradeModel) {
        let contextText = "";
        try {
          const gradeNum = (exam.meta?.grade || "12").replace(/\D/g, "") || "12";
          const contextResults = await performHybridSearch(q.question, gradeNum);
          for (const r of contextResults.slice(0, 3)) {
            const entry = `[${r.section_title}]: ${r.content}`;
            if (contextText.length + entry.length > 3000) break;
            contextText += (contextText ? "\n\n" : "") + entry;
          }
        } catch (_) { /* context is optional */ }

        const gradePrompt = buildGradeEssayPrompt({
          question: q.question,
          studentAnswer,
          rubric: q.rubric || "",
          contextText: contextText || null,
          maxScore: points,
        });

        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const result = await gradeModel.generateContent(gradePrompt);
            const response = await result.response;
            const text = response.text();
            gradeResult = parseExamJSON(text);
            break;
          } catch (aiError) {
            const msg = aiError.message || String(aiError);
            console.error(`[Exam] Essay grading error (attempt ${attempt}):`, msg);
            if (attempt < 2 && /429|500|503|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(msg)) {
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
          }
        }
      }

      if (gradeResult && typeof gradeResult.score === "number") {
        const strengths = gradeResult.strengths || [];
        const improvements = gradeResult.improvements || [];
        essay_results.push({
          question: q.question,
          level: q.level || "vận dụng cao",
          student_answer: studentAnswer,
          score: Math.min(gradeResult.score, points),
          points,
          analysis: gradeResult.feedback || "",
          comment: strengths.join("; ") + (improvements.length ? " | Cần cải thiện: " + improvements.join("; ") : ""),
          improved_answer: "",
        });
      } else {
        // Fallback: partial credit based on length
        const wordCount = studentAnswer.split(/\s+/).length;
        const ratio = Math.min(wordCount / 100, 1);
        const score = Math.round(ratio * points * 100) / 100;
        essay_results.push({
          question: q.question,
          level: q.level || "vận dụng cao",
          student_answer: studentAnswer,
          score,
          points,
          analysis: "Chấm tự động dựa trên độ dài bài làm (AI không khả dụng).",
          comment: wordCount < 30 ? "Bài làm còn ngắn, cần bổ sung thêm ý." : "Bài làm có độ dài phù hợp.",
          improved_answer: "",
        });
      }
    }

    // ── Calculate total score (0-10) ─────────────────────────────
    const mcTotal = multiple_choice_results.reduce((s, r) => s + r.score, 0);
    const tfTotal = true_false_results.reduce((s, r) => s + r.score, 0);
    const essayTotal = essay_results.reduce((s, r) => s + r.score, 0);
    const total_score = Math.round((mcTotal + tfTotal + essayTotal) * 100) / 100;

    res.json({
      total_score,
      multiple_choice_results,
      true_false_results,
      essay_results,
    });
  } catch (err) {
    console.error("[Exam] Grade error:", err);
    res.status(500).json({ error: "grade_failed", message: "Không thể chấm bài. Vui lòng thử lại." });
  }
});

module.exports = router;
