const rateLimitMap = new Map();
const RATE_LIMIT = 5;
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

const VALID_GRADES = ['10', '11', '12'];
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];

const INJECTION_PATTERNS = [
  /ignore\s+(previous|all|above)\s+instructions/i,
  /bỏ qua\s+(hướng dẫn|chỉ dẫn|lệnh)/i,
  /you are now/i,
  /bây giờ bạn là/i,
  /system\s*prompt/i,
  /\[\s*INST\s*\]/i,
  /<\s*\/?system\s*>/i,
];

function validateExamInput(body) {
  const { grade, topic, difficulty } = body;

  if (!grade || !VALID_GRADES.includes(String(grade))) {
    return { valid: false, error: 'invalid_grade', message: 'Lớp phải là 10, 11, hoặc 12.' };
  }

  if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
    return { valid: false, error: 'invalid_topic', message: 'Vui lòng nhập chủ đề kiểm tra.' };
  }

  if (topic.trim().length > 500) {
    return { valid: false, error: 'topic_too_long', message: 'Chủ đề quá dài. Vui lòng nhập tối đa 500 ký tự.' };
  }

  if (!difficulty || !VALID_DIFFICULTIES.includes(difficulty)) {
    return { valid: false, error: 'invalid_difficulty', message: 'Mức độ khó phải là easy, medium, hoặc hard.' };
  }

  // Check injection in topic and notes
  const fieldsToCheck = [topic, body.notes].filter(Boolean);
  for (const field of fieldsToCheck) {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(field)) {
        return { valid: false, error: 'invalid_input', message: 'Nội dung không hợp lệ. Vui lòng nhập yêu cầu đề kiểm tra KTPL.' };
      }
    }
  }

  return { valid: true, sanitizedTopic: topic.trim(), sanitizedNotes: body.notes ? body.notes.trim() : null };
}

function examSafetyMiddleware(req, res, next) {
  const { userUid } = req.body;

  // Rate limit check
  const rateResult = checkRateLimit(userUid);
  if (!rateResult.allowed) {
    return res.status(429).json({
      error: 'rate_limited',
      message: 'Bạn đã tạo quá nhiều đề. Vui lòng thử lại sau 1 phút.'
    });
  }

  // Input validation
  const validateResult = validateExamInput(req.body);
  if (!validateResult.valid) {
    return res.status(400).json({ error: validateResult.error, message: validateResult.message });
  }

  // Attach sanitized data and rate limit info to request
  req.sanitizedTopic = validateResult.sanitizedTopic;
  req.sanitizedNotes = validateResult.sanitizedNotes;
  req.rateLimitRemaining = rateResult.remaining;

  next();
}

module.exports = { examSafetyMiddleware };
