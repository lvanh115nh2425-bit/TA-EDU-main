const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
const DEFAULT_SYSTEM_PROMPT = `Bạn là SmartTutor - trợ giảng THPT. Trả lời tiếng Việt, súc tích, từng bước, bám chương trình SGK mới.`;
const EXAM_SYSTEM_PROMPT = `Bạn là TA-SmartExam. Sinh đề theo đúng metadata và số lượng câu hỏi yêu cầu. Luôn trả về JSON duy nhất theo schema, không thêm ghi chú. Ký hiệu toán học dùng ^{} cho mũ, frac{a}{b} cho phân số, sqrt{} cho căn.`;
const DEFAULT_COUNTS = {
  multiple_choice: 12,
  true_false: 4,
  essay: { min: 1, max: 3 },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/exam/")) {
      return handleExamRequest(request, env, url.pathname);
    }
    return handleChatRequest(request, env);
  },
};

async function handleChatRequest(request, env) {
  const origin = pickOrigin(env, request.headers.get("Origin"));
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, origin);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400, origin);
  }

  const key = env.PERPLEXITY_API_KEY;
  if (!key) return json({ error: "missing_api_key" }, 500, origin);

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const systemPrompt = payload.system || env.SMARTTUTOR_SYSTEM || DEFAULT_SYSTEM_PROMPT;
  const maxChars = Number(env.SMARTTUTOR_MAX_CHARS) || 480;

  try {
    if (payload.stream) {
      return await streamPerplexity({
        apiKey: key,
        model: env.PERPLEXITY_MODEL || "sonar",
        messages,
        systemPrompt,
        maxChars,
        origin,
      });
    }
    const reply = await askPerplexity({
      apiKey: key,
      model: env.PERPLEXITY_MODEL || "sonar",
      messages,
      systemPrompt,
      maxChars,
    });
    return json({ reply }, 200, origin);
  } catch (err) {
    console.error("smarttutor chat error:", err);
    return json({ error: "upstream_error", detail: err.message || String(err) }, 502, origin);
  }
}

async function handleExamRequest(request, env, pathname) {
  const origin = pickOrigin(env, request.headers.get("Origin"));
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, origin);
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400, origin);
  }

  try {
    if (pathname.endsWith("/generate")) {
      const exam = await buildExam(payload, env);
      return json(exam, 200, origin);
    }
    if (pathname.endsWith("/grade")) {
      const grading = await gradeExam(payload, env);
      return json(grading, 200, origin);
    }
    return json({ error: "not_found" }, 404, origin);
  } catch (err) {
    console.error("smartexam error:", err);
    return json({ error: "exam_error", detail: err.message || String(err) }, 500, origin);
  }
}

async function buildExam(payload, env) {
  const meta = normalizeMeta(payload);
  const counts = normalizeCounts(payload.counts);
  const key = env.PERPLEXITY_API_KEY;
  if (!key) return createMockExam(meta, counts);

  const userPrompt = {
    subject: meta.subject,
    grade: meta.grade,
    topic: meta.topic,
    difficulty: meta.difficulty,
    note: meta.note || "",
    counts,
    schema: examSchema(counts),
  };

  const messages = [
    { role: "system", content: EXAM_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(userPrompt) },
  ];

  try {
    const raw = await askPerplexity({
      apiKey: key,
      model: env.PERPLEXITY_MODEL || "sonar",
      messages,
      systemPrompt: EXAM_SYSTEM_PROMPT,
      maxChars: 2000,
    });
    const parsed = tryParseJSON(raw);
    if (parsed && hasAnyQuestion(parsed)) {
      return parsed;
    }
    console.warn("SmartExam returned invalid JSON, fallback to mock exam.");
    return createMockExam(meta, counts);
  } catch (err) {
    console.warn("SmartExam generate fallback:", err);
    return createMockExam(meta, counts);
  }
}

