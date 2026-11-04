// Run with `node --test scripts/e2e-results-tsv.test.mjs` (the `script-tests` recipe does).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'e2e-results-tsv.mjs');
const dir = mkdtempSync(path.join(tmpdir(), 'e2e-results-tsv-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const write = (name, content) => {
  const file = path.join(dir, name);
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
};

const result = (status, duration, errors = []) => ({ status, duration, errors, error: errors[0] });
const spec = (file, tests) => ({ file, line: 1, tests });

// One spec file with a pass, a flaky test, a skip, and a test timeout that interrupted a click.
const mixedReport = write('mixed.json', {
  suites: [
    {
      file: 'live/mixed.spec.ts',
      specs: [
        spec('live/mixed.spec.ts', [{ status: 'expected', results: [result('passed', 1000)] }]),
      ],
      suites: [
        {
          specs: [
            spec('live/mixed.spec.ts', [
              { status: 'flaky', results: [result('failed', 2000), result('passed', 1500)] },
              { status: 'skipped', results: [result('skipped', 0)] },
              {
                status: 'unexpected',
                results: [
                  result('timedOut', 60000, [
                    { message: '\u001b[31mTest timeout of 60000ms exceeded.\u001b[39m' },
                    {
                      message: 'Error: locator.click: Test timeout of 60000ms exceeded.\nCall log:',
                      location: { file: '/tmp/x/slot-3/e2e/live/mixed.spec.ts', line: 42 },
                    },
                  ]),
                ],
              },
            ]),
          ],
        },
      ],
    },
  ],
});

const run = (args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
  });
  assert.equal(status, 0, stderr);
  const [header, ...rows] = stdout.replace(/\n$/, '').split('\n');
  return { header: header.split('\t'), rows: rows.map((row) => row.split('\t')) };
};

test('counts first-attempt passes, flaky tests, skips and failures per spec file', () => {
  const { header, rows } = run([mixedReport]);
  assert.deepEqual(header, [
    'spec',
    'passed',
    'failed',
    'skipped',
    'first error',
    'flaky',
    'seconds',
    'server',
    'load',
  ]);
  assert.deepEqual(rows, [
    [
      'live/mixed.spec.ts',
      '1',
      '1',
      '1',
      'Test timeout of 60000ms exceeded. in locator.click (live/mixed.spec.ts:42)',
      '1',
      '65',
      '',
      '',
    ],
  ]);
});

test('a manifest row without a report, or with a cut-off report, counts as one failure', () => {
  const log = write(
    'missing.log',
    'e2e-slot 3: snapshot\nError: listen EADDRINUSE: 127.0.0.1:4303\n'
  );
  const truncated = write('truncated.json', '{"suites": [');
  const manifest = write(
    'manifest.tsv',
    [
      ['e2e/live/mixed.spec.ts', mixedReport, '', 'preview', '1', '12.5'],
      ['e2e/missing.spec.ts', path.join(dir, 'none.json'), log, 'preview', '1', '80'],
      ['e2e/truncated.spec.ts', truncated, '', 'dev', '1', '3'],
    ]
      .map((cells) => cells.join('\t'))
      .join('\n')
  );
  const { rows } = run(['--manifest', manifest]);
  const bySpec = Object.fromEntries(rows.map((row) => [row[0], row]));

  assert.deepEqual(bySpec['live/mixed.spec.ts'].slice(1, 4), ['1', '1', '1']);
  assert.equal(bySpec['live/mixed.spec.ts'][8], '12.5');
  assert.deepEqual(bySpec['missing.spec.ts'].slice(1, 5), [
    '0',
    '1',
    '0',
    'no Playwright report: Error: listen EADDRINUSE: 127.0.0.1:4303',
  ]);
  assert.deepEqual(bySpec['truncated.spec.ts'].slice(1, 3), ['0', '1']);
  assert.match(bySpec['truncated.spec.ts'][4], /^invalid Playwright report: SyntaxError/);
  assert.equal(bySpec['truncated.spec.ts'][7], 'dev');
});
