#!/usr/bin/env node
// How long inserting message rows takes under the app's style sheets, in WebKit and Chromium.
//
// WebKit spent ~0.2 ms per inserted row in the app's document against ~0.001 ms in Chromium or in
// a shadow root (perf/mac-app/idiom-fps-2026-11-19): style invalidation on insertion, which some
// selectors make expensive. This page has the built style sheets and a copy of a thread's DOM, so
// the cost can be measured, and its selectors bisected, without a homeserver.
//
// Usage: node scripts/perf/webkit-insert-probe.mjs [options]
//   --page <file>     HTML snapshot of the app (from e2e/perf/webkit-insert-snapshot.live.spec.ts);
//                     default: an empty body under every style sheet of --dist
//   --dist <dir>      production build whose assets/*.css the default page loads (default dist)
//   --rows <n>        rows per insert (default 1000)
//   --runs <n>        inserts per measurement; the median counts (default 7)
//   --engines <list>  comma-separated, chromium and/or webkit (default both)
//   --bisect          also measure the page with each style sheet left out, then with each rule of
//                     the costliest sheets left out, and list the rules whose removal saves most
//   --top <n>         rules to list (default 15)
//   --floor <ms>      smallest saving the bisection follows (default a twentieth of the insert time)
//   --json <file>     write the results there too
// Browsers: CHROMIUM_PATH and PLAYWRIGHT_WEBKIT_EXECUTABLE name the executables; unset, Playwright's
// own. On NixOS, run it in mcr.microsoft.com/playwright:v<version>-noble (the version in
// package.json), whose WebKit has its libraries.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, webkit } from '@playwright/test';

const { values: opts } = parseArgs({
  options: {
    page: { type: 'string' },
    dist: { type: 'string', default: 'dist' },
    rows: { type: 'string', default: '1000' },
    runs: { type: 'string', default: '7' },
    engines: { type: 'string', default: 'chromium,webkit' },
    bisect: { type: 'boolean', default: false },
    top: { type: 'string', default: '15' },
    floor: { type: 'string' },
    json: { type: 'string' },
  },
});

const ROW_FALLBACK =
  '<div data-message-item><div><b>Placeholder sender</b> <span>alpha beta gamma delta epsilon zeta eta theta</span></div></div>';

const defaultPage = () => {
  const dir = join(opts.dist, 'assets');
  const sheets = readdirSync(dir)
    .filter((name) => name.endsWith('.css'))
    .sort()
    .map(
      (name) => `<style data-probe-sheet="${name}">${readFileSync(join(dir, name), 'utf8')}</style>`
    );
  return `<!doctype html><html lang="en" dir="ltr"><head>${sheets.join(
    '\n'
  )}</head><body><div id="root"></div></body></html>`;
};

// Runs in the page: the probe's measurements and the switches the bisection flips.
const pageProbe = () => {
  const probe = {};
  const sheetName = (sheet, index) =>
    sheet.ownerNode?.dataset?.probeSheet ?? sheet.href?.split('/').pop() ?? `sheet-${index}`;
  probe.sheets = () =>
    [...document.styleSheets].map((sheet, index) => ({
      name: sheetName(sheet, index),
      rules: sheet.cssRules.length,
    }));
  // The snapshot's own rows, repeated in turn.
  const rowsHtml = (count) => {
    const rows = [...document.querySelectorAll('[data-message-item]')].map((row) => row.outerHTML);
    if (rows.length === 0) rows.push(window.__probeFallbackRow);
    return Array.from({ length: count }, (_, index) => rows[index % rows.length]).join('');
  };
  // The rows go where the thread's rows are, so ancestors and siblings match as in the app.
  const target = () => {
    const row = document.querySelector('[data-message-item]');
    return row?.parentElement ?? document.getElementById('root') ?? document.body;
  };
  // In a shadow root the app's selectors do not reach the rows: the engine's own cost.
  probe.measure = (rows, runs, shadow = false) => {
    const html = rowsHtml(rows);
    const parent = target();
    const insert = [];
    const style = [];
    for (let run = 0; run < runs; run += 1) {
      let holder = document.createElement('div');
      parent.appendChild(holder);
      if (shadow)
        holder = holder.attachShadow({ mode: 'open' }).appendChild(document.createElement('div'));
      void document.body.offsetHeight;
      const t0 = performance.now();
      holder.innerHTML = html;
      const t1 = performance.now();
      void document.body.offsetHeight;
      const t2 = performance.now();
      insert.push(t1 - t0);
      style.push(t2 - t1);
      (holder.getRootNode().host ?? holder).remove();
      void document.body.offsetHeight;
    }
    const median = (list) => list.sort((a, b) => a - b)[Math.floor(list.length / 2)];
    return { insertMs: median(insert), styleLayoutMs: median(style) };
  };
  probe.setSheetDisabled = (index, disabled) => {
    document.styleSheets[index].disabled = disabled;
  };
  // Leaves out the top-level rules [from, to) of a sheet, keeping their text to put them back.
  const removed = new Map();
  probe.removeRules = (sheetIndex, from, to) => {
    const sheet = document.styleSheets[sheetIndex];
    const texts = [];
    for (let rule = from; rule < to; rule += 1) texts.push(sheet.cssRules[rule].cssText);
    for (let rule = to - 1; rule >= from; rule -= 1) sheet.deleteRule(rule);
    removed.set(`${sheetIndex}:${from}`, texts);
    return texts;
  };
  probe.restoreRules = (sheetIndex, from) => {
    const key = `${sheetIndex}:${from}`;
    removed.get(key).forEach((text, offset) => {
      document.styleSheets[sheetIndex].insertRule(text, from + offset);
    });
    removed.delete(key);
  };
  probe.ruleText = (sheetIndex, ruleIndex) =>
    document.styleSheets[sheetIndex].cssRules[ruleIndex].cssText;
  window.__probe = probe;
};