async function gradeExam(payload, env) {
  const exam = payload.exam;
  const answers = payload.answers || {};
  if (!exam || !answers) {
    throw new Error("missing_exam_or_answers");
  }

  const multiple_choice_results = (exam.multiple_choice || []).map((item, index) => {
    const student = (answers.multiple_choice || [])[index] || "";
    const correct = item.correct || "";
    const isCorrect =
      student && correct && student.trim().toUpperCase() === correct.trim().toUpperCase();
    return {
      question: item.question || "",
      student_answer: student,
      correct,
      explanation: item.explanation || "",
      score: isCorrect ? 1 : 0,
      level: item.level || "",
    };
  });

  const true_false_results = (exam.true_false || []).map((group, index) => {
    const items = group.items || {};
    const answersMap = group.answers || {};
    const studentAnswers = (answers.true_false || [])[index] || {};
    const keys = Object.keys(items);
    let correctCount = 0;
    keys.forEach((key) => {
      const expected = (answersMap[key] || "").trim().toUpperCase();
      const student = (studentAnswers[key] || "").trim().toUpperCase();
      if (expected && student && expected === student) correctCount += 1;
    });
    const score = keys.length ? correctCount / keys.length : 0;
    return {
      question: group.question || "",
      items,
      answers: answersMap,
      student_answers: studentAnswers,
      explanation: group.explanation || "",
      score,
    };
  });

  const essayPromises = (exam.essay || []).map((item, index) =>
    gradeEssay(
      {
        question: item.question || "",
        expected: item.expected || "",
        rubric: item.rubric || "",
        points: Number(item.points) || 2,
        student: (answers.essay || [])[index] || "",
      },
      env,
    ),
  );
  const essay_results = await Promise.all(essayPromises);

  const mcScore = sumScore(multiple_choice_results);
  const tfScore = sumScore(true_false_results);
  const essayScore = sumScore(essay_results);
  const totalRaw =
    mcScore + tfScore + essayScore;
  const totalPossible =
    (exam.multiple_choice || []).length +
    (exam.true_false || []).length +
    essay_results.reduce((total, item) => total + (item.points || 0), 0);
  const total_score = totalPossible ? Number(((totalRaw / totalPossible) * 10).toFixed(2)) : 0;

  return {
    total_score: Math.max(0, Math.min(10, total_score)),
    multiple_choice_results,
    true_false_results,
    essay_results,
  };
}

async function gradeEssay({ question, expected, rubric, points, student }, env) {
  const cleanPoints = Number(points) || 2;
  if (!student) {
    return {
      question,
      score: 0,
      points: cleanPoints,
      analysis: "Chưa có bài làm.",
      comment: "Vui lòng bổ sung câu trả lời.",
      improved_answer: expected,
      student_answer: "",
    };
  }

  const key = env.PERPLEXITY_API_KEY;
  if (!key) {
    return {
      question,
      score: 0.5 * cleanPoints,
      points: cleanPoints,
      analysis: "Chấm tạm thời (ngoại tuyến).",
      comment: "Đối chiếu gợi ý để tự điều chỉnh.",
      improved_answer: expected,
      student_answer: student,
    };
  }

  const messages = [
    {
      role: "system",
      content:
        "Bạn là giám khảo TA-SmartExam. Hãy chấm điểm tự luận theo thang điểm yêu cầu và trả về JSON {score:number,analysis:string,comment:string,improved_answer:string}.",
    },
    {
      role: "user",
      content: JSON.stringify({
        question,
        expected_answer: expected,
        rubric,
        max_points: cleanPoints,
        student_answer: student,
      }),
    },
  ];

  try {
    const text = await askPerplexity({
      apiKey: key,
      model: env.PERPLEXITY_MODEL || "sonar",
      messages,
      systemPrompt: messages[0].content,
      maxChars: 800,
    });
    const parsed = tryParseJSON(text);
    if (parsed && typeof parsed.score === "number") {
      return {
        question,
        score: Math.max(0, Math.min(cleanPoints, Number(parsed.score))),
        points: cleanPoints,
        analysis: parsed.analysis || "",
        comment: parsed.comment || "",
        improved_answer: parsed.improved_answer || expected || "",
        student_answer: student,
      };
    }
    throw new Error("invalid_essay_json");
  } catch (err) {
    console.warn("Essay grading fallback:", err);
    return {
      question,
      score: 0.5 * cleanPoints,
      points: cleanPoints,
      analysis: "Không thể chấm tự động.",
      comment: "Đối chiếu với gợi ý để hoàn thiện đáp án.",
      improved_answer: expected,
      student_answer: student,
    };
  }
}

