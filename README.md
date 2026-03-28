# TA-Edu – Nền tảng học tập THPT

Hướng dẫn dành cho người mới: **clone về → cấu hình `.env` → chạy 3 lệnh là xong.**

---

## Giới thiệu

TA-Edu là nền tảng học tập cho học sinh THPT gồm:

- **Portal học viên** – Giao diện HTML/CSS/JS (`apps/portal`)
- **Backend API** – Node.js + PostgreSQL chạy trong Docker (`services/kyc-admin-api`)
- **Tư vấn luật AI** – Chatbot tra cứu 10 bộ luật Việt Nam (`rule/Luat`)
- **Firebase Functions** – Các tính năng cloud như SmartTutor, mindmap AI

---

## Yêu cầu cài đặt trước

| Phần mềm | Ghi chú |
|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Bắt buộc – chạy Postgres + API |
| [Node.js 18+](https://nodejs.org/) | Bắt buộc – chạy scripts và frontend |
| [Git](https://git-scm.com/) | Bắt buộc – clone repo |
| [Firebase CLI](https://firebase.google.com/docs/cli) | Tùy chọn – chỉ cần nếu dùng Functions |

---

## Cấu trúc thư mục

```
TA-EDU/
├── apps/portal/              # Giao diện học viên + admin
├── services/kyc-admin-api/   # REST API chính (KYC, luật, hỏi đáp...)
│   ├── src/                  # Source code Node.js
│   ├── scripts/              # Script ingest dữ liệu
│   └── env.example.txt       # Mẫu biến môi trường
├── backend/
│   ├── firebase-functions/   # Firebase Cloud Functions
│   └── workers/              # Cloudflare Workers
├── rule/
│   └── Luat/                 # 10 file văn bản luật (.txt)
└── docker-compose.yml        # Cấu hình Docker local
```

---

## Chạy dự án lần đầu

### Bước 1 – Clone và cài thư viện

```bash
git clone https://github.com/NguyenTanTan/TA-EDU.git
cd TA-EDU
npm install
cd services/kyc-admin-api && npm install && cd ../..
```

### Bước 2 – Tạo file cấu hình môi trường

```bash
# Windows PowerShell
Copy-Item services/kyc-admin-api/env.example.txt services/kyc-admin-api/.env

# macOS / Linux
cp services/kyc-admin-api/env.example.txt services/kyc-admin-api/.env
```

Sau đó mở file `.env` vừa tạo và điền các giá trị thật:

| Biến | Bắt buộc | Lấy ở đâu |
|---|---|---|
| `GEMINI_API_KEY` | Không* | [makersuite.google.com](https://makersuite.google.com/app/apikey) – miễn phí |
| `FIREBASE_PROJECT_ID` | Có | Firebase Console > Project Settings |
| `FIREBASE_SERVICE_ACCOUNT` | Có | Firebase Console > Service Accounts > Generate key |
| `JWT_SECRET` | Có | Đặt chuỗi bất kỳ (nên dài, ngẫu nhiên) |

> *Nếu không có `GEMINI_API_KEY`, tính năng tư vấn luật vẫn chạy ở chế độ tra cứu nội bộ (không có AI tổng hợp câu trả lời).

### Bước 3 – Khởi động Docker (Postgres + API)

```bash
docker-compose up --build -d
```

Chờ khoảng 30 giây rồi kiểm tra:

```bash
# Phải trả về: {"ok":true,"service":"kyc-admin-api"}
curl http://localhost:4001/health
```

- PostgreSQL: cổng `5434`
- KYC Admin API: `http://localhost:4001`

### Bước 4 – Nạp dữ liệu luật vào database

> Chỉ cần chạy **1 lần** sau khi khởi động database lần đầu.

```bash
cd services/kyc-admin-api
npm run ingest:legal
cd ../..
```

Kết quả thành công:
```
Found 10 legal files to ingest.
- Ingesting Hiến pháp 2013: found 118 articles
...
Ingestion complete!
```

### Bước 4b – Nạp dữ liệu KTPL (Tạo bài tập / RAG đề)

Trang **Tạo bài tập** đọc bảng `exam_knowledge` (khác với tư vấn luật). Cần chạy **một lần** (hoặc khi đổi PDF):

```bash
cd services/kyc-admin-api
npm run ingest:ktpl
```

PDF đặt tại `rule/KTPL/{10|11|12}/*.pdf` hoặc `rule/KTPL/GD-KTPL-12.pdf` (khớp số lớp trong tên file). Repo mẫu hiện có PDF lớp **12**; nếu chọn **Lớp 10** mà chưa thêm PDF lớp 10 thì danh sách bài học sẽ trống.

### Bước 5 – Khởi động Frontend

```bash
npx serve apps/portal
```

Frontend chạy tại: `http://localhost:3000`

---

## Các trang chính

| Trang | URL |
|---|---|
| Trang chủ | http://localhost:3000 |
| Tư vấn luật AI | http://localhost:3000/tu-van-luat.html |
| Admin KYC | http://localhost:3000/admin/index.html |
| Health check API | http://localhost:4001/health |

**Tài khoản admin mặc định:** `admin` / `admin123`

---

## Các lệnh thường dùng

```bash
# Khởi động / tắt Docker stack
docker-compose up --build -d
docker-compose down

# Xem log của API
docker logs ta-edu-demo_v1-kyc-admin-api-1 --tail 50

# Nạp lại dữ liệu luật (xóa cũ + nạp mới)
cd services/kyc-admin-api
npm run ingest:legal -- --clear

# Kiểm tra parse mà không ghi DB
npm run ingest:legal -- --dry-run

# Firebase Functions (tùy chọn)
cd ../..
npm run dev:functions      # chạy emulator local
npm run deploy:functions   # deploy lên Firebase
```

---

## Tùy chọn: Firebase Functions

Cần cài Firebase CLI trước:

```bash
npm install -g firebase-tools
firebase login
```

Sau đó từ thư mục gốc:

```bash
npm run dev:functions
```

---

## Xử lý lỗi thường gặp

**`Failed to fetch` khi đăng nhập admin**
- Mở `http://localhost:4001/health` kiểm tra API có chạy không
- Đảm bảo frontend chạy qua `npx serve` (không mở file `index.html` trực tiếp)
- Kiểm tra `ALLOWED_ORIGINS` trong `docker-compose.yml` có chứa `http://localhost:3000`
- Rebuild: `docker-compose up --build -d`

**`ECONNREFUSED 127.0.0.1:5434` khi ingest**
- Docker Desktop chưa mở hoặc Postgres chưa sẵn sàng
- Chạy lại: `docker-compose up -d` rồi chờ 20-30 giây

**`API key not valid` khi tư vấn luật**
- `GEMINI_API_KEY` trong file `.env` không đúng hoặc chưa điền
- Bỏ trống biến này để dùng chế độ fallback (không cần AI)

**`Cannot GET /` khi mở `localhost:4001`**
- Đây là bình thường – API không có route trang chủ
- Truy cập đúng: `http://localhost:4001/health`
