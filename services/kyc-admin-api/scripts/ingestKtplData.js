require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const pdfParse = require("pdf-parse");
const { query, ensureSchema } = require("../src/db");

// Lazy-loaded after OCR phase to avoid OOM (embedding model ~500MB + OCR ~1GB)
let _embeddings = null;
let _semanticChunker = null;
function getEmbeddings() {
  if (!_embeddings) _embeddings = require("../src/lib/embeddings");
  return _embeddings;
}
function getSemanticChunker() {
  if (!_semanticChunker) _semanticChunker = require("../src/lib/semanticChunker");
  return _semanticChunker;
}

// Resolve paths: works both locally (services/kyc-admin-api/scripts/) and in Docker (/app/scripts/)
const KTPL_DIR_LOCAL = path.join(__dirname, "../../../rule/KTPL");
const KTPL_DIR_DOCKER = path.join(__dirname, "../rule/KTPL");
const KTPL_DIR = fs.existsSync(KTPL_DIR_LOCAL) ? KTPL_DIR_LOCAL : KTPL_DIR_DOCKER;

const DETHI_DIR_LOCAL = path.join(__dirname, "../../../rule/DeThi");
const DETHI_DIR_DOCKER = path.join(__dirname, "../rule/DeThi");
const DETHI_DIR = fs.existsSync(DETHI_DIR_LOCAL) ? DETHI_DIR_LOCAL : DETHI_DIR_DOCKER;

// CLI flags
const args = process.argv.slice(2);
const FLAG_CLEAR = args.includes("--clear");
const FLAG_DRY_RUN = args.includes("--dry-run");
const FLAG_LEGACY = args.includes("--legacy");

