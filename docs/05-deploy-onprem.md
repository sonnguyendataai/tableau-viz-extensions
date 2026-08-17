# 05 — Triển khai viz extension lên Tableau Server on-prem (air-gapped)

> Tài liệu bàn giao cho **team hạ tầng** + **quản trị Tableau**. Mục tiêu: đưa 6 viz
> extension trong repo này chạy trên Tableau Server nội bộ **không có internet**.


---

## 0. TL;DR (điều cốt lõi phải hiểu trước)

Viz extension **KHÔNG upload lên Tableau Server** như workbook. Nó là một **trang web tĩnh**
(`.html` + `.js`) chạy trong iframe ở **trình duyệt của người xem**. File `.trex` chỉ là
manifest **trỏ tới URL** của trang web đó.

Vì vậy "triển khai" = 3 việc, làm đúng thứ tự:

1. **[Hạ tầng]** Host thư mục web assets lên một **web server tĩnh nội bộ (HTTPS)**.
2. **[BI]** Sửa `<url>` trong các file `.trex` để trỏ về host nội bộ đó.
3. **[Quản trị Tableau]** **Allow-list** domain đó trong Tableau Server.

> ⚠️ **Điểm chết người nhất:** URL phải reachable từ **trình duyệt của người xem**, KHÔNG
> phải từ máy chủ Tableau. Vì thế **tuyệt đối không dùng `localhost`** — với người xem,
> `localhost` là chính máy của họ.

Tin tốt: repo này **đã vendored** thư viện D3 và Tableau Extensions API vào `lib/` (không
gọi CDN). Extensions API giao tiếp với Tableau bằng `postMessage`, **không cần internet**.
Nên air-gapped hoàn toàn khả thi — chỉ cần host nội bộ + đổi URL + allow-list.

---

## 1. Phân vai

| Vai trò | Việc phải làm | Phần |
|---|---|---|
| **Team hạ tầng** | Dựng web server tĩnh HTTPS nội bộ, host assets, mở firewall | Phần 3–4 |
| **BI** | Sửa `<url>` trong `.trex`, đưa `.trex` cho tác giả workbook | Phần 5 |
| **Quản trị Tableau** | Bật extensions + allow-list domain + cấp Full Data | Phần 6 |
| **Tác giả workbook** | Gắn extension vào worksheet, publish workbook | Phần 7 |

---

## 2. Sơ đồ luồng

```
  Trình duyệt người xem (trong mạng nội bộ)
  ┌──────────────────────────────────────────────┐
  │  Tableau Server (viewer view)                  │
  │  ┌──────────────────────────────────────────┐ │
  │  │  <iframe src=                              │ │      HTTPS, nội bộ
  │  │   https://viz.corp.local/src/vizzes/...>   │ │────────────────────────►  Web server tĩnh
  │  │     • D3 (lib/) • Extensions API (lib/)    │ │   GET .html/.js            (nginx / IIS / Apache)
  │  │     • src/core/*  • src/vizzes/<viz>/*     │ │◄────────────────────────  trả HTML + JS + config
  │  └──────────────────────────────────────────┘ │
  │        ▲ postMessage (KHÔNG ra internet)       │
  └────────┼───────────────────────────────────────┘
           │ data / selection / hover qua Extensions API
```

Không có bước nào gọi ra internet. Toàn bộ nằm trong LAN.

---

## 3. [Hạ tầng] Chuẩn bị web server tĩnh nội bộ

### 3.1 Yêu cầu bắt buộc

| Yêu cầu | Vì sao | Hỏng nếu sai |
|---|---|---|
| **HTTPS** với chứng chỉ do **CA nội bộ** cấp, được trình duyệt người xem tin | Tableau chỉ cho phép `http` với `localhost`; mọi origin khác **bắt buộc HTTPS** | Extension trống, không báo lỗi rõ (silent block) |
| `.js` (và `.mjs`) trả MIME **`application/javascript`** | Trình duyệt từ chối ES module sai MIME | Console: *"disallowed MIME type"* → viz trắng |
| Reachable từ **mọi máy người xem** qua hostname cố định (vd `viz.corp.local`) | iframe chạy ở máy người xem | 404 / connection refused ở máy viewer |
| **KHÔNG** gắn `X-Frame-Options: DENY/SAMEORIGIN` cho các file này | Header đó chặn Tableau (khác origin) nhúng iframe | Extension trống trên Server (nhưng chạy nếu mở URL trực tiếp) |
| Không cần CORS | Assets cùng origin với nhau; API dùng postMessage | — |

> **Rendering phía server (subscription / PDF / ảnh thumbnail):** nếu tổ chức cần các bản
> xuất này hiển thị được viz, thì **các node Tableau Server (Backgrounder)** cũng phải
> reachable tới `https://viz.corp.local/...`. Nếu chỉ cần xem trực tiếp trên trình duyệt
> thì chỉ cần máy người xem reachable là đủ. Kiểm chứng theo phiên bản Server của bạn.

