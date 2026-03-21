// js/modules/smarttutor.js
// - Tự nhận diện phần tử cho smarttutor.html và widget trong dashboard
// - Ưu tiên URL backend từ window.TA_EDU_TUTOR_BACKEND; fallback /api/smarttutor

import { auth } from "../core/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

const chatBox =
  document.getElementById("chat-box") ||
  document.getElementById("tutorMessages");

const input =
  document.getElementById("user-input") ||
  document.getElementById("tutorInput");

const sendBtn =
  document.getElementById("send-btn") ||
  document.getElementById("tutorSend");

const form = document.getElementById("tutorForm");

const CLASS_USER = chatBox?.id === "tutorMessages" ? "tutor-user" : "user-msg";
const CLASS_BOT = chatBox?.id === "tutorMessages" ? "tutor-bot" : "bot-msg";

const BACKEND_URL =
  (typeof window !== "undefined" && window.TA_EDU_TUTOR_BACKEND) ||
  "/api/smarttutor";

const SYSTEM_PROMPT = [
  "Bạn là TA-SmartTutor, gia sư tiếng Việt thân thiện hỗ trợ học sinh phổ thông.",
  "Quy tắc:",
  "1) Trả lời gọn, dùng văn bản thuần (không Markdown, không ** hoặc ---).",
  "2) Khi tạo danh sách câu hỏi/bài tập, luôn tạo đủ số lượng người dùng yêu cầu.",
  "3) Định dạng câu hỏi theo mẫu: Câu 1: ...\\nA. ...\\nB. ...; sau cùng ghi Đáp án: ... - Giải thích: ...",
  "4) Kết thúc bằng lời gợi ý người dùng tiếp tục nếu phù hợp.",
  "5) Khi người dùng yêu cầu số lượng cụ thể (ví dụ 5 câu), luôn tạo đúng số lượng mục, không ít hơn."
].join(" ");

let greetedOnce = false;

// ====== Yêu cầu đăng nhập ======
onAuthStateChanged(auth, (user) => {
  if (!user) {
    alert("Bạn cần đăng nhập để sử dụng TA-SmartTutor.");
    window.location.href = "index.html";
    return;
  }
  if (!greetedOnce) {
    const name = user.displayName || user.email?.split("@")[0] || "bạn";
    appendMessage(
      "bot",
      `Xin chào ${name}! Mình là TA-SmartTutor, cứ hỏi mình bất kỳ điều gì nhé.`
    );
    greetedOnce = true;
  }
});

// ====== Gửi tin ======
if (form) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage();
  });
} else if (sendBtn) {
  sendBtn.addEventListener("click", sendMessage);
}

if (input) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

async function sendMessage() {
  const text = (input?.value || "").trim();
  if (!text || !chatBox) return;

  appendMessage("user", text);

  if (isGreeting(text)) {
    appendMessage("bot", "Hi bạn! Mình đang ở đây, bạn muốn mình hỗ trợ điều gì?");
    if (input) input.value = "";
    return;
  }

  if (input) input.value = "";
  const botNode = appendMessage("bot", "");

  try {
    if (!botNode) return;
    botNode.textContent = "";
    let assembledRaw = "";
    const finalReply = await streamAI(text, {
      onToken: (chunk) => {
        assembledRaw += chunk;
        botNode.textContent = formatBotText(assembledRaw);
      },
    });
    const cleanedFinal = formatBotText(finalReply || assembledRaw);
    botNode.textContent = cleanedFinal;
    if (!cleanedFinal) {
      botNode.textContent = "Xin lỗi, mình chưa hiểu rõ câu hỏi này.";
    }
  } catch (e) {
    if (botNode) {
      botNode.textContent = "Ôi, có lỗi kết nối. Bạn thử lại sau nhé!";
    }
    console.error(e);
  }
}

async function streamAI(latestUserText, { onToken } = {}) {
  const res = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: latestUserText }
      ],
      stream: true,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Server error ${res.status}: ${t}`);
  }

  const isJSON = (res.headers.get("content-type") || "").includes("application/json");
  if (!res.body || isJSON) {
    const data = await res.json();
    const reply = data.reply?.trim() || "Xin lỗi, mình chưa hiểu rõ câu hỏi này.";
    onToken?.(reply);
    return reply;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let finalText = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (!chunk) continue;
    finalText += chunk;
    onToken?.(chunk);
  }
  return finalText.replace(/\[stream_error\]$/, "").trim();
}

function appendMessage(sender, msg) {
  if (!chatBox) return;
  const div = document.createElement("div");
  div.className = sender === "user" ? CLASS_USER : CLASS_BOT;
  div.textContent = msg;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;

  if (input && input.tagName === "TEXTAREA") {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }
  return div;
}

function isGreeting(rawText) {
  const normalized = rawText
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[!?.,]/g, "")
    .trim();

  const greetings = [
    "hi",
    "hello",
    "hey",
    "xin chao",
    "chao",
    "chao ban",
    "alo",
    "yo",
    "sup",
  ];

  return greetings.some((phrase) => normalized === phrase);
}

function formatBotText(text) {
  if (!text) return "";
  return text
    .replace(/\r/g, "")
    .replace(/```/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__([^_]+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/---+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimStart();
}
