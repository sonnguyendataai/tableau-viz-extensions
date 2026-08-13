# 01 — Khung quyết định

> Trả lời 3 câu hỏi theo thứ tự trước khi viết bất kỳ code nào.

## Câu hỏi 1 — Có THỰC SỰ cần custom viz không?

Custom viz tốn công build + host + maintain. Chỉ dùng khi built-in KHÔNG làm được.

```
Yêu cầu của khách
   │
   ├─ Chart chuẩn (bar/line/donut/scatter/heatmap/map) làm được? ──► DÙNG BUILT-IN. Dừng.
   │
   ├─ Chỉ là bố cục/nhãn/màu/format? ─────────────────────────────► Sửa worksheet/dashboard. Dừng.
   │
   ├─ Chỉ cần NHÚNG view đã có vào web app? ──────────────────────► Embedding API (khác project).
   │
   └─ Cần HÌNH HỌC mà built-in không có
      (radar, bullet, waterfall, marimekko, calendar heatmap,
       cohort grid, chord, network, KPI card sparkline...) ───────► ✅ CUSTOM VIZ EXTENSION.
```

**Cảnh báo giới hạn dữ liệu:** viz extension chỉ đọc **summary data của một worksheet**
đó. Nếu yêu cầu cần dữ liệu từ nguồn khác, join runtime, hay set filter/parameter chủ
động → viz extension KHÔNG hợp; cân nhắc dashboard extension hoặc Embedding API.

## Câu hỏi 2 — Nền tảng nào?

| Nếu content sống ở... | Dùng | Ghi chú |
|---|---|---|
| Tableau **Desktop/Cloud/Server** (classic) | **Viz extension** (project này) | `.trex` + `src/core` + D3 |
| **Tableau Next** (`analytics__Dashboard`, Salesforce) | Custom **LWC** | skill `tableau-next-custom-lwc`; KHÔNG dùng repo này |
| Widget cho **cả dashboard** (không gắn 1 sheet) | Dashboard extension | `dashboard-extension` — ngoài phạm vi |

Các demo hiện tại (Mey Group/TADT/Rivea) là **Tableau Next** → nếu cần custom viz cho
chúng, đó là đường LWC. Repo này phục vụ **classic Tableau**.

## Câu hỏi 3 — Chọn dạng chart & khai báo encoding nào?

Encoding trong `.trex` = các shelf mà user kéo field vào. Thiết kế encoding theo "ngữ
pháp" của chart:

| Nhóm chart | Ví dụ | Encoding gợi ý (`.trex`) |
|---|---|---|
| **So sánh nâng cao** | radar, bullet, waterfall, marimekko | `category` (discrete-dim) + 1–N `measure` (continuous). Bullet thêm `target`. Waterfall thêm `order`. |
| **Ma trận thời gian/cohort** | calendar heatmap, cohort grid, small multiples | `row` + `col` (discrete-dim) + `value` (continuous-measure) + optional `panel` (small-multiple facet) |
| **Quan hệ/mạng lưới** | chord, network, Sankey biến thể | `level` (discrete-dim, `max-count` cao) + `edge`/`weight` (continuous-measure) |
| **KPI/executive tile** | big-number + sparkline + MoM/YoY | `value` (measure) + `trend` (measure theo thời gian) + optional `compare` (measure) |

Nguyên tắc:
- Mỗi shelf = một `<encoding id>`; `id` chính là key trong `encodedData`.
- `role-spec` giới hạn kiểu field (discrete-dimension / continuous-measure / …).
- `max-count="1"` cho shelf đơn, cao hơn khi cho phép nhiều field (Sankey level).
- LUÔN thiết kế để **thiếu field vẫn không crash** — renderer guard + hiện hướng dẫn.

## Ma trận "khi nào KHÔNG build custom"

| Tình huống | Làm thay vì custom viz |
|---|---|
| Chỉ đổi màu/nhãn/tiêu đề | Format worksheet |
| Cần combo bar+line 2 trục | Built-in dual-axis |
| Cần bản đồ | Built-in map / Mapbox |
| Cần bảng có sort/search | Built-in text table (hoặc dùng lại supertable community) |
| Cần dữ liệu ngoài worksheet | Dashboard extension / Embedding API |
| Content ở Tableau Next | Custom LWC |

## Quyết định đã chốt cho project này

- Nền tảng: **classic viz extension**.
- Stack: **plain JS + D3**, mô hình **BUILD ZONE** (`render(info)` là điểm mở rộng duy nhất).
- Deliverable: docs (bộ này) + scaffold chạy được (`src/core` + `src/vizzes/barchart`).
