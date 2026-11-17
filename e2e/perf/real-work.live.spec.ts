/* eslint-disable no-await-in-loop, no-console */
// The scenarios run one after the other on one page, and the results go to the console as well.
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  STACK_SCRIPT,
  composer,
  expect,
  openLobby,
  test,
  type AgentStack,
} from '../helpers/agentStack';
import {
  installProbe,
  startProbe,
  timeToVisible,
  typeWithLatency,
  type ProbeResult,
  type Stats,
} from '../helpers/perfProbe';
import { setRoomCompact } from '../helpers/roomViewSwitch';

/**
 * What the Compact room view and an open thread cost while a real MindRoom backend streams many
 * agent replies. Opt in with PERF_REAL_WORK=1 and run it on the production build:
 *
 *   PERF_REAL_WORK=1 PERF_WORKLOAD=e2e/perf/workloads/real-work-smoke.json PERF_CPU_THROTTLE=1 \
 *     scripts/e2e-slot.sh <n> --snapshot --preview npx playwright test e2e/perf/real-work.live.spec.ts
 *
 * The load comes from scripts/perf/real-work/driver.py against the slot's agent stack, shaped by
 * the workload profile PERF_WORKLOAD (default e2e/perf/workloads/real-work-census.json): its
 * history phase fills the lobby once (kept in the stack's directory, so a later run reuses it),
 * then for each value of PERF_STREAMS (a list such as `7,25,50`; default the profile's
 * `live.streams`) its live phase keeps that many replies streaming, the spec waits 60 s for the
 * ramp, over which the driver spreads the first replies' starts so the windows do not all meet them
 * at the same point, and the scenarios run. A profile with more than one agent starts the stack with
 * `--agents <agents>` and stops it at the end.
 *
 * Scenarios, in this order, each one measurement window of e2e/helpers/perfProbe.ts:
 *
 *   compact-idle    30 s of the Compact view left alone
 *   compact-scroll  the wheel in 600 px steps, 10 s down and 10 s up
 *   thread-open     a press on a streaming thread's card to its first message row, and to the
 *                   rows it settles on, then 5 s
 *   thread-idle     30 s of the open thread left alone
 *   thread-type     10 s of typing in the thread's composer
 *   switch          Back, then another streaming thread, 5 times, each timed (the thread to its
 *                   first row and to its settled rows)
 *   cold-load       a reload of the room, to its first card, then 5 s
 *
 * Each writes test-results/perf/real-work/<scenario>-<engine>-<throttle>x-<streams>s.json: the
 * probe's result plus `timings` ({ name, ms } of the open, each switch and the cold load; an open
 * or a switch to a thread also has `<name>-settled`: the time from the same press to the frame
 * from which the message rows shown stayed the same ones for 1 s, with `rows`, how many they
 * were. A thread shows its first row before its history is there, so the first row alone can come
 * early on an open that keeps changing),
 * `typing` (key latency), `target` (the streams asked for) and `achieved` (what the driver saw in
 * its 5 s reports that overlap the window: replies streaming on average, live frames, edits and
 * jobs state writes a second, replies given up as stuck). A window that held under 80 % of the
 * target fails with both numbers, and so does one in which the driver stopped (its result then
 * has `driverExit`). The thread scenarios press a card that shows the app's streaming marker,
 * waiting up to 10 s for one, else the top card (among several that stream, one of the profile's
 * heavy threads, which hold as many replies as real ones do); `openedStreaming` says whether every card they
 * pressed showed it. Each result also goes to the console as a `PERF-REAL-WORK {json}` line.
 *
 * Knobs:
 *   PERF_CPU_THROTTLE  CPU slowdown rates, each repeating the scenarios (default `1,4`; Chromium)
 *   PERF_SCENARIOS     a list of the scenarios to run (default all)
 *   PERF_VIEWPORT      `phone` for 390x844 with touch (default 1440x900)
 *   PERF_PROFILE=1     a CPU profile of each window, <label>.cpuprofile
 *   PERF_TRACE=1       a Chrome trace of each window, <label>.trace.json
 *   PERF_SOAK=1        adds `soak` (run it alone with `-g soak`): PERF_SOAK_MINUTES (default 20) of
 *                      60 s Compact and 60 s thread in turn, in one window sampled every 5 s; it
 *                      fails when the heap ends more than 50 MB above where it began
 *   PERF_SOAK_GC=1     the soak forces a garbage collection before each of its samples, so the
 *                      heap it compares is what stays (a busy page lets garbage pile up between
 *                      collections, which the plain samples count); its result has `collected`
 *
 * External mode, for an account that is already there, in Chromium only (any other engine is
 * refused): PERF_TARGET=external with PERF_HOMESERVER (which must be on 127.0.0.1 or localhost),
 * PERF_USERNAME, PERF_PASSWORD and PERF_ROOM (a room ID). No stack and no driver: the page signs
 * in, there is no service worker, and `thread-open`, `thread-type`, `switch`, `cold-load` and
 * `compact-scroll` run on what the room holds. Nothing the page does reaches another host: `route`
 * aborts every request to one, a WebSocket to one is closed before it connects, and Chromium starts
 * with a proxy on a closed loopback port, which it never uses for loopback, so a request that
 * `route` does not see (a redirect from this machine to another host) fails at the proxy, and WebRTC,
 * which may only use the proxy, cannot leave this machine over UDP or TCP (no external scenario
 * starts a call). Results end in `-external`.
 */

