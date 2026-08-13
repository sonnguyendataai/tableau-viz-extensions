# 02 — Công thức build một viz mới (7 bước)

> Mục tiêu: tạo một chart type mới cho yêu cầu khách mà **không đụng `src/core/`**.
> Mọi phần lặp lại (init, đọc data, selection, hover, theme, re-render) đã có sẵn.

## Nguyên tắc BUILD ZONE

Bạn chỉ viết 2 thứ:
1. **`<name>.trex`** — khai báo các shelf (`<encoding>`).
2. **`render(info)`** trong `<name>.js` — vẽ chart.

`<name>.html` gần như copy nguyên (chỉ đổi title + CDN thư viện chart nếu cần).

## Bước 1 — Copy khuôn barchart

```bash
cd ~/tableau-extension
cp -r src/vizzes/barchart src/vizzes/<name>
cd src/vizzes/<name>
# đổi tên file cho khớp (tuỳ chọn, không bắt buộc):
#   barchart.trex → <name>.trex, .html, .js
```

## Bước 2 — Khai báo encoding trong `<name>.trex`

Sửa 3 chỗ:
- `id` phải **duy nhất toàn cục**: `com.<org>.vizplatform.<name>` (Tableau cache theo id).
- `<source-location><url>` khớp **chính xác** đường server phục vụ (xem bước 5).
- Khối `<encoding>` — một block cho mỗi shelf. Ví dụ một bullet chart:

```xml
<encoding id="category">
  <display-name>Category</display-name>
  <role-spec><role-type>discrete-dimension</role-type></role-spec>
  <fields max-count="1"/>
  <encoding-icon token="letter-y"/>
</encoding>
<encoding id="value">
  <display-name>Actual</display-name>
  <data-spec><data-type>numeric</data-type></data-spec>
  <role-spec><role-type>continuous-measure</role-type></role-spec>
  <fields max-count="1"/>
  <encoding-icon token="bar"/>
</encoding>
<encoding id="target">
  <display-name>Target</display-name>
  <data-spec><data-type>numeric</data-type></data-spec>
  <role-spec><role-type>continuous-measure</role-type></role-spec>
  <fields max-count="1"/>
  <encoding-icon token="line"/>
</encoding>
```

Role types: `continuous-measure`, `discrete-measure`, `continuous-dimension`,
`discrete-dimension`. Icon tokens: `letter-x/y`, `size`, `color`, `text`, `detail`,
`bar`, `line`, `circle`, `path`, `shape`.

## Bước 3 — Viết `render(info)` trong `<name>.js`

Bộ khung bất biến:

```js
import { initExtension } from '../../core/extension.js';
import { makeFog } from '../../core/selection.js';

function render(info) {
  const { encodedData, selectedMarkIds, width, height, styles, bgRgb, container } = info;
  container.innerHTML = '';

  // 1) GUARD — chưa đủ field thì hướng dẫn, đừng crash
  if (!encodedData.length /* || thiếu encoding bắt buộc */) {
    container.innerHTML = '<div class="viz-empty">Thả field lên các shelf…</div>';
    return;
  }

  // 2) Đọc giá trị qua optional-chaining (encoding có thể vắng mặt)
  const rows = encodedData.map(r => ({
    $tupleId: r.$tupleId,
    label: r.category?.[0]?.formattedValue ?? '—',
    value: Number(r.value?.[0]?.value ?? 0),
    // target: Number(r.target?.[0]?.value ?? 0),
  }));

  // 3) Vẽ bằng D3. BẮT BUỘC gắn $tupleId lên mỗi element để framework lo
  //    click→select và hover→tooltip:
  //      .data(rows, d => d.$tupleId)  hoặc  .each(function(d){ this.__data__ = d; })
  //    Fog mark chưa chọn:
  const fog = makeFog(bgRgb);
  const anySel = selectedMarkIds.size > 0;
  const fill = d => (anySel && !selectedMarkIds.has(d.$tupleId)) ? fog('#4e79a7') : '#4e79a7';
  // ... build SVG, append vào container ...
}

window.onload = () => initExtension({ render, containerId: 'content' });
```

Những gì bạn **KHÔNG** phải viết (core đã lo): `initializeAsync`, đọc data/encoding,
đọc selection, `selectTuplesAsync`, `hoverTupleAsync`, re-render khi filter/resize/theme.

## Bước 4 — Chỉnh `<name>.html`

- Đổi `<title>`.
- Nếu chart cần lib phụ (d3-sankey, d3-hexbin…) thêm `<script>` CDN **trước** thư viện
  Extensions và **trước** `<name>.js`.
- Giữ nguyên thứ tự nạp: **D3 → lib Extensions → `<name>.js` (type=module)**.

## Bước 5 — Chạy dev server

```bash
cd ~/tableau-extension && npm start        # http-server tại repo root, cổng 8765
```

URL phục vụ: `http://localhost:8765/src/vizzes/<name>/<name>.html` — phải **khớp
chính xác** `<source-location><url>` trong `.trex`.

## Bước 6 — Đăng ký trong Tableau Desktop (2024.2+)

Marks card → dropdown mark type → **Add Extension** → **Access Local Extensions** →
chọn `src/vizzes/<name>/<name>.trex`. Sau đó kéo field lên các shelf vừa khai báo.

## Bước 7 — Vòng lặp dev

- Sửa **`.js`/`.html`** → right-click extension → **Reload** (không cần re-add).
- Sửa **`.trex`** → **Remove** rồi **Add Extension** lại (manifest cache theo id).

Chi tiết server/hosting/lỗi thường gặp: `03-dev-loop.md`.

## Checklist trước khi coi là "xong"

- [ ] `.trex` XML well-formed, `id` duy nhất, URL khớp server.
- [ ] `render` guard đủ: thiếu field → hướng dẫn, không crash.
- [ ] Mọi element mang `$tupleId` → click chọn được, hover ra tooltip.
- [ ] Fog mark chưa chọn khi có selection.
- [ ] Đổi filter trên dashboard → viz tự cập nhật (`SummaryDataChanged`).
- [ ] Đổi theme workbook → màu chữ/nền cập nhật.
- [ ] Nhân bản được: bạn không phải sửa `src/core/` để build viz này.
