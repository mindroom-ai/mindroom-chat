#!/usr/bin/env node
// Summarizes a Chrome .cpuprofile (e2e/perf/client-speed.live.spec.ts writes them with
// PERF_CPU_PROFILE=1): the functions with the most self time and the most total time.
//
//   node scripts/perf/cpuprofile-summary.mjs <file.cpuprofile> [--maps <sourcemap dist> --build <served dist>] [--top 30]
//     [--callers <regex>]   time under frames matching the regex, by the nearest app (src/) caller
//
// Production frames are minified. --maps points at a `vite build --sourcemap` output of the same
// commit. Hashes differ between the two builds, so a frame in assets/<name>-<hash>.js is looked
// up in the map of the chunk with the same name whose size is closest to that chunk's size in the
// profiled build (--build, the served dist), and reported as its source file, line and name.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { SourceMapConsumer } from 'source-map-js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  return args.splice(index, 2)[1];
};
const mapsDir = option('--maps');
const buildDir = option('--build');
const top = Number(option('--top', 30));
const callersOf = option('--callers');
const profile = JSON.parse(readFileSync(args[0], 'utf8'));

const consumers = new Map();
const consumerFor = (url) => {
  if (!mapsDir || !url) return null;
  const base = path.basename(new URL(url, 'http://x/').pathname);
  const stem = base.replace(/-[\w-]{8}\.js$/, '');
  if (consumers.has(base)) return consumers.get(base);
  const assets = path.join(mapsDir, 'assets');
  const candidates = readdirSync(assets).filter(
    (name) => name.endsWith('.js.map') && name.replace(/-[\w-]{8}\.js\.map$/, '') === stem
  );
  // Same stem in several chunks (index, emoji): take the one closest in size to the profiled chunk.
  const size = (file) => {
    try {
      return statSync(file).size;
    } catch {
      return NaN;
    }
  };
  const target = buildDir ? size(path.join(buildDir, 'assets', base)) : NaN;
  const distance = (name) => Math.abs(size(path.join(assets, name.slice(0, -4))) - target);
  const chosen =
    candidates.length === 1
      ? candidates[0]
      : Number.isNaN(target)
      ? null
      : candidates.sort((a, b) => distance(a) - distance(b))[0] ?? null;
  const consumer = chosen
    ? new SourceMapConsumer(JSON.parse(readFileSync(path.join(assets, chosen), 'utf8')))
    : null;
  consumers.set(base, consumer);
  return consumer;
};

const label = ({ functionName, url, lineNumber, columnNumber }) => {
  if (!url) return functionName || '(native)';
  const consumer = lineNumber >= 0 ? consumerFor(url) : null;
  if (consumer) {
    const original = consumer.originalPositionFor({ line: lineNumber + 1, column: columnNumber });
    if (original.source) {
      const source = original.source.replace(/^(\.\.\/)+/, '').replace(/^.*node_modules\//, '~');
      return `${original.name ?? functionName ?? '(anonymous)'} ${source}:${original.line}`;
    }
  }
  return `${functionName || '(anonymous)'} ${path.basename(url)}:${lineNumber + 1}:${columnNumber}`;
};

const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const self = new Map();
profile.samples.forEach((id, index) => {
  self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0));
});
const parent = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);

const selfByLabel = new Map();
const totalByLabel = new Map();
let total = 0;
for (const [id, micros] of self) {
  total += micros;
  const node = nodes.get(id);
  const name = label(node.callFrame);
  selfByLabel.set(name, (selfByLabel.get(name) ?? 0) + micros);
  // Inclusive time: once per distinct label on the stack, so recursion is not counted twice.
  const seen = new Set();
  for (let at = id; at !== undefined; at = parent.get(at)) {
    const frame = label(nodes.get(at).callFrame);
    if (seen.has(frame)) continue;
    seen.add(frame);
    totalByLabel.set(frame, (totalByLabel.get(frame) ?? 0) + micros);
  }
}
const appTop = [...totalByLabel].filter(([name]) => / src\//.test(name)).sort((a, b) => b[1] - a[1]);
const ms = (micros) => `${(micros / 1000).toFixed(1).padStart(8)} ms`;
const idle = ['(idle)', '(program)', '(garbage collector)', '(root)'];
console.log(`profile: ${ms(total)} sampled`);
console.log(`\nself time, top ${top}:`);
for (const [name, micros] of [...selfByLabel].sort((a, b) => b[1] - a[1]).slice(0, top))
  console.log(`${ms(micros)}  ${name}`);
console.log(`\ntotal time, top ${top} (idle and the root left out):`);
for (const [name, micros] of [...totalByLabel]
  .filter(([name]) => !idle.includes(name))
  .sort((a, b) => b[1] - a[1])
  .slice(0, top))
  console.log(`${ms(micros)}  ${name}`);
console.log(`\ntotal time of the app's own functions (src/), top ${top}:`);
for (const [name, micros] of appTop.slice(0, top)) console.log(`${ms(micros)}  ${name}`);

if (callersOf) {
  const pattern = new RegExp(callersOf);
  const byCaller = new Map();
  for (const [id, micros] of self) {
    let at = id;
    while (at !== undefined && !pattern.test(label(nodes.get(at).callFrame))) at = parent.get(at);
    if (at === undefined) continue;
    while (at !== undefined && !/ src\//.test(label(nodes.get(at).callFrame))) at = parent.get(at);
    const caller = at === undefined ? '(no app caller)' : label(nodes.get(at).callFrame);
    byCaller.set(caller, (byCaller.get(caller) ?? 0) + micros);
  }
  console.log(`\ntime under /${callersOf}/ by nearest app caller:`);
  for (const [name, micros] of [...byCaller].sort((a, b) => b[1] - a[1]).slice(0, top))
    console.log(`${ms(micros)}  ${name}`);
}