const enabled = process.env.PERF_REAL_WORK === '1';
const external = process.env.PERF_TARGET === 'external';
const list = (name: string, fallback: string) =>
  (process.env[name] ?? fallback)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const SCENARIOS = [
  'compact-idle',
  'compact-scroll',
  'thread-open',
  'thread-idle',
  'thread-type',
  'switch',
  'cold-load',
] as const;
type Scenario = (typeof SCENARIOS)[number];
const EXTERNAL_SCENARIOS: Scenario[] = [
  'thread-open',
  'thread-type',
  'switch',
  'cold-load',
  'compact-scroll',
];
const wanted = list('PERF_SCENARIOS', SCENARIOS.join(','));
const scenarios = (external ? EXTERNAL_SCENARIOS : [...SCENARIOS]).filter((name) =>
  wanted.includes(name)
);

const WORKLOAD = process.env.PERF_WORKLOAD ?? 'e2e/perf/workloads/real-work-census.json';
const workload =
  enabled && !external
    ? (JSON.parse(readFileSync(WORKLOAD, 'utf8')) as {
        name: string;
        agents?: number;
        live: { streams: number };
      })
    : { name: 'none', live: { streams: 0 } };
const AGENTS = workload.agents ?? 1;
const STREAMS = list('PERF_STREAMS', String(workload.live.streams)).map(Number);
const THROTTLES = list('PERF_CPU_THROTTLE', '1,4').map(Number);
const PHONE = process.env.PERF_VIEWPORT === 'phone';
const PROFILE = process.env.PERF_PROFILE === '1';
const TRACE = process.env.PERF_TRACE === '1';
const SOAK = process.env.PERF_SOAK === '1';
const SOAK_MINUTES = Number(process.env.PERF_SOAK_MINUTES ?? 20);
const SOAK_GC = process.env.PERF_SOAK_GC === '1';
const SOAK_HEAP_MB = 50;
const OUT_DIR = 'test-results/perf/real-work';
const DRIVER = fileURLToPath(new URL('../../scripts/perf/real-work/driver.py', import.meta.url));
/** The driver's ramp (its `--ramp`), which its shortfall check leaves out as well. */
const RAMP_MS = 60_000;
/** The driver reports every 5 s. */
const REPORT_SECONDS = 5;
const SHARE = 0.8;
/** The word a Compact card shows beside its pulsing dot while an agent replies in its thread. */
const STREAMING_MARKER = 'streaming';
/** A scenario test's time limit at a CPU rate, and the soak's. */
const scenariosTimeout = (throttle: number) => 30 * 60_000 * Math.max(1, throttle / 2);
const SOAK_TIMEOUT = (SOAK_MINUTES + 15) * 60_000;
const VIEWPORT = PHONE ? { width: 390, height: 844 } : { width: 1440, height: 900 };

const CARD = '[data-compact-room-view] [data-thread-root-id]';
const ROW = '[data-message-id]';
const COLD_LOAD_FLAG = 'perf:real-work-cold-load';

type Timing = { name: string; ms: number; rows?: number };
type DriverLine = {
  t: number;
  target: number;
  streaming: number;
  frames: number;
  edits: number;
  jobs: number;
  stuck: number;
};
type Achieved = {
  reports: number;
  streaming: number;
  framesPerSecond: number;
  editsPerSecond: number;
  jobsPerSecond: number;
  stuck: number;
};
type Driver = {
  streams: number;
  lines: () => DriverLine[];
  /** The exit code once it has ended (null: killed by a signal), undefined while it runs. */
  ended: () => number | null | undefined;
  errors: () => string;
  stop: () => Promise<number | null>;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Starts the live phase. It ends on `stop`; `seconds` is when it ends by itself, so a worker that
 * was killed cannot leave it posting for good.
 */
const startDriver = (
  stateFile: string,
  historyFile: string,
  streams: number,
  seconds: number
): Driver => {
  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `driver-${streams}s.jsonl`);
  rmSync(out, { force: true });
  const child = spawn(
    'python3',
    [
      DRIVER,
      '--stack',
      stateFile,
      '--profile',
      WORKLOAD,
      '--phase',
      'live',
      '--history',
      historyFile,
      '--streams',
      String(streams),
      '--seconds',
      String(seconds),
      '--ramp',
      String(RAMP_MS / 1000),
      '--out',
      out,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => {
    errors = (errors + chunk.toString()).slice(-4000);
  });
  let code: number | null | undefined;
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (status) => {
      code = status;
      resolve(status);
    });
    child.on('error', (error) => {
      errors += String(error);
      code = 1;
      resolve(1);
    });
  });
  return {
    streams,
    lines: () =>
      existsSync(out)
        ? readFileSync(out, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as DriverLine)
        : [],
    ended: () => code,
    errors: () => errors,
    stop: async () => {
      if (code !== undefined) return code;
      child.kill('SIGTERM');
      // It ends within a /sync answer of the signal; one that does not is killed.
      const kill = setTimeout(() => child.kill('SIGKILL'), 5_000);
      const status = await exited;
      clearTimeout(kill);
      return status;
    },
  };
};

