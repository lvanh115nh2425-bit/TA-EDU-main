# Mind Map Builder - MarkMap Edition

## 🎯 Đã chuyển sang thư viện MarkMap!

### Tại sao đổi sang MarkMap?

✅ **Ổn định hơn**: Ít bug, ít lỗi kéo thả  
✅ **Mượt mà hơn**: Animation và zoom/pan tự nhiên  
✅ **Chuyên nghiệp**: Được sử dụng bởi nhiều công ty lớn  
✅ **Dễ customize**: Nhiều theme màu sắc đẹp  
✅ **Performance tốt**: Xử lý mind map lớn tốt hơn  

---

## Tính năng chính

### 🖱️ Thao tác cơ bản
- **Click node**: Chọn node để chỉnh sửa (viền vàng)
- **Kéo canvas**: Nhấp giữ vào vùng trống và kéo để di chuyển
- **Zoom**: Cuộn chuột để phóng to/thu nhỏ
- **Pan tự động**: MarkMap tự động căn chỉnh view

### ➕ Quản lý Node

1. **Thêm nhánh con**
   - Chọn node cha
   - Nhấn nút "Nhánh con"
   - Nhập tên và Enter

2. **Thêm nhánh cùng cấp**
   - Chọn node bất kỳ (không phải root)
   - Nhấn "Nhánh cùng cấp"
   - Nhập tên và Enter

3. **Đổi tên node**
   - Chọn node
   - Nhấn "Đổi tiêu đề"
   - Nhập tên mới

4. **Xóa node**
   - Chọn node
   - Nhấn "Xóa nhánh"
   - Xác nhận xóa (sẽ xóa cả nhánh con)

### 🎨 Tuỳ chỉnh giao diện

- **Theme màu**: Nhấn "Theme" để chuyển đổi giữa 5 bộ màu đẹp
- **Zoom In/Out**: Phóng to/thu nhỏ
- **Căn giữa**: Đưa mind map về vị trí trung tâm

### 💾 Lưu trữ & Chia sẻ

- **Auto-save**: Tự động lưu mỗi khi thay đổi
- **Export JSON**: Xuất dữ liệu để backup hoặc chia sẻ
- **Import JSON**: Nhập lại dữ liệu đã lưu
- **Reset**: Xóa toàn bộ và bắt đầu lại

---

## So sánh D3.js vs MarkMap

| Tính năng | D3.js (Cũ) | MarkMap (Mới) |
|-----------|-----------|---------------|
| Kéo thả node | ⚠️ Có bug nhảy | ✅ Mượt mà |
| Zoom/Pan | ⚠️ Đôi khi lag | ✅ Rất mượt |
| Performance | 🐌 Chậm khi nhiều node | ⚡ Nhanh |
| Giao diện | 🎨 Tùy chỉnh phức tạp | 🎨 Đẹp sẵn |
| Lỗi | ⚠️ Nhiều edge case | ✅ Ổn định |

---

## Cấu trúc dữ liệu

```json
{
  "id": "root",
  "content": "Ý tưởng chính",
  "children": [
    {
      "id": "branch-1",
      "content": "Nhánh 1",
      "children": [
        {
          "id": "branch-1-1",
          "content": "Nhánh con 1.1",
          "children": []
        }
      ]
    },
    {
      "id": "branch-2",
      "content": "Nhánh 2",
      "children": []
    }
  ]
}
```

**Lưu ý**: Khác với version cũ (dùng `name`), bây giờ dùng `content` cho tên node.

---

## Theme màu sắc

MarkMap hỗ trợ 5 bộ theme đẹp:

1. **Default**: Xanh dương, tím, hồng, xanh lá, vàng
2. **Purple Dream**: Các tông tím pastel
3. **Pink Blossom**: Các tông hồng nhẹ nhàng
4. **Green Nature**: Các tông xanh lá tươi mát
5. **Sunset**: Các tông vàng ấm áp

---

## Khắc phục sự cố

### Mind map không hiển thị
```javascript
// Check console (F12)
// Đảm bảo MarkMap library đã load:
console.log(typeof markmap); // Should be "object"
console.log(typeof d3); // Should be "object"
```

### Không chọn được node
- Refresh trang (Cmd/Ctrl + R)
- Xóa localStorage và thử lại
- Kiểm tra console có lỗi không

### Performance chậm
- MarkMap xử lý tốt đến 100+ nodes
- Nếu vẫn chậm, thử đóng các nhánh không cần thiết
- Xóa bớt node không dùng

---

## Migration từ D3 sang MarkMap

Nếu bạn có dữ liệu cũ với format `name`:

```javascript
// Old format (D3)
{ id: "1", name: "Node", children: [...] }

// New format (MarkMap)
{ id: "1", content: "Node", children: [...] }
```

**Cách chuyển đổi**: Export JSON từ version cũ, tìm & thay `"name"` → `"content"`, rồi Import lại.

---

## Roadmap

Tính năng sắp tới:

- [ ] Export PNG/SVG image
- [ ] Thêm màu sắc tùy chỉnh cho từng node
- [ ] Ghi chú/mô tả chi tiết
- [ ] Link giữa các node
- [ ] Undo/Redo
- [ ] Keyboard shortcuts
- [ ] Real-time collaboration
- [ ] Cloud sync (Firebase)

---

## Công nghệ

- **MarkMap**: https://markmap.js.org/
- **D3.js v7**: Rendering engine
- **LocalStorage**: Lưu trữ local

**Version**: 3.0.0 (MarkMap Edition)  
**Updated**: 2025-11-21  
**Author**: TA-Edu Development Team
