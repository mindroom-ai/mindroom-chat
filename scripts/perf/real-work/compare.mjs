#!/usr/bin/env node
// Compare real-work perf runs of two commits: node compare.mjs --base <dir>... --head <dir>... [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const round = (v, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Metric name to value for one result; metrics that are absent are left out. */
function metricsOf(result) {
  const out = {};
  const put = (name, value) => {
    const v = num(value);
    if (v !== undefined) out[name] = v;
  };
  put('metrics.busy', result.metrics?.busy);
  put('frames.p95', result.frames?.p95);
  put('loaf.count', result.loaf?.count);
  put('loaf.p95', result.loaf?.p95);
  // inputs only exist where typing or clicks happened
  if (num(result.inputs?.count) > 0) put('inputs.p95', result.inputs.p95);
  const last = Array.isArray(result.series) ? result.series.at(-1) : undefined;
  put('series.heapMB', last?.heapMB);
  put('series.nodes', last?.nodes);
  const byName = new Map();
  for (const t of result.timings ?? []) {
    if (typeof t?.name === 'string' && num(t.ms) !== undefined) {
      byName.set(t.name, [...(byName.get(t.name) ?? []), t.ms]);
    }
  }
  for (const [name, list] of byName) put(`timings.${name}`, median(list));
  return out;
}

// The share of the target streams a window must have held, as the spec checks it.
const SHARE = 0.8;

/**
 * Why a result is left out of the medians, or undefined when it counts: the driver had stopped
 * (`driverExit`), the scenario threw inside its window (`failed`), or the window held under 80 %
 * of the streams asked for (the spec's soft failure). External results have no target.
 */
export function exclusion(result) {
  if (result.driverExit !== undefined) return `driverExit ${result.driverExit}`;
  if (result.failed !== undefined) return 'failed';
  const target = num(result.target);
  if (target > 0) {
    const streaming = num(result.achieved?.streaming);
    if (!(streaming >= SHARE * target)) return `held ${streaming ?? 'no'} of ${target} streams`;
  }
  return undefined;
}

/** label to metric to values (one per run), leaving out the results `exclusion` names. */
function collect(runs) {
  const labels = new Map();
  for (const run of runs) {
    for (const result of run) {
      if (!result?.label || exclusion(result) !== undefined) continue;
      const metrics = labels.get(result.label) ?? new Map();
      labels.set(result.label, metrics);
      for (const [name, value] of Object.entries(metricsOf(result))) {
        metrics.set(name, [...(metrics.get(name) ?? []), value]);
      }
    }
  }
  return labels;
}

/** Each result left out, as `<label> (<reason>)`, sorted. */
export function excludedLabels(base, head) {
  const out = new Set();
  for (const run of [...base, ...head]) {
    for (const r of run) {
      const reason = r?.label ? exclusion(r) : undefined;
      if (reason !== undefined) out.add(`${r.label} (${reason})`);
    }
  }
  return [...out].sort();
}

/**
 * One row per label and metric present on both sides, except a metric that is 0 in every run of
 * both: a statistic with nothing to count, such as `frames.p95` of `cold-load` (the reload loses
 * the page's frames) or `metrics.busy` in an engine without Chrome's metrics.
 */
export function compareRuns(base, head) {
  const b = collect(base);
  const h = collect(head);
  const rows = [];
  for (const label of [...b.keys()].filter((l) => h.has(l)).sort()) {
    for (const [metric, baseValues] of b.get(label)) {
      const headValues = h.get(label).get(metric);
      if (!headValues) continue;
      if ([...baseValues, ...headValues].every((v) => v === 0)) continue;
      const baseMedian = median(baseValues);
      const headMedian = median(headValues);
      rows.push({
        label,
        metric,
        base: round(baseMedian),
        head: round(headMedian),
        changePct: baseMedian === 0 ? (headMedian === 0 ? 0 : null) : round(((headMedian - baseMedian) / baseMedian) * 100, 2),
        overlap: Math.min(...headValues) <= Math.max(...baseValues) && Math.max(...headValues) >= Math.min(...baseValues),
      });
    }
  }
  return rows;
}

function loadDir(dir) {
  if (!fs.existsSync(dir)) throw new Error(`${dir}: no such directory`);
  if (!fs.statSync(dir).isDirectory()) throw new Error(`${dir}: not a directory`);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const file = path.join(dir, f);
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (error) {
        throw new Error(`${file}: ${error.message}`);
      }
    })
    .filter((r) => r && typeof r.label === 'string');
}

function parseArgs(argv) {
  const args = { base: [], head: [], json: false };
  let side;
  for (const a of argv) {
    if (a === '--base') side = 'base';
    else if (a === '--head') side = 'head';
    else if (a === '--json') args.json = true;
    else if (a.startsWith('--') || !side) throw new Error(`unexpected argument: ${a}`);
    else args[side].push(a);
  }
  if (!args.base.length || !args.head.length) {
    throw new Error('usage: compare.mjs --base <dir>... --head <dir>... [--json]');
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.base.map(loadDir);
  const head = args.head.map(loadDir);
  const excluded = excludedLabels(base, head);
  if (excluded.length) {
    console.error(`warning: left out results the spec failed or measured under a short load: ${excluded.join(', ')}`);
  }
  const rows = compareRuns(base, head);
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const w = Math.max(5, ...rows.map((r) => r.label.length));
  const m = Math.max(6, ...rows.map((r) => r.metric.length));
  console.log(`${'label'.padEnd(w)}  ${'metric'.padEnd(m)}  ${'base'.padStart(10)}  ${'head'.padStart(10)}  ${'change'.padStart(9)}  overlap`);
  for (const r of rows) {
    const change = r.changePct === null ? 'n/a' : `${r.changePct > 0 ? '+' : ''}${r.changePct}%`;
    console.log(
      `${r.label.padEnd(w)}  ${r.metric.padEnd(m)}  ${String(r.base).padStart(10)}  ${String(r.head).padStart(10)}  ${change.padStart(9)}  ${r.overlap}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`compare.mjs: ${error.message}`);
    process.exit(2);
  }
}