/**
 * What the driver saw between `from` and `to` (epoch ms): its reports whose 5 s overlap that
 * time, once the one that covers the end has been written. Undefined when it wrote none.
 */
const achievedBetween = async (
  driver: Driver,
  from: number,
  to: number
): Promise<Achieved | undefined> => {
  const deadline = Date.now() + 3 * REPORT_SECONDS * 1000;
  while (
    driver.ended() === undefined &&
    Date.now() < deadline &&
    !driver.lines().some((line) => line.t * 1000 >= to)
  ) {
    await sleep(500);
  }
  const reports = driver
    .lines()
    .filter((line) => line.t * 1000 > from && (line.t - REPORT_SECONDS) * 1000 < to);
  if (reports.length === 0) return undefined;
  const total = (key: 'streaming' | 'frames' | 'edits' | 'jobs' | 'stuck') =>
    reports.reduce((sum, line) => sum + line[key], 0);
  const seconds = reports.length * REPORT_SECONDS;
  return {
    reports: reports.length,
    streaming: round(total('streaming') / reports.length),
    framesPerSecond: round(total('frames') / seconds),
    editsPerSecond: round(total('edits') / seconds),
    jobsPerSecond: round(total('jobs') / seconds),
    stuck: total('stuck'),
  };
};

/**
 * On a load marked by the cold-load scenario, notes the first animation frame in which a card of
 * the Compact view is laid out and in the viewport, in milliseconds from the navigation's time
 * origin.
 */
const watchColdLoad = ({ flag, selector }: { flag: string; selector: string }) => {
  try {
    if (window !== window.top || !sessionStorage.getItem(flag)) return;
    sessionStorage.removeItem(flag);
  } catch {
    // A sandboxed frame has no storage.
    return;
  }
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  };
  const tick = () => {
    const now = performance.now();
    if (Array.from(document.querySelectorAll(selector)).some(visible)) {
      (window as unknown as { __realWorkFirstCard?: number }).__realWorkFirstCard = now;
    } else if (now < 180_000) {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
};

/** The recovery password prompt of a new session would cover the room. */
const dismissRecoveryPrompt = (page: Page): Promise<void> =>
  page.addLocatorHandler(
    page.getByRole('dialog').filter({ hasText: 'Set up your recovery password' }),
    (dialog) => dialog.getByRole('button', { name: 'Not now', exact: true }).click()
  );

type Run = {
  page: Page;
  engine: string;
  throttle: number;
  /** The label's last part: `<streams>s`, or `external`. */
  suffix: string;
  driver?: Driver;
  /** The threads the driver streams in; without them any card counts. */
  threads?: string[];
  /** Those of them with a real thread's many replies, which the thread scenarios open first. */
  heavy?: string[];
};

const cards = (page: Page) => page.locator(CARD);
const banner = (page: Page) => page.locator('[data-thread-context-banner]');
const back = (page: Page) => banner(page).getByRole('button', { name: 'Back', exact: true });

/** The threads of the Compact view's cards, top first, among those the driver streams in. */
const shownThreads = async (run: Run, of = cards(run.page)): Promise<string[]> => {
  const shown = await of.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-thread-root-id') ?? '')
  );
  const known = run.threads;
  return [...new Set(shown)].filter((root) => root && (!known || known.includes(root)));
};

/**
 * A thread to press: one whose card shows the app's streaming marker (the word beside the pulsing
 * dot) right now (a heavy thread, when one of them does), waiting up to 10 s under the driver's
 * load for one, else the top card. `except` leaves a thread out.
 */
const pickThread = async (run: Run, except = ''): Promise<{ root: string; streaming: boolean }> => {
  const { page } = run;
  const marked = cards(page).filter({ has: page.getByText(STREAMING_MARKER, { exact: true }) });
  const end = Date.now() + (run.driver ? 10_000 : 0);
  for (;;) {
    const streaming = (await shownThreads(run, marked)).filter((candidate) => candidate !== except);
    const root = streaming.find((candidate) => run.heavy?.includes(candidate)) ?? streaming[0];
    if (root) return { root, streaming: true };
    if (Date.now() >= end) break;
    await page.waitForTimeout(250);
  }
  const all = await shownThreads(run);
  const top = all.find((candidate) => candidate !== except) ?? all[0];
  if (!top) throw new Error('the Compact view shows no thread to open');
  return { root: top, streaming: false };
};

