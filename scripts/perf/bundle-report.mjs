#!/usr/bin/env node
// Reports what a production build ships and what a first visit downloads before the app can paint.
//
//   node scripts/perf/bundle-report.mjs [dist] [--json <file>] [--sources] [--budget <file>]
//
// "Initial" is index.html's module script with every chunk it imports statically (the browser
// fetches all of them before the entry runs), plus index.html's style sheets. Dynamic imports
// load later and are listed as other chunks. --sources attributes each initial chunk's bytes to
// packages and app folders through the build's source maps (`vite build --sourcemap`).
// --budget fails (exit 1) when a gzip size goes over the limits in the given JSON file.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const [value] = args.splice(index, 2).slice(1);
  return value;
};
const jsonOut = option('--json');
const budgetFile = option('--budget');
const sourcesFlag = args.indexOf('--sources');
if (sourcesFlag >= 0) args.splice(sourcesFlag, 1);
const dist = path.resolve(args[0] ?? 'dist');

const sizes = (file) => {
  const data = readFileSync(file);
  return {
    raw: data.length,
    gzip: gzipSync(data, { level: 9 }).length,
    brotli: brotliCompressSync(data, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
};

// Module specifiers of static `import`/`export ... from` statements; dynamic `import(` is skipped.
const STATIC_IMPORT =
  /(?:^|[;}\s])(?:import|export)\s*(?:(?:[\w$]+\s*,?\s*)?(?:\{[^}]*\}|\*\s*as\s*[\w$]+|\*)?\s*from\s*)?["']([^"']+\.js)["']/g;
const staticImports = (file) => {
  const code = readFileSync(file, 'utf8');
  const found = new Set();
  for (const match of code.matchAll(STATIC_IMPORT)) {
    if (match[1].startsWith('.') || match[1].startsWith('/'))
      found.add(path.resolve(path.dirname(file), match[1].startsWith('/') ? `${dist}${match[1]}` : match[1]));
  }
  return [...found];
};

const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const attr = (tag, name) => new RegExp(`${name}="([^"]+)"`).exec(tag)?.[1];
const tags = html.match(/<(?:script|link)\b[^>]*>/g) ?? [];
const entries = tags
  .filter((tag) => tag.startsWith('<script') && /type="module"/.test(tag))
  .map((tag) => attr(tag, 'src'));
const preloads = tags
  .filter((tag) => /rel="modulepreload"/.test(tag))
  .map((tag) => attr(tag, 'href'));
const styles = tags
  .filter((tag) => /rel="stylesheet"/.test(tag))
  .map((tag) => attr(tag, 'href'));
