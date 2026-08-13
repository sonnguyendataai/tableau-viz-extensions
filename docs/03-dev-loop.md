# 03 — Dev loop, hosting & lỗi thường gặp

## Yêu cầu
- Node.js + npm (đã cài).
- **Tableau Desktop 2024.2+** (viz extension không tồn tại trước version này).
- `npm install` đã chạy (http-server + `@tableau/extensions-api-types`).

## Chạy server (local, HTTP)

```bash
cd ~/tableau-extension
npm start        # = http-server . -p 8765 -c-1 --cors
```

- Phục vụ từ **repo root** → URL: `http://localhost:8765/src/vizzes/<name>/<name>.html`.
- `-c-1` tắt cache (thấy thay đổi ngay); `--cors` cho phép iframe của Tableau tải.
- Kiểm tra nhanh trong browser trước khi vào Tableau — không lỗi console là đạt.

> Tableau Desktop **cho phép localhost HTTP**. Mọi origin khác **bắt buộc HTTPS**.

## Đăng ký trong Tableau Desktop

1. Mở một worksheet (Marks card phải active).
2. Marks card → dropdown mark type (Automatic/Bar/Line…) → **Add Extension…**
3. **Access Local Extensions** → chọn `.trex`.
4. Kéo field lên các shelf (Category/Value…) vừa khai báo.

## Vòng lặp sửa code

| Sửa gì | Thao tác trong Tableau |
|---|---|
| `.js` / `.html` / CSS | Right-click extension trong Marks card → **Reload** |
| `.trex` (manifest) | **Remove** extension rồi **Add Extension** lại (manifest cache theo `id`) |
| `id` trong `.trex` | Coi như extension mới — **mất settings** đã lưu. Tránh trừ khi cùng đường. |

## Hosting HTTPS (Tableau Cloud/Server, workshop từ xa)

Khi không dùng được localhost (Tableau Cloud, máy khác), cần URL HTTPS công khai.

### Cách A — GitHub Pages
1. Push repo lên GitHub, bật Pages (Settings → Pages → branch `main`, thư mục `/root`).
2. URL sẽ là `https://<user>.github.io/<repo>/src/vizzes/<name>/<name>.html`.
3. Dùng `manifests/<name>.hosted.trex`, sửa `<url>` cho khớp, đăng ký bản này.
4. **Giữ nguyên `id`** giữa bản localhost và hosted → không mất settings.

### Cách B — Netlify Drop (nhanh nhất)
Kéo-thả cả thư mục repo vào `app.netlify.com/drop` → nhận URL HTTPS tức thì. Cập nhật
`<url>` trong `.hosted.trex`. Re-drop để cập nhật.

> Lưu ý CDN: `barchart.html` nạp D3 từ `cdn.jsdelivr.net` (HTTPS) nên OK trên trang HTTPS.
> Nếu vendor D3 cục bộ, đảm bảo cũng phục vụ qua HTTPS (tránh mixed-content).

## Lỗi thường gặp

| Triệu chứng | Nguyên nhân & khắc phục |
|---|---|
| Panel trống / extension không tải | `<source-location><url>` **không khớp** URL server (path/port/tên file). Mở URL trong browser để kiểm chứng. |
| `tableau is not defined` | Thư viện Extensions nạp **sau** code viz, hoặc thiếu `<script>` lib. Thứ tự: D3 → lib → `<name>.js`. |
| `initializeAsync is not a function` | Gọi API trước khi `initializeAsync()` resolve, hoặc nạp script sai thứ tự. |
| Data cũ / không cập nhật khi đổi filter | Chưa subscribe `SummaryDataChanged` **bên trong** `initializeAsync().then(...)`. (Core đã lo — kiểm tra không ghi đè.) |
| Sửa code nhưng Tableau vẫn hành vi cũ | Manifest cache. Remove + re-add, hoặc restart Tableau. |
| Mixed-content bị chặn | Trang HTTPS nhưng extension URL là HTTP. Dùng hosting HTTPS. |
| Port bận | `lsof -i :8765` → `kill <PID>`, hoặc đổi cổng và cập nhật `.trex`. |
| Click không chọn được mark | Element chưa mang `$tupleId` (thiếu `.datum()`/key function). Xem `02-build-recipe.md` bước 3. |

## Kiểm thử logic không cần Tableau

Các hàm thuần trong `src/core/{data,selection}.js` chạy được bằng Node (không phụ thuộc
`tableau`/`d3` global). Có thể viết test nhanh:

```bash
node --check src/core/*.js src/vizzes/**/*.js     # syntax
# hoặc import trong một file .mjs tạm để test getEncodedData/findIdsOfMarks/makeFog
```

(Đã dùng cách này để verify scaffold: 13/13 assertion pass.)
