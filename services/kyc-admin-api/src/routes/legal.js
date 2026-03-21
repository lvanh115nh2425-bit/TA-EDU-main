const express = require("express");
const router = express.Router();
const { query } = require("../db");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { generateEmbedding, TaskType } = require("../lib/embeddings");
const { DISCLAIMER, SYSTEM_PROMPT } = require("../lib/legalPrompts");
const { legalSafetyMiddleware, calculateConfidence, checkGroundedness } = require("../middleware/legalSafety");

// Provider selection: LM Studio (local) vs Gemini (cloud)
const LM_STUDIO_URL = (process.env.LM_STUDIO_URL || "").trim();
const useLMStudio = LM_STUDIO_URL.length > 0;

// Initialize Gemini
const geminiKey = (process.env.GEMINI_API_KEY || "").trim(); // trim handles CRLF from .env
const hasValidKey = geminiKey.length > 0 && geminiKey !== "YOUR_API_KEY_HERE";
if (useLMStudio) {
  console.log(`[Legal] Using LM Studio at ${LM_STUDIO_URL}`);
} else {
  console.log(`[Legal] GEMINI_API_KEY: ${hasValidKey ? geminiKey.substring(0, 8) + '... (' + geminiKey.length + ' chars)' : 'NOT SET'}`);
}
const genAI = hasValidKey ? new GoogleGenerativeAI(geminiKey) : null;
const model = genAI ? genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  systemInstruction: SYSTEM_PROMPT,
  generationConfig: { temperature: 0.3, maxOutputTokens: 2048, topP: 0.8 },
}) : null;

/**
 * Chat completion via LM Studio (OpenAI-compatible API)
 */
