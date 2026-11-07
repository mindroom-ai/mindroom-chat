import { mkdirSync, writeFileSync } from 'node:fs';
import {
  chromium,
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type CDPSession,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  buildBusyThreadRoom,
  instrumentScrolling,
  scrollRoom,
  startAgentStreams,
  startRecording,
  stopRecording,
  type RoomView,
  type ScrollInput,
} from '../helpers/busyThreadRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';
import { createDefaultThreadFilterState, seedRoomOverviewState } from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

/**
 * Scrolling a room with many threads (Bas, 2026-11-06: "jittery, and epileptic"). Opt in with
 * PERF_SCROLL_JITTER=1 and run it on the production build (`e2e-slot.sh --preview`).
 *
 * A room holds PERF_THREADS (default 320) threads the way MindRoom writes them: a person's
 * question, an agent's "Thinking..." reply finished by an edit with a long Markdown answer, the
 * agent's stop reaction redacted, a title notice, some follow-ups, reactions and pictures. The
 * reader has 25 other rooms. While PERF_STREAMS (default 3) agents keep streaming, the reader
 * scrolls the room's Compact, Threads and Classic views with the wheel (and on a Chromium phone,
 * with touch flings), and every animation frame is checked: rows already on screen must not move
 * against the scroll or change their height or text, the app must not write the scroll offset,
 * and frame times, long tasks, React commits and layout shifts are recorded. Results go to
 * test-results/perf/scroll-jitter*.json; PERF_TRACE=1 adds a Chromium performance trace and
 * PERF_FRAMES=1 a screencast frame strip.
 */

const enabled = process.env.PERF_SCROLL_JITTER === '1';
const THREADS = Number(process.env.PERF_THREADS ?? 320);
const OTHER_ROOMS = Number(process.env.PERF_ROOMS ?? 25);
const STREAMS = Number(process.env.PERF_STREAMS ?? 3);
const EDIT_MS = Number(process.env.PERF_EDIT_MS ?? 700);
const list = (name: string, fallback: string) => (process.env[name] ?? fallback).split(',');
const VIEWS = list('PERF_VIEWS', 'compact,threaded,classic');
const ENGINES = list('PERF_ENGINES', 'chromium,webkit');
const VIEWPORTS = list('PERF_VIEWPORTS', 'desktop,phone');
const THEMES = list('PERF_THEMES', 'light');
const THROTTLES = list('PERF_CPU_THROTTLE', '1,4').map(Number);
const TRACE = process.env.PERF_TRACE === '1';
const FRAMES = process.env.PERF_FRAMES === '1';
const PROFILE = process.env.PERF_PROFILE === '1';
const ASSERT = process.env.PERF_ASSERT === '1';
const OUT_DIR = 'test-results/perf';
const PASSWORD = 'thread-scroll-jitter-password';

const VIEWPORT_OPTIONS: Record<string, BrowserContextOptions> = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round((sorted[Math.max(0, index)] ?? Number.NaN) * 10) / 10;
};

const startTrace = async (cdp: CDPSession) => {
  await cdp.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    traceConfig: {
      includedCategories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame',
        'blink.user_timing',
        'latencyInfo',
        'v8.execute',
        'benchmark',
        'cc',
        'gpu',
      ],
    },
  });
};

