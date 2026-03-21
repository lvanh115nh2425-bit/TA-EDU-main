# Mind Map Builder - Hướng dẫn sử dụng

## Tính năng chính

### ✅ Kéo thả linh hoạt
- **Kéo node**: Nhấp giữ vào bất kỳ node nào và kéo để di chuyển vị trí
- **Kéo canvas**: Nhấp giữ vào vùng trống và kéo để di chuyển toàn bộ sơ đồ
- **Zoom**: Cuộn chuột hoặc dùng nút Zoom In/Out để phóng to/thu nhỏ

### 🎯 Thao tác với Node

1. **Chọn node**: Nhấp vào bất kỳ node nào để chọn (viền vàng xuất hiện)
2. **Thêm nhánh con**: Chọn node cha → nhấn nút "Nhánh con"
3. **Thêm nhánh cùng cấp**: Chọn node → nhấn "Nhánh cùng cấp"
4. **Đổi tên**: Chọn node → nhấn "Đổi tiêu đề"
5. **Xóa node**: Chọn node → nhấn "Xóa nhánh" (sẽ xóa cả nhánh con)
6. **Mở/đóng nhánh**: Double-click vào node để mở rộng/thu gọn nhánh con

### 🎨 Tuỳ chỉnh

- **Đổi theme màu**: Nhấn nút "Theme" để thay đổi màu sắc
- **Căn giữa**: Nhấn "Căn giữa" để đưa sơ đồ về vị trí trung tâm
- **Reset theme**: Quay lại theme mặc định

### 💾 Lưu trữ & Xuất

- **Tự động lưu**: Dữ liệu được lưu tự động vào localStorage mỗi khi có thay đổi
- **Xuất JSON**: Nhấn "Xuất JSON" để lấy dữ liệu dạng JSON
- **Nhập JSON**: Nhấn "Nhập JSON" và dán dữ liệu để khôi phục sơ đồ
- **Reset toàn bộ**: Nhấn "Reset sơ đồ" để xóa và bắt đầu lại

## Phím tắt & Tips

### Thao tác nhanh
- **Single Click**: Chọn node
- **Double Click**: Mở/đóng nhánh con
- **Kéo thả**: Di chuyển node hoặc canvas
- **Cuộn chuột**: Zoom in/out

### Lưu ý kỹ thuật
- Dữ liệu lưu trong localStorage, không mất khi refresh
- Mỗi node có ID duy nhất tự động tạo
- Có thể kéo thả tự do, vị trí sẽ được lưu lại
- Hỗ trợ nhiều theme màu sắc

## Cấu trúc dữ liệu JSON

```json
{
  "id": "root",
  "name": "Ý tưởng chính",
  "children": [
    {
      "id": "branch-1",
      "name": "Nhánh 1",
      "children": [
        {
          "id": "branch-1-1",
          "name": "Nhánh con 1.1"
        }
      ]
    }
  ]
}
```

## Công nghệ sử dụng

- **D3.js v7**: Thư viện visualization mạnh mẽ
- **Drag & Drop**: Hỗ trợ kéo thả mượt mà
- **Zoom & Pan**: Phóng to/thu nhỏ và di chuyển canvas
- **LocalStorage**: Lưu trữ tự động

## Khắc phục sự cố

### Mind map không hiển thị
- Kiểm tra console (F12) xem có lỗi không
- Đảm bảo D3.js đã được load (CDN)
- Thử xóa localStorage và refresh lại

### Không kéo thả được
- Đảm bảo đã nhấp chính xác vào node (không phải text)
- Thử refresh trang nếu bị lag
- Kiểm tra xem có conflict với extension trình duyệt không

### Performance chậm
- Giảm số lượng node (dưới 50 node cho mượt nhất)
- Đóng các nhánh không cần thiết (double-click)
- Thử giảm zoom level

## Phát triển thêm

Có thể mở rộng với:
- [ ] Export ra hình ảnh PNG/SVG
- [ ] Thêm icon cho node
- [ ] Màu sắc tuỳ chỉnh cho từng node
- [ ] Ghi chú/mô tả chi tiết cho node
- [ ] Chia sẻ qua URL
- [ ] Nhiều người cùng chỉnh sửa (realtime)
- [ ] Lưu trữ trên cloud (Firebase)

---

**Tác giả**: TA-Edu Development Team  
**Phiên bản**: 2.0.0  
**Cập nhật**: 2025-11-21