// ── Known KTPL curriculum reference (Cánh Diều / NXB Đại học Huế) ──────
// Source of truth for lesson names — OCR text is too unreliable for heading extraction.
const LESSON_REFERENCE = {
  "10": {
    topics: {
      1: "Chủ đề 1. Nền kinh tế và các chủ thể của nền kinh tế",
      2: "Chủ đề 2. Thị trường và cơ chế thị trường",
      3: "Chủ đề 3. Ngân sách nhà nước và thuế",
      4: "Chủ đề 4. Sản xuất kinh doanh và các mô hình sản xuất kinh doanh",
      5: "Chủ đề 5. Tín dụng và các dịch vụ tín dụng",
      6: "Chủ đề 6. Lập kế hoạch tài chính cá nhân",
      7: "Chủ đề 7. Hệ thống chính trị nước CHXHCN Việt Nam",
      8: "Chủ đề 8. Hiến pháp nước CHXHCN Việt Nam",
      9: "Chủ đề 9. Pháp luật nước CHXHCN Việt Nam",
    },
    lessons: {
      1:  { name: "Bài 1. Các hoạt động kinh tế trong đời sống xã hội", topic: 1 },
      2:  { name: "Bài 2. Các chủ thể của nền kinh tế", topic: 1 },
      3:  { name: "Bài 3. Thị trường", topic: 2 },
      4:  { name: "Bài 4. Cơ chế thị trường", topic: 2 },
      5:  { name: "Bài 5. Ngân sách nhà nước", topic: 3 },
      6:  { name: "Bài 6. Thuế", topic: 3 },
      7:  { name: "Bài 7. Sản xuất kinh doanh và các mô hình sản xuất kinh doanh", topic: 4 },
      8:  { name: "Bài 8. Tín dụng", topic: 5 },
      9:  { name: "Bài 9. Dịch vụ tín dụng", topic: 5 },
      10: { name: "Bài 10. Lập kế hoạch tài chính cá nhân", topic: 6 },
      11: { name: "Bài 11. Hệ thống chính trị nước CHXHCN Việt Nam", topic: 7 },
      12: { name: "Bài 12. Bộ máy nhà nước CHXHCN Việt Nam", topic: 7 },
      13: { name: "Bài 13. Chính quyền địa phương", topic: 7 },
      14: { name: "Bài 14. Hiến pháp nước CHXHCN Việt Nam", topic: 8 },
      15: { name: "Bài 15. Hiến pháp về chế độ chính trị", topic: 8 },
      16: { name: "Bài 16. Hiến pháp về quyền con người, quyền và nghĩa vụ cơ bản của công dân", topic: 8 },
      17: { name: "Bài 17. Hiến pháp về kinh tế, văn hóa, giáo dục, khoa học, công nghệ và môi trường", topic: 8 },
      18: { name: "Bài 18. Hiến pháp về bộ máy nhà nước", topic: 8 },
      19: { name: "Bài 19. Pháp luật trong đời sống xã hội", topic: 9 },
      20: { name: "Bài 20. Hệ thống pháp luật Việt Nam", topic: 9 },
      21: { name: "Bài 21. Thực hiện pháp luật", topic: 9 },
    },
  },
  "11": {
    topics: {
      1: "Chủ đề 1. Cạnh tranh, cung, cầu trong kinh tế thị trường",
      2: "Chủ đề 2. Thị trường lao động, việc làm",
      3: "Chủ đề 3. Thất nghiệp, lạm phát",
      4: "Chủ đề 4. Ý tưởng, cơ hội kinh doanh và các năng lực cần thiết của người kinh doanh",
      5: "Chủ đề 5. Đạo đức kinh doanh",
      6: "Chủ đề 6. Văn hoá tiêu dùng",
      7: "Chủ đề 7. Quyền bình đẳng của công dân",
      8: "Chủ đề 8. Quyền và nghĩa vụ cơ bản của công dân",
      9: "Chủ đề 9. Một số quyền tự do cơ bản của công dân",
    },
    lessons: {
      1:  { name: "Bài 1. Cạnh tranh trong kinh tế thị trường", topic: 1 },
      2:  { name: "Bài 2. Cung, cầu trong kinh tế thị trường", topic: 1 },
      3:  { name: "Bài 3. Thị trường lao động", topic: 2 },
      4:  { name: "Bài 4. Việc làm", topic: 2 },
      5:  { name: "Bài 5. Thất nghiệp", topic: 3 },
      6:  { name: "Bài 6. Lạm phát", topic: 3 },
      7:  { name: "Bài 7. Ý tưởng, cơ hội kinh doanh và các năng lực cần thiết của người kinh doanh", topic: 4 },
      8:  { name: "Bài 8. Đạo đức kinh doanh", topic: 5 },
      9:  { name: "Bài 9. Văn hoá tiêu dùng", topic: 6 },
      10: { name: "Bài 10. Quyền bình đẳng của công dân trước pháp luật", topic: 7 },
      11: { name: "Bài 11. Bình đẳng giới trong đời sống xã hội", topic: 7 },
      12: { name: "Bài 12. Quyền bình đẳng giữa các dân tộc, tôn giáo", topic: 7 },
      13: { name: "Bài 13. Quyền và nghĩa vụ của công dân trong tham gia quản lí nhà nước và xã hội", topic: 8 },
      14: { name: "Bài 14. Quyền và nghĩa vụ của công dân về bầu cử và ứng cử", topic: 8 },
      15: { name: "Bài 15. Quyền và nghĩa vụ của công dân về khiếu nại, tố cáo", topic: 8 },
      16: { name: "Bài 16. Quyền và nghĩa vụ của công dân về bảo vệ Tổ quốc", topic: 8 },
      17: { name: "Bài 17. Quyền bất khả xâm phạm về thân thể, được pháp luật bảo hộ về tính mạng, sức khoẻ, danh dự và nhân phẩm", topic: 9 },
      18: { name: "Bài 18. Quyền bất khả xâm phạm về chỗ ở", topic: 9 },
      19: { name: "Bài 19. Quyền được bảo đảm an toàn và bí mật thư tín, điện thoại, điện tín", topic: 9 },
      20: { name: "Bài 20. Quyền và nghĩa vụ công dân về tự do ngôn luận, báo chí và tiếp cận thông tin", topic: 9 },
      21: { name: "Bài 21. Quyền và nghĩa vụ công dân về tự do tín ngưỡng và tôn giáo", topic: 9 },
    },
  },
  "12": {
    topics: {
      1: "Chủ đề 1. Tăng trưởng và phát triển kinh tế",
      2: "Chủ đề 2. Hội nhập kinh tế quốc tế",
      3: "Chủ đề 3. Bảo hiểm và an sinh xã hội",
      4: "Chủ đề 4. Lập kế hoạch kinh doanh",
      5: "Chủ đề 5. Trách nhiệm xã hội của doanh nghiệp",
      6: "Chủ đề 6. Quản lí thu, chi trong gia đình",
      7: "Chủ đề 7. Một số quyền và nghĩa vụ của công dân về kinh tế",
      8: "Chủ đề 8. Quyền và nghĩa vụ của công dân về văn hóa, xã hội",
      9: "Chủ đề 9. Một số vấn đề cơ bản của pháp luật quốc tế",
    },
    lessons: {
      1:  { name: "Bài 1. Tăng trưởng và phát triển kinh tế", topic: 1 },
      2:  { name: "Bài 2. Hội nhập kinh tế quốc tế", topic: 2 },
      3:  { name: "Bài 3. Bảo hiểm", topic: 3 },
      4:  { name: "Bài 4. An sinh xã hội", topic: 3 },
      5:  { name: "Bài 5. Lập kế hoạch kinh doanh", topic: 4 },
      6:  { name: "Bài 6. Trách nhiệm xã hội của doanh nghiệp", topic: 5 },
      7:  { name: "Bài 7. Quản lí thu, chi trong gia đình", topic: 6 },
      8:  { name: "Bài 8. Quyền và nghĩa vụ của công dân về kinh doanh và nộp thuế", topic: 7 },
      9:  { name: "Bài 9. Quyền và nghĩa vụ của công dân về sở hữu tài sản", topic: 7 },
      10: { name: "Bài 10. Quyền và nghĩa vụ của công dân trong hôn nhân và gia đình", topic: 8 },
      11: { name: "Bài 11. Quyền và nghĩa vụ của công dân trong học tập", topic: 8 },
      12: { name: "Bài 12. Quyền và nghĩa vụ của công dân trong bảo vệ, chăm sóc sức khỏe và đảm bảo an sinh xã hội", topic: 8 },
      13: { name: "Bài 13. Quyền và nghĩa vụ của công dân về bảo vệ di sản văn hóa", topic: 8 },
      14: { name: "Bài 14. Quyền và nghĩa vụ của công dân trong bảo vệ môi trường và tài nguyên thiên nhiên", topic: 8 },
      15: { name: "Bài 15. Những vấn đề chung về pháp luật quốc tế", topic: 9 },
      16: { name: "Bài 16. Công pháp quốc tế về dân cư, lãnh thổ và biên giới quốc gia", topic: 9 },
      17: { name: "Bài 17. Các nguyên tắc cơ bản của Tổ chức Thương mại thế giới và hợp đồng thương mại quốc tế", topic: 9 },
    },
  },
};

/**
 * Look up the correct lesson name and topic from the reference map.
 * Returns { lessonName, topicName } or null if not found.
 */
function lookupLesson(grade, baiNumber) {
  const ref = LESSON_REFERENCE[grade];
  if (!ref) return null;
  const lesson = ref.lessons[baiNumber];
  if (!lesson) return null;
  const topicName = ref.topics[lesson.topic] || "";
  return { lessonName: lesson.name, topicName };
}

// Textbook set detection from filename
function detectTextbookSet(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes("canh-dieu") || lower.includes("canh dieu") || lower.includes(" cd")) return "CD";
  if (lower.includes("ctst") || lower.includes("chan-troi") || lower.includes("chan troi")) return "CTST";
  if (lower.includes("kntt") || lower.includes("ket-noi") || lower.includes("ket noi")) return "KNTT";
  // Fallback patterns from task description
  if (lower.includes("sgk-gd-ktpl-10")) return "KNTT"; // SGK-GD-KTPL-10.pdf
  return "UNKNOWN";
}