### 3.2 Files cần host (giữ NGUYÊN cấu trúc thư mục)

Chép **repo root** (bỏ `node_modules/`, `.git/`, `docs/`) làm web root. Bắt buộc có 3 nhánh:

```
<WEBROOT>/                                  ← ví dụ /var/www/tableau-viz  hoặc  C:\inetpub\tableau-viz
├── lib/
│   ├── d3.v7.min.js
│   └── tableau.extensions.1.latest.js      ← Extensions API vendored — KHÔNG cần internet
├── src/
│   ├── core/                               ← BẮT BUỘC, dùng chung cho mọi viz
│   │   ├── data.js
│   │   ├── extension.js
│   │   ├── selection.js
│   │   └── theme.js
│   └── vizzes/
│       ├── barchart/            barchart.html        + barchart.js
│       ├── combo-bar-lines/     combo-bar-lines.html + combo-bar-lines.js
│       ├── kqkd-measures/       kqkd-measures.html   + kqkd-measures.js
│       ├── kqkd-report/         kqkd-report.html     + kqkd-report.js
│       ├── pivot-table/         pivot-table.html     + pivot-table.js
│       └── radar/               radar.html + radar.js + radar-config.html
```

> **Vì sao phải giữ nguyên path:** mỗi `.html` nạp `../../../lib/*.js` và `./<viz>.js`;
> mỗi `<viz>.js` `import ../../core/*.js`. Đổi path hay thiếu `src/core/` → 404 / vỡ
> bare-import khi load. Copy **nguyên khối** `lib/` và `src/` là an toàn nhất.
>
> **Config dialog:** `radar/radar-config.html` là hộp thoại cấu hình màu (mở qua chuột
> phải → Configure). Nó nằm trong thư mục viz nên copy `src/vizzes/` là đã bao gồm.

Không cần host: `node_modules/`, `manifests/`, `docs/`, `.git/`, `.nojekyll` (`.nojekyll`
chỉ phục vụ GitHub Pages, vô nghĩa nội bộ).

### 3.3 Cấu hình nginx (Linux)

```nginx
server {
    listen 443 ssl;
    server_name viz.corp.local;                     # ← ĐỔI thành hostname nội bộ thật

    ssl_certificate     /etc/ssl/certs/viz.corp.local.crt;   # cert từ CA nội bộ
    ssl_certificate_key /etc/ssl/private/viz.corp.local.key;

    root /var/www/tableau-viz;                        # = <WEBROOT> ở 3.2
    index index.html;

    # MIME đúng cho ES module (một số nginx cũ trả text/plain cho .mjs)
    types { application/javascript js mjs; }

    # KHÔNG đặt X-Frame-Options ở đây. Nếu buộc phải có CSP, cho phép Tableau nhúng:
    # add_header Content-Security-Policy "frame-ancestors https://tableau.corp.local";

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Kiểm tra & reload:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 3.4 Cấu hình IIS (Windows — phổ biến khi Tableau Server chạy Windows)

1. **Copy** `<WEBROOT>` (mục 3.2) vào ví dụ `C:\inetpub\tableau-viz`.
2. IIS Manager → **Add Website**: Site name `tableau-viz`, Physical path trỏ vào thư mục
   trên, **Binding = https**, chọn cert từ **CA nội bộ**, hostname `viz.corp.local`.
3. Site → **MIME Types** → đảm bảo:
   - `.js`  → `application/javascript`
   - `.mjs` → `application/javascript` (nếu chưa có thì **Add**)
4. Site → **HTTP Response Headers**: **xóa** `X-Frame-Options` nếu chính sách chung của IIS
   tự thêm `SAMEORIGIN` (nếu không sẽ chặn iframe Tableau).
5. (Tùy) tắt static compression cho `.js` nếu proxy nội bộ làm hỏng MIME.

### 3.5 Apache (thay thế)

```apache
<VirtualHost *:443>
    ServerName viz.corp.local
    DocumentRoot /var/www/tableau-viz
    SSLEngine on
    SSLCertificateFile      /etc/ssl/certs/viz.corp.local.crt
    SSLCertificateKeyFile   /etc/ssl/private/viz.corp.local.key
    AddType application/javascript .js .mjs
    # KHÔNG bật: Header set X-Frame-Options SAMEORIGIN
