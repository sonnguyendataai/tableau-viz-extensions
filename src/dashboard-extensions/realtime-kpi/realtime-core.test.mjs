// node --test src/dashboard-extensions/realtime-kpi/realtime-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampSeconds, GroupScheduler, inActiveHours, mapWorksheets, MIN_SECONDS, resolveGroups } from './realtime-core.js';

test('clampSeconds enforces the 15 s floor and falls back on garbage', () => {
  assert.equal(clampSeconds(5), MIN_SECONDS);
  assert.equal(clampSeconds('90'), 90);
  assert.equal(clampSeconds('abc'), 60);
  assert.equal(clampSeconds(10 ** 9), 86400);
});

test('mapWorksheets dedupes data sources shared by several worksheets', () => {
  const live = { id: 'L', name: 'KPI realtime', isExtract: false };
  const ext = { id: 'E', name: 'Mart QTĐH', isExtract: true };
  const { dataSources, worksheetsByDs } = mapWorksheets([
    { name: 'HĐV tile', dataSources: [live] }, { name: 'Dư nợ tile', dataSources: [live] }, { name: 'Mix', dataSources: [ext] },
  ]);
  assert.deepEqual(dataSources.map((d) => d.id), ['L', 'E']);
  assert.deepEqual(worksheetsByDs.get('L'), ['HĐV tile', 'Dư nợ tile']);
});

test('resolveGroups keeps only configured data sources still on the dashboard', () => {
  const ds = [{ id: 'L', name: 'KPI realtime', isExtract: false }, { id: 'E', name: 'Mart', isExtract: true }];
  const groups = resolveGroups(
    [{ dsId: 'L', seconds: 30, label: 'Huy động' }, { dsId: 'GONE', seconds: 30 }, { dsId: 'L', seconds: 99 }, null],
    ds, new Map([['L', ['HĐV tile']]]));
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], { dsId: 'L', name: 'KPI realtime', label: 'Huy động', seconds: 30, isExtract: false, worksheets: ['HĐV tile'] });
  // the extract data source "E" is not configured → never refreshed (its KPIs stay unchanged)
  assert.equal(groups.some((g) => g.dsId === 'E'), false);
});

test('inActiveHours: empty = always, normal and overnight windows', () => {
  const at = (h, m) => new Date(2026, 9, 15, h, m);
  assert.equal(inActiveHours(at(3, 0), '', ''), true);
  assert.equal(inActiveHours(at(9, 0), '08:00', '17:30'), true);
  assert.equal(inActiveHours(at(18, 0), '08:00', '17:30'), false);
  assert.equal(inActiveHours(at(23, 0), '22:00', '02:00'), true);
  assert.equal(inActiveHours(at(12, 0), '22:00', '02:00'), false);
});

/** Fake clock + manual timer so the scheduler is deterministic. */
function harness(groups, refreshImpl) {
  let now = 0; let pending = null;
  const calls = [];
  const s = new GroupScheduler({
    groups,
    refresh: async (g) => { calls.push({ id: g.dsId, at: now }); await refreshImpl(g); },
    now: () => now,
    setTimer: (fn) => { pending = fn; return 1; },
    clearTimer: () => { pending = null; },
    tickMs: 1000,
  });
  const advance = async (secs) => {
    for (let i = 0; i < secs; i++) { now += 1000; const fn = pending; pending = null; fn?.(); await new Promise((r) => setImmediate(r)); }
  };
  return { s, calls, advance, get now() { return now; } };
}

const G = (dsId, seconds) => ({ dsId, name: dsId, label: dsId, seconds, isExtract: false, worksheets: [] });

test('each group fires on its own interval; others untouched', async () => {
  const h = harness([G('A', 15), G('B', 60)], async () => {});
  h.s.start();
  await h.advance(61);
  const a = h.calls.filter((c) => c.id === 'A').length;
  const b = h.calls.filter((c) => c.id === 'B').length;
  assert.ok(a >= 3 && a <= 4, `A fired ${a}×`);
  assert.equal(b, 0, 'B (60 s + 3 s stagger) not yet due at t=61 s');
  await h.advance(5);
  assert.equal(h.calls.filter((c) => c.id === 'B').length, 1);
});

test('a slow refresh is never overlapped; next due counts from completion', async () => {
  let release;
  const h = harness([G('A', 15)], () => new Promise((r) => { release = r; }));
  h.s.start();
  await h.advance(20);              // fired at t=15, still running
  assert.equal(h.calls.length, 1);
  await h.advance(30);              // still running → no second call
  assert.equal(h.calls.length, 1);
  release();
  await h.advance(1);               // finished at t≈51 → next due ≈66
  await h.advance(10);
  assert.equal(h.calls.length, 1);
  await h.advance(6);
  assert.equal(h.calls.length, 2);
});

test('paused / hidden: nothing fires; errors are recorded and retried', async () => {
  let fail = true;
  const h = harness([G('A', 15)], async () => { if (fail) throw new Error('timeout'); });
  h.s.start();
  h.s.togglePause();
  await h.advance(40);
  assert.equal(h.calls.length, 0);
  h.s.togglePause();
  await h.advance(1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.s.state[0].lastError, 'timeout');
  fail = false;
  h.s.setHidden(true);
  await h.advance(30);
  assert.equal(h.calls.length, 1);
  h.s.setHidden(false);
  await h.advance(1);
  assert.equal(h.calls.length, 2);
  assert.equal(h.s.state[0].lastError, '');
  assert.equal(h.s.state[0].refreshCount, 1);
});
