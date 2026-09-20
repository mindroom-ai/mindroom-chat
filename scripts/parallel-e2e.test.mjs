import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  planJobs,
  runJobs,
  summarizeJob,
  parseArguments,
  requireLoopback,
  usesDevelopmentServer,
} from './parallel-e2e.mjs';

const report = (file, project, statuses = ['passed']) => ({
  config: { rootDir: '/repo/e2e' },
  suites: [
    {
      title: file,
      suites: [
        {
          title: 'behavior',
          specs: [
            {
              title: 'preserves state',
              file,
              tests: [{ projectName: project, results: statuses.map((status) => ({ status })) }],
            },
          ],
        },
      ],
    },
  ],
});

test('discovers nested cases and runs shared Chromium coverage once across configs', () => {
  const jobs = planJobs(
    [
      {
        config: 'playwright.config.ts',
        report: report('live/navigation-panel.spec.ts', 'chromium'),
      },
      {
        config: 'playwright.sidebar.config.ts',
        report: report('live/navigation-panel.spec.ts', 'chromium'),
      },
      {
        config: 'playwright.sidebar.config.ts',
        report: report('live/navigation-panel.spec.ts', 'webkit'),
      },
    ],
    { repo: '/repo' }
  );
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    jobs.map(({ file, project, config, cases }) => [file, project, config, cases.length]),
    [
      ['e2e/live/navigation-panel.spec.ts', 'chromium', 'playwright.config.ts', 1],
      ['e2e/live/navigation-panel.spec.ts', 'webkit', 'playwright.sidebar.config.ts', 1],
    ]
  );
});

test('selection rejects a misspelled spec instead of returning an empty green run', () => {
  assert.throws(
    () =>
      planJobs(
        [{ config: 'playwright.config.ts', report: report('account-storage.spec.ts', 'chromium') }],
        { repo: '/repo', files: ['e2e/missing.spec.ts'] }
      ),
    /not discovered/i
  );
});

test('performance cases are exclusive and normal cases use a bounded pool', async () => {
  const jobs = [
    { id: 'a', exclusive: false },
    { id: 'b', exclusive: false },
    { id: 'c', exclusive: false },
    { id: 'slow1', exclusive: true },
    { id: 'slow2', exclusive: true },
  ];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = [];
  const completed = [];
  let active = 0;
  let maximum = 0;
  const done = runJobs(jobs, {
    concurrency: 2,
    execute: async (job) => {
      active += 1;
      maximum = Math.max(maximum, active);
      started.push(job.id);
      if (job.exclusive) {
        assert.equal(active, 1);
        assert.deepEqual(completed.slice(0, 3).sort(), ['a', 'b', 'c']);
      } else await gate;
      active -= 1;
      completed.push(job.id);
      return { status: 'passed' };
    },
  });
  assert.deepEqual(started, ['a', 'b']);
  release();
  const results = await done;
  assert.equal(maximum, 2);
  assert.deepEqual(completed.slice(3), ['slow1', 'slow2']);
  assert.equal(results.length, 5);
});

test('setup failure is recorded and remaining specs still run', async () => {
  const results = await runJobs([{ id: 'bad' }, { id: 'good' }], {
    concurrency: 1,
    execute: async ({ id }) => {
      if (id === 'bad') throw new Error('registration unavailable');
      return { status: 'passed' };
    },
  });
  assert.deepEqual(
    results.map((r) => r.status),
    ['error', 'passed']
  );
  assert.match(results[0].error, /registration unavailable/);
});

test('cancellation records unfinished jobs and does not start the next spec', async () => {
  const abort = new AbortController();
  const started = [];
  const results = await runJobs([{ id: 'first' }, { id: 'next' }], {
    concurrency: 1,
    signal: abort.signal,
    execute: async ({ id }) => {
      started.push(id);
      abort.abort();
      return { status: 'passed' };
    },
  });
  assert.deepEqual(started, ['first']);
  assert.deepEqual(
    results.map((r) => r.status),
    ['passed', 'interrupted']
  );
});

test('a failed repeat cannot be hidden by the final passing attempt', () => {
  const base = report('account-storage.spec.ts', 'chromium');
  const [job] = planJobs([{ config: 'playwright.config.ts', report: base }], { repo: '/repo' });
  assert.equal(summarizeJob(job, base, 0).status, 'passed');
  assert.equal(
    summarizeJob(job, report('account-storage.spec.ts', 'chromium', ['failed', 'passed']), 0)
      .status,
    'failed'
  );
  assert.equal(summarizeJob(job, base, 1).status, 'failed');
  assert.equal(summarizeJob(job, { suites: [] }, 0).status, 'failed');
  assert.equal(summarizeJob(job, undefined, 0).status, 'failed');
});

test('reports platform skips separately from passed cases', () => {
  const [job] = planJobs(
    [{ config: 'playwright.config.ts', report: report('glass.spec.ts', 'webkit') }],
    { repo: '/repo' }
  );
  const result = summarizeJob(job, report('glass.spec.ts', 'webkit', ['skipped']), 0);
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.counts, { passed: 0, failed: 0, skipped: 1, missing: 0 });
});

test('rejects invalid concurrency and unsupported flags before starting services', () => {
  for (const value of ['0', '-1', '1.5', 'NaN', '2oops']) {
    assert.throws(() => parseArguments(['--jobs', value]), /jobs/i);
  }
  assert.throws(() => parseArguments(['--unknown']), /unknown/i);
  assert.equal(parseArguments(['--jobs', '3', '--list']).jobs, 3);
  assert.equal(parseArguments(['--jobs', '3', '--list']).list, true);
});

test('isolated fixture endpoints require loopback origins', () => {
  for (const url of ['http://127.0.0.1:1234', 'http://localhost:1234', 'http://[::1]:1234']) {
    assert.doesNotThrow(() => requireLoopback(url));
  }
  for (const url of [
    'https://example.com',
    'http://localhost.example.com',
    'file:///data',
    'http://name:secret@localhost:1234',
  ]) {
    assert.throws(() => requireLoopback(url), /loopback/i);
  }
});

test('source-import probes use Vite and actual application checks use production', () => {
  assert.equal(
    usesDevelopmentServer(
      'e2e/message-tables.spec.ts',
      "page.goto('/e2e/fixtures/message-tables.html')"
    ),
    true
  );
  assert.equal(usesDevelopmentServer('e2e/live/diagnostics-storage-fallback.spec.ts', ''), true);
  assert.equal(usesDevelopmentServer('e2e/cinny124-flight-recorder.spec.ts', ''), true);
  assert.equal(usesDevelopmentServer('e2e/account-storage.spec.ts', ''), false);
});

test('CLI help and invalid arguments finish without provisioning infrastructure', () => {
  const script = fileURLToPath(new URL('./test-e2e-parallel.mjs', import.meta.url));
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--jobs/);
  const invalid = spawnSync(process.execPath, [script, '--jobs', '0'], { encoding: 'utf8' });
  assert.equal(invalid.status, 64);
  assert.match(invalid.stderr, /jobs/);
});