</VirtualHost>
```

### 3.6 Nghiệm thu web server (làm ở MÁY NGƯỜI XEM, không phải máy admin)

Mở trình duyệt trên một máy người dùng bất kỳ trong LAN và vào **thẳng** URL:

```
https://viz.corp.local/src/vizzes/radar/radar.html
```

Đạt khi:
- [ ] Trang load, **không** cảnh báo chứng chỉ (thanh địa chỉ ổ khóa xanh/không đỏ).
- [ ] **F12 → Network**: `radar.html`, `d3.v7.min.js`, `tableau.extensions.1.latest.js`,
      `radar.js`, và `src/core/*.js` đều **200** (không 404).
- [ ] **F12 → Console**: không có lỗi MIME, không có lỗi bare-import.

Lặp lại cho 5 viz còn lại (đổi tên trong path). Không đạt bước này thì các bước sau vô nghĩa.

---

## 4. [Hạ tầng] Firewall / DNS

- [ ] Tạo bản ghi **DNS nội bộ** `viz.corp.local` → IP web server (hoặc dùng IP tĩnh trong URL).
- [ ] Mở **443** từ dải mạng người xem tới web server.
- [ ] Nếu cần xuất PDF/subscription: mở 443 từ **node Tableau Server (Backgrounder)** tới web server.
- [ ] Cài **cert CA nội bộ** vào kho tin cậy của các máy người xem (thường đã có sẵn qua GPO).

---

## 5. [Tác giả] Sửa `<url>` trong các file `.trex`

Dùng các bản **`manifests/*.hosted.trex`** (đã cấu hình cho hosting). Hiện `<url>` đang trỏ
GitHub Pages — **đổi phần host** sang nội bộ, **giữ nguyên đuôi path** (bỏ tiền tố repo
`/tableau-viz-extensions` vì web root nội bộ = repo root).

Ví dụ (radar):
```diff
- <url>https://sonnguyendataai.github.io/tableau-viz-extensions/src/vizzes/radar/radar.html</url>
+ <url>https://viz.corp.local/src/vizzes/radar/radar.html</url>
```

Bảng đổi cho cả 6 (chỉ đổi host + bỏ `/tableau-viz-extensions`, **KHÔNG đổi `id`**):

| File `.trex` | `id` (GIỮ NGUYÊN) | `<url>` mới |
|---|---|---|
| `barchart.hosted.trex` | `com.sonnguyen.vizplatform.barchart` | `https://viz.corp.local/src/vizzes/barchart/barchart.html` |
| `combo-bar-lines.hosted.trex` | `com.sonnguyen.vizplatform.combobarlines` | `https://viz.corp.local/src/vizzes/combo-bar-lines/combo-bar-lines.html` |
| `kqkd-measures.hosted.trex` | `com.sonnguyen.vizplatform.kqkdmeasures` | `https://viz.corp.local/src/vizzes/kqkd-measures/kqkd-measures.html` |
| `kqkd-report.hosted.trex` | `com.sonnguyen.vizplatform.kqkd2` | `https://viz.corp.local/src/vizzes/kqkd-report/kqkd-report.html` |
| `pivot-table.hosted.trex` | `com.sonnguyen.vizplatform.pivottable` | `https://viz.corp.local/src/vizzes/pivot-table/pivot-table.html` |
| `radar.hosted.trex` | `com.sonnguyen.vizplatform.radar` | `https://viz.corp.local/src/vizzes/radar/radar.html` |

> **Không đổi `id`:** id là khóa nhận diện. Đổi id = extension "mới" → mọi workbook đã
> publish mất cấu hình và không nhận ra viz.
>
> **Sửa `.trex` = tác giả workbook phải Remove + Add lại** trong Tableau (manifest cache
> theo id). Đây là lý do phải chốt URL nội bộ **trước khi** phát cho tác giả workbook.

---

## 6. [Quản trị Tableau] Bật extensions + allow-list

Yêu cầu **Tableau Server 2024.2+** (viz extension không tồn tại trước bản này; các manifest
khai `min-api-version 1.11`).

Làm cho **từng site** cần dùng:

1. Đăng nhập admin → chọn **Site** → **Settings → Extensions**.
2. Bật **"Let users run extensions on this site"** và cho phép **network-enabled extensions**.
3. Trong **"Enable specific extensions"** (safe list), **Add**:
   - URL: `https://viz.corp.local` (hoặc URL đầy đủ tới từng `.html`).
   - **Full Data Access: Allow** — các viz này đọc summary data qua
     `getSummaryDataReaderAsync`, thiếu quyền này sẽ không có dữ liệu.
   - **Prompt user: No** (tùy chọn) để người xem không bị hỏi mỗi lần mở.
4. Lặp lại cho các site khác nếu có.

---

## 7. [Tác giả workbook] Gắn extension & publish

Làm trong **Tableau Desktop 2024.2+**:

1. Mở worksheet (Marks card đang active).
2. Marks card → dropdown mark type → **Add Extension…** → **Access Local Extensions** →
   chọn file `.trex` bản hosted (vd `radar.hosted.trex` đã sửa URL ở Phần 5).
3. Kéo field vào các shelf encoding → chỉnh xong.
4. (Tùy) chuột phải extension → **Configure** để chỉnh màu (nếu viz có config dialog).
5. **Publish workbook** lên Server.

Khi người xem mở workbook trên Server: trình duyệt nạp iframe từ `https://viz.corp.local/...`;
vì đã allow-list (Phần 6) và host nội bộ (Phần 3) → chạy không cần internet.

> `.trex` chỉ cần lúc **gắn extension**. Sau khi publish, định nghĩa nằm trong workbook;
> người xem **không** cần file `.trex`.

---

## 8. Checklist nghiệm thu end-to-end

- [ ] Mở URL `.html` từ **máy người xem** → 200, không lỗi cert/MIME/404 (Phần 3.6).
- [ ] Không còn URL nào trỏ internet trong `.trex` đã dùng (github.io, cdn.*).
- [ ] Server 2024.2+, đã bật extensions + allow-list + Full Data Access (Phần 6).
- [ ] Publish một workbook thử, mở bằng **tài khoản người xem thường** (không phải admin).
- [ ] Viz hiển thị đúng, click chọn mark hoạt động, đổi filter → viz cập nhật.
- [ ] (Nếu cần) xuất PDF/subscription hiển thị viz → xác nhận Backgrounder reachable.

---

## 9. Xử lý sự cố

| Triệu chứng | Nguyên nhân & khắc phục |
|---|---|
| Extension **trắng** trên Server nhưng mở URL trực tiếp thì OK | Web server gắn `X-Frame-Options: SAMEORIGIN` → chặn iframe Tableau. Gỡ header đó, hoặc dùng CSP `frame-ancestors` cho phép origin Tableau (Phần 3.1). |
| Extension trắng, Console báo cert / `net::ERR_CERT_*` | Cert không do CA nội bộ tin cậy cấp, hoặc chưa cài CA vào máy người xem (Phần 4). |
| Console: *"disallowed MIME type ... not executable"* | `.js` trả sai MIME. Sửa MIME server thành `application/javascript` (Phần 3.3–3.5). |
| Panel trống, Network 404 `src/core/*.js` | Thiếu `src/core/` trên web root, hoặc sai cấu trúc path. Copy nguyên khối `src/` (Phần 3.2). |
| `tableau is not defined` | Thứ tự script sai / thiếu `lib/tableau.extensions...js`. Đây là lỗi code, không phải hạ tầng — báo tác giả. |
| Viz hiện nhưng **không có dữ liệu** | Site chưa cấp **Full Data Access** cho URL (Phần 6). |
| Đăng ký `.trex` báo lỗi version | Desktop/Server < 2024.2. Nâng cấp. |
| Sửa URL `.trex` xong Tableau vẫn dùng bản cũ | Manifest cache theo id. Tác giả workbook **Remove + Add lại** extension. |
| Chỉ 1 máy người xem lỗi, máy khác OK | Máy đó thiếu cert CA nội bộ, hoặc DNS `viz.corp.local` không phân giải trên máy đó. |

---

## Phụ lục A — Danh sách extension trong repo

| Tên | id | HTML | Có config dialog? |
|---|---|---|---|
| barchart | `com.sonnguyen.vizplatform.barchart` | `barchart.html` | Không |
| combo-bar-lines | `com.sonnguyen.vizplatform.combobarlines` | `combo-bar-lines.html` | Không |
| kqkd-measures | `com.sonnguyen.vizplatform.kqkdmeasures` | `kqkd-measures.html` | Không |
| kqkd-report | `com.sonnguyen.vizplatform.kqkd2` | `kqkd-report.html` | Không |
| pivot-table | `com.sonnguyen.vizplatform.pivottable` | `pivot-table.html` | Không |
| radar | `com.sonnguyen.vizplatform.radar` | `radar.html` | Có (`radar-config.html`) |

## Phụ lục B — Định dạng (font/màu) chỉnh ở đâu?

- **Tự động từ Tableau (không cần code):** nền worksheet và một phần định dạng mà Extensions
  API expose được core đọc qua `styles`/`bgRgb` và truyền vào `render()` — với điều kiện
  `render()` của viz có *dùng* các giá trị đó. Core cũng tự vẽ lại khi user đổi format
  (sự kiện `WorksheetFormattingChanged`).
- **Qua config dialog của extension (code một lần, sau đó user tự chỉnh trên UI):** ví dụ
  `radar-config.html` cho user chọn màu từng series và lưu vào workbook. Muốn thêm font/size
  thì mở rộng dialog này.
- **KHÔNG có sẵn:** menu **Format** của Tableau không áp thẳng vào SVG do extension tự vẽ
  ngoài phần API expose. Nhu cầu chỉnh tùy ý → phải cung cấp qua config dialog trong extension.
