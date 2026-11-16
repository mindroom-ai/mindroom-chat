import assert from 'node:assert/strict';
import test from 'node:test';

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
  assert.deepEqual(excludedLabels([[bad]], [[result(0.1)]]), ['thread-open-chromium-4x-25s']);
});

test('zero base gives null change', () => {
  const rows = compareRuns([[result(0)]], [[result(0.2)]]);
  assert.equal(rows[0].changePct, null);
});
