// @ts-check
/* global tableau */

/**
 * auto-refresh.js — DASHBOARD EXTENSION: tự refresh data source của dashboard theo chu kỳ.
 *
 * Viết mới, thay cho "Auto Refresh" (Starschema) trên Tableau Exchange — bản đó khoá
 * chu kỳ tối thiểu 300s NGAY TRONG extension (configure.html min="300"). Tableau API
 * không có giới hạn đó; ở đây floor = MIN_SECONDS (10s) để không dội tải lên Server.
 *
 * KHÁC các viz trong src/vizzes/: đây là dashboard extension (dashboardContent), KHÔNG
 * dùng src/core/ (core chỉ phục vụ worksheet extension).
 *
 * Cơ chế:
 *   - Mỗi chu kỳ: gom data source của mọi worksheet trên dashboard (khử trùng theo id),
 *     lọc theo danh sách user chọn (rỗng = tất cả) → refreshAsync() song song.
 *   - Đếm ngược CHỈ chạy lại SAU KHI lượt refresh trước xong → không chồng request khi
 *     refresh chậm hơn chu kỳ.
 *   - Tab bị ẩn (document.hidden) → tạm dừng; hiện lại mà đã quá hạn → refresh ngay.
 *   - Click vòng đếm ngược → tạm dừng / tiếp tục.
 *   - Parameter tên `autoRefresh_seconds` (nếu có trong workbook) GHI ĐÈ chu kỳ đã cấu
 *     hình — tương thích cách dùng của bản Starschema.
 *
 * Lưu ý (từ docs refreshAsync): tương đương bấm Refresh data source — KHÔNG refresh
 * extract trên Server. Refresh quá dày có thể bị admin Tableau Cloud chặn.
 */

export const MIN_SECONDS = 10;
export const MAX_SECONDS = 24 * 60 * 60;
export const DEFAULT_SECONDS = 60;
export const PARAM_NAME = 'autoRefresh_seconds';

const SETTINGS = {
  seconds:       'autoRefresh.seconds',
  datasourceIds: 'autoRefresh.datasourceIds', // JSON mảng id; rỗng/thiếu = tất cả
};

/** Ép giá trị bất kỳ về số giây nguyên trong [MIN_SECONDS, MAX_SECONDS]. */
export function clampSeconds(value, fallback = DEFAULT_SECONDS) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, n));
}

