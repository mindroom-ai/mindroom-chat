import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./bundle-report.mjs', import.meta.url));

// A build whose entry imports one chunk statically, which imports another, and one lazily.
const fakeDist = () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'bundle-report-'));
  mkdirSync(path.join(dist, 'assets'));
  const write = (name, code) => writeFileSync(path.join(dist, 'assets', name), code);
  write('index-AAAAAAAA.js', 'import{a as b}from"./shared-BBBBBBBB.js";const l=()=>import("./lazy-CCCCCCCC.js");b(l);');
  write('shared-BBBBBBBB.js', 'import"./leaf-DDDDDDDD.js";export const a=x=>x;');
  write('leaf-DDDDDDDD.js', 'console.log(1);');
  write('lazy-CCCCCCCC.js', `export default ${JSON.stringify('x'.repeat(5000))};`);
  write('index-EEEEEEEE.css', 'body{color:red}');
  writeFileSync(
    path.join(dist, 'index.html'),
    '<script type="module" crossorigin src="/assets/index-AAAAAAAA.js"></script><link rel="stylesheet" crossorigin href="/assets/index-EEEEEEEE.css">'
  );
  return dist;
};

const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('the initial load is the entry with its static imports and the style sheet', () => {
  const dist = fakeDist();
  const out = path.join(dist, 'report.json');
  const result = run(dist, '--json', out);
  assert.equal(result.status, 0, result.stderr);
  const { summary, rows } = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(
    rows.filter((row) => row.initial).map((row) => row.file).sort(),
    ['assets/index-AAAAAAAA.js', 'assets/index-EEEEEEEE.css', 'assets/leaf-DDDDDDDD.js', 'assets/shared-BBBBBBBB.js']
  );
  assert.equal(summary.entry, 'assets/index-AAAAAAAA.js');
  assert.equal(summary.initialFiles, 4);
});

test('a budget fails the run only when a size is over it', () => {
  const dist = fakeDist();
  const budget = path.join(dist, 'budget.json');
  writeFileSync(budget, JSON.stringify({ initialJsGzipBytes: 10_000, initialCssGzipBytes: 1_000 }));
  assert.equal(run(dist, '--budget', budget).status, 0);
  writeFileSync(budget, JSON.stringify({ initialJsGzipBytes: 50 }));
  const over = run(dist, '--budget', budget);
  assert.equal(over.status, 1);
  assert.match(over.stdout, /FAIL initial JS gzip/);
});