const stopTrace = async (cdp: CDPSession, path: string) => {
  const complete = new Promise<string>((resolve) => {
    cdp.once('Tracing.tracingComplete', (event: { stream?: string }) =>
      resolve(event.stream ?? '')
    );
  });
  await cdp.send('Tracing.end');
  const stream = await complete;
  const chunks: string[] = [];
  for (;;) {
    const chunk = await cdp.send('IO.read', { handle: stream });
    chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString() : chunk.data);
    if (chunk.eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  writeFileSync(path, chunks.join(''));
};

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.describe('thread scroll jitter', () => {
  test.skip(!enabled, 'PERF_SCROLL_JITTER=1 not set');
  test.setTimeout(90 * 60_000);

  test('rows on screen stay put while the reader scrolls a room with many threads', async ({
    baseURL,
  }) => {
    test.skip(!(await disposableHomeserverIsUp()), 'the disposable homeserver is not running');
    const seedStart = Date.now();
    const world = await buildBusyThreadRoom({
      threads: THREADS,
      otherRooms: OTHER_ROOMS,
      password: PASSWORD,
    });
    const seedSeconds = Math.round((Date.now() - seedStart) / 1000);
    // eslint-disable-next-line no-console
    console.log(`PERF-JITTER seeded ${THREADS} threads in ${seedSeconds} s`);
    mkdirSync(OUT_DIR, { recursive: true });

    const results: Record<string, unknown>[] = [];
    for (const engine of ENGINES) {
      if (engine === 'webkit' && !WEBKIT_EXECUTABLE) continue;
      const browser: Browser =
        engine === 'webkit'
          ? await launchWebKit()
          : await chromium.launch(CHROMIUM_WITH_SCROLLBARS);
      try {
        for (const viewport of VIEWPORTS)
          for (const theme of THEMES)
            for (const throttle of engine === 'chromium' ? THROTTLES : [1])
              for (const view of VIEWS as RoomView[]) {
                const name = `${engine}-${viewport}-${theme}-${view}-x${throttle}`;
                const context = await browser.newContext({
                  baseURL,
                  locale: 'en-US',
                  ...VIEWPORT_OPTIONS[viewport],
                });
                await context.addInitScript(instrumentScrolling);
                await context.addInitScript((themeId) => {
                  const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
                  localStorage.setItem(
                    'settings',
                    JSON.stringify({ ...settings, useSystemTheme: false, themeId })
                  );
                }, `${theme}-theme`);
                const page = await context.newPage();
                const errors: string[] = [];
                page.on('pageerror', (error) => errors.push(error.message));
                try {
                  await loginWithPassword(page, {
                    homeserver: DISPOSABLE_HOMESERVER,
                    username: world.reader.username,
                    password: PASSWORD,
                  });
                  await seedRoomOverviewState({
                    page,
                    roomId: world.roomId,
                    userId: world.reader.userId,
                    viewMode: view,
                    filterState: createDefaultThreadFilterState(),
                  });
                  await page.goto(`/home/${encodeURIComponent(world.roomId)}`);
                  if (view === 'compact') {
                    const cards = page.locator(
                      '[data-compact-room-view="true"] [data-scroll-anchor]'
                    );
                    await expect
                      .poll(() => cards.count(), { timeout: 180_000 })
                      .toBeGreaterThanOrEqual(THREADS);
                  } else {
                    await expect(page.locator('[data-message-item]').first()).toBeVisible({
                      timeout: 120_000,
                    });
                  }
                  await page.waitForTimeout(4_000);
                  const cdp = engine === 'chromium' ? await context.newCDPSession(page) : undefined;
                  if (cdp && throttle > 1)
                    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
                  const load = startAgentStreams(world, STREAMS, EDIT_MS);
                  await page.waitForTimeout(2_000);
                  if (cdp && TRACE) await startTrace(cdp);
                  const frames: { t: number; data: string }[] = [];
                  if (cdp && FRAMES) {
                    cdp.on(
                      'Page.screencastFrame',
                      (frame: {
                        data: string;
                        sessionId: number;
                        metadata: { timestamp?: number };
                      }) => {
                        frames.push({
                          t: (frame.metadata.timestamp ?? 0) * 1000,
                          data: frame.data,
                        });
                        cdp
                          .send('Page.screencastFrameAck', { sessionId: frame.sessionId })
                          .catch(() => undefined);
                      }
                    );
                    await cdp.send('Page.startScreencast', {
                      format: 'jpeg',
                      quality: 60,
                      maxWidth: 720,
                      maxHeight: 900,
                      everyNthFrame: 1,
                    });
                  }
                  const input: ScrollInput =
                    viewport !== 'phone' ? 'wheel' : engine === 'chromium' ? 'touch' : 'drag';
                  if (cdp && PROFILE) {
                    await cdp.send('Profiler.enable');
                    await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
                    await cdp.send('Profiler.start');
                  }
                  const builds = () =>
                    page.evaluate(
                      () =>
                        (window as unknown as { __threadRecordBuilds?: number })
                          .__threadRecordBuilds ?? 0
                    );
                  const buildsBefore = await builds();
                  const at = await startRecording(page, view, input === 'touch');
                  const started = Date.now();
                  await scrollRoom(page, cdp, input, at);
                  const elapsed = Date.now() - started;
                  const state = await stopRecording(page);
                  const rebuilds = (await builds()) - buildsBefore;
                  if (cdp && FRAMES) {
                    await cdp.send('Page.stopScreencast');
                    mkdirSync(`${OUT_DIR}/${name}-frames`, { recursive: true });
                    frames.forEach((frame, index) =>
                      writeFileSync(
                        `${OUT_DIR}/${name}-frames/${String(index).padStart(4, '0')}-${Math.round(
                          frame.t
                        )}.jpg`,
                        Buffer.from(frame.data, 'base64')
                      )
                    );
                  }
                  if (cdp && TRACE) await stopTrace(cdp, `${OUT_DIR}/${name}.trace.json`);
                  if (cdp && PROFILE) {
                    const { profile } = await cdp.send('Profiler.stop');
                    writeFileSync(`${OUT_DIR}/${name}.cpuprofile`, JSON.stringify(profile));
                  }
                  await load.stop();
                  const loafScripts = new Map<string, number>();
                  state.loaf.forEach((frame) =>
                    frame.scripts.forEach((script) => {
                      const [invoker = '', fn = '', ms = '0'] = script.split('|');
                      const key = `${invoker} ${fn}`;
                      loafScripts.set(key, (loafScripts.get(key) ?? 0) + Number(ms));
                    })
                  );
                  const result = {
                    name,
                    engine,
                    viewport,
                    theme,
                    view,
                    throttle,
                    elapsedMs: elapsed,
                    scrolledPx: Math.round(state.scrolled),
                    rebuilds,
                    rebuildsPerSecond: Math.round((rebuilds / (elapsed / 1000)) * 10) / 10,
                    frames: state.frames.length,
                    frameP50: percentile(state.frames, 50),
                    frameP95: percentile(state.frames, 95),
                    frameP99: percentile(state.frames, 99),
                    framesOver34: state.frames.filter((ms) => ms > 34).length,
                    framesOver50: state.frames.filter((ms) => ms > 50).length,
                    longTasks: state.longTasks.length,
                    longTaskMs: state.longTasks.reduce((sum, ms) => sum + ms, 0),
                    loafCount: state.loaf.length,
                    loafTop: [...loafScripts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
                    commits: state.commits,
                    commitsPerFrame:
                      Math.round((state.commits / Math.max(1, state.frames.length)) * 100) / 100,
                    moveFrames: state.moveFrames,
                    layoutFrames: state.layoutFrames,
                    quietFrames: state.quietFrames,
                    maxMovePx: Math.round(state.maxMove),
                    totalMovePx: Math.round(state.totalMove),
                    heightChanges: state.heightChanges.length,
                    textChanges: state.textChanges.length,
                    scrollWrites: state.writes.length,
                    layoutShiftScore:
                      Math.round(
                        state.layoutShifts.reduce((sum, entry) => sum + entry.value, 0) * 1000
                      ) / 1000,
                    layoutShiftEntries: state.layoutShifts.length,
                    errors: errors.slice(0, 5),
                  };
                  // eslint-disable-next-line no-console
                  console.log(`PERF-JITTER ${JSON.stringify(result)}`);
                  writeFileSync(
                    `${OUT_DIR}/${name}.json`,
                    JSON.stringify({ result, state }, null, 1)
                  );
                  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
                  results.push(result);
                } finally {
                  await context.close();
                }
              }
      } finally {
        await browser.close();
      }
    }
    writeFileSync(`${OUT_DIR}/scroll-jitter.json`, JSON.stringify(results, null, 1));
    if (ASSERT) {
      for (const result of results) {
        expect(result.maxMovePx, `${String(result.name)} rows moved on screen`).toBe(0);
      }
    }
  });
});
