# 04 — Hệ sinh thái repo/library (đã khảo sát & chọn lọc)

> Khảo sát tháng 7/2026 qua GitHub search + npm registry. Mục tiêu: tái sử dụng tối đa,
> tránh viết lại, và **an toàn license**.

## Nguyên tắc license

- **Chỉ copy code** từ nguồn **có license rõ ràng, tương thích** (MIT).
- Repo cộng đồng **không nêu license** → **chỉ học pattern, tự viết lại** (không copy trực tiếp).
- Repo này retain copyright của Tableau trong `LICENSE` vì `lib/` và các helper trong
  `src/core/` phái sinh từ MIT sample của họ.

## Bảng nguồn

| Nguồn | License | Stack | Vai trò | Đã dùng thế nào |
|---|---|---|---|---|
| **`tableau/extensions-api`** (v1.17.0, Jun 2026) | **MIT** ✓ | Plain JS + D3 | **Ground-truth chính** | Vendor `lib/tableau.extensions.1.latest.js`; port pattern `getSummaryData`/`getEncodedData`/`findIdsOfMarks`/fog từ `Samples/Viz/Sankey` |
| **`@tableau/extensions-api-types`** (v1.17.0) | **MIT** ✓ | TS types | Autocomplete/JSDoc | devDep trong `package.json` + `jsconfig.json` (`// @ts-check`) |
| `TableauOps/tableau-extension-starter` | ⚠ *không nêu* | Plain JS | Mẫu kiến trúc | Học pattern: dual manifest (localhost + hosted HTTPS), 1 `render()` "BUILD ZONE", `CLAUDE.md` cho AI. **Không copy code.** |
| `cristiansaavedra/tc24_1418_hello-viz-extensions` | ⚠ *không nêu* | Plain JS | Thang học | Đối chiếu khái niệm 6 bước (worksheet name→params→encodings→data→settings→table). |
| `Shintumon/tableau-combo-chart-react` | ⚠ *không nêu* | React18+D3+Vite | Tham khảo React | Chỉ dùng nếu tương lai đổi sang React. Không dùng cho stack hiện tại. |
| `michaelmccusker30/tableau-viz-extension-supertable` | ⚠ *không nêu* | Plain JS | Ý tưởng chart | Tham khảo cho nhu cầu "bảng giàu tính năng". |
| `keplergl/kepler.gl-tableau` | (kiểm tra repo) | — | Ý tưởng map | 58★ — nhúng Kepler.gl; tham khảo cho geospatial. |

## Chi tiết `tableau/extensions-api` (`Samples/Viz`)

Chỉ **2/8** thư mục là chart thật để làm khuôn:

| Thư mục | Là gì | Học được |
|---|---|---|
| **`Sankey`** | Sankey diagram | Multi-field encoding (`level` `max-count` cao), selection layer, hover layer, fog, `$tupleId` binding, join key `\x00` |
| **`ConnectedScatterplot`** | Scatter nối đường | Encoding x/y/text, animation |
| `DataSources` | *demo API* | Không phải chart |
| `Filtering` | *demo API* | Không phải chart |
| `Parameters` | *demo API* | Không phải chart |
| `Settings` | *demo API* | Config dialog + settings persistence |
| `UINamespace` | *demo API* | UI dialog namespace |
| `VizImage` | *demo API* | Multi-pane image |

Runtime lib **không có trên npm** — phải vendor từ `lib/` của repo (đã làm: `lib/tableau.extensions.1.latest.js`, ~2 MB).

## Quyết định kiến trúc rút ra

1. **Vendor** runtime lib (MIT) thay vì CDN → offline-friendly, version cố định.
2. **Tách `src/core/` (tái sử dụng) khỏi `src/vizzes/` (BUILD ZONE)** — lấy ý tưởng
   `render(model)` của TableauOps starter nhưng **viết lại thuần**, không copy (license mù).
3. **Dual manifest** (`src/vizzes/*/*.trex` localhost + `manifests/*.hosted.trex` HTTPS)
   — pattern từ TableauOps starter, giữ chung `id` để không mất settings.
4. **`@tableau/extensions-api-types`** cho type-check dù viết plain JS.

## Muốn tìm thêm

```bash
gh search repos "tableau viz extension" --limit 30 \
  --json fullName,stargazersCount,description \
  --jq 'sort_by(-.stargazersCount)[] | "\(.stargazersCount)★  \(.fullName) — \(.description)"'
```

Luôn kiểm tra **license** trước khi copy; nếu không có, chỉ đọc để học pattern.