/** "75" → "1:15", "9" → "9". */
export function formatSeconds(secs) {
  const s = Math.max(0, Math.ceil(secs));
  if (s < 60) return String(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Khử trùng data source theo id (nhiều worksheet dùng chung 1 nguồn). */
export function uniqueDataSources(lists) {
  const byId = new Map();
  lists.flat().forEach((ds) => { if (ds && !byId.has(ds.id)) byId.set(ds.id, ds); });
  return [...byId.values()];
}

/** selectedIds rỗng = tất cả; id đã chọn nhưng không còn trên dashboard thì bỏ qua. */
export function pickDataSources(all, selectedIds) {
  if (!selectedIds || selectedIds.length === 0) return all;
  const wanted = new Set(selectedIds);
  return all.filter((ds) => wanted.has(ds.id));
}

/** @param {any} dashboard */
export async function collectDataSources(dashboard) {
  const lists = await Promise.all(dashboard.worksheets.map((ws) => ws.getDataSourcesAsync()));
  return uniqueDataSources(lists);
}

/** Refresh song song; 1 nguồn lỗi không chặn nguồn khác. */
export async function refreshAll(dataSources) {
  const results = await Promise.allSettled(dataSources.map((ds) => ds.refreshAsync()));
  const failed = [];
  results.forEach((r, i) => { if (r.status === 'rejected') failed.push({ ds: dataSources[i], error: r.reason }); });
  return { total: dataSources.length, failed };
}

/**
 * Bộ đếm ngược. Mỗi `tickMs` trừ 1 giây; về 0 → await onFire() → mới đếm lại từ đầu.
 * Không phụ thuộc DOM/tableau → test được bằng Node.
 */
export class Countdown {
  /**
   * @param {{ getSeconds: () => number, onFire: () => Promise<void>,
   *           onTick?: (left: number, total: number) => void, tickMs?: number }} opts
   */
  constructor({ getSeconds, onFire, onTick = () => {}, tickMs = 1000 }) {
    this.getSeconds = getSeconds;
    this.onFire = onFire;
    this.onTick = onTick;
    this.tickMs = tickMs;
    this.left = getSeconds();
    this.paused = false;   // do user click
    this.suspended = false; // do tab ẩn
    this.firing = false;
    this.stopped = true;
    this.timer = null;
  }

  start() { this.stopped = false; this._schedule(); this.onTick(this.left, this.getSeconds()); }

  stop() { this.stopped = true; clearTimeout(this.timer); this.timer = null; }

  /** Đổi chu kỳ: đếm lại từ đầu với giá trị mới. */
  reset() { this.left = this.getSeconds(); this.onTick(this.left, this.getSeconds()); }

  togglePause() { this.paused = !this.paused; this.onTick(this.left, this.getSeconds()); }

  /** Tab ẩn/hiện. Hiện lại mà đã về 0 trong lúc ẩn → bắn ngay. */
  setSuspended(hidden) {
    this.suspended = hidden;
    if (!hidden && !this.stopped && this.left <= 0 && !this.firing) this._fire();
  }

  get running() { return !this.paused && !this.suspended; }

  _schedule() {
    clearTimeout(this.timer);
    if (this.stopped) return; // stop() giữa lúc đang refresh → không đặt lịch lại
    this.timer = setTimeout(() => this._tick(), this.tickMs);
  }

  _tick() {
    if (this.running && !this.firing) {
      this.left -= 1;
      this.onTick(this.left, this.getSeconds());
      if (this.left <= 0) { this._fire(); return; }
    }
    this._schedule();
  }

  async _fire() {
    this.firing = true;
    clearTimeout(this.timer);
    try {
      await this.onFire();
    } finally {
      this.firing = false;
      this.left = this.getSeconds();
      this.onTick(this.left, this.getSeconds());
      this._schedule();
    }
  }
}

/* =====================================================================
 * PHẦN CHẠY TRONG TABLEAU (DOM + Extensions API)
 * ===================================================================== */

function readSetting(key, fallback) {
  try {
    const v = tableau.extensions.settings.get(key);
    return v == null || v === '' ? fallback : v;
  } catch (_e) {
    return fallback;
  }
}

function readSelectedIds() {
  try {
    const ids = JSON.parse(readSetting(SETTINGS.datasourceIds, '[]'));
    return Array.isArray(ids) ? ids : [];
  } catch (_e) {
    return [];
  }
}

const state = {
  /** @type {number | null} giá trị từ parameter autoRefresh_seconds (ghi đè settings) */
  paramSeconds: null,
  /** @type {Countdown | null} */
  countdown: null,
  lastRun: '',
  lastError: '',
};

function effectiveSeconds() {
  if (state.paramSeconds != null) return state.paramSeconds;
  return clampSeconds(readSetting(SETTINGS.seconds, DEFAULT_SECONDS));
}

async function runRefresh() {
  const dashboard = tableau.extensions.dashboardContent.dashboard;
  try {
    const targets = pickDataSources(await collectDataSources(dashboard), readSelectedIds());
    const { total, failed } = await refreshAll(targets);
    state.lastRun = new Date().toLocaleTimeString();
    state.lastError = failed.length
      ? `${failed.length}/${total} nguồn lỗi: ${failed.map((f) => f.ds.name).join(', ')}`
      : '';
    // eslint-disable-next-line no-console
    failed.forEach((f) => console.error('[auto-refresh] refresh lỗi', f.ds.name, f.error));
  } catch (err) {
    state.lastError = String((err && err.message) || err);
    // eslint-disable-next-line no-console
    console.error('[auto-refresh] refresh lỗi', err);
  }
}

/* --- Vòng đếm ngược (SVG thuần, co giãn theo zone) --- */
const RING_R = 42;
const RING_LEN = 2 * Math.PI * RING_R;

function drawTick(left, total) {
  const cd = state.countdown;
  const arc = document.getElementById('ring-arc');
  const label = document.getElementById('ring-label');
  const sub = document.getElementById('ring-sub');
  const status = document.getElementById('status');
  if (!arc || !label || !sub || !status) return;

  const frac = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  arc.setAttribute('stroke-dashoffset', String(RING_LEN * (1 - frac)));

  if (cd && cd.firing) {
    label.textContent = '⟳';
    sub.textContent = 'đang tải';
  } else if (cd && cd.paused) {
    label.textContent = formatSeconds(left);
    sub.textContent = 'tạm dừng';
  } else {
    label.textContent = formatSeconds(left);
    sub.textContent = state.paramSeconds != null ? `${PARAM_NAME}` : `mỗi ${formatSeconds(total)}s`;
  }
  document.body.classList.toggle('is-paused', !!(cd && cd.paused));
  document.body.classList.toggle('has-error', !!state.lastError);

  status.textContent = state.lastError || (state.lastRun ? `Cập nhật lúc ${state.lastRun}` : '');
  status.title = state.lastError || '';
}

/* --- Parameter autoRefresh_seconds (tuỳ chọn) --- */
async function watchParameter(dashboard) {
  let param;
  try {
    param = await dashboard.findParameterAsync(PARAM_NAME);
  } catch (_e) {
    return;
  }
  if (!param) return;

  const apply = (p) => {
    state.paramSeconds = clampSeconds(p.currentValue?.value, effectiveSeconds());
    state.countdown?.reset();
  };
  apply(param);
  param.addEventListener(tableau.TableauEventType.ParameterChanged, (ev) =>
    ev.getParameterAsync().then(apply));
}

/* --- CONFIGURE... --- */
async function openConfig() {
  const dashboard = tableau.extensions.dashboardContent.dashboard;
  let dataSources = [];
  try {
    dataSources = await collectDataSources(dashboard);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[auto-refresh] không lấy được data source', err);
  }

  const payload = JSON.stringify({
    seconds: clampSeconds(readSetting(SETTINGS.seconds, DEFAULT_SECONDS)),
    selectedIds: readSelectedIds(),
    dataSources: dataSources.map((ds) => ({ id: ds.id, name: ds.name, isExtract: ds.isExtract })),
    paramActive: state.paramSeconds != null,
    limits: { min: MIN_SECONDS, max: MAX_SECONDS, default: DEFAULT_SECONDS },
  });

  tableau.extensions.ui
    .displayDialogAsync('./auto-refresh-config.html', payload, { width: 420, height: 480 })
    .then((closePayload) => {
      if (!closePayload) return; // Cancel → giữ cấu hình cũ
      let cfg;
      try { cfg = JSON.parse(closePayload); } catch (_e) { return; }
      tableau.extensions.settings.set(SETTINGS.seconds, String(clampSeconds(cfg.seconds)));
      tableau.extensions.settings.set(SETTINGS.datasourceIds,
        JSON.stringify(Array.isArray(cfg.selectedIds) ? cfg.selectedIds : []));
      return tableau.extensions.settings.saveAsync().then(() => state.countdown?.reset());
    })
    .catch((err) => {
      if (err && err.errorCode === tableau.ErrorCodes.DialogClosedByUser) return;
      // eslint-disable-next-line no-console
      console.error('[auto-refresh] config dialog error', err);
    });
}

async function init() {
  await tableau.extensions.initializeAsync({ configure: openConfig });
  const dashboard = tableau.extensions.dashboardContent.dashboard;

  state.countdown = new Countdown({
    getSeconds: effectiveSeconds,
    onFire: async () => { drawTick(0, effectiveSeconds()); await runRefresh(); },
    onTick: drawTick,
  });

  await watchParameter(dashboard);

  document.getElementById('ring')?.addEventListener('click', () => state.countdown?.togglePause());
  document.addEventListener('visibilitychange', () => state.countdown?.setSuspended(document.hidden));
  // Settings đổi từ nơi khác (vd. tác giả lưu ở Desktop) → đếm lại với chu kỳ mới.
  tableau.extensions.settings.addEventListener(tableau.TableauEventType.SettingsChanged,
    () => state.countdown?.reset());

  state.countdown.start();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.onload = () => init().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[auto-refresh] init lỗi', err);
    const status = document.getElementById('status');
    if (status) status.textContent = `Lỗi khởi tạo: ${(err && err.message) || err}`;
  });
}