const ROWS = Number(opts.rows);
const RUNS = Number(opts.runs);
const TOP = Number(opts.top);
const html = opts.page ? readFileSync(opts.page, 'utf8') : defaultPage();

const launchers = {
  chromium: () => chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }),
  webkit: () =>
    webkit.launch({ executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE || undefined }),
};

const measure = (page) =>
  page.evaluate(([rows, runs]) => window.__probe.measure(rows, runs), [ROWS, RUNS]);
const perThousand = (ms) => Math.round((ms * 1000 * 100) / ROWS) / 100;

const bisect = async (page, base) => {
  const sheets = await page.evaluate(() => window.__probe.sheets());
  const sheetCosts = [];
  for (const [index, sheet] of sheets.entries()) {
    await page.evaluate((i) => window.__probe.setSheetDisabled(i, true), index);
    const without = await measure(page);
    await page.evaluate((i) => window.__probe.setSheetDisabled(i, false), index);
    sheetCosts.push({ ...sheet, index, savesMs: base.insertMs - without.insertMs });
  }
  sheetCosts.sort((a, b) => b.savesMs - a.savesMs);
  const ruleCosts = [];
  // Halves the rules of each sheet that saves at least a tenth of the insert time, keeping every
  // half that still saves that much, down to single rules.
  const floor = opts.floor ? Number(opts.floor) : Math.max(base.insertMs / 20, 1);
  const saves = async (sheet, from, to) => {
    await page.evaluate(
      ([s, f, t]) => window.__probe.removeRules(s, f, t),
      [sheet.index, from, to]
    );
    const without = await measure(page);
    await page.evaluate(([s, f]) => window.__probe.restoreRules(s, f), [sheet.index, from]);
    return base.insertMs - without.insertMs;
  };
  const split = async (sheet, from, to, saved) => {
    if (to - from === 1) {
      const text = await page.evaluate(
        ([s, r]) => window.__probe.ruleText(s, r),
        [sheet.index, from]
      );
      ruleCosts.push({ sheet: sheet.name, rule: from, savesMs: saved, text: text.slice(0, 400) });
      return;
    }
    const middle = Math.floor((from + to) / 2);
    for (const [f, t] of [
      [from, middle],
      [middle, to],
    ]) {
      const part = await saves(sheet, f, t);
      if (part >= floor) await split(sheet, f, t, part);
    }
  };
  for (const sheet of sheetCosts.filter((s) => s.savesMs >= floor)) {
    await split(sheet, 0, sheet.rules, sheet.savesMs);
  }
  ruleCosts.sort((a, b) => b.savesMs - a.savesMs);
  return { sheets: sheetCosts, rules: ruleCosts.slice(0, TOP) };
};

const results = {};
for (const engine of opts.engines.split(',')) {
  const browser = await launchers[engine]();
  try {
    const page = await (
      await browser.newContext({ viewport: { width: 1280, height: 900 } })
    ).newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate((row) => {
      window.__probeFallbackRow = row;
    }, ROW_FALLBACK);
    await page.evaluate(pageProbe);
    const base = await measure(page);
    const shadow = await page.evaluate(
      ([rows, runs]) => window.__probe.measure(rows, runs, true),
      [ROWS, RUNS]
    );
    const result = {
      ...base,
      insertMsPer1000Rows: perThousand(base.insertMs),
      shadowRoot: shadow,
      sheets: (await page.evaluate(() => window.__probe.sheets())).length,
      nodes: await page.evaluate(() => document.getElementsByTagName('*').length),
    };
    console.log(
      `${engine}: ${ROWS} rows, insert ${base.insertMs.toFixed(
        1
      )} ms, style+layout ${base.styleLayoutMs.toFixed(
        1
      )} ms; in a shadow root insert ${shadow.insertMs.toFixed(
        1
      )} ms, style+layout ${shadow.styleLayoutMs.toFixed(1)} ms (${result.sheets} sheets, ${
        result.nodes
      } nodes)`
    );
    if (opts.bisect) {
      result.bisect = await bisect(page, base);
      for (const sheet of result.bisect.sheets.slice(0, 5))
        console.log(
          `  without ${sheet.name} (${sheet.rules} rules): saves ${sheet.savesMs.toFixed(1)} ms`
        );
      for (const rule of result.bisect.rules)
        console.log(
          `  without ${rule.sheet}#${rule.rule}: saves ${rule.savesMs.toFixed(
            1
          )} ms  ${rule.text.slice(0, 160)}`
        );
    }
    results[engine] = result;
  } finally {
    await browser.close();
  }
}
if (opts.json)
  writeFileSync(opts.json, `${JSON.stringify({ rows: ROWS, runs: RUNS, results }, null, 2)}\n`);
