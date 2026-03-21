# Cloudflare Worker: TA-Edu KYC Review

Worker này thay Firebase Functions để duyệt hồ sơ KYC: nhận POST `{ uid, action, note, key }`, kiểm tra `key`, ký JWT bằng service account rồi cập nhật trường `verify` trong Firestore.

## Chuẩn bị

1. **Service account**
   - Firebase Console → IAM & Admin → Service Accounts → `Generate new private key`.
   - Lưu lại `project_id`, `client_email`, `private_key`.

2. **Cài Wrangler**
   ```bash
   npm install -g wrangler
   ```

3. **Biến môi trường**
   - **Triển khai thật (Cloudflare secrets)**
     ```bash
     cd workers/kyc-review
     wrangler secret put FIREBASE_CLIENT_EMAIL
     wrangler secret put FIREBASE_PRIVATE_KEY   # dán nguyên block, wrangler tự xử lý xuống dòng
     wrangler secret put FIREBASE_PROJECT_ID
     wrangler secret put ADMIN_REVIEW_KEY       # chuỗi bạn nhập ở trang admin
     wrangler secret put CORS_ORIGIN            # (tuỳ chọn) ví dụ https://taedu.io
     ```
   - **Chạy local**: copy file `.dev.vars.example` thành `.dev.vars`, điền giá trị thực (file này đã được ignore nên không sợ lộ khoá).

## Phát triển & deploy
```bash
cd workers/kyc-review
wrangler dev     # chạy local, tự đọc biến trong .dev.vars
wrangler deploy  # xuất bản lên workers.dev
```

Sau khi deploy, ghi chú lại URL (ví dụ `https://taedu-kyc-review.<id>.workers.dev/`) và đặt vào trang admin:
```html
<script>
  window.__TAEDU_KYC_REVIEW_ENDPOINT = "https://taedu-kyc-review....workers.dev/";
</script>
```
Giờ mỗi lần duyệt/từ chối, trang sẽ gọi Worker này và Worker cập nhật Firestore thông qua service account. 