const card = (page: Page, root: string) =>
  page.locator(`${CARD}[data-thread-root-id="${root}"]`).first();

/** Shows the Compact view, leaving an open thread through its Back button. */
const showCompact = async (page: Page): Promise<void> => {
  if ((await banner(page).count()) > 0) await back(page).click();
  await expect(cards(page).first()).toBeVisible({ timeout: 120_000 });
  // Only the Compact view's cards: a message row here would end a thread's timing at once.
  await expect(page.locator(ROW)).toHaveCount(0);
};

/**
 * Opens a thread that streams now, from the Compact view, also when a thread is open: that one may
 * have gone quiet. Returns whether the pressed card showed the marker.
 */
const showThread = async (run: Run): Promise<boolean> => {
  const { page } = run;
  await showCompact(page);
  const { root, streaming } = await pickThread(run);
  await card(page, root).click();
  await expect(banner(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(ROW).first()).toBeVisible({ timeout: 60_000 });
  return streaming;
};

/** How long the shown rows must stay the same ones to count as settled. */
const SETTLED_QUIET_MS = 1_000;
type SettledOutcome = { ms?: number; rows?: number; error?: string };

/**
 * Watches, from the next press on, which message rows are shown (their event IDs, hidden rows
 * left out), once per animation frame, on the clock of `timeToVisible`. The promise it returns
 * gives the time from the press to the frame from which those rows stayed the same for
 * SETTLED_QUIET_MS, and how many rows that were. Call it before the press, and the function it
 * returns after it. Fails when the rows have not settled 30 s after the press.
 */
const watchRowsSettled = async (page: Page, name: string): Promise<() => Promise<Timing>> => {
  await page.evaluate(
    ({ selector, quietMs }) => {
      const shown = () =>
        Array.from(document.querySelectorAll(selector))
          .filter((row) =>
            row.checkVisibility
              ? row.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
              : true
          )
          .map((row) => row.getAttribute('data-message-id') ?? '');
      (window as unknown as { __realWorkSettled?: Promise<SettledOutcome> }).__realWorkSettled =
        new Promise<SettledOutcome>((resolve) => {
          const start = (event: Event) => {
            document.removeEventListener('pointerdown', start, true);
            const now = performance.now();
            const age = now - event.timeStamp;
            const startedAt = age >= 0 && age < 60_000 ? event.timeStamp : now;
            let rows: string[] = [];
            let changedAt = now;
            const tick = () => {
              const at = performance.now();
              const next = shown();
              if (next.join(' ') !== rows.join(' ')) {
                rows = next;
                changedAt = at;
              }
              if (rows.length > 0 && at - changedAt >= quietMs) {
                resolve({ ms: changedAt - startedAt, rows: rows.length });
              } else if (at - startedAt > 30_000) {
                resolve({ error: 'the rows shown had not stayed the same for 1 s after 30 s' });
              } else {
                requestAnimationFrame(tick);
              }
            };
            requestAnimationFrame(tick);
          };
          document.addEventListener('pointerdown', start, true);
        });
    },
    { selector: ROW, quietMs: SETTLED_QUIET_MS }
  );
  return async () => {
    const outcome = await page.evaluate(
      () => (window as unknown as { __realWorkSettled?: Promise<SettledOutcome> }).__realWorkSettled
    );
    if (outcome?.ms === undefined) {
      throw new Error(`${name}: ${outcome?.error ?? 'the page loaded again before rows settled'}`);
    }
    return { name, ms: round(outcome.ms), rows: outcome.rows };
  };
};

type Measured = { timings?: Timing[]; typing?: Stats; openedStreaming?: boolean };

const idle = async (run: Run): Promise<void> => {
  await run.page.waitForTimeout(30_000);
};

const SCENARIO: Record<
  Scenario,
  {
    /** Sets the view up; a thread scenario's gives whether the thread it opened streamed. */
    prepare: (run: Run) => Promise<boolean | void>;
    measure: (run: Run) => Promise<Measured | void>;
  }
> = {
  'compact-idle': { prepare: (run) => showCompact(run.page), measure: idle },
  'compact-scroll': {
    prepare: (run) => showCompact(run.page),
    measure: async ({ page }) => {
      await cards(page).first().hover();
      for (const step of [600, -600]) {
        const end = Date.now() + 10_000;
        while (Date.now() < end) {
          await page.mouse.wheel(0, step);
          await page.waitForTimeout(100);
        }
      }
    },
  },
  'thread-open': {
    prepare: (run) => showCompact(run.page),
    measure: async (run) => {
      const { page } = run;
      const { root, streaming } = await pickThread(run);
      const settled = await watchRowsSettled(page, 'open-settled');
      const ms = await timeToVisible(page, () => card(page, root).click(), ROW);
      await expect(banner(page)).toBeVisible();
      // The rest of the thread arrives and settles inside the window.
      const [settledTiming] = await Promise.all([settled(), page.waitForTimeout(5_000)]);
      return { timings: [{ name: 'open', ms }, settledTiming], openedStreaming: streaming };
    },
  },
  'thread-idle': { prepare: showThread, measure: idle },
  'thread-type': {
    prepare: showThread,
    measure: async ({ page }) => ({
      typing: await typeWithLatency(page, composer(page).last(), 10_000),
    }),
  },
  switch: {
    prepare: showThread,
    measure: async (run) => {
      const { page } = run;
      const timings: Timing[] = [];
      let openedStreaming = true;
      let current = '';
      for (let turn = 1; turn <= 5; turn += 1) {
        const backMs = await timeToVisible(page, () => back(page).click(), CARD);
        await expect(page.locator(ROW)).toHaveCount(0);
        timings.push({ name: `back-${turn}`, ms: backMs });
        // Another thread each time, one that streams when there is one.
        const { root, streaming } = await pickThread(run, current);
        current = root;
        openedStreaming &&= streaming;
        const settled = await watchRowsSettled(page, `switch-${turn}-settled`);
        const ms = await timeToVisible(page, () => card(page, root).click(), ROW);
        await expect(banner(page)).toBeVisible();
        timings.push({ name: `switch-${turn}`, ms });
        // As long as before when the rows settle at once: 1 s after the first row.
        const [settledTiming] = await Promise.all([settled(), page.waitForTimeout(1_000)]);
        timings.push(settledTiming);
      }
      return { timings, openedStreaming };
    },
  },
  'cold-load': {
    prepare: (run) => showCompact(run.page),
    measure: async ({ page }) => {
      // A reload cannot be timed from an input: the page that took it is gone. The new page
      // times itself from its time origin (watchColdLoad).
      await page.evaluate((flag) => sessionStorage.setItem(flag, '1'), COLD_LOAD_FLAG);
      await page.reload({ waitUntil: 'commit', timeout: 180_000 });
      const first = await page.waitForFunction(
        () => (window as unknown as { __realWorkFirstCard?: number }).__realWorkFirstCard,
        undefined,
        { timeout: 180_000 }
      );
      const ms = round(Number(await first.jsonValue()));
      // The first /sync answers and what they bring arrive inside the window.
      await page.waitForTimeout(5_000);
      return { timings: [{ name: 'cold-load', ms }] };
    },
  },
};

/**
 * Fails the test (softly, so the other scenarios still run) when the window's load fell short, or
 * the driver had ended by the end of it: the reports it wrote before can still average high.
 */
const checkLoad = (label: string, driver: Driver, achieved: Achieved | undefined): void => {
  const ended = driver.ended();
  expect
    .soft(
      ended,
      `${label}: the driver stopped with exit ${ended} inside the window: ${driver
        .errors()
        .trim()
        .slice(-500)}`
    )
    .toBeUndefined();
  expect
    .soft(
      achieved?.streaming ?? 0,
      `${label}: the driver held ${achieved?.streaming ?? 'no reported'} streams of the ${
        driver.streams
      } asked for, under ${SHARE * 100} %`
    )
    .toBeGreaterThanOrEqual(SHARE * driver.streams);
};

/**
 * Adds what the driver saw to a result file the probe wrote, and `driverExit` (its exit code,
 * null after a signal) when it had ended by then.
 */
const addAchieved = (label: string, driver: Driver, achieved: Achieved | undefined): void => {
  const file = join(OUT_DIR, `${label}.json`);
  const result = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const ended = driver.ended();
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        ...result,
        achieved: achieved ?? null,
        ...(ended === undefined ? {} : { driverExit: ended }),
      },
      null,
      2
    )}\n`
  );
};

/** Throws when the driver has ended: nothing measured from here on would be under its load. */
const expectDriverRuns = (label: string, driver: Driver | undefined): void => {
  if (driver && driver.ended() !== undefined) {
    throw new Error(
      `${label}: the driver stopped with exit ${driver.ended()}: ${driver.errors().trim()}`
    );
  }
};

const report = (
  result: ProbeResult,
  extra: { timings: Timing[]; typing?: Stats; openedStreaming?: boolean; target: number | null },
  achieved: Achieved | undefined,
  driver?: Driver
): void => {
  console.log(
    `PERF-REAL-WORK ${JSON.stringify({
      label: result.label,
      wallMs: result.wallMs,
      busy: result.metrics.busy,
      frames: result.frames,
      loaf: { count: result.loaf.count, over100: result.loaf.over100, p95: result.loaf.p95 },
      longTasks: result.longTasks,
      commits: result.commits,
      load: result.load,
      ...extra,
      achieved: achieved ?? null,
      ...(driver?.ended() === undefined ? {} : { driverExit: driver.ended() }),
      notes: result.notes,
    })}`
  );
};

/**
 * Slows the page's CPU; a rate above 1 needs Chromium. Each scenario sets it again: in the
 * Chromium that Playwright installs on a Mac a rate set once held for the first scenario only
 * (measured: the later scenarios' 4x results equalled the 1x ones). The cause is inferred, not
 * shown: the probe detaches its developer tools session at the end of each window, and Chromium
 * may put the rate back when a session of the page goes. This session therefore stays attached.
 */
const throttleCpu = async (page: Page, rate: number): Promise<void> => {
  if (rate === 1) return;
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
};

const runScenario = async (run: Run, name: Scenario): Promise<void> => {
  const { page, driver } = run;
  const label = `${name}-${run.engine}-${run.throttle}x-${run.suffix}`;
  await throttleCpu(page, run.throttle);
  const prepared = await SCENARIO[name].prepare(run);
  expectDriverRuns(label, driver);
  const from = Date.now();
  const probe = await startProbe(page, { label, outDir: OUT_DIR, profile: PROFILE, trace: TRACE });
  const extra = {
    scenario: name,
    engine: run.engine,
    throttle: run.throttle,
    viewport: VIEWPORT,
    target: driver?.streams ?? null,
    timings: [] as Timing[],
    typing: undefined as Stats | undefined,
    // Whether every thread the scenario opened showed the streaming marker when pressed.
    openedStreaming: typeof prepared === 'boolean' ? prepared : undefined,
  };
  try {
    const measured = await SCENARIO[name].measure(run);
    if (measured?.timings) extra.timings = measured.timings;
    extra.typing = measured?.typing;
    if (measured?.openedStreaming !== undefined) {
      extra.openedStreaming = (extra.openedStreaming ?? true) && measured.openedStreaming;
    }
  } catch (error) {
    await probe.stop({ ...extra, failed: String(error) }).catch(() => undefined);
    throw error;
  }
  // The window ends here: the stop writes profiles and traces after it closed the window.
  const to = Date.now();
  const result = await probe.stop(extra);
  const achieved = driver ? await achievedBetween(driver, from, to) : undefined;
  if (driver) {
    addAchieved(label, driver, achieved);
    checkLoad(label, driver, achieved);
  }
  report(result, extra, achieved, driver);
};

const runScenarios = async (run: Run): Promise<void> => {
  for (const name of scenarios) {
    await test.step(name, () => runScenario(run, name));
  }
};

test.use({
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  actionTimeout: 15_000,
  viewport: VIEWPORT,
  hasTouch: PHONE,
  ...(AGENTS > 1 ? { agentStackArgs: ['--agents', String(AGENTS)] } : {}),
});
/** A loopback port that nothing listens on: it was free a moment ago and is closed again. */
const closedLoopbackPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });

if (external) {
  // `route` does not see a redirect, and WebRTC cannot be routed at all, so Chromium also sends
  // everything but loopback to a proxy on a closed port, written as a raw argument: Playwright's
  // `proxy` option would send loopback through it as well. Chromium never proxies loopback, so the
  // homeserver and the app stay reachable; a request to another host fails at the proxy, and WebRTC
  // may only use the proxy (no UDP of its own, TCP through the dead proxy), so a call cannot leave
  // this machine. No external scenario starts one. Other engines are refused in the describe's
  // `beforeAll`. (Launch options cannot be set inside a describe.)
  test.use({
    launchOptions: [
      async ({ launchOptions, browserName }, use) => {
        if (browserName !== 'chromium') {
          await use(launchOptions);
          return;
        }
        const port = await closedLoopbackPort();
        await use({
          ...launchOptions,
          args: [
            ...(launchOptions.args ?? []),
            `--proxy-server=http://127.0.0.1:${port}`,
            '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
          ],
        });
      },
      { scope: 'worker' },
    ],
  });
}

