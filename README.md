# Tableau Viz Extension — Nền tảng "build viz theo yêu cầu"

Nền tảng để tạo **bất kỳ custom viz nào** cho **classic Tableau** (Desktop/Cloud/Server
2024.2+) khi chart dựng sẵn không đáp ứng — bằng `.trex` + Extensions API + D3.

Triết lý **BUILD ZONE**: mọi phần lặp lại (init, đọc data/encoding, selection, hover,
theme, re-render) đã đóng gói trong `src/core/`. Tạo viz mới = viết lại **duy nhất** hàm
`render(info)` và khai báo `<encoding>` trong `.trex`. Không đụng `src/core/`.

## Cấu trúc

```
tableau-extension/
├── lib/tableau.extensions.1.latest.js   # runtime Extensions API (vendored, MIT)
├── src/
│   ├── core/            # framework mỏng — TÁI SỬ DỤNG, không sửa khi build viz
│   │   ├── extension.js #   initExtension(view): init + wiring + click/hover → view.render(info)
│   │   ├── data.js      #   getSummaryData (phân trang, $tupleId), getEncodingMap, getEncodedData
│   │   ├── selection.js #   findIdsOfMarks (khớp selection↔tupleId), makeFog
│   │   └── theme.js     #   đọc workbook formatting → CSS/màu nền
│   └── vizzes/
│       └── barchart/    # VIZ MẪU — copy thư mục này để tạo viz mới
│           ├── barchart.trex   # khai báo shelf Category + Value
│           ├── barchart.html   # nạp D3 → lib → barchart.js
│           └── barchart.js     # ← BUILD ZONE: chỉ render(info)
├── manifests/barchart.hosted.trex   # bản HTTPS (GitHub Pages/Netlify)
└── docs/                # phân tích + khung quyết định + công thức + dev loop + hệ sinh thái
```

## Chạy nhanh (local)

```bash
npm install
npm start           # http-server tại repo root, cổng 8765
```

Trong **Tableau Desktop 2024.2+**: mở worksheet → Marks card → dropdown mark type →
**Add Extension** → **Access Local Extensions** → chọn `src/vizzes/barchart/barchart.trex`.
Kéo 1 dimension lên **Category**, 1 measure lên **Value**.

## Tạo viz mới (tóm tắt)

```bash
cp -r src/vizzes/barchart src/vizzes/<name>
# 1) sửa <name>.trex: đổi id (duy nhất), URL, khối <encoding>
# 2) viết lại render(info) trong <name>.js
# 3) npm start → Add Extension trong Tableau
```

Chi tiết đầy đủ: [`docs/02-build-recipe.md`](docs/02-build-recipe.md).

## Tài liệu

| Doc | Nội dung |
|---|---|
| [`docs/00-analysis.md`](docs/00-analysis.md) | Phân tích sâu: cơ chế, vòng đời API, khả năng/giới hạn, 3 cơ chế custom viz |
| [`docs/01-decision-framework.md`](docs/01-decision-framework.md) | Khi nào cần custom viz? Nền tảng nào? Chart & encoding nào? |
| [`docs/02-build-recipe.md`](docs/02-build-recipe.md) | Công thức 7 bước tạo viz mới |
| [`docs/03-dev-loop.md`](docs/03-dev-loop.md) | Server, đăng ký, hosting HTTPS, lỗi thường gặp |
| [`docs/04-repo-ecosystem.md`](docs/04-repo-ecosystem.md) | Repo/library đã chọn lọc + nguyên tắc license |

## Ràng buộc cần nhớ

- Cần **Tableau 2024.2+**; `min-api-version` = `1.11`.
- Chỉ đọc **summary data của một worksheet**; không set filter/parameter trực tiếp.
- **localhost HTTP** OK; mọi origin khác **bắt buộc HTTPS**.
- Manifest **cache theo `id`** → sửa `.trex` phải Remove + re-add extension.
- Guard mọi encoding: `row.x?.[0]?.value` (encoding vắng mặt nếu chưa thả field).

## License

MIT. `lib/` và pattern trong `src/core/` phái sinh từ MIT repo
[`tableau/extensions-api`](https://github.com/tableau/extensions-api). Xem `LICENSE`.
