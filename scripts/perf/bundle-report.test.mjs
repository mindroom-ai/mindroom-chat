import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
  writeFileSync(
    path.join(dist, 'assets', 'lazy-FFFFFFFF.css'),
    `.a{color:blue}${' '.repeat(3000)}`
  );
  mkdirSync(path.join(dist, '.vite'));
  writeFileSync(
    path.join(dist, '.vite', 'manifest.json'),
    JSON.stringify({
      // A package that node_modules links to outside the project root.
      '../../deps/0123/node_modules/some-pkg/index.js': {
        file: 'assets/lazy-CCCCCCCC.js',
        src: '../../deps/0123/node_modules/some-pkg/index.js',
        isDynamicEntry: true,
        css: ['assets/lazy-FFFFFFFF.css'],
      },
      '_shared-BBBBBBBB.js': {
        file: 'assets/shared-BBBBBBBB.js',
        name: 'shared',
        imports: ['_leaf-DDDDDDDD.js'],
      },
      '_leaf-DDDDDDDD.js': { file: 'assets/leaf-DDDDDDDD.js', name: 'leaf' },
      'index.html': {
        file: 'assets/index-AAAAAAAA.js',
        src: 'index.html',
        isEntry: true,
        imports: ['_shared-BBBBBBBB.js'],
        dynamicImports: ['../../deps/0123/node_modules/some-pkg/index.js'],
        css: ['assets/index-EEEEEEEE.css'],
      },
      // A style sheet that the bundler keys like a chunk.
      '_lazy-!~{001}~.js': { file: 'assets/lazy-FFFFFFFF.css', src: '_lazy-!~{001}~.js' },
    })
  );
  const { stdout } = run(dist);
  const listed = stdout.split('\nEvery chunk')[1].split('\n').slice(1).filter(Boolean);
  assert.deepEqual(
    listed.map((line) => line.split(/\s{2,}/)[0]),
    ['index.html (initial)', 'leaf (initial)', 'node_modules/some-pkg/index.js', 'shared (initial)']
  );
  const bytes = (...names) =>
    names.reduce((total, name) => total + statSync(path.join(dist, 'assets', name)).size, 0);
  const raw = `${(bytes('lazy-CCCCCCCC.js', 'lazy-FFFFFFFF.css') / 1024).toFixed(1)} KiB`;
  assert.equal(listed[2].split(/\s{2,}/)[1], raw);
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