test.describe('PERF: real work under the backend load', () => {
  test.skip(!enabled || external, 'PERF_REAL_WORK=1 without PERF_TARGET=external runs it');
  // One after the other, and a failed load level does not skip the next.
  test.describe.configure({ mode: 'default' });

  let stack: AgentStack | undefined;
  let directory = '';
  let stateFile = '';
  let historyFile = '';

  test.beforeAll(async ({ agentStackOrSkip }) => {
    test.setTimeout(55 * 60_000);
    test.skip(typeof agentStackOrSkip === 'string', String(agentStackOrSkip));
    stack = agentStackOrSkip as AgentStack;
    // The driver posts as the tester, whose token the state holds.
    directory = mkdtempSync(join(tmpdir(), 'real-work-'));
    stateFile = join(directory, 'stack.json');
    writeFileSync(stateFile, JSON.stringify(stack), { mode: 0o600 });
    chmodSync(directory, 0o700);

    // The history stays with the stack, whose lobby holds it.
    historyFile = join(stack.dir, `real-work-history-${workload.name}.json`);
    const kept = existsSync(historyFile)
      ? (JSON.parse(readFileSync(historyFile, 'utf8')) as { room?: string })
      : {};
    if (kept.room === stack.rooms.lobby) return;
    rmSync(historyFile, { force: true });
    const history = spawnSync(
      'python3',
      [
        DRIVER,
        '--stack',
        stateFile,
        '--profile',
        WORKLOAD,
        '--phase',
        'history',
        '--out',
        historyFile,
      ],
      { encoding: 'utf8', timeout: 30 * 60_000 }
    );
    if (history.status !== 0) {
      rmSync(historyFile, { force: true });
      throw new Error(
        `The driver's history phase failed (exit ${history.status}): ${(
          history.stderr || String(history.error ?? '')
        )
          .trim()
          .slice(-2000)}`
      );
    }
  });

  test.afterAll(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    // A stack with more agents was started for this spec only.
    if (stack && AGENTS > 1) {
      spawnSync('python3', [STACK_SCRIPT, String(stack.slot), 'down'], { timeout: 120_000 });
    }
  });

  const open = async (page: Page, running: AgentStack): Promise<void> => {
    await installProbe(page);
    await page.addInitScript(watchColdLoad, { flag: COLD_LOAD_FLAG, selector: CARD });
    await dismissRecoveryPrompt(page);
    await openLobby(page, running);
    await setRoomCompact(page, true);
    await expect(cards(page).first()).toBeVisible({ timeout: 120_000 });
  };

  for (const streams of STREAMS) {
    test.describe(`${streams} streams`, () => {
      let driver: Driver | undefined;

      test.beforeAll(async () => {
        test.setTimeout(5 * 60_000);
        // As long as this load level's tests may take together, and its ramp.
        const limit =
          RAMP_MS +
          THROTTLES.reduce((total, throttle) => total + scenariosTimeout(throttle), 0) +
          (SOAK ? SOAK_TIMEOUT : 0);
        driver = startDriver(stateFile, historyFile, streams, Math.ceil(limit / 1000) + 600);
        await sleep(RAMP_MS);
      });

      test.afterAll(async () => {
        if (!driver) return;
        const ended = driver.ended();
        const code = await driver.stop();
        // 0 after the SIGTERM; 2 is its shortfall, 1 a stack it could not use.
        if (ended !== undefined || code !== 0) {
          throw new Error(
            `The driver for ${streams} streams stopped with exit ${code}: ${driver.errors().trim()}`
          );
        }
      });

      const history = () => {
        const kept = JSON.parse(readFileSync(historyFile, 'utf8')) as {
          threads: string[];
          heavyThreads?: string[];
        };
        return { threads: kept.threads, heavy: kept.heavyThreads ?? [] };
      };

      for (const throttle of THROTTLES) {
        test(`scenarios at ${throttle}x CPU`, async ({ page, browserName }) => {
          test.skip(scenarios.length === 0, 'PERF_SCENARIOS names no scenario');
          test.skip(throttle !== 1 && browserName !== 'chromium', 'CPU throttling needs Chromium');
          test.setTimeout(scenariosTimeout(throttle));
          if (!stack || !driver) throw new Error('the stack or the driver did not start');
          await open(page, stack);
          await runScenarios({
            page,
            engine: browserName,
            throttle,
            suffix: `${streams}s`,
            driver,
            ...history(),
          });
        });
      }

      test('soak', async ({ page, browserName }) => {
        test.skip(!SOAK, 'PERF_SOAK=1 runs it');
        test.setTimeout(SOAK_TIMEOUT);
        if (!stack || !driver) throw new Error('the stack or the driver did not start');
        await open(page, stack);
        const run: Run = {
          page,
          engine: browserName,
          throttle: 1,
          suffix: `${streams}s`,
          driver,
          ...history(),
        };
        const label = `soak-${browserName}-1x-${streams}s`;
        const from = Date.now();
        const probe = await startProbe(page, {
          label,
          outDir: OUT_DIR,
          sampleMs: 5000,
          collectGarbage: SOAK_GC,
        });
        const extra = {
          scenario: 'soak',
          engine: browserName,
          throttle: 1,
          viewport: VIEWPORT,
          target: streams,
          timings: [] as Timing[],
          // Whether each sample of `series` followed a forced garbage collection.
          collected: SOAK_GC,
        };
        try {
          const end = from + SOAK_MINUTES * 60_000;
          while (Date.now() < end) {
            expectDriverRuns(label, driver);
            await showCompact(page);
            await page.waitForTimeout(60_000);
            expectDriverRuns(label, driver);
            await showThread(run);
            await page.waitForTimeout(60_000);
          }
        } catch (error) {
          await probe.stop({ ...extra, failed: String(error) }).catch(() => undefined);
          throw error;
        }
        const to = Date.now();
        const result = await probe.stop(extra);
        const achieved = await achievedBetween(driver, from, to);
        addAchieved(label, driver, achieved);
        checkLoad(label, driver, achieved);
        report(result, { timings: [], target: streams }, achieved, driver);
        const first = result.series[0]?.heapMB ?? 0;
        const last = result.series.at(-1)?.heapMB ?? 0;
        expect(
          last - first,
          `the heap went from ${first} MB to ${last} MB in ${SOAK_MINUTES} minutes`
        ).toBeLessThanOrEqual(SOAK_HEAP_MB);
      });
    });
  }
});

