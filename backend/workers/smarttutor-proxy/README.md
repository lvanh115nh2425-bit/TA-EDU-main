# TA-Edu SmartTutor Proxy (Perplexity)

Cloudflare Worker dùng để thay thế Firebase Functions cho SmartTutor. Worker nhận `POST { messages: [...] }`, gọi API Perplexity và trả về `{ reply }`.

## Cấu hình

1. Cài Wrangler
   ```bash
   npm install -g wrangler
   ```
2. Cài các phụ thuộc dev
   ```bash
   cd workers/smarttutor-proxy
   npm install
   ```
3. Tạo `.dev.vars` từ file mẫu:
   ```
   cp .dev.vars.example .dev.vars
   ```
   Điền giá trị thật:
   - `PERPLEXITY_API_KEY`: API key lấy từ https://www.perplexity.ai/settings.
   - `PERPLEXITY_MODEL`: (tùy chọn) model muốn dùng, mặc định `llama-3.1-sonar-small-128k-online`.
   - `ALLOWED_ORIGINS`: danh sách origin được phép gọi Worker, ngăn cách bởi dấu phẩy. Ghi `*` nếu không giới hạn.
   - `SMARTTUTOR_SYSTEM`: (tùy chọn) system prompt cho SmartTutor.

4. Chạy local:
   ```bash
   wrangler dev
   ```
   Worker dùng các biến trong `.dev.vars`.

5. Deploy
   ```bash
   wrangler deploy
   ```
   Sau đó lấy URL, ví dụ `https://taedu-smarttutor.<id>.workers.dev/`.

6. Trên frontend, đặt
   ```html
   <script>
     window.__TAEDU_TUTOR_BACKEND = "https://taedu-smarttutor.<id>.workers.dev/";
   </script>
   ```
   hoặc cập nhật script trong `smarttutor.html` để trỏ tới URL mới.

## Payload mẫu

```json
{
  "messages": [
    { "role": "user", "content": "Giải thích định luật Ôm" }
  ]
}
```

## Response

```json
{
  "reply": "Định luật Ôm cho biết ... "
}
```

Worker tự xử lý CORS (OPTIONS + `Access-Control-Allow-Origin`). Nếu request thất bại, trả JSON `{ error, detail }`.