// Parse DeThi filename for grade and exam_type
// e.g. "gk1-l10.txt" → { grade: "10", examType: "gk1" }
// e.g. "ck1-l12.txt" → { grade: "12", examType: "ck1" }
function parseDeThiFilename(filename) {
  const match = filename.match(/^(gk\d|ck\d)-l(\d{2})\.txt$/i);
  if (!match) return null;
  return { examType: match[1].toLowerCase(), grade: match[2] };
}

/**
 * Legacy character-based chunking for textbook sections.
 */
function chunkSection(section) {
  const MAX_CHUNK_SIZE = 1800;
  const OVERLAP = 200;
  const content = section.content;

  if (content.length <= 2000) {
    return [{
      ...section,
      chunkIndex: 0,
      totalChunks: 1,
      chunkingMethod: "character",
    }];
  }

  const chunks = [];
  const paragraphs = content.split(/\n\n+/);
  let currentChunk = "";
  let currentParagraphs = [];

  function finalizeChunk() {
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = "";
      currentParagraphs = [];
    }
  }

  function addParagraph(para) {
    const testChunk = currentChunk + (currentChunk ? "\n\n" : "") + para;
    if (testChunk.length <= MAX_CHUNK_SIZE) {
      currentChunk = testChunk;
      currentParagraphs.push(para);
    } else {
      if (currentChunk) {
        const lastPara = currentParagraphs.length > 0
          ? currentParagraphs[currentParagraphs.length - 1]
          : null;
        finalizeChunk();
        if (lastPara && lastPara.length <= OVERLAP) {
          currentChunk = lastPara;
          currentParagraphs = [lastPara];
        }
      }

      if (para.length > MAX_CHUNK_SIZE) {
        const sentences = para.split(/\.\s+/);
        let sentenceChunk = "";

        for (let sentence of sentences) {
          const testSentence = sentenceChunk + (sentenceChunk ? ". " : "") + sentence;
          if (testSentence.length <= MAX_CHUNK_SIZE) {
            sentenceChunk = testSentence;
          } else {
            if (sentenceChunk) {
              chunks.push(sentenceChunk.trim());
              sentenceChunk = sentenceChunk.slice(-OVERLAP) + ". " + sentence;
            } else {
              chunks.push(sentence.trim());
              sentenceChunk = "";
            }
          }
        }

        if (sentenceChunk.trim()) {
          currentChunk = sentenceChunk.trim();
          currentParagraphs = [sentenceChunk.trim()];
        }
      } else {
        currentChunk = (currentChunk ? currentChunk + "\n\n" : "") + para;
        currentParagraphs.push(para);
      }
    }
  }

  for (const para of paragraphs) {
    if (para.trim()) {
      addParagraph(para.trim());
    }
  }

  finalizeChunk();

  const totalChunks = chunks.length;
  return chunks.map((chunkContent, i) => ({
    sourceName: section.sourceName,
    grade: section.grade,
    textbookSet: section.textbookSet,
    chapter: section.chapter,
    sectionTitle: i === 0 ? section.sectionTitle : `${section.sectionTitle} [phần ${i + 1}]`,
    content: chunkContent,
    chunkIndex: i,
    totalChunks,
    chunkingMethod: "character",
  }));
}

/**
 * Clean PDF text artifacts: standalone page numbers, repeated headers.
 */
function cleanPdfText(text) {
  const lines = text.split("\n");
  const cleaned = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip standalone page numbers (just digits, possibly with surrounding whitespace)
    if (/^\d{1,4}$/.test(trimmed)) continue;
    // Skip common repeated headers/footers
    if (/^(Trang\s+\d|GIÁO DỤC KINH TẾ VÀ PHÁP LUẬT|NHÀ XUẤT BẢN)$/i.test(trimmed)) continue;
    cleaned.push(line);
  }

  return cleaned.join("\n");
}

/**
 * Parse PDF text into sections by Vietnamese textbook headings.
 * Detects: "Chương" for chapter, "Bài" for section, "Mục" or numbered items for subsections.
 */
function detectSectionType(line) {
  const lower = line.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^luyện\s*tập/i.test(lower) || /luyện\s*tập$/i.test(lower)) return 'luyen_tap';
  if (/^vận\s*dụng/i.test(lower) || /vận\s*dụng$/i.test(lower)) return 'van_dung';
  if (/^khám\s*phá/i.test(lower) || /khám\s*phá$/i.test(lower)) return 'kham_pha';
  return null;
}

/**
 * Try to extract a lesson number from a garbled "Bài" line.
 * OCR often garbles digits: 1→Ï/l/I/ỉ, etc.
 * Returns the number if found, null otherwise.
 */
function extractBaiNumber(line) {
  // Clean digit match: "Bài 1", "Bài 12", etc.
  const cleanMatch = line.match(/^b[àa]i\s+(\d{1,2})/i);
  if (cleanMatch) return parseInt(cleanMatch[1], 10);

  // Garbled digit: "Bài Ï", "Bài l", etc. — extract chars after "Bài "
  const afterBai = line.replace(/^b[àa]i\s+/i, '');
  // Map common OCR garbles to digits
  const charMap = { 'Ï': '1', 'ï': '1', 'l': '1', 'I': '1', '¡': '1', 'ỉ': '1', 'Ỉ': '1',
                    'Z': '2', 'z': '2', 'ä': '4', 'S': '5', 's': '5', 'G': '6', 'ó': '6',
                    'T': '7', 'B': '8', 'g': '9', 'Q': '9' };
  // Try first 1-2 chars
  let numStr = '';
  for (let i = 0; i < Math.min(2, afterBai.length); i++) {
    const ch = afterBai[i];
    if (/\d/.test(ch)) { numStr += ch; continue; }
    if (charMap[ch]) { numStr += charMap[ch]; continue; }
    break;
  }
  if (numStr) {
    const num = parseInt(numStr, 10);
    if (num >= 1 && num <= 30) return num;
  }
  return null;
}

