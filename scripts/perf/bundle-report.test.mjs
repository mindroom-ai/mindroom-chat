import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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

test('with a manifest, every chunk is listed by its source or chunk name, with its style sheets', () => {
  const dist = fakeDist();
  assert.match(run(dist).stdout, /build with `npx vite build --manifest`/);
  // Random bytes, so the raw, gzip and brotli sizes of the style sheet differ.
  writeFileSync(
    path.join(dist, 'assets', 'lazy-FFFFFFFF.css'),
    `/* ${randomBytes(3000).toString('hex')} */`
  );
  // A `?worker` bundle, which the manifest does not record.
  writeFileSync(path.join(dist, 'assets', 'some.worker-WWWWWWWW.js'), 'onmessage=()=>{};');
  mkdirSync(path.join(dist, '.vite'));
  writeFileSync(
    path.join(dist, '.vite', 'manifest.json'),
    JSON.stringify({
      // A package that node_modules links to outside the project root.
      '../../deps/0123/node_modules/some-pkg/index.js': {
        file: 'assets/lazy-CCCCCCCC.js',
        src: '../../deps/0123/node_modules/some-pkg/index.js',
        css: ['assets/lazy-FFFFFFFF.css'],
      },
      '_shared-BBBBBBBB.js': { file: 'assets/shared-BBBBBBBB.js', name: 'shared' },
      '_leaf-DDDDDDDD.js': { file: 'assets/leaf-DDDDDDDD.js', name: 'leaf' },
      'index.html': {
        file: 'assets/index-AAAAAAAA.js',
        src: 'index.html',
        css: ['assets/index-EEEEEEEE.css'],
      },
      // A style sheet that the bundler keys like a chunk.
      '_lazy-!~{001}~.js': { file: 'assets/lazy-FFFFFFFF.css' },
    })
  );
  const out = path.join(dist, 'report.json');
  const { stdout } = run(dist, '--json', out);
  const listed = stdout
    .split('\nEvery chunk')[1]
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split(/\s{2,}/));
  assert.deepEqual(
    listed.map(([name]) => name),
    [
      'index.html (initial)',
      'leaf (initial)',
      'node_modules/some-pkg/index.js',
      'shared (initial)',
      'some.worker',
    ]
  );
  // The lazy chunk's sizes are those of its script and its style sheet together.
  const files = JSON.parse(readFileSync(out, 'utf8')).rows.filter((row) =>
    ['assets/lazy-CCCCCCCC.js', 'assets/lazy-FFFFFFFF.css'].includes(row.file)
  );
  const kb = (key) =>
    `${(files.reduce((total, row) => total + row[key], 0) / 1024).toFixed(1)} KiB`;
  assert.deepEqual(listed[2].slice(1), [kb('raw'), kb('gzip'), kb('brotli')]);
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
