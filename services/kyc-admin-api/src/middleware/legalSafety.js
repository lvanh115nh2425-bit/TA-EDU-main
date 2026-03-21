const rateLimitMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60 * 1000; // 1 minute

// Cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitMap) {
    const valid = timestamps.filter(t => now - t < RATE_WINDOW);
    if (valid.length === 0) rateLimitMap.delete(key);
    else rateLimitMap.set(key, valid);
  }
}, 5 * 60 * 1000);

function checkRateLimit(userUid) {
  const key = userUid || 'anonymous';
  const now = Date.now();
  const timestamps = (rateLimitMap.get(key) || []).filter(t => now - t < RATE_WINDOW);

  if (timestamps.length >= RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
  return { allowed: true, remaining: RATE_LIMIT - timestamps.length };
}

const INJECTION_PATTERNS = [
  /ignore\s+(previous|all|above)\s+instructions/i,
  /bỏ qua\s+(hướng dẫn|chỉ dẫn|lệnh)/i,
  /you are now/i,
  /bây giờ bạn là/i,
  /system\s*prompt/i,
  /\[\s*INST\s*\]/i,
  /<\s*\/?system\s*>/i,
];

function sanitizeInput(question) {
  if (!question || typeof question !== 'string') {
    return { valid: false, error: 'question_required', message: 'Vui lòng nhập câu hỏi.' };
  }

  const trimmed = question.trim();

  if (trimmed.length < 5) {
    return { valid: false, error: 'question_too_short', message: 'Câu hỏi quá ngắn. Vui lòng nhập ít nhất 5 ký tự.' };
  }

  if (trimmed.length > 1000) {
    return { valid: false, error: 'question_too_long', message: 'Câu hỏi quá dài. Vui lòng nhập tối đa 1000 ký tự.' };
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: 'invalid_input', message: 'Câu hỏi không hợp lệ. Vui lòng hỏi về pháp luật Việt Nam.' };
    }
  }

  return { valid: true, sanitized: trimmed };
}

const BLOCKED_CONTENT_PATTERNS = [
  /hack|crack|exploit/i,
  /trốn\s*thuế|lách\s*luật|trốn\s*tránh\s*pháp\s*luật/i,
  /ma\s*túy|chất\s*cấm|cần\s*sa/i,
  /giết\s*người|bạo\s*lực|khủng\s*bố/i,
  /cách\s*(trốn|lách|né|qua\s*mặt)/i,
];

function filterContent(question) {
  const q = question.toLowerCase();
  for (const pattern of BLOCKED_CONTENT_PATTERNS) {
    if (pattern.test(q)) {
      return { blocked: true, reason: 'harmful_content', message: 'Câu hỏi chứa nội dung không phù hợp. Vui lòng hỏi về pháp luật Việt Nam một cách nghiêm túc.' };
    }
  }
  return { blocked: false };
}

function calculateConfidence(contextResults) {
  if (!contextResults || contextResults.length === 0) {
    return { level: 'none', score: 0 };
  }

  const topResult = contextResults[0];
  const rrfScore = topResult.relevance_score || 0;
  const vectorSim = topResult.vector_similarity || 0;

  // Weighted score: 40% RRF (normalized to 0-1 range), 60% vector similarity
  const normalizedRRF = Math.min(rrfScore / 0.033, 1); // 0.033 ≈ max typical RRF for k=60
  const score = 0.4 * normalizedRRF + 0.6 * vectorSim;

  if (score >= 0.7) return { level: 'high', score };
  if (score >= 0.4) return { level: 'medium', score };
  if (score > 0) return { level: 'low', score };
  return { level: 'none', score: 0 };
}

function checkGroundedness(answer, contextResults) {
  if (!contextResults || contextResults.length === 0) return { grounded: false, referencedSources: 0 };

  let referencedSources = 0;
  for (const result of contextResults) {
    // Check if answer mentions the law name or article name
    if (result.article_name && answer.includes(result.article_name.replace(/^Điều\s+/, 'Điều '))) {
      referencedSources++;
    } else if (result.law_name && answer.toLowerCase().includes(result.law_name.toLowerCase())) {
      referencedSources++;
    }
  }

  return { grounded: referencedSources > 0, referencedSources };
}

function legalSafetyMiddleware(req, res, next) {
  const { question, userUid } = req.body;

  // Rate limit check
  const rateResult = checkRateLimit(userUid);
  if (!rateResult.allowed) {
    return res.status(429).json({
      error: 'rate_limited',
      message: 'Bạn đã gửi quá nhiều câu hỏi. Vui lòng thử lại sau 1 phút.'
    });
  }

  // Input sanitization
  const sanitizeResult = sanitizeInput(question);
  if (!sanitizeResult.valid) {
    return res.status(400).json({ error: sanitizeResult.error, message: sanitizeResult.message });
  }

  // Content filtering
  const filterResult = filterContent(sanitizeResult.sanitized);
  if (filterResult.blocked) {
    return res.status(400).json({ error: filterResult.reason, message: filterResult.message });
  }

  // Attach sanitized question and rate limit info to request
  req.sanitizedQuestion = sanitizeResult.sanitized;
  req.rateLimitRemaining = rateResult.remaining;

  next();
}

module.exports = { legalSafetyMiddleware, checkRateLimit, sanitizeInput, filterContent, calculateConfidence, checkGroundedness };
