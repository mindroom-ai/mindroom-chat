#!/usr/bin/env node
// @ts-check
// One TSV row per spec file from Playwright JSON reports (`--reporter=json`).
//
// Usage:
//   node scripts/e2e-results-tsv.mjs <report.json>...
//   node scripts/e2e-results-tsv.mjs --manifest <manifest.tsv>
//
// A manifest (written by scripts/e2e-suite.sh) has one line per spec run: spec path, report path,
// log path, server (preview or dev), exit code, load average at its start. A run that left no
// report counts as one failure whose error is the last line of its log that names an error.
//
// Columns: spec (relative to e2e/), passed (on the first attempt), failed (on every attempt),
// skipped, first error (message line and spec location), flaky (passed on a retry), seconds (all
// attempts together), server, load (the machine's 1-minute load average when the spec started).
import { existsSync, readFileSync } from 'node:fs';

/**
 * @typedef {{ message?: string; location?: { file: string; line: number } }} ReportError
 * @typedef {{ status: string; duration: number; error?: ReportError; errors?: ReportError[] }} TestResult
 * @typedef {{ status: string; results: TestResult[] }} ReportTest
 * @typedef {{ file: string; line: number; tests: ReportTest[] }} ReportSpec
 * @typedef {{ file?: string; specs?: ReportSpec[]; suites?: ReportSuite[] }} ReportSuite
 * @typedef {{ suites?: ReportSuite[]; errors?: ReportError[] }} Report
 * @typedef {{ passed: number; failed: number; skipped: number; flaky: number; ms: number; error: string; server: string; load: string }} Row
 */

// eslint-disable-next-line no-control-regex
const ansi = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** @param {string} text */
const oneLine = (text) =>
  (
    text
      .replace(ansi, '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  )
    .replace(/\t/g, ' ')
    .slice(0, 300);

/** @param {string} file */
const specName = (file) => file.replace(/^(\.\/)?e2e\//, '');

/** @param {ReportError | undefined} error */
const describeError = (error) => {
  if (!error) return '';
  const message = oneLine(error.message ?? '');
  const where = error.location
    ? ` (${specName(error.location.file.replace(/^.*?\/e2e\//, 'e2e/'))}:${error.location.line})`
    : '';
  return `${message}${where}`;
};

/** @returns {Row} */
const emptyRow = (server = '') => ({
  passed: 0,
  failed: 0,
  skipped: 0,
  flaky: 0,
  ms: 0,
  error: '',
  server,
  load: '',
});

/** @type {Map<string, Row>} */
const rows = new Map();

/**
 * @param {string} spec
 * @param {string} server
 */
const rowFor = (spec, server) => {
  const existing = rows.get(spec);
  if (existing) return existing;
  const row = emptyRow(server);
  rows.set(spec, row);
  return row;
};

/**
 * @param {ReportSuite} suite
 * @param {(spec: ReportSpec) => void} visit
 */
const walk = (suite, visit) => {
  suite.specs?.forEach(visit);
  suite.suites?.forEach((child) => walk(child, visit));
};

/**
 * @param {Report} report
 * @param {string | undefined} expectedSpec
 * @param {string} server
 */
const addReport = (report, expectedSpec, server) => {
  report.suites?.forEach((suite) =>
    walk(suite, (spec) => {
      const row = rowFor(expectedSpec ?? specName(spec.file), server);
      spec.tests.forEach((test) => {
        row.ms += test.results.reduce((sum, result) => sum + result.duration, 0);
        if (test.status === 'skipped') row.skipped += 1;
        else if (test.status === 'flaky') row.flaky += 1;
        else if (test.status === 'expected') row.passed += 1;
        else row.failed += 1;
        if (test.status === 'unexpected' && !row.error) {
          const failure = test.results.find((result) => result.error || result.errors?.length);
          row.error =
            describeError(failure?.error ?? failure?.errors?.[0]) || failure?.status || '';
        }
      });
    })
  );
  // Errors outside any test: a spec that does not load, global setup, the web server.
  const [outside] = report.errors ?? [];
  if (outside) {
    const row = rowFor(expectedSpec ?? '(run)', server);
    if (row.passed + row.failed + row.flaky === 0) row.failed = 1;
    if (!row.error) row.error = describeError(outside);
  }
};

/** @param {string} logPath */
const lastLogError = (logPath) => {
  if (!existsSync(logPath)) return 'no Playwright report and no log';
  const lines = readFileSync(logPath, 'utf8').replace(ansi, '').split('\n');
  const line = lines.reverse().find((entry) => /error|failed|refused|timed? ?out/i.test(entry));
  return `no Playwright report: ${oneLine(line ?? lines.find((entry) => entry.trim()) ?? '')}`;
};

const args = process.argv.slice(2);
if (args[0] === '--manifest') {
  const manifest = readFileSync(args[1], 'utf8').split('\n').filter(Boolean);
  manifest.forEach((line) => {
    const [spec, reportPath, logPath, server = '', exitCode = '', load = ''] = line.split('\t');
    const name = specName(spec);
    if (reportPath && existsSync(reportPath)) {
      addReport(JSON.parse(readFileSync(reportPath, 'utf8')), name, server);
    }
    const row = rowFor(name, server);
    row.load = load;
    if (row.passed + row.failed + row.flaky + row.skipped === 0) {
      row.failed = 1;
      row.error ||= lastLogError(logPath);
    } else if (exitCode !== '0' && row.failed === 0 && !row.error) {
      row.error = `exit code ${exitCode}: ${lastLogError(logPath).replace(
        /^no Playwright report: /,
        ''
      )}`;
    }
  });
} else {
  args.forEach((reportPath) =>
    addReport(JSON.parse(readFileSync(reportPath, 'utf8')), undefined, '')
  );
}

const header = [
  'spec',
  'passed',
  'failed',
  'skipped',
  'first error',
  'flaky',
  'seconds',
  'server',
  'load',
];
const lines = [...rows.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([spec, row]) =>
    [spec, row.passed, row.failed, row.skipped, row.error, row.flaky, Math.round(row.ms / 1000)]
      .concat(row.server, row.load)
      .join('\t')
  );
// One write, so a reader that stops early (`| head`) ends the process without an EPIPE trace.
process.stdout.on('error', () => process.exit(0));
process.stdout.write(`${[header.join('\t'), ...lines].join('\n')}\n`);
