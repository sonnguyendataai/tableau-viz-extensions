// @ts-check
/**
 * realtime-core.js — pure logic of the "Realtime KPI" dashboard extension (no DOM, no `tableau` global),
 * so it runs under Node for tests (realtime-core.test.mjs).
 *
 * Model: a dashboard mixes data sources. The author marks SOME of them "realtime" and gives each its own
 * refresh interval; the extension calls DataSource.refreshAsync() only on those. Worksheets built on any
 * other data source keep their data — that is how "only some KPIs refresh" is achieved: put the realtime
 * KPIs on their own (live) data source.
 */

export const MIN_SECONDS = 15;          // floor: refreshAsync is not meant for streaming (Extensions API docs)
export const WARN_BELOW_SECONDS = 60;   // config dialog warns below this
export const MAX_SECONDS = 24 * 60 * 60;
export const DEFAULT_SECONDS = 60;
export const STAGGER_SECONDS = 3;       // groups start a few seconds apart, never all at once

/** Any value → integer seconds in [MIN_SECONDS, MAX_SECONDS]. */
export function clampSeconds(value, fallback = DEFAULT_SECONDS) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, n));
}

/**
 * @typedef {{ id: string, name: string, isExtract?: boolean }} DsInfo
 * @typedef {{ dsId: string, seconds: number, label?: string }} GroupSetting   saved in workbook settings
 * @typedef {{ dsId: string, name: string, label: string, seconds: number, isExtract: boolean,
 *             worksheets: string[] }} Group                                   resolved against the dashboard
 */

/**
 * Saved settings + data sources found on the dashboard → active groups. A saved group whose data source
 * is no longer on the dashboard is dropped (not an error); duplicates keep the first entry.
 * @param {unknown} saved
 * @param {DsInfo[]} dataSources
 * @param {Map<string, string[]>} worksheetsByDs
 * @returns {Group[]}
 */
export function resolveGroups(saved, dataSources, worksheetsByDs) {
  const byId = new Map(dataSources.map((d) => [d.id, d]));
  const seen = new Set();
  const out = [];
  for (const g of Array.isArray(saved) ? saved : []) {
    if (!g || typeof g !== 'object') continue;
    const dsId = String(/** @type {any} */ (g).dsId ?? '');
    const ds = byId.get(dsId);
    if (!ds || seen.has(dsId)) continue;
    seen.add(dsId);
    const label = String(/** @type {any} */ (g).label ?? '').trim();
    out.push({
      dsId,
      name: ds.name,
      label: label || ds.name,
      seconds: clampSeconds(/** @type {any} */ (g).seconds),
      isExtract: !!ds.isExtract,
      worksheets: worksheetsByDs.get(dsId) ?? [],
    });
  }
  return out;
}

/**
 * Worksheet → data sources lists → data-source id → worksheet names (a data source shared by several
 * sheets is refreshed once and listed with all of them).
 * @param {{ name: string, dataSources: DsInfo[] }[]} sheets
 */
export function mapWorksheets(sheets) {
  /** @type {Map<string, DsInfo>} */ const ds = new Map();
  /** @type {Map<string, string[]>} */ const byDs = new Map();
  for (const s of sheets) {
    for (const d of s.dataSources) {
      if (!ds.has(d.id)) ds.set(d.id, d);
      const list = byDs.get(d.id) ?? [];
      if (!list.includes(s.name)) list.push(s.name);
      byDs.set(d.id, list);
    }
  }
  return { dataSources: [...ds.values()], worksheetsByDs: byDs };
}

/**
 * "HH:MM" window check. Empty / malformed bounds = always active. A window may cross midnight
 * (e.g. 22:00–02:00).
 * @param {Date} now
 * @param {string | undefined} from
 * @param {string | undefined} to
 */
