// Run with `node --test scripts/strict-check.test.mjs` (the `strict` recipe does).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readLanePPaths, splitByLane } from './strict-check.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'strict-check.mjs');
const scratch = mkdtempSync(path.join(tmpdir(), 'strict-check-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const TSC_OUTPUT = [
  "src/app/ported.ts(3,7): error TS6133: 'unused' is declared but its value is never read.",
  "src/app/clean.ts(10,1): error TS2322: Type 'string | undefined' is not assignable to type 'string'.",
  "  Type 'undefined' is not assignable to type 'string'.",
  "e2e/lane-c/spec.ts(1,1): error TS7030: Not all code paths return a value.",
  "error TS5083: Cannot read file 'tsconfig.missing.json'.",
  '',
].join('\n');

test('sorts diagnostics by lane and keeps continuation lines with their diagnostic', () => {
  const { laneC, laneP } = splitByLane(TSC_OUTPUT, new Set(['src/app/ported.ts']));
  assert.deepEqual(
    laneP.map((diagnostic) => diagnostic.file),
    ['src/app/ported.ts']
  );
  assert.deepEqual(
    laneC.map((diagnostic) => diagnostic.file),
    ['src/app/clean.ts', 'e2e/lane-c/spec.ts', null]
  );
  assert.match(laneC[0].text, /\n {2}Type 'undefined' is not assignable/);
});

test('reads Lane P paths from every portable list, binary rows included', () => {
  const paths = readLanePPaths();
  assert.ok(paths.size > 1000, `expected the portable lists, got ${paths.size} paths`);
  assert.ok([...paths].some((file) => file.endsWith('.png')), 'portable-wave3.tsv lists images');
  assert.ok(!paths.has(''), 'blank rows are skipped');
});

test('fails on Lane C errors and passes when only Lane P files have errors', () => {
  const lanePFile = [...readLanePPaths()].find((file) => file.endsWith('.ts'));
  const onlyLaneP = path.join(scratch, 'lane-p.txt');
  writeFileSync(onlyLaneP, `${lanePFile}(1,1): error TS6133: 'x' is declared but never read.\n`);
  const passing = spawnSync('node', [script, '--from', onlyLaneP], { encoding: 'utf8' });
  assert.equal(passing.status, 0, passing.stdout);
  assert.match(passing.stdout, /0 Lane C errors in 0 files; 1 Lane P errors ignored/);

  const withLaneC = path.join(scratch, 'lane-c.txt');
  writeFileSync(withLaneC, TSC_OUTPUT);
  const failing = spawnSync('node', [script, '--from', withLaneC], { encoding: 'utf8' });
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /src\/app\/clean\.ts\(10,1\)/);
});
