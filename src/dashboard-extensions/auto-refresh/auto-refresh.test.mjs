// node --test src/dashboard-extensions/auto-refresh/auto-refresh.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampSeconds, collectDataSources, Countdown, formatSeconds, MIN_SECONDS, pickDataSources,
  refreshAll, uniqueDataSources,
} from './auto-refresh.js';

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

test('clampSeconds enforces the 5 s floor (not 300 s) and falls back on garbage', () => {
  assert.equal(MIN_SECONDS, 5);
  assert.equal(clampSeconds(5), 5);
  assert.equal(clampSeconds(15), 15);
  assert.equal(clampSeconds(3), MIN_SECONDS);
  assert.equal(clampSeconds('300'), 300);
  assert.equal(clampSeconds(10 ** 9), 86400);
  assert.equal(clampSeconds('abc'), 60);
  assert.equal(clampSeconds(-5, 30), 30);
  assert.equal(clampSeconds(12.6), 13);
});

test('formatSeconds renders s, m:ss and h:mm:ss', () => {
  assert.equal(formatSeconds(9), '9');
  assert.equal(formatSeconds(75), '1:15');
  assert.equal(formatSeconds(3661), '1:01:01');
  assert.equal(formatSeconds(-3), '0');
});

test('data sources are deduped across worksheets; empty selection = all', async () => {
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  assert.deepEqual(uniqueDataSources([[a, b], [a], []]), [a, b]);
  const dashboard = { worksheets: [{ getDataSourcesAsync: async () => [a, b] }, { getDataSourcesAsync: async () => [b] }] };
  assert.deepEqual(await collectDataSources(dashboard), [a, b]);
  assert.deepEqual(pickDataSources([a, b], []), [a, b]);
  assert.deepEqual(pickDataSources([a, b], ['b', 'gone']), [b]);
});

test('refreshAll: one failing data source does not block the others', async () => {
  let calls = 0;
  const ok = { id: 'ok', name: 'OK', refreshAsync: async () => { calls++; } };
  const bad = { id: 'bad', name: 'BAD', refreshAsync: async () => { calls++; throw new Error('x'); } };
  const { total, failed } = await refreshAll([ok, bad]);
  assert.equal(calls, 2);
  assert.equal(total, 2);
  assert.deepEqual(failed.map((f) => f.ds.name), ['BAD']);
});

test('Countdown never overlaps a slow refresh with the next one', async () => {
  let fires = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const cd = new Countdown({
    getSeconds: () => 3, tickMs: 5,
    onFire: async () => { fires++; concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent); await sleep(40); concurrent--; },
  });
  cd.start();
  await sleep(150);
  cd.stop();
  assert.ok(fires >= 2, `fires=${fires}`);
  assert.equal(maxConcurrent, 1);
});

test('Countdown pause holds the clock; resume continues', async () => {
  let fires = 0;
  const cd = new Countdown({ getSeconds: () => 2, tickMs: 5, onFire: async () => { fires++; } });
  cd.start();
  cd.togglePause();
  await sleep(60);
  assert.equal(fires, 0);
  assert.equal(cd.left, 2);
  cd.togglePause();
  await sleep(40);
  assert.ok(fires >= 1);
  cd.stop();
});

test('Countdown fires immediately when a hidden tab returns after the deadline', async () => {
  let fires = 0;
  const cd = new Countdown({ getSeconds: () => 5, tickMs: 1000, onFire: async () => { fires++; } });
  cd.start();
  cd.setSuspended(true);
  cd.left = 0;
  cd.setSuspended(false);
  await sleep(5);
  assert.equal(fires, 1);
  assert.equal(cd.left, 5);
  cd.stop();
});

test('Countdown reset picks up a new interval; stop during refresh does not reschedule', async () => {
  let secs = 100;
  const ticks = [];
  const cd = new Countdown({ getSeconds: () => secs, tickMs: 1000, onFire: async () => {}, onTick: (l, t) => ticks.push([l, t]) });
  secs = 20;
  cd.reset();
  assert.equal(cd.left, 20);
  assert.deepEqual(ticks.at(-1), [20, 20]);
  cd.stop();

  let fires = 0;
  const cd2 = new Countdown({ getSeconds: () => 1, tickMs: 5, onFire: async () => { fires++; await sleep(30); } });
  cd2.start();
  await sleep(12);
  cd2.stop();
  await sleep(80);
  assert.equal(fires, 1);
});