export function inActiveHours(now, from, to) {
  const parse = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
    if (!m) return null;
    const h = Number(m[1]); const mi = Number(m[2]);
    return h < 24 && mi < 60 ? h * 60 + mi : null;
  };
  const a = parse(from); const b = parse(to);
  if (a == null || b == null || a === b) return true;
  const t = now.getHours() * 60 + now.getMinutes();
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/** 75 → "1:15", 9 → "9s", 3600 → "1:00:00". */
export function formatSeconds(secs) {
  const s = Math.max(0, Math.ceil(secs));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/**
 * One timer per group, driven by a single tick. A group fires when due; while its refresh is running it
 * is never fired again (no overlapping requests when a refresh is slower than its interval); its next due
 * time is counted from when the refresh FINISHED. Clock and timer are injectable for tests.
 */
export class GroupScheduler {
  /**
   * @param {{ groups: Group[], refresh: (g: Group) => Promise<void>,
   *           onChange?: (state: GroupState[]) => void, isActive?: () => boolean,
   *           now?: () => number, setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (h: any) => void,
   *           tickMs?: number }} opts
   */
  constructor(opts) {
    this.refresh = opts.refresh;
    this.onChange = opts.onChange ?? (() => {});
    this.isActive = opts.isActive ?? (() => true);
    this.now = opts.now ?? (() => Date.now());
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));
    this.tickMs = opts.tickMs ?? 1000;
    this.paused = false;
    this.hidden = false;
    this.timer = null;
    /** @type {GroupState[]} */
    this.state = [];
    this.setGroups(opts.groups);
  }

  /** Replace the groups (config changed). Keeps last-refresh info of groups that stay. */
  setGroups(groups) {
    const prev = new Map(this.state.map((s) => [s.group.dsId, s]));
    const t = this.now();
    this.state = groups.map((g, i) => {
      const p = prev.get(g.dsId);
      return {
        group: g,
        dueAt: p && p.group.seconds === g.seconds ? p.dueAt : t + (g.seconds + i * STAGGER_SECONDS) * 1000,
        running: false,
        lastOkAt: p?.lastOkAt ?? null,
        lastError: p?.lastError ?? '',
        refreshCount: p?.refreshCount ?? 0,
      };
    });
    this.onChange(this.state);
  }

  start() { this.stop(); this._schedule(); this.onChange(this.state); }
  stop() { if (this.timer != null) this.clearTimer(this.timer); this.timer = null; }

  /** Pause/resume by the viewer (click). Resuming does not fire at once; timers continue. */
  togglePause() { this.paused = !this.paused; this.onChange(this.state); }

  /** Browser tab hidden/visible. Coming back with an overdue group fires it on the next tick. */
  setHidden(hidden) { this.hidden = hidden; }

  get running() { return !this.paused && !this.hidden && this.isActive(); }

  /** Refresh every group now (button), then restart their timers. */
  async refreshAllNow() {
    await Promise.all(this.state.map((s) => this._fire(s)));
  }

  /** Seconds left before the group is due (0 when due or running). */
  secondsLeft(s) { return s.running ? 0 : Math.max(0, (s.dueAt - this.now()) / 1000); }

  _schedule() { this.timer = this.setTimer(() => this._tick(), this.tickMs); }

  _tick() {
    if (this.running) {
      const t = this.now();
      for (const s of this.state) {
        if (!s.running && t >= s.dueAt) void this._fire(s);
      }
    }
    this.onChange(this.state);
    this._schedule();
  }

  /** @param {GroupState} s */
  async _fire(s) {
    if (s.running) return;
    s.running = true;
    this.onChange(this.state);
    try {
      await this.refresh(s.group);
      s.lastOkAt = this.now();
      s.lastError = '';
      s.refreshCount += 1;
    } catch (err) {
      s.lastError = String((err && /** @type {any} */ (err).message) || err);
    } finally {
      s.running = false;
      s.dueAt = this.now() + s.group.seconds * 1000;
      this.onChange(this.state);
    }
  }
}

/**
 * @typedef {{ group: Group, dueAt: number, running: boolean, lastOkAt: number | null, lastError: string,
 *             refreshCount: number }} GroupState
 */
