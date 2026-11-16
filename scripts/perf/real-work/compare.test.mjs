import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compareRuns, excludedLabels } from './compare.mjs';

const result = (busy, extra = {}) => ({
  label: 'thread-open-chromium-4x-25s',
  metrics: { busy },
  ...extra,
});

test('median busy of two runs per side, change and no overlap', () => {
  const rows = compareRuns([[result(0.4)], [result(0.5)]], [[result(0.2)], [result(0.25)]]);
  assert.deepEqual(rows, [
    {
      label: 'thread-open-chromium-4x-25s',
      metric: 'metrics.busy',
      base: 0.45,
      head: 0.225,
      changePct: -50,
      overlap: false,
    },
  ]);
});

test('overlap when the head range meets the base range', () => {
  const rows = compareRuns([[result(0.4)], [result(0.5)]], [[result(0.45)], [result(0.6)]]);
  assert.equal(rows[0].overlap, true);
});

test('timings are medians per name, then across runs', () => {
  const run = (a, b) => [
    result(0.1, {
      timings: [
        { name: 'open', ms: a },
        { name: 'open', ms: b },
        { name: 'open', ms: a + b },
      ],
    }),
  ];
  const rows = compareRuns([run(100, 300)], [run(50, 150)]);
  const row = rows.find((r) => r.metric === 'timings.open');
  assert.equal(row.base, 300);
  assert.equal(row.head, 150);
  assert.equal(row.changePct, -50);
});

test('series last heap and nodes', () => {
  const s = (h, n) => result(0.1, { series: [{ t: 0, heapMB: 1, nodes: 1 }, { t: 1, heapMB: h, nodes: n }] });
  const rows = compareRuns([[s(100, 1000)]], [[s(150, 900)]]);
  assert.equal(rows.find((r) => r.metric === 'series.heapMB').changePct, 50);
  assert.equal(rows.find((r) => r.metric === 'series.nodes').changePct, -10);
});

test('metric absent on one side gives no row; inputs with no events are absent', () => {
  const withInputs = result(0.1, { inputs: { count: 5, p95: 40 } });
  const noInputs = result(0.1, { inputs: { count: 0, p95: 0 } });
  const rows = compareRuns([[withInputs]], [[noInputs]]);
  assert.equal(rows.some((r) => r.metric === 'inputs.p95'), false);
  assert.equal(compareRuns([[withInputs]], [[withInputs]]).some((r) => r.metric === 'inputs.p95'), true);
});

test('labels compare separately and only when on both sides', () => {
  const a = result(0.1);
  const b = { ...result(0.1), label: 'other-chromium-1x-3s' };
  const rows = compareRuns([[a, b]], [[a]]);
  assert.deepEqual(rows.map((r) => r.label), ['thread-open-chromium-4x-25s']);
});

test('driverExit results are excluded and listed', () => {
  const bad = result(0.9, { driverExit: 1 });
  const rows = compareRuns([[result(0.4)], [bad]], [[result(0.4)]]);
  assert.equal(rows[0].base, 0.4);
  assert.deepEqual(excludedLabels([[bad]], [[result(0.1)]]), ['thread-open-chromium-4x-25s (driverExit 1)']);
});

test('results of a scenario that threw are excluded and listed', () => {
  const failed = result(0.9, { failed: 'Error: timed out' });
  const rows = compareRuns([[result(0.4)], [failed]], [[result(0.4)]]);
  assert.equal(rows[0].base, 0.4);
  assert.deepEqual(excludedLabels([[failed]], [[result(0.1)]]), ['thread-open-chromium-4x-25s (failed)']);
});

test('results that held under 80 % of the target streams are excluded and listed', () => {
  const held = (streaming, busy) => result(busy, { target: 25, achieved: { streaming } });
  const rows = compareRuns([[held(20, 0.4)], [held(19.9, 0.9)]], [[held(25, 0.4)]]);
  assert.equal(rows[0].base, 0.4);
  const noReport = result(0.9, { target: 25, achieved: null });
  assert.deepEqual(excludedLabels([[held(19.9, 0.9), noReport]], [[held(20, 0.4), result(0.1, { target: null })]]), [
    'thread-open-chromium-4x-25s (held 19.9 of 25 streams)',
    'thread-open-chromium-4x-25s (held no of 25 streams)',
  ]);
});

test('a metric that is 0 in every run of both sides gives no row', () => {
  const coldLoad = (busy, p95) => result(busy, { frames: { count: p95 ? 10 : 0, p95 } });
  const metrics = (rows) => rows.map((r) => r.metric);
  assert.deepEqual(metrics(compareRuns([[coldLoad(0.3, 0)]], [[coldLoad(0.2, 0)]])), ['metrics.busy']);
  assert.deepEqual(metrics(compareRuns([[coldLoad(0.3, 0)]], [[coldLoad(0.2, 16)]])), ['metrics.busy', 'frames.p95']);
});

test('a missing directory is named, without a stack trace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compare-'));
  try {
    const missing = join(dir, 'missing');
    const script = fileURLToPath(new URL('./compare.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script, '--base', missing, '--head', dir], { encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.equal(run.stderr, `compare.mjs: ${missing}: no such directory\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('zero base gives null change', () => {
  const rows = compareRuns([[result(0)]], [[result(0.2)]]);
  assert.equal(rows[0].changePct, null);
});