/** The external homeserver, when it is on this machine; anything else is refused. */
const loopbackHomeserver = (): string => {
  const homeserver = process.env.PERF_HOMESERVER ?? '';
  let host = '';
  try {
    host = new URL(homeserver).hostname;
  } catch {
    // Not a URL: refused below.
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(
      `PERF_HOMESERVER is "${homeserver}": external mode only measures a homeserver on 127.0.0.1 or localhost, and made no request`
    );
  }
  return homeserver;
};

const externalPage = async (browser: Browser, baseURL: string | undefined): Promise<Page> => {
  const homeserver = loopbackHomeserver();
  // Not the fixtures' context: that one starts the agent stack and signs its tester in.
  const context = await browser.newContext({
    baseURL,
    storageState: undefined,
    viewport: VIEWPORT,
    hasTouch: PHONE,
    locale: 'en-US',
    serviceWorkers: 'block',
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      await route.abort();
      return;
    }
    if (url.pathname !== '/config.json') {
      await route.continue();
      return;
    }
    // Fetched by Playwright, outside Chromium and its proxy guard: a redirect is not followed.
    const response = await route.fetch({ maxRedirects: 0 });
    if (response.status() >= 300 && response.status() < 400) {
      await route.abort();
      return;
    }
    const config = (await response.json()) as Record<string, Record<string, unknown>>;
    await route.fulfill({
      response,
      json: {
        ...config,
        homeserverList: [homeserver],
        defaultHomeserver: 0,
        sidebar: { ...config.sidebar, showMindRoom: false, mindRoomProvisioningUrl: '' },
        encryptionRecovery: { ...config.encryptionRecovery, promptAtStart: false },
        tour: { ...config.tour, offerAtStart: false },
      },
    });
  });
  // `route` does not see WebSockets: one to another host is closed before it connects.
  await context.routeWebSocket(/^wss?:\/\//, async (socket) => {
    const { hostname } = new URL(socket.url());
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      socket.connectToServer();
      return;
    }
    await socket.close({ code: 1008, reason: 'external mode stays on this machine' });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await installProbe(page);
  await page.addInitScript(watchColdLoad, { flag: COLD_LOAD_FLAG, selector: CARD });
  await dismissRecoveryPrompt(page);
  await loginWithPassword(page, {
    homeserver,
    username: process.env.PERF_USERNAME ?? '',
    password: process.env.PERF_PASSWORD ?? '',
  });
  await page.goto(`/home/${encodeURIComponent(process.env.PERF_ROOM ?? '')}`, {
    timeout: 180_000,
  });
  await setRoomCompact(page, true);
  await expect(cards(page).first()).toBeVisible({ timeout: 240_000 });
  return page;
};

