#!/usr/bin/env node
// Reports what a production build ships and what a first visit downloads before the app can paint.
//
//   node scripts/perf/bundle-report.mjs [dist] [--json <file>] [--sources] [--budget <file>]
//
// "Initial" is index.html's module script with every chunk it imports statically (the browser
// fetches all of them before the entry runs), plus index.html's style sheets. Dynamic imports
// load later and are listed as other chunks; with the manifest of `vite build --manifest`, every
// chunk is also listed under a name that stays the same between builds. --sources attributes
// each initial chunk's bytes to packages and app folders through the build's source maps
// (`vite build --sourcemap`). With MINDROOM_CLIENT_PLUGINS set as for the build, the source maps
// also give the minified and gzip size of what each client plugin adds, its packages included.
// --budget fails (exit 1) when a gzip size goes over the limits in the given JSON file.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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
const jsRows = rows.filter((row) => row.file.endsWith('.js'));
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
  allJs: { raw: sum(jsRows, 'raw'), files: jsRows.length },
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

// Every chunk with its style sheets, under a name that stays the same from build to build (file
// hashes change even between two builds of one commit), sorted by name so two reports diff line by
// line. The manifest of `vite build --manifest` names a chunk by its source module, with the path
// cut back to node_modules/ where the install sits outside the project, else by its chunk name.
// `?worker` bundles are built apart and stay out of the manifest: they go by their file name
// without the hash.
const manifestFile = path.join(dist, '.vite', 'manifest.json');
if (existsSync(manifestFile)) {
  const byFile = new Map(rows.map((row) => [row.file, row]));
  const manifest = Object.values(JSON.parse(readFileSync(manifestFile, 'utf8')));
  const recorded = new Set(manifest.map((chunk) => chunk.file));
  const workers = rows
    .filter((row) => row.file.endsWith('.js') && !recorded.has(row.file))
    .map((row) => ({ ...row, file: row.file.replace(/^assets\/(.+)-[\w-]{8}\.js$/, '$1') }));
  const chunks = manifest
    .filter((chunk) => chunk.file.endsWith('.js'))
    .map((chunk) => {
      const files = [chunk.file, ...(chunk.css ?? [])].map((file) => byFile.get(file));
      const name = chunk.src?.replace(/^.*?(?=node_modules\/)/, '') ?? chunk.name;
      return {
        file: files[0].initial ? `${name} (initial)` : name,
        raw: sum(files, 'raw'),
        gzip: sum(files, 'gzip'),
        brotli: sum(files, 'brotli'),
      };
    })
    .concat(workers)
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  console.log(
    `\nEvery chunk with its style sheets, by name; those not marked initial load on demand:`
  );
  console.log(table(chunks));
} else {
  console.log(
    '\nTo list every chunk under a name that stays the same between builds, build with `npx vite build --manifest`.'
  );
}

// The code of each generated chunk per source file, read from its source map's mappings.
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
  // A mapping's code runs to the next mapping on its line, else to the line's end.
  const add = ({ source, line, column }, end) =>
    owners.set(source, (owners.get(source) ?? '') + lines[line - 1].slice(column, end));
  consumer.eachMapping((mapping) => {
    if (previous)
      add(previous, previous.line === mapping.generatedLine ? mapping.generatedColumn : undefined);
    previous = {
      line: mapping.generatedLine,
      column: mapping.generatedColumn,
      source: mapping.source ?? '(none)',
    };
  });
  if (previous) add(previous);
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
    for (const [source, code] of owners)
      groups.set(group(source), (groups.get(group(source)) ?? 0) + code.length);
  }
  const ranked = [...groups].sort((a, b) => b[1] - a[1]);
  summary.initialSources = Object.fromEntries(ranked);
  console.log(`\nInitial JS by package or app folder (minified bytes), top 40:`);
  for (const [name, bytes] of ranked.slice(0, 40))
    console.log(`${name.padEnd(58)} ${kb(bytes).padStart(12)}`);
}

// What each client plugin adds: the code of every chunk whose source is in the plugin's directory.
if (process.env.MINDROOM_CLIENT_PLUGINS) {
  const { pluginOwner, readClientPlugins } = await import('../client-plugins.mjs');
  const plugins = readClientPlugins(process.env.MINDROOM_CLIENT_PLUGINS).map(({ id, dir }) => ({
    id,
    dir,
    code: '',
  }));
  const ownerOf = pluginOwner(plugins);
  let mapped = false;
  for (const row of jsRows) {
    const file = path.join(dist, row.file);
    // eslint-disable-next-line no-await-in-loop
    const owners = await attribute(file);
    mapped ||= owners !== null;
    for (const [source, code] of owners ?? []) {
      const owner = ownerOf(path.resolve(path.dirname(file), source));
      if (owner) owner.plugin.code += code;
    }
  }
  if (mapped) {
    summary.clientPlugins = Object.fromEntries(
      plugins.map(({ id, code }) => [id, { raw: Buffer.byteLength(code), gzip: gzipSync(code, { level: 9 }).length }])
    );
    console.log(`\nClient plugins (minified JS, from the source maps):`);
    console.log(`${'plugin'.padEnd(58)} ${'raw'.padStart(12)} ${'gzip'.padStart(11)}`);
    for (const [id, { raw, gzip }] of Object.entries(summary.clientPlugins))
      console.log(`${id.padEnd(58)} ${kb(raw).padStart(12)} ${kb(gzip).padStart(11)}`);
  } else {
    console.log('\nTo list what each client plugin adds, build with `npx vite build --sourcemap`.');
  }
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