/**
 * Try to infer lesson number by matching line content against reference lesson titles.
 * Uses keyword matching: check if distinctive words from a reference title appear in the line.
 */
function inferLessonFromContent(line, grade) {
  const ref = LESSON_REFERENCE[grade];
  if (!ref) return null;
  const lower = line.toLowerCase().replace(/\s+/g, ' ');

  let bestMatch = null;
  let bestScore = 0;

  for (const [numStr, lesson] of Object.entries(ref.lessons)) {
    // Extract distinctive keywords from lesson name (skip "Bài N.")
    const titlePart = lesson.name.replace(/^Bài\s+\d+\.\s*/, '').toLowerCase();
    const keywords = titlePart.split(/\s+/).filter(w => w.length > 3);
    if (keywords.length === 0) continue;

    let matches = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) matches++;
    }
    const score = matches / keywords.length;
    if (score > bestScore && score >= 0.3) {
      bestScore = score;
      bestMatch = parseInt(numStr, 10);
    }
  }
  return bestMatch;
}

function parsePdfSections(text, sourceName, grade, textbookSet) {
  const lines = text.split("\n");
  let currentChapter = "";    // Topic / Chủ đề name
  let currentSection = "";    // Current section title for DB
  let currentLesson = "";     // Clean lesson name from reference
  let currentSectionType = "content";
  let currentContent = [];
  let lastBaiNum = 0;         // Track last detected lesson number for sequential inference
  const sections = [];

  function pushSection() {
    if (currentSection) {
      const sectionContent = currentContent.join("\n").trim();
      if (sectionContent.length < 10) {
        if (sectionContent.length === 0) {
          // Silent skip for empty sections (e.g. TOC entries)
        } else {
          console.warn(`  Warning: Skipping short section "${currentSection}" in ${sourceName} (${sectionContent.length} chars)`);
        }
      } else {
        sections.push({
          sourceName,
          grade,
          textbookSet,
          chapter: currentChapter,
          sectionTitle: currentSection,
          content: sectionContent,
          lessonName: currentLesson || null,
          sectionType: currentSectionType,
        });
      }
    }
    currentContent = [];
  }

  function applyLesson(baiNum) {
    pushSection();
    const lookup = lookupLesson(grade, baiNum);
    if (lookup) {
      currentLesson = lookup.lessonName;
      currentSection = lookup.lessonName;
      currentChapter = lookup.topicName;
    } else {
      currentLesson = `Bài ${baiNum}`;
      currentSection = `Bài ${baiNum}`;
    }
    lastBaiNum = baiNum;
    currentSectionType = "content";
  }

  // Regex patterns
  const topicRegex = /^(?:ch[uủú]|ph[uú]|bh[uú])\s*(?:đ[eềẽế]|d[eềẽ])\s*(\d{1,2})/i;
  // Match "Bài", "BÀI", "BAI" (without diacritics), plus common OCR garbles
  const baiStartRegex = /^b[àaẠẢẤẦẨẪẬÁÀ]i\s+/i;
  // "Yêu cầu cần đạt" appears at the start of every lesson
  const yeuCauRegex = /y[eê]u\s*c[ầa]u\s*c[ầa]n\s*đ[ạa]t/i;
  // Track content size in current lesson (to skip section types on info pages)
  let lessonContentSize = 0;
  // Track line index for lookahead
  let lineIdx = -1;

  for (let line of lines) {
    lineIdx++;
    line = line.trim();
    if (!line) continue;

    // Detect topic heading: "Chủ đề 1", OCR variants "Phú đề 1", "Bhú đề 1"
    const topicMatch = line.match(topicRegex);
    if (topicMatch) {
      pushSection();
      const topicNum = parseInt(topicMatch[1], 10);
      const ref = LESSON_REFERENCE[grade];
      if (ref && ref.topics[topicNum]) {
        currentChapter = ref.topics[topicNum];
      } else {
        currentChapter = line.replace(/\s+\d{1,3}\s*$/, '').trim();
      }
      currentSection = "";
      currentSectionType = "content";
      continue;
    }

    // Detect chapter heading: "Chương 1", "CHƯƠNG I" — but NOT "Chương trình"
    if (/^ch[uư][oơ]ng\s+\d/i.test(line) || /^ch[uư][oơ]ng\s+[IVX]/i.test(line)) {
      pushSection();
      currentChapter = line.replace(/\s+\d{1,3}\s*$/, '').trim();
      currentSection = "";
      currentSectionType = "content";
      continue;
    }

    // Detect lesson heading: "Bài ..."
    if (baiStartRegex.test(line) && line.length < 300) {
      // Try to extract lesson number
      let baiNum = extractBaiNumber(line);

      // If digit extraction failed, try keyword matching against reference
      if (!baiNum) {
        baiNum = inferLessonFromContent(line, grade);
      }

      // Last resort: sequential inference (next lesson after lastBaiNum)
      if (!baiNum && lastBaiNum > 0) {
        const nextNum = lastBaiNum + 1;
        const ref = LESSON_REFERENCE[grade];
        if (ref && ref.lessons[nextNum]) {
          baiNum = nextNum;
          console.log(`  [Infer] "${line.substring(0, 50)}..." → Bài ${baiNum} (sequential)`);
        }
      }

      if (baiNum) {
        applyLesson(baiNum);
        lessonContentSize = 0;
        continue;
      }
      // If we still can't determine the lesson, fall through to content
    }

    // Secondary lesson detection: "Yêu cầu cần đạt" marks the start of a lesson
    // Look ahead to see if this is followed by lesson objectives
    if (yeuCauRegex.test(line) && lastBaiNum > 0) {
      // Check if we're already past this lesson's requirements
      // (each lesson only has one "Yêu cầu cần đạt" at the start)
      // If lessonContentSize is large (> 500 chars), this is probably a NEW lesson
      if (lessonContentSize > 500) {
        const nextNum = lastBaiNum + 1;
        const ref = LESSON_REFERENCE[grade];
        if (ref && ref.lessons[nextNum]) {
          console.log(`  [Infer] "Yêu cầu cần đạt" after ${lessonContentSize} chars → Bài ${nextNum} (requirement marker)`);
          applyLesson(nextNum);
          lessonContentSize = 0;
          continue;
        }
      }
    }

    // Also try: ALL-CAPS short line that matches known lesson title keywords
    // This catches garbled "Bài" headings that OCR converted to uppercase title text only
    if (line.length > 10 && line.length < 200 && lessonContentSize > 300) {
      const upper = line.toUpperCase();
      if (upper === line && /[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ]/.test(line)) {
        // This is an ALL-CAPS line — might be a lesson title
        const matchedBai = inferLessonFromContent(line, grade);
        if (matchedBai && matchedBai > lastBaiNum) {
          console.log(`  [Infer] ALL-CAPS "${line.substring(0, 50)}..." → Bài ${matchedBai} (title keywords)`);
          applyLesson(matchedBai);
          lessonContentSize = 0;
          continue;
        }
      }
    }

    // Detect subsection types: Luyện tập, Vận dụng, Khám phá
    // Only detect these when we have substantial lesson content (avoid info pages)
    const secType = detectSectionType(line);
    if (secType && currentLesson && lessonContentSize > 200) {
      pushSection();
      currentSectionType = secType;
      currentSection = currentLesson ? `${currentLesson} - ${line.replace(/\s+\d{1,3}\s*$/, '').trim()}` : line;
      continue;
    }

    // Detect subsection heading: "Mục I", "Mục 1"
    if (/^(mục\s+)/i.test(line) && line.length < 200 && currentLesson) {
      pushSection();
      currentSection = line.replace(/\s+\d{1,3}\s*$/, '').trim();
      currentSectionType = "content";
      continue;
    }

    currentContent.push(line);
    lessonContentSize += line.length;
  }
  pushSection(); // last one

  return sections;
}

