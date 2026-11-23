import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

type ViewportCase = { name: 'desktop' | 'phone'; options: BrowserContextOptions };
const VIEWPORTS: ViewportCase[] = [
  { name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
  { name: 'phone', options: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
];

const HARNESS_HTML = `<!doctype html>
<html>
<head><style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  #scroller { height: 100vh; overflow-y: auto; overflow-x: hidden; overflow-anchor: none; position: relative; }
  #inner { position: relative; width: 100%; }
  .row { position: absolute; left: 0; right: 0; height: 96px; box-sizing: border-box; border-bottom: 1px solid #ccc; font: 14px monospace; padding: 8px; }
</style></head>
<body>
<div id="scroller"><div id="inner"></div></div>
<script>
(() => {
  const scroller = document.getElementById('scroller');
  const inner = document.getElementById('inner');
  const ROW_H = 100;
  let state = {
    headroom: 0,
    firstId: 100,
    count: 60,
    stallMs: 150,
    writeDelta: 0,
    wheelPx: 0,
    frames: [],
    prevTop: 0,
    prevRows: new Map(),
    sampling: false,
  };

  function render() {
    inner.style.height = (state.headroom + state.count * ROW_H) + 'px';
    inner.innerHTML = '';
    const viewTop = scroller.scrollTop;
    const viewH = scroller.clientHeight;
    const startIdx = Math.max(0, Math.floor((viewTop - state.headroom - viewH) / ROW_H));
    const endIdx = Math.min(state.count - 1, Math.ceil((viewTop - state.headroom + viewH * 2) / ROW_H));
    for (let i = startIdx; i <= endIdx; i++) {
      const id = state.firstId + i;
      const el = document.createElement('div');
      el.className = 'row';
      el.dataset.id = String(id);
      el.style.top = (state.headroom + i * ROW_H) + 'px';
      el.textContent = 'row ' + id;
      inner.appendChild(el);
    }
  }

  function writeScrollTop(next, takeover) {
    const from = scroller.scrollTop;
    const delta = next - from;
    state.writeDelta += delta;
    if (takeover) {
      scroller.style.overflowY = 'hidden';
      void scroller.offsetHeight;
    }
    scroller.scrollTop = next;
    if (state.stallMs > 0 && Math.abs(delta) >= 48) {
      const until = performance.now() + state.stallMs;
      while (performance.now() < until) {}
    }
    if (takeover) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        scroller.style.overflowY = 'auto';
      }));
    }
  }

  window.addEventListener('wheel', (e) => {
    if (state.sampling) state.wheelPx += e.deltaY;
  }, { capture: true, passive: true });

  scroller.addEventListener('scroll', () => {
    render();
  }, { passive: true });

  function tick() {
    if (state.sampling) {
      const view = scroller.getBoundingClientRect();
      const cur = new Map();
      const moved = [];
      for (const el of inner.querySelectorAll('.row')) {
        const r = el.getBoundingClientRect();
        if (r.bottom <= view.top || r.top >= view.bottom) continue;
        const id = el.dataset.id;
        cur.set(id, r.top);
        const prev = state.prevRows.get(id);
        if (prev !== undefined) moved.push(r.top - prev);
      }
      const ds = moved.slice().sort((a, b) => a - b);
      const median = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
      const st = scroller.scrollTop;
      const dScroll = st - state.prevTop;
      const appDelta = state.writeDelta;
      state.writeDelta = 0;
      const wheelPx = state.wheelPx;
      state.wheelPx = 0;
      const movedPx = dScroll - appDelta;
      const unexplained = ds.length ? median + movedPx : 0;
      const lostPlace = ds.length === 0 && cur.size > 0 && state.prevRows.size > 0;
      if (state.prevRows.size > 0) {
        state.frames.push({
          t: Math.round(performance.now()),
          st: Math.round(st),
          dScroll: Math.round(dScroll),
          appDelta: Math.round(appDelta),
          wheelPx: Math.round(wheelPx),
          median: Math.round(median),
          unexplained: Math.round(unexplained),
          lostPlace,
          headroom: state.headroom,
        });
      }
      state.prevTop = st;
      state.prevRows = cur;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.__proto = {
    init({ headroom, count, scrollTop, stallMs = 150 }) {
      state.headroom = headroom;
      state.firstId = 100;
      state.count = count;
      state.stallMs = stallMs;
      state.writeDelta = 0;
      state.wheelPx = 0;
      state.frames = [];
      state.prevRows = new Map();
      state.sampling = false;
      render();
      scroller.scrollTop = scrollTop;
      render();
      state.prevTop = scroller.scrollTop;
    },
    startSampling() {
      state.frames = [];
      state.writeDelta = 0;
      state.wheelPx = 0;
      state.prevTop = scroller.scrollTop;
      state.prevRows = new Map();
      state.sampling = true;
    },
    prepend({ rows, mode }) {
      const deltaPx = rows * ROW_H;
      state.firstId -= rows;
      state.count += rows;
      if (mode === 'headroom') {
        const consumed = Math.min(state.headroom, deltaPx);
        state.headroom -= consumed;
        const deficit = deltaPx - consumed;
        render();
        if (deficit > 0) writeScrollTop(scroller.scrollTop + deficit, false);
        render();
        return { consumed, deficit };
      }
      render();
      writeScrollTop(scroller.scrollTop + deltaPx, mode === 'takeover');
      render();
      return { consumed: 0, deficit: deltaPx };
    },
    trimHeadroom({ mode }) {
      const trim = state.headroom;
      state.headroom = 0;
      render();
      const target = Math.max(0, scroller.scrollTop - trim);
      writeScrollTop(target, mode === 'takeover');
      render();
      return { trim, target };
    },
    stop() {
      state.sampling = false;
      const frames = state.frames;
      const maxUnexplained = Math.max(0, ...frames.map((f) => Math.abs(f.unexplained)));
      const maxReversal = Math.max(0, ...frames.map((f) => (f.median < 0 ? -f.median : 0)));
      const lostPlace = frames.filter((f) => f.lostPlace).length;
      const totalWheel = frames.reduce((s, f) => s + f.wheelPx, 0);
      const totalRow = frames.reduce((s, f) => s + f.median, 0);
      const badFrames = frames.filter(
        (f) => Math.abs(f.unexplained) >= 8 || f.median <= -6 || f.lostPlace
      );
      return {
        frameCount: frames.length,
        finalScrollTop: Math.round(scroller.scrollTop),
        headroom: state.headroom,
        maxUnexplained,
        maxReversal,
        lostPlace,
        totalWheel: Math.round(totalWheel),
        totalRow: Math.round(totalRow),
        badFrames: badFrames.slice(0, 8),
      };
    },
  };
})();
</script>
</body>
</html>`;

async function runCase(page: Page, label: string, fn: () => Promise<void>) {
  await page.setContent(HARNESS_HTML);
  await fn();
  const report = await page.evaluate(() => (window as unknown as { __proto: { stop: () => unknown } }).__proto.stop());
  // eslint-disable-next-line no-console
  console.log(`PROTO ${label}: ${JSON.stringify(report)}`);
  return report as {
    maxUnexplained: number;
    maxReversal: number;
    lostPlace: number;
    totalWheel: number;
    totalRow: number;
    finalScrollTop: number;
    badFrames: unknown[];
  };
}

test.describe('prototype: WebKit headroom hard cases (a) and (b)', () => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');

  for (const vp of VIEWPORTS) {
    test(`webkit ${vp.name}: probe hard cases (a) prepend-at-0 while wheeling and (b) burst overtaking final trim`, async () => {
      const browser = await launchWebKit();
      try {
        const context = await browser.newContext(vp.options);
        const page = await context.newPage();
        const cx = Math.floor((vp.options.viewport?.width ?? 800) / 2);
        const cy = Math.floor((vp.options.viewport?.height ?? 600) / 2);
        await page.mouse.move(cx, cy);

        // (a1) Prepend +2400px at scrollTop=0 while actively wheeling up (raw scrollTop write + 150ms stall)
        const aRaw = await runCase(page, `${vp.name}/a-raw-prepend-at-0`, async () => {
          await page.evaluate(() => (window as any).__proto.init({ headroom: 0, count: 60, scrollTop: 0, stallMs: 150 }));
          await page.evaluate(() => (window as any).__proto.startSampling());
          await page.waitForTimeout(50);
          for (let i = 0; i < 4; i++) {
            await page.mouse.wheel(0, -240);
            await page.waitForTimeout(16);
          }
          const prependPromise = page.evaluate(() => (window as any).__proto.prepend({ rows: 24, mode: 'raw' }));
          await page.waitForTimeout(50);
          for (let i = 0; i < 6; i++) {
            await page.mouse.wheel(0, -240);
            await page.waitForTimeout(16);
          }
          await prependPromise;
          await page.waitForTimeout(400);
        });

        // (a2) Prepend +2400px at scrollTop=0 while wheeling up WITH explicit overflow-y:hidden takeover
        const aTakeover = await runCase(page, `${vp.name}/a-takeover-prepend-at-0`, async () => {
          await page.evaluate(() => (window as any).__proto.init({ headroom: 0, count: 60, scrollTop: 0, stallMs: 150 }));
          await page.evaluate(() => (window as any).__proto.startSampling());
          await page.waitForTimeout(50);
          for (let i = 0; i < 4; i++) {
            await page.mouse.wheel(0, -240);
            await page.waitForTimeout(16);
          }
          const prependPromise = page.evaluate(() => (window as any).__proto.prepend({ rows: 24, mode: 'takeover' }));
          await page.waitForTimeout(50);
          for (let i = 0; i < 6; i++) {
            await page.mouse.wheel(0, -240);
            await page.waitForTimeout(16);
          }
          await prependPromise;
          await page.waitForTimeout(400);
        });

        // (a3) Prepend +2400px absorbed by headroom=3000 while actively wheeling up (zero scrollTop write)
        const aHeadroom = await runCase(page, `${vp.name}/a-headroom-absorbs`, async () => {
          await page.evaluate(() => (window as any).__proto.init({ headroom: 3000, count: 60, scrollTop: 3200, stallMs: 150 }));
          await page.evaluate(() => (window as any).__proto.startSampling());
          await page.waitForTimeout(50);
          for (let i = 0; i < 4; i++) {
            await page.mouse.wheel(0, -240);
            await page.waitForTimeout(16);
          }
          await page.evaluate(() => (window as any).__proto.prepend({ rows: 24, mode: 'headroom' }));
          for (let i = 0; i < 6; i++) {
            await page.mouse.wheel(0, -240);
            await page.waitForTimeout(16);
          }
          await page.waitForTimeout(400);
        });

        // (b1) New wheel burst overtaking final headroom trim (-1200px, raw scrollTop write + 150ms stall)
        const bRaw = await runCase(page, `${vp.name}/b-raw-trim-overtaken`, async () => {
          await page.evaluate(() => (window as any).__proto.init({ headroom: 1200, count: 60, scrollTop: 3000, stallMs: 150 }));
          await page.evaluate(() => (window as any).__proto.startSampling());
          await page.waitForTimeout(50);
          const trimPromise = page.evaluate(() => (window as any).__proto.trimHeadroom({ mode: 'raw' }));
          await page.waitForTimeout(50);
          for (let i = 0; i < 8; i++) {
            await page.mouse.wheel(0, -240);
            await page.waitForTimeout(16);
          }
          await trimPromise;
          await page.waitForTimeout(500);
        });

        // (b2) New wheel burst overtaking final headroom trim (-1200px, overflow-y:hidden takeover + 150ms stall)
        const bTakeover = await runCase(page, `${vp.name}/b-takeover-trim-overtaken`, async () => {
          await page.evaluate(() => (window as any).__proto.init({ headroom: 1200, count: 60, scrollTop: 3000, stallMs: 150 }));
          await page.evaluate(() => (window as any).__proto.startSampling());
          await page.waitForTimeout(50);
          const trimPromise = page.evaluate(() => (window as any).__proto.trimHeadroom({ mode: 'takeover' }));
          await page.waitForTimeout(50);
          for (let i = 0; i < 8; i++) {
            await page.mouse.wheel(0, -240);
            await page.waitForTimeout(16);
          }
          await trimPromise;
          await page.waitForTimeout(500);
        });

        // Sanity assertion on the headroom absorption path (must be 0 jump!)
        expect(aHeadroom.maxUnexplained).toBeLessThanOrEqual(8);
        expect(aHeadroom.maxReversal).toBeLessThanOrEqual(4);
        expect(aHeadroom.lostPlace).toBe(0);
        // Log summary so we inspect raw vs takeover empirically
        expect(aRaw.finalScrollTop).toBeGreaterThanOrEqual(0);
        expect(aTakeover.finalScrollTop).toBeGreaterThanOrEqual(0);
        expect(bRaw.finalScrollTop).toBeGreaterThanOrEqual(0);
        expect(bTakeover.finalScrollTop).toBeGreaterThanOrEqual(0);
      } finally {
        await browser.close();
      }
    });
  }
});