const local = (url) => path.join(dist, url.replace(/^\//, ''));

const initial = new Set();
const visit = (file) => {
  if (initial.has(file)) return;
  initial.add(file);
  staticImports(file).forEach(visit);
};
[...entries, ...preloads].map(local).forEach(visit);
styles.map(local).forEach((file) => initial.add(file));

const assets = path.join(dist, 'assets');
const all = readdirSync(assets)
  .filter((name) => /\.(js|css|wasm)$/.test(name))
  .map((name) => path.join(assets, name));
const rows = all.map((file) => ({
  file: path.relative(dist, file),
  initial: initial.has(file),
  ...sizes(file),
}));
rows.sort((a, b) => b.raw - a.raw);
const sum = (list, key) => list.reduce((total, row) => total + row[key], 0);
const initialRows = rows.filter((row) => row.initial);
const initialJs = initialRows.filter((row) => row.file.endsWith('.js'));
const entryRow = rows.find((row) => `/${row.file}` === entries[0]);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const table = (list) =>
  list
    .map(
      (row) =>
        `${row.file.padEnd(58)} ${kb(row.raw).padStart(12)} ${kb(row.gzip).padStart(11)} ${kb(
          row.brotli
        ).padStart(11)}`
    )
    .join('\n');

const summary = {
  entry: entryRow?.file,
  initialFiles: initialRows.length,
  initialJs: { raw: sum(initialJs, 'raw'), gzip: sum(initialJs, 'gzip'), brotli: sum(initialJs, 'brotli') },
  initialCss: {
    raw: sum(initialRows.filter((row) => row.file.endsWith('.css')), 'raw'),
    gzip: sum(initialRows.filter((row) => row.file.endsWith('.css')), 'gzip'),
  },
  entryJs: entryRow ? { raw: entryRow.raw, gzip: entryRow.gzip, brotli: entryRow.brotli } : null,
  allJs: { raw: sum(rows.filter((row) => row.file.endsWith('.js')), 'raw'), files: rows.filter((row) => row.file.endsWith('.js')).length },
};

console.log(`Initial load (before the entry runs): ${initialRows.length} files`);
console.log(`${'file'.padEnd(58)} ${'raw'.padStart(12)} ${'gzip'.padStart(11)} ${'brotli'.padStart(11)}`);
console.log(table(initialRows));
console.log(
  `initial JS: ${kb(summary.initialJs.raw)} raw, ${kb(summary.initialJs.gzip)} gzip, ${kb(
    summary.initialJs.brotli
  )} brotli; initial CSS ${kb(summary.initialCss.raw)} raw, ${kb(summary.initialCss.gzip)} gzip`
);
console.log(`\nLargest 25 other chunks (load on demand):`);
console.log(table(rows.filter((row) => !row.initial).slice(0, 25)));
console.log(`all JS: ${kb(summary.allJs.raw)} raw in ${summary.allJs.files} files`);

// Bytes of each generated chunk per source file, read from its source map's mappings.
const attribute = async (file) => {
  const mapFile = `${file}.map`;
  try {
    statSync(mapFile);
  } catch {
    return null;
  }
  const { SourceMapConsumer } = await import('source-map-js');
  const consumer = new SourceMapConsumer(JSON.parse(readFileSync(mapFile, 'utf8')));
  const lines = readFileSync(file, 'utf8').split('\n');
  const owners = new Map();
  let previous = null;
  const add = (source, bytes) => owners.set(source, (owners.get(source) ?? 0) + bytes);
  consumer.eachMapping((mapping) => {
    if (previous && previous.line === mapping.generatedLine)
      add(previous.source, mapping.generatedColumn - previous.column);
    else if (previous) add(previous.source, lines[previous.line - 1].length - previous.column);
    previous = {
      line: mapping.generatedLine,
      column: mapping.generatedColumn,
      source: mapping.source ?? '(none)',
    };
  });
  if (previous) add(previous.source, lines[previous.line - 1].length - previous.column);
  return owners;
};
const group = (source) => {
  const modules = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(source);
  if (modules) return modules[1];
  const app = /src\/app\/([^/]+)/.exec(source);
  if (app) return `src/app/${app[1]}`;
  return source.replace(/^(\.\.\/)+/, '');
};
if (sourcesFlag >= 0) {
  const groups = new Map();
  for (const row of initialJs) {
    // eslint-disable-next-line no-await-in-loop
    const owners = await attribute(path.join(dist, row.file));
    if (!owners) continue;
    for (const [source, bytes] of owners)
      groups.set(group(source), (groups.get(group(source)) ?? 0) + bytes);
  }
  const ranked = [...groups].sort((a, b) => b[1] - a[1]);
  summary.initialSources = Object.fromEntries(ranked);
  console.log(`\nInitial JS by package or app folder (minified bytes), top 40:`);
  for (const [name, bytes] of ranked.slice(0, 40))
    console.log(`${name.padEnd(58)} ${kb(bytes).padStart(12)}`);
}

if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ summary, rows }, null, 2)}\n`);

if (budgetFile) {
  const budget = JSON.parse(readFileSync(budgetFile, 'utf8'));
  const checks = [
    ['initial JS gzip', summary.initialJs.gzip, budget.initialJsGzipBytes],
    ['entry JS gzip', summary.entryJs?.gzip ?? 0, budget.entryJsGzipBytes],
    ['initial CSS gzip', summary.initialCss.gzip, budget.initialCssGzipBytes],
  ];
  let failed = false;
  for (const [name, actual, limit] of checks) {
    if (limit === undefined) continue;
    const over = actual > limit;
    failed ||= over;
    console.log(`${over ? 'FAIL' : 'ok  '} ${name}: ${kb(actual)} (budget ${kb(limit)})`);
  }
  if (failed) process.exitCode = 1;
}
