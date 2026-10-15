// @ts-check
/* global tableau */

/**
 * realtime-kpi.js — DASHBOARD EXTENSION "Realtime KPI": refresh ONLY the data sources the author marked
 * as realtime, each on its own interval. Worksheets on other data sources are never touched, so their
 * numbers stay as they were loaded.
 *
 * How to use (author, Tableau Desktop or web edit):
 *   1. Build the realtime KPIs on their own data source (live connection, e.g. ClickHouse);
 *      keep the other KPIs on the existing extract.
 *   2. Drag an Extension object onto the dashboard → this .trex → Configure… → tick the realtime
 *      data source(s), set an interval per data source, optional active hours.
 *
 * What a refresh does: DataSource.refreshAsync() = the "Refresh" command on that data source — Tableau
 * re-queries it, bypassing the cache. It does NOT refresh an extract on Server (Extensions API docs), so a
 * realtime data source must be a LIVE connection. Every open dashboard refreshes on its own: N viewers ×
 * one query per interval hit the source — size intervals accordingly (min 15 s here).
 */

import { clampSeconds, formatSeconds, GroupScheduler, inActiveHours, mapWorksheets, resolveGroups } from './realtime-core.js';

const SETTINGS = {
  groups: 'realtimeKpi.groups',          // JSON [{ dsId, seconds, label }]
  activeFrom: 'realtimeKpi.activeFrom',  // "HH:MM" or ""
  activeTo: 'realtimeKpi.activeTo',
};

function readSetting(key, fallback = '') {
  try {
    const v = tableau.extensions.settings.get(key);
    return v == null ? fallback : v;
  } catch (_e) {
    return fallback;
  }
}

function readSavedGroups() {
  try {
    const v = JSON.parse(readSetting(SETTINGS.groups, '[]'));
    return Array.isArray(v) ? v : [];
  } catch (_e) {
    return [];
  }
}

/** Data sources of every worksheet on the dashboard + which worksheets use each. */
async function scanDashboard() {
  const dashboard = tableau.extensions.dashboardContent.dashboard;
  const sheets = await Promise.all(dashboard.worksheets.map(async (ws) => ({
    name: ws.name,
    dataSources: (await ws.getDataSourcesAsync()).map((d) => ({ id: d.id, name: d.name, isExtract: d.isExtract, _ds: d })),
  })));
  const { dataSources, worksheetsByDs } = mapWorksheets(sheets);
  /** @type {Map<string, any>} */
  const handles = new Map();
  sheets.forEach((s) => s.dataSources.forEach((d) => handles.set(d.id, d._ds)));
  return { dataSources, worksheetsByDs, handles };
}

const state = {
  /** @type {GroupScheduler | null} */ scheduler: null,
  /** @type {Map<string, any>} */ handles: new Map(),
};

/* ----------------------------------------------------------------- UI --- */

