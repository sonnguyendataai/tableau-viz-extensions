# 00 — Phân tích sâu: Tableau Viz Extension

> Tài liệu nền tảng. Đọc trước khi build. Nguồn chuẩn: `~/.claude/skills/tableau-viz-extension/`
> và MIT repo `github.com/tableau/extensions-api` (v1.17.0, Jun 2026).

## 0. Vấn đề & lý do tồn tại của project

Các chart dựng sẵn (built-in mark types + template Tableau Next) phủ ~90% nhu cầu:
line, bar, stacked bar, donut, heatmap, scatter, flow/Sankey, funnel, KPI tile. Nhưng
khi khách yêu cầu một dạng **đặc thù** — radar, bullet, waterfall, marimekko, calendar
heatmap, cohort grid, chord/network, KPI card có sparkline — thì template chạm giới hạn
(ví dụ thực tế đã gặp: KPI tile lỗi trên calc field, `performance_overview` chỉ 3 slot).

**Viz extension** là lối thoát: ta tự viết một mark renderer bằng D3/canvas và Tableau
nhúng nó vào Marks card như một "mark type" mới. Data và encoding vẫn do người dùng
kéo-thả trong Tableau; ta chỉ chịu trách nhiệm **vẽ**.

## 1. Ba cơ chế "custom viz" — không thể thay thế nhau

| Cơ chế | Sản phẩm Tableau | Manifest/Config | Hosting | Khi nào dùng |
|---|---|---|---|---|
| **Viz extension** (`worksheet-extension`) | Classic Desktop/Cloud/Server (2024.2+) | `.trex` (XML) | URL tĩnh (localhost/HTTPS) | **Chart type mới trong Marks card** — dự án này |
| Dashboard extension (`dashboard-extension`) | Classic Desktop/Cloud/Server | `.trex` (XML) | URL tĩnh | Widget toàn dashboard (không gắn 1 worksheet) — *ngoài phạm vi* |
| Tableau Next custom LWC | Tableau Next (Salesforce) | `.js-meta.xml` | Deploy vào Salesforce org | Chart trên `analytics__Dashboard`, query semantic layer qua `sdk` |
| *(đối chiếu)* Embedding API React | Nhúng view đã publish vào web app | React props + JWT | App tự host | KHÔNG phải viz mới — chỉ nhúng view có sẵn |

**Dự án này = Viz extension.** Chúng dùng chung ZERO API/manifest/hosting với LWC. Nếu
sau này cần custom viz cho các demo Tableau Next (Mey Group/TADT/Rivea trên `myorg`),
đó là đường LWC hoàn toàn khác — xem skill `tableau-next-custom-lwc`.

## 2. Kiến trúc runtime

```
┌─ Tableau Worksheet ─────────────────────────────┐
│  Marks card                                      │
│   ├─ Shelf "Category"  ← user kéo dimension vào  │
│   ├─ Shelf "Value"     ← user kéo measure vào    │
│   └─ <iframe>  ← viz extension của ta            │
│        │ initializeAsync()                       │
│        │ getSummaryDataReaderAsync() → summary   │
│        │ getVisualSpecificationAsync() → encoding│
│        │ D3 render vào #content                  │
│        │ selectTuplesAsync / hoverTupleAsync ────┼──► Tableau selection + tooltip
│   ▲                                              │
│   └── SummaryDataChanged (filter/action) ────────┘
└──────────────────────────────────────────────────┘
```

Viz chạy trong **iframe cô lập**. Tableau đẩy vào: summary data của worksheet + map
encoding (field nào trên shelf nào). Ta đẩy ra: mark được chọn/hover. Data hai chiều
đều qua Extensions API — không có DOM chung với Tableau.

## 3. Vòng đời API (đã xác thực từ MIT sample)

```
initializeAsync()                    ← BẮT BUỘC đầu tiên; không API nào chạy trước
  └─ worksheetContent.worksheet      ← handle worksheet
       ├─ getSummaryDataReaderAsync(pageSize, {ignoreSelection, applyWorksheetFormatting})
       │    └─ loop getPageAsync(p) cho reader.pageCount trang → releaseAsync()
       │       (rows BỊ ĐẢO → reverse; $tupleId ta tự gán 1-indexed)
       ├─ getVisualSpecificationAsync()
       │    └─ marksSpecifications[activeMarksSpecificationIndex].encodings
       │       (return sớm nếu activeMarksSpecificationIndex < 0)
       ├─ addEventListener(SummaryDataChanged, refetch+render)
       ├─ addEventListener(WorksheetFormattingChanged, render)   [API ≥ 1.7]
       ├─ selectTuplesAsync([tupleIds], SelectOptions.Simple|Toggle|Add|Remove, {tooltipAnchorPoint})
       ├─ hoverTupleAsync(tupleId, {tooltipAnchorPoint})         (-1 để clear)
       └─ getSelectedMarksAsync() → MarksCollection (luôn 1 DataTable cho viz ext)
```