async function askPerplexity({ apiKey, model, messages, systemPrompt, maxChars }) {
  const sanitized = normalizeHistory([{ role: "system", content: systemPrompt }, ...messages]);
  const history = ensureAlternating(sanitized);
  const resp = await fetch(PERPLEXITY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: history,
      temperature: 0.2,
      top_p: 0.9,
      stream: false,
    }),
  });
  if (!resp.ok) {
    throw new Error(`perplexity_${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
  return shorten(removeReferences(content).trim(), maxChars);
}

async function streamPerplexity({ apiKey, model, messages, systemPrompt, maxChars, origin }) {
  const sanitized = normalizeHistory([{ role: "system", content: systemPrompt }, ...messages]);
  const history = ensureAlternating(sanitized);
  const resp = await fetch(PERPLEXITY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: history,
      temperature: 0.2,
      top_p: 0.9,
      stream: true,
    }),
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`perplexity_stream_${resp.status}`);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const readable = new ReadableStream({
    start(controller) {
      const reader = resp.body.getReader();
      let collected = "";
      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) {
            controller.close();
            return;
          }
          const chunk = decoder.decode(value, { stream: true });
          collected += chunk;
          controller.enqueue(value);
          if (collected.length > maxChars * 4) reader.cancel();
          pump();
        });
      }
      pump();
    },
  });

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      ...corsHeaders(origin),
    },
  });
}

function normalizeMeta(payload = {}) {
  const subject = payload.subject || DEFAULT_COUNTS.subject || "Môn học";
  return {
    subject,
    grade: payload.grade || "Lớp 10",
    topic: payload.topic || "Chủ đề tổng quan",
    difficulty: payload.difficulty || "Trung bình",
    note: payload.note || "",
  };
}

function normalizeCounts(counts = {}) {
  return {
    multiple_choice: Number(counts.multiple_choice) || DEFAULT_COUNTS.multiple_choice,
    true_false: Number(counts.true_false) || DEFAULT_COUNTS.true_false,
    essay: {
      min: Number(counts?.essay?.min) || DEFAULT_COUNTS.essay.min,
      max: Number(counts?.essay?.max) || DEFAULT_COUNTS.essay.max,
    },
  };
}

function examSchema(counts = DEFAULT_COUNTS) {
  return {
    meta: ["subject", "grade", "topic", "difficulty", "note"],
    multiple_choice: Array.from({ length: counts.multiple_choice }).map(() => ({
      question: "string",
      options: ["A. ...", "B. ...", "C. ...", "D. ..."],
      correct: "A",
      explanation: "string",
      level: "nhận biết/ thông hiểu/ vận dụng/ vận dụng cao",
    })),
    true_false: Array.from({ length: counts.true_false }).map(() => ({
      question: "string",
      items: { a: "string", b: "string", c: "string", d: "string" },
      answers: { a: "D", b: "S", c: "D", d: "S" },
      explanation: "string",
    })),
    essay: Array.from({ length: counts.essay.max }).map(() => ({
      question: "string",
      expected: "string",
      rubric: "string",
      points: 2,
      level: "vận dụng cao",
    })),
  };
}

function createMockExam(meta, counts = DEFAULT_COUNTS) {
  const mc = Array.from({ length: counts.multiple_choice }).map((_, index) => ({
    question: `Câu hỏi minh họa ${index + 1} cho chủ đề ${meta.topic}`,
    options: ["A. Đáp án 1", "B. Đáp án 2", "C. Đáp án 3", "D. Đáp án 4"],
    correct: "A",
    explanation: `Đáp án A đúng với kiến thức chuẩn về ${meta.topic}.`,
    level: index < 4 ? "nhận biết" : index < 8 ? "thông hiểu" : "vận dụng",
  }));
  const tf = Array.from({ length: counts.true_false }).map((_, idx) => ({
    question: `Đánh giá các nhận định số ${idx + 1} liên quan tới ${meta.topic}.`,
    items: {
      a: `Nhận định A về ${meta.topic}`,
      b: `Nhận định B về ${meta.topic}`,
      c: `Nhận định C về ${meta.topic}`,
      d: `Nhận định D về ${meta.topic}`,
    },
    answers: { a: "D", b: "S", c: "D", d: "S" },
    explanation: "A, C đúng; B, D sai.",
  }));
  const essayCount = Math.max(counts.essay.min, Math.min(counts.essay.max, 1));
  const essay = Array.from({ length: essayCount }).map((_, idx) => ({
    question: `Trình bày/vận dụng kiến thức ${meta.topic} (câu ${idx + 1}).`,
    expected: `Nêu khái niệm, công thức, ví dụ gắn với ${meta.topic}.`,
    rubric: "Đủ ý và có ví dụ được điểm tối đa.",
    points: 2,
    level: "vận dụng cao",
  }));
  return { meta, multiple_choice: mc, true_false: tf, essay };
}

function hasAnyQuestion(exam) {
  if (!exam) return false;
  return (
    (Array.isArray(exam.multiple_choice) && exam.multiple_choice.length) ||
    (Array.isArray(exam.true_false) && exam.true_false.length) ||
    (Array.isArray(exam.essay) && exam.essay.length)
  );
}

function tryParseJSON(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function sumScore(items = []) {
  return items.reduce((total, item) => total + (Number(item.score) || 0), 0);
}

function shorten(text, max) {
  if (!text || text.length <= max) return text;
  const slice = text.slice(0, max);
  const dot = slice.lastIndexOf(". ");
  if (dot > 120) {
    return slice.slice(0, dot + 1).trim();
  }
  return slice.trim();
}

function removeReferences(text) {
  return (text || "").replace(/\[\d+\]/g, "").replace(/\s{2,}/g, " ");
}

function normalizeHistory(list) {
  const cleaned = [];
  for (const msg of list) {
    if (!msg || !msg.role || !msg.content) continue;
    if (msg.role === "system") {
      if (!cleaned.length) cleaned.push(msg);
      continue;
    }
    if (!cleaned.length) {
      cleaned.push({ role: "system", content: DEFAULT_SYSTEM_PROMPT });
    }
    const role = msg.role === "assistant" ? "assistant" : "user";
    const previous = cleaned[cleaned.length - 1];
    if (previous && previous.role === role) {
      previous.content += `\n${msg.content}`;
    } else {
      cleaned.push({ role, content: msg.content });
    }
  }
  if (cleaned.length && cleaned[0].role !== "system") {
    cleaned.unshift({ role: "system", content: DEFAULT_SYSTEM_PROMPT });
  }
  return cleaned.slice(-12);
}

function ensureAlternating(list) {
  if (!list.length) {
    return [
      { role: "system", content: DEFAULT_SYSTEM_PROMPT },
      { role: "user", content: "Xin chào SmartTutor!" },
    ];
  }
  const result = [];
  for (const msg of list) {
    if (!msg || !msg.role || !msg.content) continue;
    const prev = result[result.length - 1];
    if (prev && prev.role === msg.role && msg.role !== "system") continue;
    result.push(msg);
  }
  if (result.length === 1) {
    result.push({ role: "user", content: "Cho mình biết bạn có thể giúp gì nhé." });
  }
  if (result[result.length - 1].role === "system") {
    result.push({ role: "user", content: "Cho mình biết bạn có thể giúp gì nhé." });
  }
  return result;
}

function pickOrigin(env, requestOrigin) {
  const config = (env.ALLOWED_ORIGINS || "*").trim();
  if (config === "*" || !requestOrigin) return config || "*";
  const allowed = config.split(",").map((s) => s.trim());
  return allowed.includes(requestOrigin) ? requestOrigin : allowed[0] || "*";
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}
