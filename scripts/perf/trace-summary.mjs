#!/usr/bin/env node
// Where a page's main thread spent its time in a Chrome trace (e2e/perf/client-speed.live.spec.ts
// writes them with PERF_TRACE=1): style, layout, paint, compositing, script and the rest, by the
// top-level work of the renderer's main thread, so nested events are not counted twice.
//
//   node scripts/perf/trace-summary.mjs <file.trace.json> [--top 20]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const topIndex = args.indexOf('--top');
const top = topIndex < 0 ? 20 : Number(args.splice(topIndex, 2)[1]);
const data = JSON.parse(readFileSync(args[0], 'utf8'));
const events = Array.isArray(data) ? data : data.traceEvents;

const threadNames = new Map();
for (const event of events)
  if (event.ph === 'M' && event.name === 'thread_name')
    threadNames.set(`${event.pid}:${event.tid}`, event.args.name);
// The busiest renderer main thread is the page's.
const busy = new Map();
for (const event of events) {
  const key = `${event.pid}:${event.tid}`;
  if (threadNames.get(key) === 'CrRendererMain' && event.ph === 'X')
    busy.set(key, (busy.get(key) ?? 0) + (event.dur ?? 0));
}
const main = [...busy].sort((a, b) => b[1] - a[1])[0]?.[0];

const own = new Map();
const total = new Map();
const spans = events
  .filter((event) => `${event.pid}:${event.tid}` === main && event.ph === 'X' && event.dur > 0)
  .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
// Self time per event name: an event's duration minus that of the events directly inside it.
const stack = [];
for (const event of spans) {
  while (stack.length && stack[stack.length - 1].end <= event.ts) stack.pop();
  const parent = stack[stack.length - 1];
  if (parent) own.set(parent.name, (own.get(parent.name) ?? 0) - event.dur);
  own.set(event.name, (own.get(event.name) ?? 0) + event.dur);
  if (!stack.some((open) => open.name === event.name))
    total.set(event.name, (total.get(event.name) ?? 0) + event.dur);
  stack.push({ name: event.name, end: event.ts + event.dur });
}
const ms = (micros) => `${(micros / 1000).toFixed(1).padStart(9)} ms`;
const first = spans[0]?.ts ?? 0;
const last = spans.reduce((end, event) => Math.max(end, event.ts + event.dur), first);
console.log(`main thread ${main}, ${ms(last - first)} traced`);
console.log(`\nself time by event, top ${top}:`);
for (const [name, micros] of [...own].sort((a, b) => b[1] - a[1]).slice(0, top))
  console.log(`${ms(micros)}  ${name}`);
console.log(`\ntotal time by event, top ${top}:`);
for (const [name, micros] of [...total].sort((a, b) => b[1] - a[1]).slice(0, top))
  console.log(`${ms(micros)}  ${name}`);