function fmtTime(ms) {
  return ms == null ? '—' : new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function render(groupStates) {
  const s = state.scheduler;
  const list = document.getElementById('groups');
  const head = document.getElementById('head-status');
  if (!list || !head || !s) return;
  const active = inActiveHours(new Date(), readSetting(SETTINGS.activeFrom), readSetting(SETTINGS.activeTo));
  document.body.classList.toggle('is-paused', s.paused || !active);
  head.textContent = s.paused ? 'Tạm dừng' : !active ? 'Ngoài giờ cập nhật' : groupStates.length ? 'Đang cập nhật' : 'Chưa cấu hình';

  if (groupStates.length === 0) {
    list.innerHTML = '<div class="empty">Chưa chọn nguồn dữ liệu realtime. Tác giả: menu của object → Configure…</div>';
    return;
  }
  list.replaceChildren(...groupStates.map((g) => {
    const row = document.createElement('div');
    row.className = 'row' + (g.lastError ? ' err' : '') + (g.running ? ' busy' : '');
    const dot = document.createElement('span'); dot.className = 'dot';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = g.group.label;
    name.title = `${g.group.name} · ${g.group.worksheets.join(', ')}`;
    const meta = document.createElement('span'); meta.className = 'meta';
    meta.textContent = g.running ? 'đang tải…'
      : g.lastError ? `lỗi · thử lại sau ${formatSeconds(s.secondsLeft(g))}`
      : `${fmtTime(g.lastOkAt)} · tiếp ${formatSeconds(s.secondsLeft(g))}`;
    meta.title = g.lastError || `Chu kỳ ${formatSeconds(g.group.seconds)}${g.group.isExtract ? ' · CẢNH BÁO: nguồn extract — refresh không cập nhật extract trên Server' : ''}`;
    row.append(dot, name, meta);
    return row;
  }));
}

/* ------------------------------------------------------------- config --- */

async function openConfig() {
  const { dataSources, worksheetsByDs } = await scanDashboard();
  const payload = JSON.stringify({
    groups: readSavedGroups(),
    activeFrom: readSetting(SETTINGS.activeFrom),
    activeTo: readSetting(SETTINGS.activeTo),
    dataSources: dataSources.map((d) => ({ ...d, worksheets: worksheetsByDs.get(d.id) ?? [] })),
  });
  try {
    const closed = await tableau.extensions.ui.displayDialogAsync('./realtime-kpi-config.html', payload, { width: 560, height: 560 });
    if (!closed) return;
    const cfg = JSON.parse(closed);
    const groups = (Array.isArray(cfg.groups) ? cfg.groups : []).map((g) => ({
      dsId: String(g.dsId), seconds: clampSeconds(g.seconds), label: String(g.label ?? '').slice(0, 60),
    }));
    tableau.extensions.settings.set(SETTINGS.groups, JSON.stringify(groups));
    tableau.extensions.settings.set(SETTINGS.activeFrom, String(cfg.activeFrom ?? ''));
    tableau.extensions.settings.set(SETTINGS.activeTo, String(cfg.activeTo ?? ''));
    await tableau.extensions.settings.saveAsync();
    await reload();
  } catch (err) {
    if (err && err.errorCode === tableau.ErrorCodes.DialogClosedByUser) return;
    // eslint-disable-next-line no-console
    console.error('[realtime-kpi] config', err);
  }
}

/* --------------------------------------------------------------- main --- */

async function reload() {
  const { dataSources, worksheetsByDs, handles } = await scanDashboard();
  state.handles = handles;
  const groups = resolveGroups(readSavedGroups(), dataSources, worksheetsByDs);
  state.scheduler?.setGroups(groups);
}

async function init() {
  await tableau.extensions.initializeAsync({ configure: openConfig });
  const { dataSources, worksheetsByDs, handles } = await scanDashboard();
  state.handles = handles;

  state.scheduler = new GroupScheduler({
    groups: resolveGroups(readSavedGroups(), dataSources, worksheetsByDs),
    refresh: async (g) => {
      const ds = state.handles.get(g.dsId);
      if (!ds) throw new Error('Không tìm thấy nguồn dữ liệu trên dashboard');
      await ds.refreshAsync();
    },
    onChange: render,
    isActive: () => inActiveHours(new Date(), readSetting(SETTINGS.activeFrom), readSetting(SETTINGS.activeTo)),
  });

  document.getElementById('pause')?.addEventListener('click', () => state.scheduler?.togglePause());
  document.getElementById('now')?.addEventListener('click', () => void state.scheduler?.refreshAllNow());
  document.addEventListener('visibilitychange', () => state.scheduler?.setHidden(document.hidden));
  tableau.extensions.settings.addEventListener(tableau.TableauEventType.SettingsChanged, () => void reload());

  state.scheduler.start();
}

window.addEventListener('load', () => {
  init().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[realtime-kpi] init', err);
    const head = document.getElementById('head-status');
    if (head) head.textContent = `Lỗi khởi tạo: ${(err && err.message) || err}`;
  });
});
