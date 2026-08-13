// @ts-check
/* global d3 */

/**
 * combo-bar-lines.js — VIZ: cụm cột (grouped bars) + nhiều đường (multi-line),
 * DUAL AXIS (bars = trục trái, lines = trục phải), có super-group tùy chọn.
 *
 * Đây là "BUILD ZONE": chỉ file này là code riêng của viz. Không đụng src/core/.
 *
 * Vì sao cần viz extension thay vì dual-axis built-in:
 *   Muốn CỤM nhiều bar phải đặt Measure Names lên Columns, nhưng Measure Names là
 *   dùng chung toàn viz → nó chẻ luôn trục line thành cột rời, line không nối liền.
 *   Chỉ có 1 field Measure Names nên không tách bar-axis và line-axis. → vẽ tay D3.
 *
 * Encoding (khai báo trong .trex):
 *   category  discrete-dimension, 1 field   → mỗi giá trị = 1 cụm cột + 1 điểm mỗi line
 *   group     discrete-dimension, 1 field   → (tùy chọn) super-group: tách khối + vạch đứt
 *   bars      continuous-measure, 1..N      → CỤM cột, TRỤC TRÁI (giá trị tuyệt đối)
 *   lines     continuous-measure, 1..N      → nhiều ĐƯỜNG, TRỤC PHẢI (thường là %)
 *
 * render(info) nhận (xem src/core/extension.js để biết đầy đủ):
 *   info.encodedData     Array<{ $tupleId, category?:DV[], group?:DV[], bars?:DV[], lines?:DV[] }>
 *   info.encodingMap     { bars?:[{name}], lines?:[{name}], ... }  ← tên series cho legend
 *   info.selectedMarkIds Set<number>
 *   info.width/height    kích thước container
 *   info.styles          CSS từ workbook (fontFamily, color, ...)
 *   info.bgRgb           nền [r,g,b] cho fog
 *   info.container       #content
 *
 * DV = { value, formattedValue, nativeValue }. Ta dùng .value để tính scale,
 * .formattedValue để in nhãn ("727,324", "41%") — Tableau đã format sẵn.
 *
 * Selection: mỗi category = 1 row = 1 tuple. Click bất kỳ cột/điểm nào của một
 * category → chọn nguyên tuple đó. Mỗi element mang $tupleId (core đọc lại để
 * selectTuplesAsync / hoverTupleAsync).
 */

import { initExtension } from '../../core/extension.js';
import { makeFog } from '../../core/selection.js';

// Palette gợi cảm hứng từ báo cáo ngân hàng (bars ấm/xám, lines tương phản).
// Cycle bằng modulo nếu user thả nhiều measure hơn số màu.
const BAR_COLORS  = ['#f2c811', '#8a8d8f', '#b7a642', '#cfd1d2', '#e8973a', '#6b8fb5'];
const LINE_COLORS = ['#2f9e9e', '#a3b545', '#e8703a', '#6b5b95', '#4e79a7', '#c14b4b'];

const MARGIN = { top: 30, right: 56, left: 64 };
const CAT_LABEL_H = 44;   // chỗ cho nhãn category (xoay)
const GAP_UNITS   = 0.7;  // bề rộng khoảng trống giữa 2 group (đơn vị = 1 slot category)
const CAT_PAD     = 0.28; // padding hai bên trong 1 slot category (cho cụm cột)

