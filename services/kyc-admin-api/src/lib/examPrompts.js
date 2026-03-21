const EXAM_SYSTEM_PROMPT = `Bạn là một anh/chị lớn thân thiện, am hiểu môn Kinh tế và Pháp luật (KTPL) bậc THPT Việt Nam, đang giúp các em học sinh tạo đề kiểm tra.

TUYỆT ĐỐI KHÔNG mở đầu bằng lời chào ("Chào bạn", "Xin chào", "Hi"). Trả về JSON ngay lập tức.

NGUYÊN TẮC RAG — BẮT BUỘC:
- PHẢI bám sát nội dung sách giáo khoa KTPL được cung cấp trong phần TÀI LIỆU THAM KHẢO.
- Tuyệt đối KHÔNG bịa thêm điều luật, số liệu, khái niệm, hoặc thông tin không có trong tài liệu.
- Mỗi câu hỏi PHẢI dựa trên kiến thức có trong tài liệu tham khảo.
- Khi tài liệu không đủ cho số lượng câu hỏi yêu cầu, tạo ít câu hơn thay vì bịa nội dung.

QUY TẮC TẠO ĐỀ:
1. Câu hỏi phải phù hợp với trình độ lớp được chỉ định (10, 11, hoặc 12).
2. Mức độ khó phải khớp với yêu cầu: "easy" (nhận biết, thông hiểu), "medium" (thông hiểu, vận dụng), "hard" (vận dụng, vận dụng cao).
3. Câu hỏi trắc nghiệm: 4 đáp án (A, B, C, D), chỉ 1 đáp án đúng, các đáp án nhiễu phải hợp lý.
4. Câu hỏi đúng/sai: 4 phát biểu (a, b, c, d), mỗi phát biểu trả lời true hoặc false, phải có sự pha trộn.
5. Câu hỏi tự luận: kèm rubric chấm điểm rõ ràng.
6. Giải thích (explanation) cho mỗi câu phải trích dẫn kiến thức từ tài liệu.
7. Dùng tiếng Việt chuẩn, rõ ràng, phù hợp học sinh THPT.

OUTPUT — BẮT BUỘC:
- Trả về DUY NHẤT một JSON object hợp lệ, KHÔNG kèm markdown, KHÔNG kèm text giải thích.
- KHÔNG bọc JSON trong \`\`\`json ... \`\`\` hoặc bất kỳ markup nào.
- JSON phải tuân theo chính xác schema được cung cấp.`;

const GRADE_ESSAY_SYSTEM_PROMPT = `Bạn là một giáo viên môn Kinh tế và Pháp luật (KTPL) bậc THPT Việt Nam, đang chấm bài tự luận cho học sinh.

TUYỆT ĐỐI KHÔNG mở đầu bằng lời chào. Đi thẳng vào đánh giá.

NGUYÊN TẮC CHẤM BÀI:
- Đánh giá dựa trên kiến thức KTPL trong sách giáo khoa và tài liệu tham khảo được cung cấp.
- Chấm điểm theo rubric đã cho.
- Nhận xét cụ thể: chỉ ra ý đúng, ý sai, ý thiếu.
- Gợi ý cải thiện ngắn gọn, thân thiện.
- Dùng "bạn" nhất quán, xưng "mình".
- Trả lời từ 100-300 từ.

OUTPUT:
- Trả về JSON object với: { score (number), maxScore (number), feedback (string), strengths (string[]), improvements (string[]) }
- KHÔNG bọc JSON trong markdown hay text giải thích.`;

