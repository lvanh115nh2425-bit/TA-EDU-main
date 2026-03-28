import { auth } from "../core/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

// ── Backend URL (giống tu-van-luat: ưu tiên __TAEDU_ADMIN_API__ khi deploy) ──
function getKycApiRoot() {
  const custom = typeof window.__TAEDU_ADMIN_API__ === "string" ? window.__TAEDU_ADMIN_API__.trim() : "";
  if (custom) return custom.replace(/\/$/, "");
  const h = location.hostname;
  if (h === "localhost" || h === "127.0.0.1") return "http://localhost:4001";
  return "";
}
const KYC_API_ROOT = getKycApiRoot();
const LESSONS_URL = `${KYC_API_ROOT}/api/exam/lessons`;
const EXERCISE_URL = `${KYC_API_ROOT}/api/exam/exercise/generate`;

// ── State ────────────────────────────────────────────────────────────
const state = {
  user: null,
  grade: "10",
  lessons: [],
  selectedLesson: null,
  difficulty: "medium",
  exercises: { mcq: [], essay: [] },
  loading: false,
};

// ── DOM refs ─────────────────────────────────────────────────────────
const refs = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheRefs();
  initAuthGuard();
  bindEvents();
  fetchLessons(state.grade);
});

function cacheRefs() {
  refs.gradeSelect = document.getElementById("gradeSelect");
  refs.lessonSelect = document.getElementById("lessonSelect");
  refs.difficultySelect = document.getElementById("difficultySelect");
  refs.mcqCount = document.getElementById("mcqCount");
  refs.essayCount = document.getElementById("essayCount");
  refs.exerciseForm = document.getElementById("exerciseForm");
  refs.generateBtn = document.getElementById("generateBtn");
  refs.configStatus = document.getElementById("configStatus");
  refs.editStatus = document.getElementById("editStatus");
  refs.stepEdit = document.getElementById("stepEdit");
  refs.stepExport = document.getElementById("stepExport");
  refs.mcqContainer = document.getElementById("mcqContainer");
  refs.essayContainer = document.getElementById("essayContainer");
  refs.addMcqBtn = document.getElementById("addMcqBtn");
  refs.addEssayBtn = document.getElementById("addEssayBtn");
  refs.previewPanel = document.getElementById("previewPanel");
  refs.exportWordNoAnswer = document.getElementById("exportWordNoAnswer");
  refs.exportWordWithAnswer = document.getElementById("exportWordWithAnswer");
  refs.exportPdfNoAnswer = document.getElementById("exportPdfNoAnswer");
  refs.exportPdfWithAnswer = document.getElementById("exportPdfWithAnswer");
}

function initAuthGuard() {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      alert("Bạn cần đăng nhập để sử dụng chức năng này.");
      window.location.href = "index.html";
      return;
    }
    state.user = user;
  });
}

function bindEvents() {
  refs.gradeSelect?.addEventListener("change", () => {
    state.grade = refs.gradeSelect.value;
    fetchLessons(state.grade);
  });
  refs.lessonSelect?.addEventListener("change", () => {
    state.selectedLesson = refs.lessonSelect.value;
  });
  refs.difficultySelect?.addEventListener("change", () => {
    state.difficulty = refs.difficultySelect.value;
  });
  refs.exerciseForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    generateExercises();
  });
  refs.addMcqBtn?.addEventListener("click", () => addMcqQuestion());
  refs.addEssayBtn?.addEventListener("click", () => addEssayQuestion());
  refs.exportWordNoAnswer?.addEventListener("click", () => exportToWord(false));
  refs.exportWordWithAnswer?.addEventListener("click", () => exportToWord(true));
  refs.exportPdfNoAnswer?.addEventListener("click", () => exportToPdf(false));
  refs.exportPdfWithAnswer?.addEventListener("click", () => exportToPdf(true));
}

// ── Fetch lessons from backend ───────────────────────────────────────

/** Extract the lesson number from "Bài N." prefix, returns Infinity if not found */
function extractBaiNumber(lessonName) {
  const m = lessonName.match(/Bài\s+(\d+)/);
  return m ? parseInt(m[1], 10) : Infinity;
}