test.describe('PERF: real work on an external account', () => {
  test.skip(!enabled || !external, 'PERF_REAL_WORK=1 with PERF_TARGET=external runs it');
  test.describe.configure({ mode: 'default' });

  // Before any fixture that starts a browser, so a refused homeserver or engine starts none.
  test.beforeAll(({ browserName }) => {
    if (browserName !== 'chromium') {
      throw new Error(
        `external mode runs in Chromium only: its guard against requests to other hosts is a Chromium proxy setting, and this is ${browserName}`
      );
    }
    loopbackHomeserver();
    for (const name of ['PERF_USERNAME', 'PERF_PASSWORD', 'PERF_ROOM']) {
      if (!process.env[name]) throw new Error(`external mode needs ${name}`);
    }
  });

  for (const throttle of THROTTLES) {
    test(`scenarios at ${throttle}x CPU`, async ({ browser, browserName, baseURL }) => {
      test.skip(scenarios.length === 0, 'PERF_SCENARIOS names no scenario');
      test.skip(throttle !== 1 && browserName !== 'chromium', 'CPU throttling needs Chromium');
      test.setTimeout(scenariosTimeout(throttle));
      const page = await externalPage(browser, baseURL);
      try {
        await runScenarios({ page, engine: browserName, throttle, suffix: 'external' });
      } finally {
        await page.context().unrouteAll({ behavior: 'ignoreErrors' });
        await page.context().close();
      }
    });
  }
});