async function lmStudioChat(systemPrompt, userPrompt) {
  const res = await fetch(`${LM_STUDIO_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.LM_STUDIO_CHAT_MODEL || "local-model",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });
  if (!res.ok) throw new Error(`LM Studio chat error: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

/**
 * Build user prompt (without system prompt) for OpenAI-style messages API
 */
function buildUserPrompt(question, contextText, conversationHistory) {
  const parts = [];

  if (conversationHistory && conversationHistory.length > 0) {
    parts.push('LỊCH SỬ HỘI THOẠI GẦN ĐÂY:');
    for (const entry of conversationHistory) {
      const cleanAnswer = entry.answer.replace(/\n---\n⚖️.*/s, '').trim();
      parts.push(`Học sinh hỏi: ${entry.question}\nTrả lời: ${cleanAnswer.substring(0, 500)}`);
    }
  }

  parts.push(`TÀI LIỆU PHÁP LUẬT THAM KHẢO:\n${contextText}`);
  parts.push(`CÂU HỎI CỦA HỌC SINH: ${question}`);
  parts.push('Hãy trả lời câu hỏi trên dựa theo tài liệu pháp luật đã cung cấp.');

  return parts.join('\n\n');
}

function generateFallbackAnswer(question, contextResults) {
  if (contextResults.length === 0) {
    return `Xin lỗi, hiện tại tôi không tìm thấy quy định nào liên quan đến câu hỏi của bạn trong cơ sở dữ liệu.

Bạn có thể thử hỏi cụ thể hơn, ví dụ: "Tuổi kết hôn tối thiểu?", "Thời gian làm việc tối đa?", "Quyền khiếu nại của công dân?"...`;
  }

  const qType = detectQuestionType(question);
  const top = contextResults[0];
  const topContent = top.content;

  // Extract key facts from article content for a concise answer
  let summary = '';

  if (qType === 'age') {
    // Extract age-related numbers
    const ageMatches = topContent.match(/\d+\s*tuổi/g);
    if (ageMatches) {
      summary = `Theo **${top.article_name}** (${top.law_name}):\n\n`;
      summary += extractKeyPoints(topContent, 500);
    }
  } else if (qType === 'conditions') {
    summary = `Theo **${top.article_name}** (${top.law_name}), các điều kiện bao gồm:\n\n`;
    summary += extractKeyPoints(topContent, 500);
  } else if (qType === 'rights') {
    summary = `Theo **${top.article_name}** (${top.law_name}), các quyền bao gồm:\n\n`;
    summary += extractKeyPoints(topContent, 500);
  } else if (qType === 'penalties') {
    summary = `Theo **${top.article_name}** (${top.law_name}), quy định xử lý:\n\n`;
    summary += extractKeyPoints(topContent, 500);
  } else if (qType === 'procedure') {
    summary = `Theo **${top.article_name}** (${top.law_name}), thủ tục gồm:\n\n`;
    summary += extractKeyPoints(topContent, 500);
  }

  if (!summary) {
    summary = `Theo **${top.article_name}** (${top.law_name}):\n\n`;
    summary += extractKeyPoints(topContent, 500);
  }

  // Add other relevant sources
  if (contextResults.length > 1) {
    const otherSources = contextResults.slice(1, 3)
      .map(r => `${r.article_name} (${r.law_name})`)
      .join(', ');
    summary += `\n\n**Các điều luật liên quan khác:** ${otherSources}`;
  }

  return summary;
}

function extractKeyPoints(content, maxLen) {
  // Split content into clauses/sentences at Vietnamese legal delimiters
  const parts = content.split(/(?:;\s*(?=[a-zđ\d]))|(?:\.\s+(?=\d|[A-ZĐẮ]))/);
  let result = '';
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const line = `- ${trimmed.replace(/^[-–]\s*/, '')}`;
    if (result.length + line.length > maxLen) break;
    result += line + '\n';
  }
  return result || content.substring(0, maxLen);
}

function detectQuestionType(question) {
  const q = question.toLowerCase();
  if (/tuổi|năm tuổi|bao nhiêu tuổi|độ tuổi/.test(q)) return 'age';
  if (/điều kiện|yêu cầu|cần gì|phải có/.test(q)) return 'conditions';
  if (/quyền|được phép|có thể|được quyền/.test(q)) return 'rights';
  if (/phạt|xử lý|vi phạm|hình phạt|chế tài/.test(q)) return 'penalties';
  if (/thủ tục|quy trình|cách|làm sao|như thế nào|hồ sơ/.test(q)) return 'procedure';
  return 'general';
}

// Vector similarity search using pgvector
async function performVectorSearch(question, limit = 5) {
  const embedding = await generateEmbedding(question, TaskType.RETRIEVAL_QUERY);
  if (!embedding) return [];

  try {
    const { rows } = await query(
      `SELECT id, law_name, chapter, article_name, content,
              1 - (embedding <=> $1::vector) as vector_similarity
       FROM legal_knowledge
       WHERE embedding IS NOT NULL
         AND 1 - (embedding <=> $1::vector) >= 0.15
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [JSON.stringify(embedding), limit]
    );
    return rows;
  } catch (err) {
    console.error("Vector search error:", err.message);
    return [];
  }
}

// Vietnamese stop words - very common, not meaningful for search
const STOP_WORDS = new Set([
  'theo', 'của', 'trong', 'này', 'cho', 'với', 'các', 'những', 'được', 'như',
  'hoặc', 'bao', 'nhiêu', 'là', 'có', 'không', 'một', 'và', 'về', 'tại',
  'khi', 'thì', 'nếu', 'để', 'từ', 'đến', 'đó', 'mà', 'nào', 'gì',
  'rằng', 'cũng', 'đã', 'sẽ', 'phải', 'còn', 'hay', 'nhưng', 'bạn',
  'nên', 'đây', 'thế', 'vậy', 'sau', 'trước', 'trên', 'dưới',
]);

// Keyword mappings: topic → related compound terms (high value for search)
const KEYWORD_MAPPINGS = {
  'hôn nhân': ['hôn nhân', 'kết hôn', 'gia đình', 'ly hôn', 'tảo hôn'],
  'lao động': ['lao động', 'người lao động', 'hợp đồng lao động'],
  'tuổi': ['tuổi', 'độ tuổi', 'đủ tuổi', 'tuổi kết hôn'],
  'quyền': ['quyền', 'nghĩa vụ', 'quyền lợi'],
  'thuế': ['thuế', 'nộp thuế', 'thuế suất'],
  'tố cáo': ['tố cáo', 'người tố cáo', 'tố giác'],
  'khiếu nại': ['khiếu nại', 'người khiếu nại'],
  'hiến pháp': ['hiến pháp', 'quyền con người', 'quyền công dân'],
  'bầu cử': ['bầu cử', 'ứng cử', 'cử tri', 'bỏ phiếu'],
  'bình đẳng giới': ['bình đẳng giới', 'giới tính'],
  'ngân sách': ['ngân sách', 'ngân sách nhà nước'],
  'việc làm': ['việc làm', 'tuyển dụng', 'thất nghiệp'],
  'trẻ em': ['trẻ em', 'vị thành niên', 'chưa thành niên'],
  'công dân': ['công dân', 'quốc tịch'],
  'kết hôn': ['kết hôn', 'điều kiện kết hôn', 'tuổi kết hôn', 'đăng ký kết hôn'],
  'lương': ['tiền lương', 'lương', 'trả lương'],
};

// Enhanced search function with better relevance scoring
async function performKeywordSearch(question, excludeIds = [], limit = 5) {
  const normalizedQuestion = question.toLowerCase().trim();

  // Build two tiers of search terms:
  // Tier 1 (high weight): compound phrases from keyword mappings
  // Tier 2 (low weight): individual meaningful words from question (stop words removed)
  const highTerms = new Set();
  const lowTerms = new Set();

  // Extract mapped compound terms (high value)
  Object.entries(KEYWORD_MAPPINGS).forEach(([key, values]) => {
    if (normalizedQuestion.includes(key)) {
      values.forEach(v => highTerms.add(v));
    }
  });

  // Extract individual words, remove stop words (low value)
  normalizedQuestion.split(/\s+/).forEach(w => {
    if (w.length >= 3 && !STOP_WORDS.has(w) && !highTerms.has(w)) {
      lowTerms.add(w);
    }
  });

  // Merge: high-weight terms first, then low-weight
  const allTerms = [...highTerms, ...lowTerms];

  if (allTerms.length === 0) {
    return [];
  }

  let results = [];

  try {
    // Stage 1: Compound phrase search (high-weight terms only, strong scoring)
    if (highTerms.size > 0) {
      const hTerms = [...highTerms];
      const placeholders = hTerms.map((_, i) => `$${i + 1}`);
      const searchConditions = placeholders.map(p =>
        `(content ILIKE ${p} OR article_name ILIKE ${p})`
      ).join(' OR ');

      // Weight: article_name match = 5, content match = 2 per compound term
      const countConditions = placeholders.map(p =>
        `(CASE WHEN article_name ILIKE ${p} THEN 5 ELSE 0 END) +
         (CASE WHEN content ILIKE ${p} THEN 2 ELSE 0 END)`
      ).join(' + ');

      const searchParams = hTerms.map(term => `%${term}%`);

      const { rows } = await query(
        `SELECT DISTINCT id, law_name, chapter, article_name, content,
                (${countConditions}) as relevance_score
         FROM legal_knowledge
         WHERE ${searchConditions}
         ORDER BY relevance_score DESC
         LIMIT 10`,
        searchParams
      );
      results.push(...rows);
    }

    // Stage 2: Broaden with low-weight single words if not enough results
    if (results.length < 5 && lowTerms.size > 0) {
      const lTerms = [...lowTerms];
      const existingIds = results.map(r => r.id);
      const placeholders = lTerms.map((_, i) => `$${i + 1}`);
      const searchConditions = placeholders.map(p =>
        `(content ILIKE ${p} OR article_name ILIKE ${p})`
      ).join(' OR ');

      const countConditions = placeholders.map(p =>
        `(CASE WHEN article_name ILIKE ${p} THEN 2 ELSE 0 END) +
         (CASE WHEN content ILIKE ${p} THEN 1 ELSE 0 END)`
      ).join(' + ');

      const searchParams = lTerms.map(term => `%${term}%`);

      const { rows } = await query(
        `SELECT DISTINCT id, law_name, chapter, article_name, content,
                (${countConditions}) as relevance_score
         FROM legal_knowledge
         WHERE ${searchConditions}
         AND id NOT IN (${existingIds.join(',') || '0'})
         ORDER BY relevance_score DESC
         LIMIT 5`,
        searchParams
      );
      results.push(...rows);
    }

    // Sort by relevance score and return top results
    return results
      .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
      .slice(0, limit);

  } catch (error) {
    console.error("Enhanced search error:", error);
    const fallbackTerm = [...highTerms][0] || normalizedQuestion;
    const { rows } = await query(
      `SELECT id, law_name, chapter, article_name, content
       FROM legal_knowledge
       WHERE content ILIKE $1
       LIMIT 5`,
      [`%${fallbackTerm}%`]
    );
    return rows;
  }
}

// Hybrid search: vector + keyword with Reciprocal Rank Fusion
async function performHybridSearch(question) {
  const [vectorResults, keywordResults] = await Promise.all([
    performVectorSearch(question, 20),
    performKeywordSearch(question, [], 15),
  ]);

  const questionType = detectQuestionType(question);
  const qLower = question.toLowerCase();

  // Reciprocal Rank Fusion (k=60)
  const k = 60;
  const scores = new Map();
  const articleMap = new Map();
  const vectorSimilarities = new Map();

  // Weight keyword results 2x higher than vector for Vietnamese legal text
  const VECTOR_WEIGHT = 1.0;
  const KEYWORD_WEIGHT = 2.0;

  vectorResults.forEach((row, rank) => {
    const id = row.id;
    scores.set(id, (scores.get(id) || 0) + VECTOR_WEIGHT / (k + rank + 1));
    articleMap.set(id, row);
    if (row.vector_similarity) vectorSimilarities.set(id, row.vector_similarity);
  });

  keywordResults.forEach((row, rank) => {
    const id = row.id;
    scores.set(id, (scores.get(id) || 0) + KEYWORD_WEIGHT / (k + rank + 1));
    if (!articleMap.has(id)) articleMap.set(id, row);
  });

  // 1. Article-name relevance boost
  // Extract 2+ char words from question, then check which appear in article_name
  const questionWords = qLower.split(/\s+/).filter(w => w.length >= 2);
  for (const [id, score] of scores) {
    const article = articleMap.get(id);
    if (!article || !article.article_name) continue;
    const name = article.article_name.toLowerCase();
    const matchCount = questionWords.filter(w => name.includes(w)).length;
    if (matchCount >= 3) {
      scores.set(id, score * 2.0);
    } else if (matchCount >= 2) {
      scores.set(id, score * 1.5);
    }
  }

  // 2. Question-type content re-ranking boost
  const reRankPatterns = {
    age: /\d+\s*tuổi|đủ\s*\d+\s*tuổi/i,
    conditions: /điều kiện|yêu cầu|phải/i,
    rights: /quyền|được\s*phép/i,
    penalties: /phạt|xử\s*lý|vi\s*phạm/i,
    procedure: /thủ tục|hồ sơ|quy trình/i,
  };

  if (reRankPatterns[questionType]) {
    const pattern = reRankPatterns[questionType];
    for (const [id, score] of scores) {
      const article = articleMap.get(id);
      if (article && pattern.test(article.content)) {
        scores.set(id, score * 3.0);
      }
    }
  }

  // 3. Penalize articles about cancellation/processing/international when asking about conditions/age
  if (questionType === 'age' || questionType === 'conditions') {
    for (const [id, score] of scores) {
      const article = articleMap.get(id);
      if (!article || !article.article_name) continue;
      const name = article.article_name.toLowerCase();
      if (/hủy|xử lý|hậu quả|yếu tố nước ngoài/.test(name)) {
        scores.set(id, score * 0.4); // penalize tangential articles
      }
    }
  }

  // Sort by RRF score descending, return top 5
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, score]) => ({
      ...articleMap.get(id),
      relevance_score: score,
      vector_similarity: vectorSimilarities.get(id) || null,
    }));
}

router.post("/consult", legalSafetyMiddleware, async (req, res) => {
  const question = req.sanitizedQuestion;
  const { userUid, sessionId } = req.body;

  try {
    // 1. Hybrid search for relevant legal context
    const contextResults = await performHybridSearch(question);

    // 2. Calculate confidence
    const confidence = calculateConfidence(contextResults);

    // 3. Build context text (max 8000 chars)
    let contextText = "";
    if (contextResults.length > 0) {
      for (const r of contextResults) {
        const entry = `[${r.law_name} - ${r.article_name}]: ${r.content}`;
        if (contextText.length + entry.length > 8000) break;
        contextText += (contextText ? "\n\n" : "") + entry;
      }
    } else {
      contextText = "Không tìm thấy dữ liệu luật trực tiếp trong cơ sở dữ liệu.";
    }

    // 4. Fetch conversation history (session-based or user-based)
    let conversationHistory = [];
    if (sessionId) {
      try {
        const { rows } = await query(
          `SELECT question, answer FROM legal_consultations
           WHERE session_id = $1
           ORDER BY created_at DESC LIMIT 5`,
          [sessionId]
        );
        conversationHistory = rows.reverse();
      } catch (histErr) {
        console.warn("[Legal] Failed to fetch session history:", histErr.message);
      }
    } else if (userUid && userUid !== 'anonymous') {
      try {
        const { rows } = await query(
          `SELECT question, answer FROM legal_consultations
           WHERE user_uid = $1
           ORDER BY created_at DESC LIMIT 5`,
          [userUid]
        );
        conversationHistory = rows.reverse();
      } catch (histErr) {
        console.warn("[Legal] Failed to fetch conversation history:", histErr.message);
      }
    }

    // 5. Build prompt and call LLM
    const userPrompt = buildUserPrompt(question, contextText, conversationHistory);

    let answer;
    let usedLLM = false;
    console.log(`[Legal] provider=${useLMStudio ? 'lmstudio' : (model ? 'gemini-2.5-flash' : 'none')}, results=${contextResults.length}, confidence=${confidence.level}, question="${question.substring(0, 50)}"`);

    if (useLMStudio) {
      try {
        console.log(`[Legal] Calling LM Studio...`);
        answer = await lmStudioChat(SYSTEM_PROMPT, userPrompt);
        usedLLM = true;
        console.log(`[Legal] LM Studio answered OK (${answer.length} chars)`);
      } catch (aiError) {
        console.error(`[Legal] LM Studio error:`, aiError.message);
        console.warn("[Legal] LM Studio failed, using fallback");
        answer = generateFallbackAnswer(question, contextResults);
      }
    } else if (model) {
      // Retry Gemini call up to 2 times on transient errors
      // systemInstruction is set on the model, so only send user content here
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`[Legal] Calling Gemini 2.5 Flash (attempt ${attempt})...`);
          const result = await model.generateContent(userPrompt);
          const response = await result.response;
          answer = response.text();
          usedLLM = true;
          console.log(`[Legal] Gemini answered OK (${answer.length} chars)`);
          break;
        } catch (aiError) {
          const msg = aiError.message || String(aiError);
          console.error(`[Legal] Gemini error (attempt ${attempt}):`, msg);
          if (attempt < 2 && /429|500|503|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(msg)) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          answer = null;
        }
      }
      if (!answer) {
        console.warn("[Legal] All Gemini attempts failed, using fallback");
        answer = generateFallbackAnswer(question, contextResults);
      }
    } else {
      console.log("[Legal] No AI provider configured, using fallback");
      answer = generateFallbackAnswer(question, contextResults);
    }

    // 6. Confidence warning for low/none
    if (confidence.level === 'low') {
      answer = `⚠️ *Lưu ý: Độ tin cậy của câu trả lời này không cao. Vui lòng tham khảo thêm nguồn khác.*\n\n${answer}`;
    } else if (confidence.level === 'none') {
      answer = `⚠️ *Lưu ý: Không tìm thấy quy định trực tiếp liên quan. Câu trả lời mang tính tham khảo chung.*\n\n${answer}`;
    }

    // 7. Groundedness check (logged, not blocking)
    const groundedness = checkGroundedness(answer, contextResults);
    if (!groundedness.grounded && contextResults.length > 0) {
      console.warn(`[Legal] Answer may not be grounded - no source references found in answer`);
    }

    // 8. Append disclaimer
    answer += DISCLAIMER;

    // 9. Log consultation with confidence and session
    const contextIds = contextResults.map(r => r.id);
    await query(
      "INSERT INTO legal_consultations (user_uid, question, answer, context_ids, confidence_score, session_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [userUid || "anonymous", question, answer, contextIds, confidence.score, sessionId || null]
    );

    res.json({
      answer,
      sessionId,
      confidence: confidence.level,
      usedLLM,
      sources: contextResults.map(r => ({
        lawName: r.law_name,
        articleName: r.article_name,
        relevance: r.relevance_score,
        vectorSimilarity: r.vector_similarity,
      })),
    });
  } catch (err) {
    console.error("Legal consult error:", err);
    res.status(500).json({ error: "consultation_failed" });
  }
});

router.get("/history", async (req, res) => {
  const { userUid } = req.query;
  if (!userUid) return res.status(400).json({ error: "userUid required" });

  try {
    const { rows } = await query(
      `SELECT session_id,
              MIN(question) AS first_question,
              COUNT(*) AS message_count,
              MAX(created_at) AS last_message_at
       FROM legal_consultations
       WHERE user_uid = $1 AND session_id IS NOT NULL
       GROUP BY session_id
       ORDER BY last_message_at DESC
       LIMIT 20`,
      [userUid]
    );
    res.json(rows.map(r => ({
      sessionId: r.session_id,
      firstQuestion: r.first_question,
      messageCount: parseInt(r.message_count),
      lastMessageAt: r.last_message_at,
    })));
  } catch (err) {
    console.error("History fetch error:", err);
    res.status(500).json({ error: "history_failed" });
  }
});

router.get("/history/:sessionId", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT question, answer, context_ids, confidence_score, created_at
       FROM legal_consultations
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [req.params.sessionId]
    );
    res.json(rows.map(r => ({
      question: r.question,
      answer: r.answer,
      confidenceScore: r.confidence_score,
      createdAt: r.created_at,
    })));
  } catch (err) {
    console.error("Session history fetch error:", err);
    res.status(500).json({ error: "session_history_failed" });
  }
});

module.exports = router;