async function fetchLessons(grade) {
  try {
    setStatus(refs.configStatus, "Đang tải bài học...", true);
    const res = await fetch(`${LESSONS_URL}?grade=${grade}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    state.lessons = data.lessons || [];

    if (state.lessons.length === 0) {
      refs.lessonSelect.innerHTML = `<option value="">Chưa có dữ liệu cho lớp này</option>`;
      state.selectedLesson = null;
      setStatus(
        refs.configStatus,
        `Chưa có bài học lớp ${grade} trong CSDL. Thử lớp 12 nếu đã chạy ingest mặc định, hoặc chạy trên server: npm run ingest:ktpl (cần PDF trong rule/KTPL/).`
      );
      return;
    }

    // Sort lessons by Bài number
    state.lessons.sort((a, b) => extractBaiNumber(a.lesson_name) - extractBaiNumber(b.lesson_name));

    // Group lessons by chapter, preserving insertion order
    const chapterMap = new Map();
    for (const lesson of state.lessons) {
      const ch = lesson.chapter || "Khác";
      if (!chapterMap.has(ch)) chapterMap.set(ch, []);
      chapterMap.get(ch).push(lesson);
    }

    // Build <optgroup> HTML
    let html = "";
    for (const [chapter, lessons] of chapterMap) {
      html += `<optgroup label="${escapeHTML(chapter)}">`;
      for (const l of lessons) {
        const hint = l.chunk_count != null ? ` (${l.chunk_count} câu hỏi)` : "";
        html += `<option value="${escapeHTML(l.lesson_name)}">${escapeHTML(l.lesson_name)}${escapeHTML(hint)}</option>`;
      }
      html += `</optgroup>`;
    }
    refs.lessonSelect.innerHTML = html;

    state.selectedLesson = state.lessons[0].lesson_name;
    setStatus(refs.configStatus, `${state.lessons.length} bài học`);
  } catch (err) {
    console.error("Failed to fetch lessons:", err);
    refs.lessonSelect.innerHTML = `<option value="">Lỗi tải bài học</option>`;
    setStatus(refs.configStatus, "Lỗi tải bài học");
  }
}

// ── Generate exercises ───────────────────────────────────────────────
async function generateExercises() {
  const lessonName = refs.lessonSelect?.value;
  if (!lessonName) {
    alert("Vui lòng chọn bài học.");
    return;
  }

  state.loading = true;
  setStatus(refs.configStatus, "Đang tạo bài tập...", true);
  refs.generateBtn.disabled = true;

  try {
    const payload = {
      grade: state.grade,
      lesson_name: lessonName,
      difficulty: state.difficulty,
      counts: {
        mcq: parseInt(refs.mcqCount.value, 10) || 5,
        essay: parseInt(refs.essayCount.value, 10) || 2,
      },
    };

    const res = await fetch(EXERCISE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const meta = data._meta;
    const fromGemini = meta?.source === "gemini";

    state.exercises.mcq = (data.mcq || []).map((q, i) => ({ ...q, _id: `mcq-${Date.now()}-${i}` }));
    state.exercises.essay = (data.essay || []).map((q, i) => ({ ...q, _id: `essay-${Date.now()}-${i}` }));
    state.selectedLesson = lessonName;

    renderExerciseCards();
    renderPreview();
    refs.stepEdit.hidden = false;
    refs.stepExport.hidden = false;
    if (fromGemini) {
      setStatus(refs.configStatus, "Tạo thành công (AI).");
    } else {
      setStatus(
        refs.configStatus,
        meta?.reason === "missing_gemini_api_key"
          ? "Bản minh họa — server chưa có GEMINI_API_KEY (thêm vào .env & restart container)."
          : "Bản minh họa — Gemini lỗi hoặc trả JSON không đúng. Xem log container kyc-admin-api."
      );
    }
    updateEditStatus();

    refs.stepEdit.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error("Generate error:", err);
    alert("Không thể tạo bài tập: " + err.message);
    setStatus(refs.configStatus, "Lỗi tạo bài tập");
  } finally {
    state.loading = false;
    refs.generateBtn.disabled = false;
  }
}

// ── Render editable cards ────────────────────────────────────────────
function renderExerciseCards() {
  renderMcqCards();
  renderEssayCards();
}

function renderMcqCards() {
  const container = refs.mcqContainer;
  if (!container) return;

  if (state.exercises.mcq.length === 0) {
    container.innerHTML = `<div class="ex-empty">Chưa có câu trắc nghiệm</div>`;
    return;
  }

  container.innerHTML = `<h3 class="ex-section-title">Trắc nghiệm (${state.exercises.mcq.length} câu)</h3>` +
    state.exercises.mcq.map((q, i) => {
      const opts = q.options || {};
      const letters = ["A", "B", "C", "D"];
      return `
        <div class="ex-card" data-type="mcq" data-index="${i}">
          <div class="ex-card-header">
            <strong>Câu ${i + 1}</strong>
            <span class="ex-difficulty-badge">${formatDifficulty(q.difficulty)}</span>
            <div class="ex-card-actions">
              <button type="button" class="ex-btn-icon" data-action="up" title="Di chuyển lên" ${i === 0 ? 'disabled' : ''}>
                <i class="fa-solid fa-arrow-up"></i>
              </button>
              <button type="button" class="ex-btn-icon" data-action="down" title="Di chuyển xuống" ${i === state.exercises.mcq.length - 1 ? 'disabled' : ''}>
                <i class="fa-solid fa-arrow-down"></i>
              </button>
              <button type="button" class="ex-btn-icon ex-btn-danger" data-action="delete" title="Xóa">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
          <label class="ex-field ex-field--full">
            <span>Câu hỏi</span>
            <textarea rows="2" data-field="question">${escapeHTML(q.question || '')}</textarea>
          </label>
          ${letters.map(letter => {
            const val = typeof opts === 'object' ? (opts[letter] || '') : '';
            return `
              <div class="ex-option-row">
                <label class="ex-radio-label">
                  <input type="radio" name="mcq-correct-${i}" value="${letter}" ${q.correct === letter ? 'checked' : ''} data-field="correct">
                  <strong>${letter}.</strong>
                </label>
                <input type="text" value="${escapeHTML(val)}" data-field="option-${letter}" placeholder="Đáp án ${letter}">
              </div>`;
          }).join('')}
          <label class="ex-field ex-field--full">
            <span>Giải thích</span>
            <textarea rows="2" data-field="explanation">${escapeHTML(q.explanation || '')}</textarea>
          </label>
        </div>`;
    }).join("");

  bindCardEvents(container, "mcq");
}

function renderEssayCards() {
  const container = refs.essayContainer;
  if (!container) return;

  if (state.exercises.essay.length === 0) {
    container.innerHTML = `<div class="ex-empty">Chưa có câu tự luận</div>`;
    return;
  }

  container.innerHTML = `<h3 class="ex-section-title">Tự luận (${state.exercises.essay.length} câu)</h3>` +
    state.exercises.essay.map((q, i) => `
      <div class="ex-card" data-type="essay" data-index="${i}">
        <div class="ex-card-header">
          <strong>Câu ${i + 1}</strong>
          <span class="ex-difficulty-badge">${formatDifficulty(q.difficulty)}</span>
          <div class="ex-card-actions">
            <button type="button" class="ex-btn-icon" data-action="up" title="Di chuyển lên" ${i === 0 ? 'disabled' : ''}>
              <i class="fa-solid fa-arrow-up"></i>
            </button>
            <button type="button" class="ex-btn-icon" data-action="down" title="Di chuyển xuống" ${i === state.exercises.essay.length - 1 ? 'disabled' : ''}>
              <i class="fa-solid fa-arrow-down"></i>
            </button>
            <button type="button" class="ex-btn-icon ex-btn-danger" data-action="delete" title="Xóa">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
        <label class="ex-field ex-field--full">
          <span>Câu hỏi</span>
          <textarea rows="2" data-field="question">${escapeHTML(q.question || '')}</textarea>
        </label>
        <label class="ex-field ex-field--full">
          <span>Đáp án mẫu</span>
          <textarea rows="3" data-field="model_answer">${escapeHTML(q.model_answer || '')}</textarea>
        </label>
        <label class="ex-field ex-field--full">
          <span>Rubric chấm điểm</span>
          <textarea rows="2" data-field="rubric">${escapeHTML(q.rubric || '')}</textarea>
        </label>
        <label class="ex-field">
          <span>Điểm</span>
          <input type="number" value="${q.points || 2}" min="0.5" max="10" step="0.5" data-field="points">
        </label>
      </div>`).join("");

  bindCardEvents(container, "essay");
}

function bindCardEvents(container, type) {
  // Action buttons
  container.querySelectorAll(".ex-btn-icon").forEach(btn => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".ex-card");
      const index = parseInt(card.dataset.index, 10);
      const action = btn.dataset.action;

      if (action === "up") moveQuestion(type, index, -1);
      else if (action === "down") moveQuestion(type, index, 1);
      else if (action === "delete") deleteQuestion(type, index);
    });
  });

  // Input change listeners - sync back to state
  container.querySelectorAll("textarea, input[type='text'], input[type='number']").forEach(input => {
    input.addEventListener("input", () => syncFieldToState(input, type));
  });

  container.querySelectorAll("input[type='radio']").forEach(radio => {
    radio.addEventListener("change", () => {
      const card = radio.closest(".ex-card");
      const index = parseInt(card.dataset.index, 10);
      state.exercises.mcq[index].correct = radio.value;
      renderPreview();
    });
  });
}

function syncFieldToState(input, type) {
  const card = input.closest(".ex-card");
  const index = parseInt(card.dataset.index, 10);
  const field = input.dataset.field;
  const item = state.exercises[type][index];
  if (!item) return;

  if (field === "question") item.question = input.value;
  else if (field === "explanation") item.explanation = input.value;
  else if (field === "model_answer") item.model_answer = input.value;
  else if (field === "rubric") item.rubric = input.value;
  else if (field === "points") item.points = parseFloat(input.value) || 2;
  else if (field?.startsWith("option-")) {
    const letter = field.split("-")[1];
    if (!item.options || typeof item.options !== 'object') item.options = {};
    item.options[letter] = input.value;
  }

  // Debounced preview update
  clearTimeout(state._previewTimer);
  state._previewTimer = setTimeout(() => renderPreview(), 300);
}

// ── Question manipulation ────────────────────────────────────────────
function moveQuestion(type, index, direction) {
  const arr = state.exercises[type];
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= arr.length) return;
  [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
  renderExerciseCards();
  renderPreview();
  updateEditStatus();
}

function deleteQuestion(type, index) {
  state.exercises[type].splice(index, 1);
  renderExerciseCards();
  renderPreview();
  updateEditStatus();
}

function addMcqQuestion() {
  state.exercises.mcq.push({
    _id: `mcq-${Date.now()}`,
    question: "",
    options: { A: "", B: "", C: "", D: "" },
    correct: "A",
    explanation: "",
    difficulty: "thong_hieu",
  });
  renderExerciseCards();
  updateEditStatus();
  // Scroll to new card
  const cards = refs.mcqContainer.querySelectorAll(".ex-card");
  cards[cards.length - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function addEssayQuestion() {
  state.exercises.essay.push({
    _id: `essay-${Date.now()}`,
    question: "",
    model_answer: "",
    rubric: "",
    points: 2,
    difficulty: "van_dung",
  });
  renderEssayCards();
  updateEditStatus();
  const cards = refs.essayContainer.querySelectorAll(".ex-card");
  cards[cards.length - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ── Preview ──────────────────────────────────────────────────────────
function renderPreview() {
  const panel = refs.previewPanel;
  if (!panel) return;

  const mcq = state.exercises.mcq;
  const essay = state.exercises.essay;

  if (mcq.length === 0 && essay.length === 0) {
    panel.innerHTML = `<div class="ex-empty">Chưa có câu hỏi để xem trước</div>`;
    return;
  }

  let html = `<div class="preview-header">
    <h3>BÀI TẬP KTPL - LỚP ${escapeHTML(state.grade)}</h3>
    <p>${escapeHTML(state.selectedLesson || '')}</p>
  </div>`;

  if (mcq.length > 0) {
    html += `<div class="preview-section"><h4>I. Trắc nghiệm (${mcq.length} câu)</h4>`;
    mcq.forEach((q, i) => {
      html += `<div class="preview-question">
        <p><strong>Câu ${i + 1}.</strong> ${escapeHTML(q.question || '')}</p>`;
      const opts = q.options || {};
      ["A", "B", "C", "D"].forEach(letter => {
        const isCorrect = q.correct === letter;
        html += `<p class="preview-option ${isCorrect ? 'ex-option-correct' : ''}">${letter}. ${escapeHTML(opts[letter] || '')}</p>`;
      });
      html += `</div>`;
    });
    html += `</div>`;
  }

  if (essay.length > 0) {
    html += `<div class="preview-section"><h4>II. Tự luận (${essay.length} câu)</h4>`;
    essay.forEach((q, i) => {
      html += `<div class="preview-question">
        <p><strong>Câu ${i + 1}.</strong> ${escapeHTML(q.question || '')} <em>(${q.points || 2} điểm)</em></p>
      </div>`;
    });
    html += `</div>`;
  }

  panel.innerHTML = html;
}

// ── Word Export (docx) ───────────────────────────────────────────────
async function exportToWord(includeAnswers) {
  if (typeof window.docx === "undefined") {
    alert("Thư viện docx chưa tải xong, vui lòng thử lại.");
    return;
  }

  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = window.docx;

  const children = [];

  // Title
  children.push(new Paragraph({
    children: [new TextRun({ text: `BÀI TẬP KTPL - LỚP ${state.grade}`, bold: true, size: 32 })],
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
  }));

  children.push(new Paragraph({
    children: [new TextRun({ text: state.selectedLesson || '', size: 24 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }));

  // MCQ section
  const mcq = state.exercises.mcq;
  if (mcq.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: `I. Trắc nghiệm (${mcq.length} câu)`, bold: true, size: 26 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300 },
    }));

    mcq.forEach((q, i) => {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `Câu ${i + 1}. `, bold: true }),
          new TextRun({ text: q.question || '' }),
        ],
        spacing: { before: 200 },
      }));

      const opts = q.options || {};
      ["A", "B", "C", "D"].forEach(letter => {
        const isCorrect = includeAnswers && q.correct === letter;
        children.push(new Paragraph({
          children: [new TextRun({
            text: `${letter}. ${opts[letter] || ''}`,
            bold: isCorrect,
            color: isCorrect ? "FF0000" : undefined,
          })],
          indent: { left: 400 },
        }));
      });

      if (includeAnswers) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `Đáp án: ${q.correct || ''}`, bold: true, color: "FF0000" }),
          ],
          spacing: { before: 100 },
          indent: { left: 400 },
        }));
        if (q.explanation) {
          children.push(new Paragraph({
            children: [new TextRun({ text: `Giải thích: ${q.explanation}`, italics: true, color: "666666" })],
            indent: { left: 400 },
          }));
        }
      }
    });
  }

  // Essay section
  const essay = state.exercises.essay;
  if (essay.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: `II. Tự luận (${essay.length} câu)`, bold: true, size: 26 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400 },
    }));

    essay.forEach((q, i) => {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `Câu ${i + 1}. `, bold: true }),
          new TextRun({ text: q.question || '' }),
          new TextRun({ text: ` (${q.points || 2} điểm)`, italics: true }),
        ],
        spacing: { before: 200 },
      }));

      if (includeAnswers) {
        if (q.model_answer) {
          children.push(new Paragraph({
            children: [
              new TextRun({ text: "Đáp án mẫu: ", bold: true, color: "FF0000" }),
              new TextRun({ text: q.model_answer }),
            ],
            indent: { left: 400 },
            spacing: { before: 100 },
          }));
        }
        if (q.rubric) {
          children.push(new Paragraph({
            children: [
              new TextRun({ text: "Rubric: ", bold: true, italics: true }),
              new TextRun({ text: q.rubric, italics: true, color: "666666" }),
            ],
            indent: { left: 400 },
          }));
        }
      }
    });
  }

  const doc = new Document({ sections: [{ children }] });

  try {
    const blob = await Packer.toBlob(doc);
    const suffix = includeAnswers ? "co-dap-an" : "khong-dap-an";
    downloadBlob(blob, `bai-tap-ktpl-lop-${state.grade}-${suffix}.docx`);
  } catch (err) {
    console.error("Word export error:", err);
    alert("Lỗi khi xuất Word: " + err.message);
  }
}

// ── PDF Export (jsPDF) ───────────────────────────────────────────────
// LIMITATION: jsPDF's built-in fonts (Helvetica, Courier, Times) only support
// the WinAnsi / Latin-1 character set, which does NOT include Vietnamese
// diacritics (e.g., ắ, ề, ổ, ử, ơ, đ). Embedding a custom .ttf font that
// covers Vietnamese (such as Roboto or Noto Sans) would add ~200-500 KB to the
// page load and requires a base64-encoded font file, which is not practical here.
//
// As a result, all static labels in the PDF use ASCII-safe approximations
// (e.g., "Trac nghiem" instead of "Trắc nghiệm"). User-generated content
// (questions, answers) is passed through as-is, but Vietnamese characters will
// render as "?" or blank squares in the PDF output.
//
// RECOMMENDED: Use the Word (.docx) export instead — it fully supports
// Vietnamese Unicode and produces higher-quality formatted output.
async function exportToPdf(includeAnswers) {
  if (typeof window.jspdf === "undefined") {
    alert("Thư viện jsPDF chưa tải xong, vui lòng thử lại.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // jsPDF default font — no Vietnamese diacritic support (see comment above).
  // All static labels below use ASCII-safe text intentionally.
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = 20;

  function checkPageBreak(needed) {
    if (y + needed > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 20;
    }
  }

  function addWrappedText(text, x, fontSize, options = {}) {
    doc.setFontSize(fontSize);
    if (options.bold) doc.setFont(undefined, "bold");
    else if (options.italic) doc.setFont(undefined, "italic");
    else doc.setFont(undefined, "normal");

    if (options.color) doc.setTextColor(...options.color);
    else doc.setTextColor(0, 0, 0);

    const lines = doc.splitTextToSize(text, contentWidth - (x - margin));
    for (const line of lines) {
      checkPageBreak(8);
      doc.text(line, x, y);
      y += fontSize * 0.45;
    }
  }

  // -- Title (ASCII-safe: no Vietnamese diacritics) --
  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  const title = `BAI TAP KTPL - LOP ${state.grade}`;  // "BÀI TẬP KTPL - LỚP" without diacritics
  doc.text(title, pageWidth / 2, y, { align: "center" });
  y += 10;

  // Subtitle: lesson name — may contain diacritics that won't render correctly
  doc.setFontSize(12);
  doc.setFont(undefined, "normal");
  const subtitle = state.selectedLesson || '';
  doc.text(subtitle, pageWidth / 2, y, { align: "center" });
  y += 3;

  // Vietnamese diacritics warning line
  doc.setFontSize(8);
  doc.setFont(undefined, "italic");
  doc.setTextColor(150, 150, 150);
  doc.text("(Luu y: Font PDF khong ho tro dau tieng Viet. De xuat file day du, dung Word export.)", pageWidth / 2, y, { align: "center" });
  doc.setTextColor(0, 0, 0);
  y += 12;

  // -- MCQ section (ASCII-safe labels) --
  const mcq = state.exercises.mcq;
  if (mcq.length > 0) {
    addWrappedText(`I. Trac nghiem (${mcq.length} cau)`, margin, 13, { bold: true });  // "Trắc nghiệm ... câu"
    y += 5;

    mcq.forEach((q, i) => {
      checkPageBreak(30);
      addWrappedText(`Cau ${i + 1}. ${q.question || ''}`, margin, 11, { bold: true });  // "Câu"
      y += 2;

      const opts = q.options || {};
      ["A", "B", "C", "D"].forEach(letter => {
        const isCorrect = includeAnswers && q.correct === letter;
        addWrappedText(`${letter}. ${opts[letter] || ''}`, margin + 5, 10, {
          bold: isCorrect,
          color: isCorrect ? [255, 0, 0] : undefined,
        });
      });

      if (includeAnswers && q.correct) {
        addWrappedText(`Dap an: ${q.correct}`, margin + 5, 10, { bold: true, color: [255, 0, 0] });  // "Đáp án"
      }
      y += 3;
    });
  }

  // -- Essay section (ASCII-safe labels) --
  const essay = state.exercises.essay;
  if (essay.length > 0) {
    y += 5;
    addWrappedText(`II. Tu luan (${essay.length} cau)`, margin, 13, { bold: true });  // "Tự luận ... câu"
    y += 5;

    essay.forEach((q, i) => {
      checkPageBreak(20);
      addWrappedText(`Cau ${i + 1}. ${q.question || ''} (${q.points || 2} diem)`, margin, 11, { bold: true });  // "Câu ... điểm"
      y += 2;

      if (includeAnswers && q.model_answer) {
        addWrappedText(`Dap an mau: ${q.model_answer}`, margin + 5, 10, { color: [255, 0, 0] });  // "Đáp án mẫu"
      }
      y += 3;
    });
  }

  const suffix = includeAnswers ? "co-dap-an" : "khong-dap-an";
  doc.save(`bai-tap-ktpl-lop-${state.grade}-${suffix}.pdf`);
}

// ── Utilities ────────────────────────────────────────────────────────
function escapeHTML(input = "") {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatus(el, text, loading = false) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("status-loading", loading);
}

function updateEditStatus() {
  const total = state.exercises.mcq.length + state.exercises.essay.length;
  setStatus(refs.editStatus, `${total} câu`);
}

function formatDifficulty(d) {
  const map = {
    nhan_biet: "Nhận biết",
    thong_hieu: "Thông hiểu",
    van_dung: "Vận dụng",
    van_dung_cao: "Vận dụng cao",
  };
  return map[d] || d || "—";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