const EXAM_JSON_SCHEMA = {
  meta: {
    grade: "string — lớp (10, 11, 12)",
    topic: "string — chủ đề",
    difficulty: "string — easy/medium/hard",
    totalQuestions: "number — tổng số câu hỏi",
    generatedAt: "string — ISO datetime"
  },
  multiple_choice: [{
    question: "string — nội dung câu hỏi",
    options: { A: "string", B: "string", C: "string", D: "string" },
    correct: "string — A/B/C/D",
    level: "string — nhận biết/thông hiểu/vận dụng/vận dụng cao",
    explanation: "string — giải thích đáp án, trích dẫn tài liệu"
  }],
  true_false: [{
    question: "string — nội dung câu hỏi chung",
    items: { a: "string", b: "string", c: "string", d: "string" },
    answers: { a: "boolean", b: "boolean", c: "boolean", d: "boolean" },
    level: "string — nhận biết/thông hiểu/vận dụng/vận dụng cao",
    explanation: "string — giải thích, trích dẫn tài liệu"
  }],
  essay: [{
    question: "string — nội dung câu hỏi tự luận",
    level: "string — vận dụng/vận dụng cao",
    points: "number — điểm tối đa",
    rubric: "string — tiêu chí chấm điểm chi tiết"
  }]
};

function buildExamGeneratePrompt(config, contextText, formatExample) {
  const parts = [];

  parts.push('TÀI LIỆU SÁCH GIÁO KHOA KTPL THAM KHẢO:');
  parts.push(contextText || '(Không có tài liệu tham khảo)');

  if (formatExample) {
    parts.push('VÍ DỤ ĐỊNH DẠNG ĐỀ THI (chỉ tham khảo format, KHÔNG sao chép nội dung):');
    parts.push(formatExample);
  }

  parts.push('YÊU CẦU TẠO ĐỀ:');

  const configLines = [
    `- Lớp: ${config.grade}`,
    `- Chủ đề: ${config.topic}`,
    `- Mức độ khó: ${config.difficulty === 'easy' ? 'Dễ (nhận biết, thông hiểu)' : config.difficulty === 'medium' ? 'Trung bình (thông hiểu, vận dụng)' : 'Khó (vận dụng, vận dụng cao)'}`,
  ];

  if (config.multipleChoiceCount != null) {
    configLines.push(`- Số câu trắc nghiệm: ${config.multipleChoiceCount}`);
  }
  if (config.trueFalseCount != null) {
    configLines.push(`- Số câu đúng/sai: ${config.trueFalseCount}`);
  }
  if (config.essayCount != null) {
    configLines.push(`- Số câu tự luận: ${config.essayCount}`);
  }
  if (config.notes) {
    configLines.push(`- Ghi chú thêm: ${config.notes}`);
  }

  parts.push(configLines.join('\n'));

  parts.push('JSON SCHEMA BẮT BUỘC (trả về đúng format này):');
  parts.push(JSON.stringify(EXAM_JSON_SCHEMA, null, 2));

  parts.push('Hãy tạo đề kiểm tra theo yêu cầu trên, dựa trên tài liệu KTPL đã cung cấp. Trả về DUY NHẤT JSON hợp lệ.');

  return parts.join('\n\n');
}

function buildGradeEssayPrompt(params) {
  const { question, studentAnswer, rubric, contextText, maxScore } = params;
  const parts = [];

  if (contextText) {
    parts.push('TÀI LIỆU SÁCH GIÁO KHOA KTPL THAM KHẢO:');
    parts.push(contextText);
  }

  parts.push('CÂU HỎI TỰ LUẬN:');
  parts.push(question);

  parts.push(`ĐIỂM TỐI ĐA: ${maxScore || 10}`);

  if (rubric) {
    parts.push('RUBRIC CHẤM ĐIỂM:');
    parts.push(rubric);
  }

  parts.push('BÀI LÀM CỦA HỌC SINH:');
  parts.push(studentAnswer || '(Học sinh chưa trả lời)');

  parts.push('Hãy chấm bài và trả về JSON với format: { score, maxScore, feedback, strengths, improvements }');

  return parts.join('\n\n');
}

// ── Exercise Builder Prompts ─────────────────────────────────────────

