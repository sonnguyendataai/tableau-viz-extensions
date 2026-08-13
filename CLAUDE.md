# CLAUDE.md — Brief cho AI session

> Đọc trước khi làm bất cứ việc gì trong repo này.

## Repo này là gì
Nền tảng build **classic Tableau viz extension** (`.trex` + Extensions API + D3), stack
**plain JS + D3**, mô hình **BUILD ZONE**. KHÔNG phải Tableau Next LWC, KHÔNG phải dashboard
extension, KHÔNG phải Embedding API.

## Luật vàng
1. **Không sửa `src/core/`** khi build viz mới. Core đã lo init/data/encoding/selection/
   hover/theme/re-render. Viz mới = copy `src/vizzes/barchart/` + viết lại `render(info)`
   + khai báo `<encoding>` trong `.trex`.
2. **Nguồn chuẩn > trí nhớ.** API viz extension đọc từ `~/.claude/skills/tableau-viz-extension/`
   (SKILL.md + references) và MIT repo `tableau/extensions-api`. Đừng bịa tên method.
3. **Method có thật:** `initializeAsync` (đầu tiên), `getSummaryDataReaderAsync`+`getPageAsync`+
   `releaseAsync`, `getVisualSpecificationAsync`, `selectTuplesAsync`, `hoverTupleAsync`,
   `getSelectedMarksAsync`. **KHÔNG tồn tại:** `getSummaryDataTableAsync`, `getEncodingMapAsync`.
4. **Guard mọi encoding:** `row.x?.[0]?.value` — encoding vắng mặt nếu user chưa thả field.
5. **`$tupleId`** ta tự gán, phải bind vào mỗi element D3 (`.datum()`/key function) để
   click/hover hoạt động. Core đọc lại từ `element.__data__.$tupleId`.
6. **Sửa `.trex` → user phải Remove+re-add** trong Tableau (cache theo `id`). Sửa `.js`→Reload.
7. **License:** chỉ copy code từ nguồn MIT. Repo cộng đồng không nêu license → chỉ học pattern.

## `render(info)` nhận gì
`{ encodedData, encodingMap, rawRows, selectedMarkIds:Set, hoveredMarkIds:Set, width,
height, styles, bgRgb, worksheet, container }`. `encodedData[i]` = `{ $tupleId,
<encodingId>: DataValue[] }`. DataValue = `{ value, formattedValue, nativeValue }`.

## Verify
```bash
npm install && npm start                 # cổng 8765
node --check src/**/*.js                  # syntax
# logic thuần (data/selection) test được bằng Node .mjs — xem docs/03-dev-loop.md
```
Đăng ký thật trong Tableau Desktop 2024.2+ là bước do người dùng thực hiện.

## Prompt mẫu để build viz mới
"Tạo viz `<tên>` cho classic Tableau: encoding `<mô tả shelf>`. Copy `src/vizzes/barchart`,
khai báo `<encoding>` trong `.trex`, viết `render(info)` vẽ `<loại chart>` bằng D3, guard
thiếu field, fog mark chưa chọn, bind `$tupleId`. Không đụng `src/core/`."

Chi tiết: `docs/02-build-recipe.md`.