/**
 * OCR a scanned PDF using pdftoppm + tesseract.
 * Falls back to this when pdf-parse returns empty text.
 */
function ocrPdf(filePath) {
  const tmpDir = `/tmp/ocr-${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });

  // Get total page count
  let totalPages;
  try {
    const info = execSync(`pdfinfo "${filePath}" 2>/dev/null | grep Pages`, { encoding: "utf-8" });
    totalPages = parseInt(info.match(/(\d+)/)?.[1], 10) || 200;
  } catch { totalPages = 200; }
  console.log(`  [OCR] ${totalPages} pages, processing in batches (200 DPI)...`);

  const BATCH = 10; // pages per batch to limit memory
  let fullText = "";
  let processed = 0;

  try {
    for (let start = 1; start <= totalPages; start += BATCH) {
      const end = Math.min(start + BATCH - 1, totalPages);

      // Convert batch of pages to images (200 DPI to save memory)
      execSync(`pdftoppm -r 200 -gray -f ${start} -l ${end} "${filePath}" "${tmpDir}/page"`, {
        timeout: 120000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // OCR each page image
      const pages = fs.readdirSync(tmpDir)
        .filter(f => f.endsWith(".pgm") || f.endsWith(".ppm"))
        .sort();

      for (const page of pages) {
        const imgPath = path.join(tmpDir, page);
        try {
          const text = execSync(`tesseract "${imgPath}" stdout -l vie --psm 6`, {
            timeout: 30000,
            encoding: "utf-8",
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          fullText += text + "\n";
        } catch (pageErr) {
          console.warn(`  [OCR] Page failed: ${pageErr.message?.substring(0, 60)}`);
        }
        // Delete image immediately to free disk
        try { fs.unlinkSync(imgPath); } catch {}
      }

      processed += (end - start + 1);
      if (processed % 20 === 0 || end === totalPages) {
        console.log(`  [OCR] Processed ${processed}/${totalPages} pages...`);
      }
    }

    console.log(`  [OCR] Done: ${fullText.length} chars extracted`);
    return fullText;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Phase 1: Extract text from PDF (OCR if needed). Does NOT load embedding model.
 * Returns { cleanedText, fileName, grade, textbookSet, sourceName } or null if empty.
 */
function extractPdfText(filePath, grade) {
  const fileName = path.basename(filePath);
  const textbookSet = detectTextbookSet(fileName);
  const sourceName = path.basename(filePath, ".pdf");

  // Read and parse PDF
  const buffer = fs.readFileSync(filePath);
  // pdf-parse is async but we need sync flow for OCR memory management
  let rawText = "";
  try {
    const data = require("pdf-parse").parseSync
      ? require("pdf-parse").parseSync(buffer)
      : null;
    rawText = data?.text || "";
  } catch {}

  return { filePath, fileName, grade, textbookSet, sourceName };
}

/**
 * Phase 1b: Async text extraction (OCR if needed).
 */
async function extractPdfTextAsync(filePath, grade) {
  const fileName = path.basename(filePath);
  const textbookSet = detectTextbookSet(fileName);
  const sourceName = path.basename(filePath, ".pdf");

  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  let rawText = data.text;

  if (rawText.trim().length < 100) {
    console.log(`  [${fileName}] No extractable text (scanned PDF), using OCR...`);
    rawText = ocrPdf(filePath);
    if (rawText.trim().length < 100) {
      console.warn(`  [${fileName}] OCR also returned insufficient text, skipping.`);
      return null;
    }
  }

  const cleanedText = cleanPdfText(rawText);
  return { cleanedText, fileName, grade, textbookSet, sourceName };
}

/**
 * Phase 2: Chunk, embed, and insert a pre-extracted PDF text.
 */
async function ingestPdfText({ cleanedText, fileName, grade, textbookSet, sourceName }) {

  // Parse into sections
  const sections = parsePdfSections(cleanedText, sourceName, grade, textbookSet);

  const chunkingMode = FLAG_LEGACY ? "character" : "semantic";
  console.log(`- Ingesting ${fileName} (grade ${grade}, set ${textbookSet}): found ${sections.length} sections (${chunkingMode} chunking)`);

  // Apply chunking
  const allChunks = [];
  for (const section of sections) {
    let chunks;
    if (FLAG_LEGACY) {
      chunks = chunkSection(section);
    } else {
      // Semantic chunking: get text chunks, then map back to section objects
      const textChunks = await getSemanticChunker().semanticChunkText(section.content);
      const totalChunks = textChunks.length;
      chunks = textChunks.map((chunkContent, i) => ({
        sourceName: section.sourceName,
        grade: section.grade,
        textbookSet: section.textbookSet,
        chapter: section.chapter,
        sectionTitle: i === 0 ? section.sectionTitle : `${section.sectionTitle} [phần ${i + 1}]`,
        content: chunkContent,
        chunkIndex: i,
        totalChunks,
        chunkingMethod: "semantic",
        lessonName: section.lessonName || null,
        sectionType: section.sectionType || "content",
      }));
    }
    // Ensure lessonName and sectionType are carried through
    chunks.forEach(c => {
      if (!c.lessonName) c.lessonName = section.lessonName || null;
      if (!c.sectionType) c.sectionType = section.sectionType || "content";
    });
    allChunks.push(...chunks);
  }

  console.log(`  Created ${allChunks.length} chunks from ${sections.length} sections`);

  // Dry run: print stats and return
  if (FLAG_DRY_RUN) {
    const avgLen = allChunks.length > 0
      ? Math.round(allChunks.reduce((sum, c) => sum + c.content.length, 0) / allChunks.length)
      : 0;
    const maxLen = allChunks.length > 0
      ? Math.max(...allChunks.map(c => c.content.length))
      : 0;
    const minLen = allChunks.length > 0
      ? Math.min(...allChunks.map(c => c.content.length))
      : 0;
    console.log(`  [dry-run] avg chunk: ${avgLen} chars, min: ${minLen}, max: ${maxLen}`);
    return { sections: sections.length, chunks: allChunks.length, inserted: 0, updated: 0, skipped: 0 };
  }

  // Generate embeddings (lazy-load to avoid OOM during OCR phase)
  const { generateEmbeddingsBatch, preprocessText, TaskType } = getEmbeddings();
  const embeddingInputs = allChunks.map((chunk) => ({
    text: preprocessText(`${chunk.sourceName} ${chunk.chapter} ${chunk.sectionTitle}\n${chunk.content}`),
  }));
  const embeddings = await generateEmbeddingsBatch(embeddingInputs, TaskType.RETRIEVAL_DOCUMENT);

  // Upsert chunks
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    const emb = embeddings[i];
    const contentHash = crypto.createHash("sha256").update(chunk.content).digest("hex");
    const chunkingMethod = chunk.chunkingMethod || chunkingMode;

    if (emb) {
      const result = await query(
        `INSERT INTO exam_knowledge
          (source_name, grade, textbook_set, chapter, section_title, content, embedding, chunk_index, total_chunks, content_hash, chunking_method, lesson_name, section_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (source_name, section_title, chunk_index)
         DO UPDATE SET
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding,
           grade = EXCLUDED.grade,
           textbook_set = EXCLUDED.textbook_set,
           chapter = EXCLUDED.chapter,
           total_chunks = EXCLUDED.total_chunks,
           content_hash = EXCLUDED.content_hash,
           chunking_method = EXCLUDED.chunking_method,
           lesson_name = EXCLUDED.lesson_name,
           section_type = EXCLUDED.section_type
         WHERE exam_knowledge.content_hash IS DISTINCT FROM EXCLUDED.content_hash
         RETURNING (xmax = 0) AS inserted`,
        [
          chunk.sourceName,
          chunk.grade,
          chunk.textbookSet,
          chunk.chapter,
          chunk.sectionTitle,
          chunk.content,
          JSON.stringify(emb),
          chunk.chunkIndex,
          chunk.totalChunks,
          contentHash,
          chunkingMethod,
          chunk.lessonName,
          chunk.sectionType
        ]
      );

      if (result.rows.length > 0) {
        if (result.rows[0].inserted) inserted++;
        else updated++;
      } else {
        skipped++;
      }
    } else {
      const result = await query(
        `INSERT INTO exam_knowledge
          (source_name, grade, textbook_set, chapter, section_title, content, chunk_index, total_chunks, content_hash, chunking_method, lesson_name, section_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (source_name, section_title, chunk_index)
         DO UPDATE SET
           content = EXCLUDED.content,
           grade = EXCLUDED.grade,
           textbook_set = EXCLUDED.textbook_set,
           chapter = EXCLUDED.chapter,
           total_chunks = EXCLUDED.total_chunks,
           content_hash = EXCLUDED.content_hash,
           chunking_method = EXCLUDED.chunking_method,
           lesson_name = EXCLUDED.lesson_name,
           section_type = EXCLUDED.section_type
         WHERE exam_knowledge.content_hash IS DISTINCT FROM EXCLUDED.content_hash
         RETURNING (xmax = 0) AS inserted`,
        [
          chunk.sourceName,
          chunk.grade,
          chunk.textbookSet,
          chunk.chapter,
          chunk.sectionTitle,
          chunk.content,
          chunk.chunkIndex,
          chunk.totalChunks,
          contentHash,
          chunkingMethod,
          chunk.lessonName,
          chunk.sectionType
        ]
      );

      if (result.rows.length > 0) {
        if (result.rows[0].inserted) inserted++;
        else updated++;
      } else {
        skipped++;
      }
    }
  }

  return { sections: sections.length, chunks: allChunks.length, inserted, updated, skipped };
}

/**
 * Parse a DeThi .txt file into structured exam template data.
 * Extracts MCQ (PHẦN I), TF/Đúng-Sai (PHẦN II), Essay (PHẦN III), and Answer Key (ĐÁP ÁN).
 */
function parseDeThiFile(content) {
  // Normalize line endings
  const text = content.replace(/\r\n/g, "\n");

  // Split into major sections
  // Look for PHẦN I, PHẦN II, PHẦN III, ĐÁP ÁN markers
  const mcMatch = text.match(/PHẦN\s+I[.:]\s*(.*?)(?=PHẦN\s+II)/si);
  const tfMatch = text.match(/PHẦN\s+II[.:]\s*(.*?)(?=PHẦN\s+III|----)/si);
  const essayMatch = text.match(/PHẦN\s+III[.:]\s*(.*?)(?=-{3,}\s*HẾT|ĐÁP\s*ÁN)/si);
  const answerMatch = text.match(/ĐÁP\s*ÁN[:\s]*(.*)/si);

  // For grade 11 and 12, PHẦN II is essay (TỰ LUẬN), not TF
  // Detect: if PHẦN II header contains "TỰ LUẬN" then it's essay format
  const part2Header = text.match(/PHẦN\s+II[.:]\s*([^\n]*)/i);
  const isTuLuanPart2 = part2Header && /TỰ LUẬN/i.test(part2Header[1]);

  let mcExample = null;
  let tfExample = null;
  let essayExample = null;
  let answerKey = null;

  if (mcMatch) {
    mcExample = mcMatch[0].trim();
  }

  if (isTuLuanPart2) {
    // Grade 11/12 format: PHẦN I = MCQ, PHẦN II = TỰ LUẬN (includes both TF-style and essay)
    const part2Match = text.match(/PHẦN\s+II[.:]\s*(.*?)(?=-{3,}\s*HẾT|ĐÁP\s*ÁN)/si);
    if (part2Match) {
      essayExample = part2Match[0].trim();
    }
    // No separate TF section
    tfExample = null;
  } else {
    // Grade 10 format: PHẦN I = MCQ, PHẦN II = TF, PHẦN III = Essay
    if (tfMatch) {
      tfExample = tfMatch[0].trim();
    }
    if (essayMatch) {
      essayExample = essayMatch[0].trim();
    }
  }

  if (answerMatch) {
    answerKey = answerMatch[0].trim();
  }

  return {
    rawContent: text.trim(),
    mcExample,
    tfExample,
    essayExample,
    answerKey,
  };
}

/**
 * Ingest DeThi .txt files into exam_templates table.
 */
async function ingestDeThiFiles() {
  if (!fs.existsSync(DETHI_DIR)) {
    console.log("DeThi directory not found, skipping exam templates.\n");
    return { files: 0, inserted: 0, updated: 0 };
  }

  const files = fs.readdirSync(DETHI_DIR).filter(f => f.endsWith(".txt"));
  console.log(`Found ${files.length} DeThi files to ingest.\n`);

  let inserted = 0;
  let updated = 0;

  for (const file of files) {
    const parsed = parseDeThiFilename(file);
    if (!parsed) {
      console.warn(`  Skipping unrecognized DeThi file: ${file}`);
      continue;
    }

    const { grade, examType } = parsed;
    const content = fs.readFileSync(path.join(DETHI_DIR, file), "utf-8");
    const template = parseDeThiFile(content);

    console.log(`- Ingesting DeThi ${file} (grade ${grade}, type ${examType})`);

    if (FLAG_DRY_RUN) {
      console.log(`  [dry-run] raw: ${template.rawContent.length} chars, mc: ${template.mcExample ? template.mcExample.length : 0}, tf: ${template.tfExample ? template.tfExample.length : 0}, essay: ${template.essayExample ? template.essayExample.length : 0}`);
      continue;
    }

    const result = await query(
      `INSERT INTO exam_templates
        (grade, exam_type, raw_content, mc_example, tf_example, essay_example, answer_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (grade, exam_type)
       DO UPDATE SET
         raw_content = EXCLUDED.raw_content,
         mc_example = EXCLUDED.mc_example,
         tf_example = EXCLUDED.tf_example,
         essay_example = EXCLUDED.essay_example,
         answer_key = EXCLUDED.answer_key
       RETURNING (xmax = 0) AS inserted`,
      [
        grade,
        examType,
        template.rawContent,
        template.mcExample,
        template.tfExample,
        template.essayExample,
        template.answerKey
      ]
    );

    if (result.rows.length > 0) {
      if (result.rows[0].inserted) inserted++;
      else updated++;
    }
  }

  return { files: files.length, inserted, updated };
}

/**
 * Ensure exam_knowledge and exam_templates tables exist.
 */
async function ensureExamSchema() {
  const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIM, 10) || 384;

  await query(`CREATE EXTENSION IF NOT EXISTS vector;`);

  await query(`
    CREATE TABLE IF NOT EXISTS exam_knowledge (
      id SERIAL PRIMARY KEY,
      source_name VARCHAR(255) NOT NULL,
      grade VARCHAR(4),
      textbook_set VARCHAR(10),
      chapter TEXT,
      section_title VARCHAR(255),
      content TEXT NOT NULL,
      embedding vector(${EMBEDDING_DIM}),
      chunk_index INTEGER DEFAULT 0,
      total_chunks INTEGER DEFAULT 1,
      content_hash VARCHAR(64),
      chunking_method VARCHAR(20) DEFAULT 'character',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // Handle embedding dimension change
  try {
    const { rows: dimCheck } = await query(`
      SELECT atttypmod FROM pg_attribute
      WHERE attrelid = 'exam_knowledge'::regclass AND attname = 'embedding'
    `);
    if (dimCheck.length > 0 && dimCheck[0].atttypmod !== EMBEDDING_DIM) {
      console.log(`[DB] exam_knowledge embedding dimension changed to ${EMBEDDING_DIM}, recreating column...`);
      await query(`DROP INDEX IF EXISTS idx_exam_knowledge_embedding;`);
      await query(`ALTER TABLE exam_knowledge DROP COLUMN embedding;`);
      await query(`ALTER TABLE exam_knowledge ADD COLUMN embedding vector(${EMBEDDING_DIM});`);
      console.warn(`[DB] All exam_knowledge embeddings cleared — re-run ingestion to regenerate.`);
    }
  } catch (dimErr) {
    console.warn(`[DB] Could not check exam_knowledge embedding dimension:`, dimErr.message);
  }

  await query(`CREATE INDEX IF NOT EXISTS idx_exam_knowledge_embedding ON exam_knowledge USING hnsw (embedding vector_cosine_ops);`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_knowledge_upsert_key ON exam_knowledge(source_name, section_title, chunk_index);`);

  // lesson_name + section_type for exercise builder
  await query(`ALTER TABLE exam_knowledge ADD COLUMN IF NOT EXISTS lesson_name VARCHAR(512);`);
  await query(`ALTER TABLE exam_knowledge ADD COLUMN IF NOT EXISTS section_type VARCHAR(32) DEFAULT 'content';`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_knowledge_lesson ON exam_knowledge(grade, lesson_name);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_knowledge_section_type ON exam_knowledge(section_type);`);

  await query(`
    CREATE TABLE IF NOT EXISTS exam_templates (
      id SERIAL PRIMARY KEY,
      grade VARCHAR(4) NOT NULL,
      exam_type VARCHAR(10) NOT NULL,
      raw_content TEXT,
      mc_example TEXT,
      tf_example TEXT,
      essay_example TEXT,
      answer_key TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(grade, exam_type)
    );
  `);

  console.log(`[DB] exam_knowledge & exam_templates schema ready (embedding dim: ${EMBEDDING_DIM})`);
}

async function main() {
  const startTime = Date.now();
  const chunkingMode = FLAG_LEGACY ? "character" : "semantic";

  console.log(`Chunking mode: ${chunkingMode}`);
  if (FLAG_CLEAR) console.log(`--clear: will wipe all exam_knowledge and exam_templates rows first`);
  if (FLAG_DRY_RUN) console.log(`--dry-run: will print stats without DB writes`);
  console.log();

  try {
    // Ensure base schema + exam-specific schema
    await ensureSchema();
    await ensureExamSchema();

    // Clear existing data if requested
    if (FLAG_CLEAR && !FLAG_DRY_RUN) {
      const ek = await query(`DELETE FROM exam_knowledge`);
      const et = await query(`DELETE FROM exam_templates`);
      console.log(`Cleared ${ek.rowCount} rows from exam_knowledge, ${et.rowCount} rows from exam_templates.\n`);
    }

    // --- Phase 1: Extract text from PDFs (OCR) WITHOUT loading embedding model ---
    console.log("=== Phase 1: PDF Text Extraction (OCR) ===\n");
    const grades = ["10", "11", "12"];
    const extractedPdfs = [];
    let totalFiles = 0;

    for (const grade of grades) {
      const gradeDir = path.join(KTPL_DIR, grade);
      if (fs.existsSync(gradeDir)) {
        const pdfs = fs.readdirSync(gradeDir).filter(f => f.toLowerCase().endsWith(".pdf"));
        for (const pdf of pdfs) {
          totalFiles++;
          const result = await extractPdfTextAsync(path.join(gradeDir, pdf), grade);
          if (result) extractedPdfs.push(result);
        }
      }
    }

    // Fallback: scan root KTPL dir for PDFs named GD-KTPL-{grade}.pdf
    if (totalFiles === 0 && fs.existsSync(KTPL_DIR)) {
      const rootPdfs = fs.readdirSync(KTPL_DIR).filter(f => f.toLowerCase().endsWith(".pdf"));
      for (const pdf of rootPdfs) {
        const gradeMatch = pdf.match(/KTPL[- ]?(\d{2})/i);
        if (!gradeMatch) {
          console.warn(`  Skipping unrecognized PDF: ${pdf}`);
          continue;
        }
        const grade = gradeMatch[1];
        totalFiles++;
        const result = await extractPdfTextAsync(path.join(KTPL_DIR, pdf), grade);
        if (result) extractedPdfs.push(result);
      }
    }

    console.log(`\nPhase 1 done: extracted text from ${extractedPdfs.length}/${totalFiles} PDFs\n`);

    // --- Phase 2: Load embedding model, chunk, embed, insert ---
    console.log("=== Phase 2: Chunking & Embedding ===\n");
    // Now it's safe to load the embedding model (OCR memory is freed)
    console.log("[Embeddings] Loading model for Phase 2...");
    getEmbeddings(); // triggers lazy load of embedding model

    let totalSections = 0;
    let totalChunks = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const pdfData of extractedPdfs) {
      const stats = await ingestPdfText(pdfData);
      totalSections += stats.sections;
      totalChunks += stats.chunks;
      totalInserted += stats.inserted;
      totalUpdated += stats.updated;
      totalSkipped += stats.skipped;
    }

    // --- Ingest DeThi files ---
    console.log("\n=== DeThi Exam Templates ===\n");
    const dethiStats = await ingestDeThiFiles();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n${"=".repeat(50)}`);
    console.log(`Ingestion complete!`);
    console.log(`${"=".repeat(50)}`);
    console.log(`Chunking mode:          ${chunkingMode}`);
    console.log(`PDF files processed:    ${totalFiles}`);
    console.log(`Total sections:         ${totalSections}`);
    console.log(`Total chunks:           ${totalChunks}`);
    if (!FLAG_DRY_RUN) {
      console.log(`Inserted (new):         ${totalInserted}`);
      console.log(`Updated (changed):      ${totalUpdated}`);
      console.log(`Skipped (unchanged):    ${totalSkipped}`);
    }
    console.log(`DeThi files processed:  ${dethiStats.files}`);
    if (!FLAG_DRY_RUN) {
      console.log(`DeThi inserted:         ${dethiStats.inserted}`);
      console.log(`DeThi updated:          ${dethiStats.updated}`);
    }
    console.log(`Duration:               ${duration}s`);
    console.log(`${"=".repeat(50)}`);

    process.exit(0);
  } catch (err) {
    console.error("Ingestion failed:", err);
    process.exit(1);
  }
}

main();