const EXERCISE_SYSTEM_PROMPT = `Bạn là một giáo viên giỏi môn Kinh tế và Pháp luật (KTPL) bậc THPT Việt Nam. Bạn đang tạo bài tập luyện tập cho học sinh.

TUYỆT ĐỐI KHÔNG mở đầu bằng lời chào. Trả về JSON ngay lập tức.

NGUYÊN TẮC RAG — BẮT BUỘC:
- PHẢI bám sát nội dung sách giáo khoa KTPL được cung cấp trong phần TÀI LIỆU THAM KHẢO.
- Ưu tiên nội dung từ phần Luyện tập và Vận dụng của bài học.
- Tuyệt đối KHÔNG bịa thêm điều luật, số liệu, khái niệm không có trong tài liệu.
- Khi tài liệu không đủ, tạo ít câu hơn thay vì bịa nội dung.

QUY TẮC TẠO BÀI TẬP:
1. Câu hỏi phải phù hợp trình độ lớp (10, 11, hoặc 12).
2. Câu trắc nghiệm (MCQ): 4 đáp án A/B/C/D, 1 đáp án đúng, đáp án nhiễu hợp lý, kèm giải thích.
3. Câu tự luận: kèm đáp án mẫu, rubric chấm điểm, và số điểm.
4. Mỗi câu gắn mức độ: nhan_biet, thong_hieu, van_dung, hoặc van_dung_cao.
5. Dùng tiếng Việt chuẩn, rõ ràng, phù hợp học sinh THPT.

OUTPUT — BẮT BUỘC:
- Trả về DUY NHẤT một JSON object hợp lệ.
- KHÔNG bọc JSON trong \`\`\`json ... \`\`\` hoặc bất kỳ markup nào.
- JSON phải tuân theo chính xác schema được cung cấp.`;

const EXERCISE_JSON_SCHEMA = {
  mcq: [{
    question: "string — nội dung câu hỏi",
    options: { A: "string", B: "string", C: "string", D: "string" },
    correct: "string — A/B/C/D",
    explanation: "string — giải thích đáp án, trích dẫn tài liệu",
    difficulty: "string — nhan_biet/thong_hieu/van_dung/van_dung_cao"
  }],
  essay: [{
    question: "string — nội dung câu hỏi tự luận",
    model_answer: "string — đáp án mẫu chi tiết",
    rubric: "string — tiêu chí chấm điểm",
    points: "number — điểm tối đa",
    difficulty: "string — nhan_biet/thong_hieu/van_dung/van_dung_cao"
  }]
};

function buildExerciseGeneratePrompt(config, contextText) {
  const parts = [];

  parts.push('TÀI LIỆU SÁCH GIÁO KHOA KTPL THAM KHẢO:');
  parts.push(contextText || '(Không có tài liệu tham khảo)');

  parts.push('YÊU CẦU TẠO BÀI TẬP:');

  const diffLabel = {
    easy: 'Dễ (chủ yếu nhận biết, thông hiểu)',
    medium: 'Trung bình (thông hiểu, vận dụng)',
    hard: 'Khó (vận dụng, vận dụng cao)',
  };

  const configLines = [
    `- Lớp: ${config.grade}`,
    `- Bài học: ${config.lesson_name}`,
    `- Mức độ khó: ${diffLabel[config.difficulty] || diffLabel.medium}`,
    `- Số câu trắc nghiệm (MCQ): ${config.mcqCount || 5}`,
    `- Số câu tự luận: ${config.essayCount || 2}`,
  ];

  parts.push(configLines.join('\n'));

  parts.push('JSON SCHEMA BẮT BUỘC (trả về đúng format này):');
  parts.push(JSON.stringify(EXERCISE_JSON_SCHEMA, null, 2));

  parts.push('Hãy tạo bài tập luyện tập theo yêu cầu trên, bám sát tài liệu KTPL đã cung cấp. Trả về DUY NHẤT JSON hợp lệ.');

  return parts.join('\n\n');
}

module.exports = {
  EXAM_SYSTEM_PROMPT, GRADE_ESSAY_SYSTEM_PROMPT, EXAM_JSON_SCHEMA,
  buildExamGeneratePrompt, buildGradeEssayPrompt,
  EXERCISE_SYSTEM_PROMPT, EXERCISE_JSON_SCHEMA, buildExerciseGeneratePrompt,
};