Trong project, toàn bộ chuỗi này đã đóng gói trong `src/core/` — xem §6.

## 4. Khái niệm cốt lõi: `$tupleId`

- API **không** cấp id hàng. Ta tự gán `$tupleId` (1-indexed, tuần tự qua các trang)
  trong `convertToNamedRows`.
- Phải **mang xuyên suốt** tới D3 (bind qua `.datum()` / key function) để khi click/hover
  đọc lại được id → `selectTuplesAsync`/`hoverTupleAsync`.
- `getSelectedMarksAsync` trả `MarksCollection`, **không** trả tupleId → khớp ngược bằng
  **value-equality trên mọi cột** (join key nối `\x00`). Đã cài trong `findIdsOfMarks`.

## 5. Khả năng vs Giới hạn

### CÓ THỂ
- Vẽ **bất kỳ** hình học nào (D3/SVG, canvas, WebGL): radar, bullet, waterfall,
  marimekko, calendar heatmap, cohort grid, chord, network, sunburst, KPI card…
- Đọc summary data đã tổng hợp của worksheet (mọi field trên shelf).
- Nhiều field trên một shelf (`max-count > 1`) — vd Sankey nhiều level.
- Chọn/highlight/hover mark, đồng bộ với selection gốc của Tableau (tooltip, action).
- Theming theo workbook (font/màu/nền) qua `WorksheetFormatting`.
- Lưu cấu hình vào workbook qua `settings` + config dialog.

### KHÔNG THỂ (ràng buộc thiết kế)
- **Chỉ đọc summary data của worksheet đó** — không truy vấn nguồn khác, không SQL tùy ý.
- **Không có setter filter/parameter trực tiếp** (khác Embedding API). Tương tác chỉ qua
  select/highlight; data mới đến qua `SummaryDataChanged`.
- `getSummaryDataTableAsync()` **không tồn tại** — bắt buộc dùng reader phân trang.
- Encoding **vắng mặt** khỏi map nếu chưa thả field → phải guard `row.x?.[0]?.value`.
- **localhost HTTP** được phép; mọi origin khác **bắt buộc HTTPS** (mixed-content).
- Manifest **cache theo `id`** → sửa `.trex` phải Remove + re-add extension.
- Cần **Tableau 2024.2+**. `min-api-version` = `1.11` là mặc định an toàn.
- Đổi `id` trong `.trex` = extension mới → **mất settings** đã lưu. Chỉ đổi khi cùng đường.

## 6. Ánh xạ cơ chế → code trong repo

| Bước vòng đời | File | Hàm |
|---|---|---|
| init + wiring + events + click/hover | `src/core/extension.js` | `initExtension(view)` |
| đọc data phân trang + $tupleId | `src/core/data.js` | `getSummaryData`, `convertToNamedRows` |
| đọc encoding + re-key theo encodingId | `src/core/data.js` | `getEncodingMap`, `getEncodedData` |
| khớp selection ↔ tupleId + fog | `src/core/selection.js` | `findIdsOfMarks`, `makeFog` |
| theming theo workbook | `src/core/theme.js` | `readStyles`, `backgroundRgb` |
| **BUILD ZONE — vẽ chart** | `src/vizzes/<name>/<name>.js` | `render(info)` |
| khai báo shelf | `src/vizzes/<name>/<name>.trex` | `<encoding>` |

→ Build viz mới = viết lại DUY NHẤT `render(info)` + khai báo `<encoding>`. Xem `02-build-recipe.md`.

## 7. Tham chiếu

- Skill trên đĩa: `~/.claude/skills/tableau-viz-extension/{SKILL.md, references/*}`
- MIT ground-truth: `Samples/Viz/Sankey`, `Samples/Viz/ConnectedScatterplot`
- Docs API: https://tableau.github.io/extensions-api/docs/
- Learning: https://www.tableau.com/developer/learning/dashboard-and-viz-extensions-api