/** @param {any} info */
function render(info) {
  const { encodedData, encodingMap, selectedMarkIds, width, height, styles, bgRgb, container } = info;
  container.innerHTML = '';

  // ---- GUARD: cần category + ít nhất 1 measure ở shelf Bars ----
  const hasCategory = encodedData.some((r) => r.category?.[0] != null);
  const hasBars = (encodingMap?.bars?.length ?? 0) > 0
    && encodedData.some((r) => r.bars?.some((dv) => dv?.value != null));
  if (!encodedData.length || !hasCategory || !hasBars) {
    const msg = document.createElement('div');
    msg.className = 'viz-empty';
    msg.textContent =
      'Drop 1 dimension on "Category", 1+ measure on "Bars" (left axis), and ' +
      '(optional) 1+ measure on "Lines" (right axis). Use "Group" to split into blocks.';
    container.appendChild(msg);
    return;
  }

  const barNames = (encodingMap?.bars ?? []).map((f, j) => f?.name ?? `Bars ${j + 1}`);
  const lineNames = (encodingMap?.lines ?? []).map((f, j) => f?.name ?? `Lines ${j + 1}`);
  const nBars = barNames.length;
  const hasGroup = (encodingMap?.group?.length ?? 0) > 0
    && encodedData.some((r) => r.group?.[0] != null);

  // ---- Chuẩn hoá rows. Giữ cả value (số, cho scale) và formattedValue (nhãn) ----
  const num = (dv) => {
    const n = Number(dv?.value);
    return Number.isFinite(n) ? n : null;
  };
  const rows = encodedData.map((r) => ({
    $tupleId: r.$tupleId,
    cat: r.category?.[0]?.formattedValue ?? '—',
    group: hasGroup ? (r.group?.[0]?.formattedValue ?? '—') : null,
    bars: (r.bars ?? []).map((dv) => ({ v: num(dv), f: dv?.formattedValue })),
    lines: (r.lines ?? []).map((dv) => ({ v: num(dv), f: dv?.formattedValue })),
  }));

  // ---- Gom row theo GROUP để cùng-group liền khối (super-group = khối ngoài) ----
  // Tableau thường trả row theo thứ tự CATEGORY (đan xen các group). Không gom lại thì
  // mỗi row đổi group → vạch đứt ở mọi cột + nhãn group đè lên nhau ở giữa chart.
  // sort ổn định (stable) nên thứ tự category TRONG mỗi group được giữ nguyên.
  if (hasGroup) {
    const groupOrder = [];
    rows.forEach((r) => { if (!groupOrder.includes(r.group)) groupOrder.push(r.group); });
    rows.sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group));
  }

  // ---- Bố cục dọc: legend đáy → group label → category label → vùng vẽ ----
  const fontFamily = styles?.['font-family'] || styles?.fontFamily || 'inherit';
  const textColor = styles?.color || '#333';

  const legend = buildLegend(barNames, lineNames, Math.max(0, width - MARGIN.left - MARGIN.right));
  const legendH = legend.rows * 18 + 10;
  const groupLabelH = hasGroup ? 20 : 0;

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(0, height - MARGIN.top - CAT_LABEL_H - groupLabelH - legendH);
  const plotTop = MARGIN.top;
  const plotBottom = plotTop + innerH;

  // ---- X: layout thủ công theo "unit" để chèn khoảng trống giữa các group ----
  // Mỗi row chiếm 1 unit; mỗi ranh giới group chèn thêm GAP_UNITS.
  const boundaries = rows.reduce(
    (acc, r, i) => acc + (i > 0 && r.group !== rows[i - 1].group ? 1 : 0),
    0
  );
  const totalUnits = rows.length + boundaries * GAP_UNITS;
  const unit = totalUnits > 0 ? innerW / totalUnits : innerW;

  let cursor = 0;
  const gaps = []; // vị trí x của các vạch đứt giữa group
  rows.forEach((r, i) => {
    if (i > 0 && r.group !== rows[i - 1].group) {
      gaps.push(MARGIN.left + (cursor + GAP_UNITS / 2) * unit);
      cursor += GAP_UNITS;
    }
    r._x0 = MARGIN.left + cursor * unit;      // mép trái slot
    r._center = r._x0 + unit / 2;             // tâm slot (điểm line)
    cursor += 1;
  });
  const catInnerW = unit * (1 - CAT_PAD);
  const clusterX = (r) => r._center - catInnerW / 2;
  const barW = nBars > 0 ? catInnerW / nBars : catInnerW;

  // ---- Y scales (độc lập) ----
  const barValues = rows.flatMap((r) => r.bars.map((b) => b.v)).filter((v) => v != null);
  const lineValues = rows.flatMap((r) => r.lines.map((b) => b.v)).filter((v) => v != null);
  const maxBar = d3.max(barValues) ?? 0;
  const minBar = d3.min(barValues) ?? 0;
  const yLeft = d3.scaleLinear()
    .domain([Math.min(0, minBar), Math.max(0, maxBar)]).nice()
    .range([plotBottom, plotTop]);

  const hasLines = lineNames.length > 0 && lineValues.length > 0;
  const maxLine = d3.max(lineValues) ?? 0;
  const minLine = d3.min(lineValues) ?? 0;
  const yRight = d3.scaleLinear()
    .domain([Math.min(0, minLine), Math.max(0, maxLine)]).nice()
    .range([plotBottom, plotTop]);

  // ---- Fog ----
  const fog = makeFog(bgRgb);
  const anySel = selectedMarkIds.size > 0;
  const barFill = (color, tupleId) =>
    anySel && !selectedMarkIds.has(tupleId) ? fog(color) : color;

  // ---- SVG ----
  const svg = d3.create('svg')
    .attr('class', 'tableau-worksheet')
    .attr('width', width).attr('height', height)
    .attr('viewBox', [0, 0, width, height])
    .style('font-family', fontFamily);

  // Trục trái (bars)
  svg.append('g')
    .attr('transform', `translate(${MARGIN.left},0)`)
    .call(d3.axisLeft(yLeft).ticks(5).tickFormat(d3.format('~s')))
    .attr('color', textColor)
    .selectAll('text').attr('class', 'axis-label').attr('fill', textColor);

  // Trục phải (lines) — chỉ khi có lines
  if (hasLines) {
    svg.append('g')
      .attr('transform', `translate(${MARGIN.left + innerW},0)`)
      .call(d3.axisRight(yRight).ticks(5))
      .attr('color', textColor)
      .selectAll('text').attr('class', 'axis-label').attr('fill', textColor);
  }

  const y0 = yLeft(0);

  // ---- BARS (mỗi bar mang $tupleId của row) ----
  const barData = [];
  rows.forEach((r) => {
    r.bars.forEach((b, j) => {
      if (b.v == null) return;
      barData.push({
        $tupleId: r.$tupleId,
        x: clusterX(r) + j * barW,
        v: b.v, f: b.f, color: BAR_COLORS[j % BAR_COLORS.length],
      });
    });
  });
  svg.append('g').selectAll('rect')
    .data(barData)
    .join('rect')
    .attr('class', 'bar')
    .each(function (d) { this.__data__ = d; }) // chắc chắn __data__ có $tupleId
    .attr('x', (d) => d.x)
    .attr('width', Math.max(0, barW - 1))
    .attr('y', (d) => Math.min(yLeft(d.v), y0))
    .attr('height', (d) => Math.abs(yLeft(d.v) - y0))
    .attr('fill', (d) => barFill(d.color, d.$tupleId));

  // Nhãn giá trị trên đầu cột (formattedValue của Tableau)
  svg.append('g').selectAll('text')
    .data(barData)
    .join('text')
    .attr('class', 'bar-label')
    .attr('x', (d) => d.x + barW / 2)
    .attr('y', (d) => Math.min(yLeft(d.v), y0) - 3)
    .attr('text-anchor', 'middle')
    .attr('fill', textColor)
    .text((d) => d.f ?? d3.format('~s')(d.v));

  // ---- LINES ----
  if (hasLines) {
    const lineGen = d3.line()
      .defined((d) => d.v != null)
      .x((d) => d._center)
      .y((d) => yRight(d.v));

    lineNames.forEach((name, j) => {
      const color = LINE_COLORS[j % LINE_COLORS.length];
      const pts = rows
        .map((r) => ({ _center: r._center, v: r.lines[j]?.v ?? null, f: r.lines[j]?.f, group: r.group, $tupleId: r.$tupleId }))
        .filter((p) => p.v != null);
      if (!pts.length) return;

      // Đường: nối theo thứ tự category, NHƯNG ngắt ở ranh giới group để line
      // không nhảy ngang qua vạch đứt. Vẽ 1 path cho mỗi khối group.
      const segments = hasGroup
        ? Object.values(pts.reduce((acc, p) => {
            (acc[p.group] ??= []).push(p);
            return acc;
          }, {}))
        : [pts];
      segments.forEach((seg) => {
        svg.append('path')
          .datum(seg)
          .attr('class', 'series-line')
          .attr('d', lineGen)
          .attr('stroke', color)
          .attr('stroke-width', 2.5)
          .attr('opacity', anySel ? 0.4 : 1);
      });

      // Điểm: mang $tupleId → click chọn / hover tooltip.
      svg.append('g').selectAll('circle')
        .data(pts)
        .join('circle')
        .attr('class', 'line-point')
        .each(function (d) { this.__data__ = d; })
        .attr('cx', (d) => d._center)
        .attr('cy', (d) => yRight(d.v))
        .attr('r', 3.5)
        .attr('fill', (d) => barFill(color, d.$tupleId));

      // Nhãn % trong ô bo góc (như hình)
      const labelG = svg.append('g');
      pts.forEach((d) => {
        const label = d.f ?? String(d.v);
        const cx = d._center;
        const cy = yRight(d.v) - 12;
        const w = label.length * 6.2 + 8;
        const gEl = labelG.append('g');
        gEl.append('rect')
          .attr('class', 'line-label-bg')
          .attr('x', cx - w / 2).attr('y', cy - 10)
          .attr('width', w).attr('height', 15).attr('rx', 3)
          .attr('fill', color).attr('opacity', anySel ? 0.18 : 0.16);
        gEl.append('text')
          .attr('class', 'line-label')
          .attr('x', cx).attr('y', cy + 1)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .text(label);
      });
    });
  }

  // ---- Nhãn category (xoay nhẹ) ----
  svg.append('g').selectAll('text')
    .data(rows)
    .join('text')
    .attr('class', 'axis-label')
    .attr('x', (r) => r._center)
    .attr('y', plotBottom + 14)
    .attr('text-anchor', 'end')
    .attr('fill', textColor)
    .attr('transform', (r) => `rotate(-15,${r._center},${plotBottom + 14})`)
    .text((r) => r.cat);

  // ---- Vạch đứt + nhãn group ----
  if (hasGroup) {
    gaps.forEach((gx) => {
      svg.append('line')
        .attr('x1', gx).attr('x2', gx)
        .attr('y1', plotTop).attr('y2', plotBottom)
        .attr('stroke', textColor).attr('stroke-dasharray', '4,4')
        .attr('opacity', 0.5);
    });
    // Nhãn group: đặt ở tâm khoảng x của các category cùng group.
    const groupSpans = {};
    rows.forEach((r) => {
      const s = groupSpans[r.group] ?? { min: Infinity, max: -Infinity, label: r.group };
      s.min = Math.min(s.min, r._x0);
      s.max = Math.max(s.max, r._x0 + unit);
      groupSpans[r.group] = s;
    });
    const gy = plotBottom + CAT_LABEL_H + 4;
    Object.values(groupSpans).forEach((s) => {
      svg.append('text')
        .attr('class', 'group-label')
        .attr('x', (s.min + s.max) / 2).attr('y', gy)
        .attr('text-anchor', 'middle')
        .attr('font-weight', 'bold')
        .attr('fill', textColor)
        .text(s.label);
    });
  }

  // ---- Legend (đáy) ----
  const legendY = height - legendH + 12;
  const legendG = svg.append('g');
  legend.items.forEach((it) => {
    const gx = MARGIN.left + it.x;
    const gy = legendY + it.row * 18;
    if (it.kind === 'bar') {
      legendG.append('rect')
        .attr('x', gx).attr('y', gy - 9).attr('width', 12).attr('height', 12).attr('rx', 2)
        .attr('fill', it.color);
    } else {
      legendG.append('line')
        .attr('x1', gx).attr('x2', gx + 12).attr('y1', gy - 3).attr('y2', gy - 3)
        .attr('stroke', it.color).attr('stroke-width', 3);
    }
    legendG.append('text')
      .attr('class', 'legend-label')
      .attr('x', gx + 16).attr('y', gy)
      .attr('fill', textColor)
      .text(it.name);
  });

  container.appendChild(svg.node());
}

/**
 * Tính bố cục legend: xếp trái→phải, wrap khi vượt bề rộng.
 * @param {string[]} barNames
 * @param {string[]} lineNames
 * @param {number} maxW
 */
function buildLegend(barNames, lineNames, maxW) {
  const entries = [
    ...barNames.map((name, j) => ({ kind: 'bar', name, color: BAR_COLORS[j % BAR_COLORS.length] })),
    ...lineNames.map((name, j) => ({ kind: 'line', name, color: LINE_COLORS[j % LINE_COLORS.length] })),
  ];
  const items = [];
  let x = 0, row = 0;
  const GAP = 22;
  for (const e of entries) {
    const w = 16 + e.name.length * 6.4 + GAP;
    if (x > 0 && x + w > maxW) { x = 0; row += 1; }
    items.push({ ...e, x, row });
    x += w;
  }
  return { items, rows: row + 1 };
}

window.onload = () => initExtension({ render, containerId: 'content' });
