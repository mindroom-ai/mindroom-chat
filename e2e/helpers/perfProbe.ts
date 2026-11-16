import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import type { CDPSession, Locator, Page, Response } from '@playwright/test';

/**
 * One measurement of the page for the perf specs: what a window of time cost the main thread
 * (frames, long animation frames, long tasks, React commits, Chrome's task, script, layout and
 * style time, heap and DOM size), the load the homeserver delivered in it, and how long the page
 * took to answer input. `installProbe` before the first navigation, then `startProbe` and
 * `Probe.stop` around each window; `timeToVisible` and `typeWithLatency` stand alone.
 *
 * The page side only buffers; Node reads it once, at the end of a window, so a CPU profile of the
 * window holds the app's work and not the probe's.
 */

export type Stats = { count: number; p50: number; p95: number; max: number };

export type ProbeResult = {
  label: string;
  wallMs: number;
  /** Milliseconds between animation frames. */
  frames: Stats;
  /** Long animation frames (over 50 ms); `top` sums their scripts by source. */
  loaf: { count: number; over100: number; p95: number; top: { source: string; ms: number }[] };
  longTasks: { count: number; totalMs: number };
  /** React commits. */
  commits: number;
  /** Layout shifts that did not follow an input, and the sum of their scores. */
  layoutShifts: { count: number; score: number };
  /** Chrome's main-thread totals over the window; `busy` is `taskMs` over `wallMs`. */
  metrics: {
    taskMs: number;
    scriptMs: number;
    layoutMs: number;
    styleMs: number;
    layoutCount: number;
    styleCount: number;
    busy: number;
  };
  /** Heap and DOM size every `sampleMs`, `t` in seconds from the start of the window. */
  series: { t: number; heapMB: number; nodes: number }[];
  /** What the /sync answers of the window carried, over all joined rooms. */
  load: { seconds: number; frames: number; edits: number; jobs: number; syncs: number };
  /** Event Timing: each press or key that took 16 ms or more, by its slowest event. */
  inputs: Stats;
  /** What this engine or page could not measure; such fields hold zeros or nothing. */
  notes: string[];
};

export type Probe = {
  /** Ends the window and writes the result, with `extra` merged in, to `<outDir>/<label>.json`. */
  stop: (extra?: Record<string, unknown>) => Promise<ProbeResult>;
};

type PageProbe = {
  recording: boolean;
  /** Whether the probe's own hook hears React's commits. */
  hooked: boolean;
  supported: string[];
  frames: number[];
  commits: number;
  longTasks: number[];
  loaf: { ms: number; scripts: { source: string; ms: number }[] }[];
  inputs: { interaction: number; ms: number }[];
  shifts: number[];
  begin: () => void;
};
type VisibleOutcome = { ms?: number; error?: string };
type ProbeWindow = Window & {
  __perfProbe?: PageProbe;
  __perfProbeVisible?: { done: Promise<VisibleOutcome>; cancel: () => void };
  __perfProbeKeys?: { samples: number[]; listener: (event: KeyboardEvent) => void };
};

const round = (value: number) => Math.round(value * 10) / 10;

const stats = (values: number[]): Stats => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => {
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return round(sorted[Math.max(0, index)] ?? 0);
  };
  return { count: sorted.length, p50: at(50), p95: at(95), max: at(100) };
};

/** The page side, installed before the app. Observers drop what they see outside a window. */
const pageProbe = () => {
  const supported = [...(PerformanceObserver.supportedEntryTypes ?? [])];
  const state: PageProbe = {
    recording: false,
    hooked: false,
    supported,
    frames: [],
    commits: 0,
    longTasks: [],
    loaf: [],
    inputs: [],
    shifts: [],
    begin: () => {
      state.frames = [];
      state.commits = 0;
      state.longTasks = [];
      state.loaf = [];
      state.inputs = [];
      state.shifts = [];
      state.recording = true;
      let last = 0;
      const tick = (now: number) => {
        if (!state.recording) return;
        if (last) state.frames.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
  };
  (window as unknown as ProbeWindow).__perfProbe = state;

  // React announces each commit to the developer tools hook.
  const hookWindow = window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
  if (!hookWindow.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    let renderer = 0;
    hookWindow.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      isDisabled: false,
      renderers: new Map(),
      inject() {
        renderer += 1;
        return renderer;
      },
      checkDCE() {},
      onScheduleFiberRoot() {},
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      onCommitFiberRoot() {
        if (state.recording) state.commits += 1;
      },
    };
    state.hooked = true;
  }

  const observe = (
    type: string,
    record: (entry: PerformanceEntry) => void,
    options: Record<string, unknown> = {}
  ) => {
    if (!supported.includes(type)) return;
    new PerformanceObserver((list) => {
      if (state.recording) list.getEntries().forEach(record);
    }).observe({ type, buffered: false, ...options } as PerformanceObserverInit);
  };
  observe('longtask', (entry) => state.longTasks.push(entry.duration));
  observe('long-animation-frame', (entry) => {
    const frame = entry as PerformanceEntry & {
      scripts: {
        invoker: string;
        sourceFunctionName: string;
        sourceURL: string;
        duration: number;
      }[];
    };
    state.loaf.push({
      ms: frame.duration,
      scripts: frame.scripts
        .filter((script) => script.duration > 5)
        .map((script) => ({
          source: [
            script.invoker,
            script.sourceFunctionName,
            script.sourceURL.split('/').pop()?.split('?')[0],
          ]
            .filter(Boolean)
            .join(' | '),
          ms: script.duration,
        })),
    });
  });
  observe(
    'event',
    (entry) => {
      // An entry without an interaction (a hover, a pointer move) is not a press or a key.
      const interaction = (entry as PerformanceEntry & { interactionId?: number }).interactionId;
      if (interaction) state.inputs.push({ interaction, ms: entry.duration });
    },
    { durationThreshold: 16 }
  );
  observe('layout-shift', (entry) => {
    const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
    if (!shift.hadRecentInput) state.shifts.push(shift.value);
  });
};

/** Call before the page's first navigation. */
export const installProbe = (page: Page): Promise<void> => page.addInitScript(pageProbe);

type Metrics = {
  taskMs: number;
  scriptMs: number;
  layoutMs: number;
  styleMs: number;
  layoutCount: number;
  styleCount: number;
  heapMB: number;
  nodes: number;
};

/** The page's totals so far (Chrome's Performance domain). */
const readMetrics = async (session: CDPSession): Promise<Metrics> => {
  const { metrics } = await session.send('Performance.getMetrics');
  const value = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? 0;
  return {
    taskMs: value('TaskDuration') * 1000,
    scriptMs: value('ScriptDuration') * 1000,
    layoutMs: value('LayoutDuration') * 1000,
    styleMs: value('RecalcStyleDuration') * 1000,
    layoutCount: value('LayoutCount'),
    styleCount: value('RecalcStyleCount'),
    heapMB: value('JSHeapUsedSize') / 1024 / 1024,
    nodes: value('Nodes'),
  };
};

type Json = Record<string, unknown>;
const record = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};
const events = (section: unknown): Json[] => {
  const list = record(section).events;
  return Array.isArray(list) ? list.map(record) : [];
};

/**
 * The load one /sync answer carries: live frames, edits and jobs state writes over its joined
 * rooms; undefined for an answer without joined rooms (a long poll that timed out).
 */
const countSync = (body: unknown): { frames: number; edits: number; jobs: number } | undefined => {
  const rooms = Object.values(record(record(record(body).rooms).join));
  if (rooms.length === 0) return undefined;
  const counts = { frames: 0, edits: 0, jobs: 0 };
  rooms.forEach((room) => {
    const joined = record(room);
    counts.frames += events(joined.ephemeral).filter(
      (event) => event.type === 'io.mindroom.live'
    ).length;
    const timeline = events(joined.timeline);
    counts.edits += timeline.filter(
      (event) => record(record(event.content)['m.relates_to']).rel_type === 'm.replace'
    ).length;
    // A state write comes in the timeline, and with `state_after` in that section as well.
    const jobs = [
      ...events(joined.state),
      ...events(joined.state_after),
      ...events(joined['org.matrix.msc4222.state_after']),
      ...timeline,
    ].filter(
      (event) => event.type === 'io.mindroom.background_jobs' && event.state_key !== undefined
    );
    const ids = new Set(jobs.map((event) => event.event_id).filter(Boolean));
    counts.jobs += ids.size + jobs.filter((event) => !event.event_id).length;
  });
  return counts;
};

/**
 * Starts a measurement window. `profile` records a CPU profile of it into `<label>.cpuprofile`
 * and `trace` a Chrome trace into `<label>.trace.json`, which scripts/perf/trace-summary.mjs
 * reads (both Chromium only; either slows the page, so its numbers do not compare with a plain
 * window). `sampleMs` (default 1000) is the time between the samples of `series`. With
 * `collectGarbage` (Chromium only) every sample first forces a garbage collection, so `series`
 * holds the heap and the nodes that stay, not what waits for the collector; the collections cost
 * main-thread time, so the window's other numbers do not compare with a plain window. A full
 * page load inside the window drops what the page had buffered until then.
 */
export const startProbe = async (
  page: Page,
  options: {
    label: string;
    outDir: string;
    profile?: boolean;
    trace?: boolean;
    sampleMs?: number;
    collectGarbage?: boolean;
  }
): Promise<Probe> => {
  const {
    label,
    outDir,
    profile = false,
    trace = false,
    sampleMs = 1000,
    collectGarbage = false,
  } = options;
  const notes: string[] = [];

  // Only Chromium has a developer tools session; without one the Chrome numbers stay empty.
  const session = await page
    .context()
    .newCDPSession(page)
    .catch(() => undefined);
  if (!session) {
    notes.push(
      `no CDP session in this engine: metrics are zeros, series is empty${
        profile ? ', no CPU profile' : ''
      }${trace ? ', no trace' : ''}`
    );
  }

  const load = { frames: 0, edits: 0, jobs: 0, syncs: 0 };
  const parsing = new Set<Promise<void>>();
  const onResponse = (response: Response) => {
    if (!response.url().includes('/_matrix/client/v3/sync')) return;
    const parsed = response
      .json()
      .then((body: unknown) => {
        const counts = countSync(body);
        if (!counts) return;
        load.frames += counts.frames;
        load.edits += counts.edits;
        load.jobs += counts.jobs;
        load.syncs += 1;
      })
      // Not JSON, or the body is gone (an aborted request, a closed page).
      .catch(() => undefined)
      .finally(() => parsing.delete(parsed));
    parsing.add(parsed);
  };

  const series: ProbeResult['series'] = [];
  let startedAt = 0;
  let timer: NodeJS.Timeout | undefined;
  let profiling = false;
  let tracing = false;
  let attached = session !== undefined;
  const sample = async (from: CDPSession) => {
    if (collectGarbage) await from.send('HeapProfiler.collectGarbage');
    const now = await readMetrics(from);
    series.push({
      t: round((Date.now() - startedAt) / 1000),
      heapMB: round(now.heapMB),
      nodes: now.nodes,
    });
    return now;
  };
  /** Lets go of whatever is still held, after a normal end or a failure; never throws. */
  const release = async () => {
    clearInterval(timer);
    page.off('response', onResponse);
    if (!session || !attached) return;
    if (profiling) await session.send('Profiler.stop').catch(() => undefined);
    if (tracing) await session.send('Tracing.end').catch(() => undefined);
    profiling = false;
    tracing = false;
    attached = false;
    await session.detach().catch(() => undefined);
  };

  let before: Metrics | undefined;
  try {
    const installed = await page.evaluate(
      () => (window as unknown as ProbeWindow).__perfProbe !== undefined
    );
    if (!installed) throw new Error('startProbe: call installProbe(page) before the page loads');
    if (session) {
      await session.send('Performance.enable');
      if (trace) {
        await session.send('Tracing.start', {
          transferMode: 'ReturnAsStream',
          traceConfig: {
            includedCategories: [
              'devtools.timeline',
              'disabled-by-default-devtools.timeline',
              'v8.execute',
              'blink',
            ],
          },
        });
        tracing = true;
      }
      if (profile) {
        await session.send('Profiler.enable');
        await session.send('Profiler.setSamplingInterval', { interval: 200 });
        await session.send('Profiler.start');
        profiling = true;
      }
    }
    // The window opens here, in the reverse of the order in which `stop` closes it.
    startedAt = Date.now();
    page.on('response', onResponse);
    await page.evaluate(() => (window as unknown as ProbeWindow).__perfProbe?.begin());
    if (session) {
      before = await sample(session);
      timer = setInterval(() => {
        // A sample that fails (the page is closing) is left out.
        sample(session).catch(() => undefined);
      }, sampleMs);
    }
  } catch (error) {
    await release();
    throw error;
  }

  const finish = async (extra: Record<string, unknown>): Promise<ProbeResult> => {
    // The window closes first, before anything slow: Chrome's totals, the page's buffers, the
    // load counter and the clock, so every number of the result covers the same time.
    clearInterval(timer);
    const after = session ? await sample(session) : undefined;
    const seen = await page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).__perfProbe;
      if (!probe) return undefined;
      const { recording, hooked, supported, frames, commits, longTasks, loaf, inputs, shifts } =
        probe;
      probe.recording = false;
      return { recording, hooked, supported, frames, commits, longTasks, loaf, inputs, shifts };
    });
    page.off('response', onResponse);
    const wallMs = Date.now() - startedAt;
    // The profile and the trace end with the window too, before the wait for parsing below.
    let cpuProfile: unknown;
    if (session && profiling) {
      ({ profile: cpuProfile } = await session.send('Profiler.stop'));
      profiling = false;
    }
    let traced: Promise<{ stream?: string }> | undefined;
    if (session && tracing) {
      traced = new Promise<{ stream?: string }>((resolve) => {
        session.once('Tracing.tracingComplete', resolve);
      });
      await session.send('Tracing.end');
      tracing = false;
    }

    // Answers that arrived inside the window may still be parsing. One that a page load cut off
    // never settles in Chromium, so the wait has an end.
    let waited: NodeJS.Timeout | undefined;
    const unparsed = await Promise.race([
      Promise.all(parsing).then(() => 0),
      new Promise<number>((resolve) => {
        waited = setTimeout(() => resolve(parsing.size), 5000);
      }),
    ]);
    clearTimeout(waited);
    if (unparsed > 0) {
      notes.push(
        `${unparsed} /sync answers never finished loading (a page load cut them off): load leaves them out`
      );
    }
    mkdirSync(outDir, { recursive: true });
    if (cpuProfile !== undefined) {
      writeFileSync(`${outDir}/${label}.cpuprofile`, JSON.stringify(cpuProfile));
    }
    if (session && traced) {
      const { stream } = await traced;
      const file = `${outDir}/${label}.trace.json`;
      writeFileSync(file, '');
      if (stream === undefined) {
        notes.push('the trace came without a stream: the trace file is empty');
      } else {
        for (;;) {
          const chunk = await session.send('IO.read', { handle: stream });
          appendFileSync(file, chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
          if (chunk.eof) break;
        }
        await session.send('IO.close', { handle: stream });
      }
    }

    const metrics = { taskMs: 0, scriptMs: 0, layoutMs: 0, styleMs: 0 };
    const counted = { layoutCount: 0, styleCount: 0 };
    if (after && before) {
      metrics.taskMs = round(after.taskMs - before.taskMs);
      metrics.scriptMs = round(after.scriptMs - before.scriptMs);
      metrics.layoutMs = round(after.layoutMs - before.layoutMs);
      metrics.styleMs = round(after.styleMs - before.styleMs);
      counted.layoutCount = after.layoutCount - before.layoutCount;
      counted.styleCount = after.styleCount - before.styleCount;
    }

    if (!seen?.recording) {
      notes.push('the page loaded again inside the window: its page-side counts were lost');
    }
    const buffered = seen ?? {
      frames: [],
      commits: 0,
      longTasks: [],
      loaf: [],
      inputs: [],
      shifts: [],
    };
    if (seen) {
      (
        [
          ['long-animation-frame', 'loaf'],
          ['longtask', 'longTasks'],
          ['event', 'inputs'],
          ['layout-shift', 'layoutShifts'],
        ] as const
      ).forEach(([type, field]) => {
        if (!seen.supported.includes(type)) {
          notes.push(`no ${type} entries in this engine: ${field} is zeros`);
        }
      });
      if (!seen.hooked) {
        notes.push('another React developer tools hook was installed: commits is 0');
      }
    }

    const sources = new Map<string, number>();
    buffered.loaf.forEach((frame) =>
      frame.scripts.forEach((script) =>
        sources.set(script.source, (sources.get(script.source) ?? 0) + script.ms)
      )
    );
    // Event Timing reports several events of one press (pointerdown, pointerup, click; keydown,
    // keypress, keyup) under one interaction: the longest of them stands for the press.
    const interactions = new Map<number, number>();
    buffered.inputs.forEach(({ interaction, ms }) =>
      interactions.set(interaction, Math.max(interactions.get(interaction) ?? 0, ms))
    );
    const loafMs = buffered.loaf.map((frame) => frame.ms);

    const result: ProbeResult = {
      label,
      wallMs,
      frames: stats(buffered.frames),
      loaf: {
        count: loafMs.length,
        over100: loafMs.filter((ms) => ms > 100).length,
        p95: stats(loafMs).p95,
        top: [...sources]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([source, ms]) => ({ source, ms: round(ms) })),
      },
      longTasks: {
        count: buffered.longTasks.length,
        totalMs: round(buffered.longTasks.reduce((total, ms) => total + ms, 0)),
      },
      commits: buffered.commits,
      layoutShifts: {
        count: buffered.shifts.length,
        score:
          Math.round(buffered.shifts.reduce((total, value) => total + value, 0) * 10000) / 10000,
      },
      metrics: {
        ...metrics,
        ...counted,
        busy: wallMs > 0 ? Math.round((metrics.taskMs / wallMs) * 1000) / 1000 : 0,
      },
      series,
      load: { seconds: round(wallMs / 1000), ...load },
      inputs: stats([...interactions.values()]),
      notes,
    };
    writeFileSync(
      `${outDir}/${label}.json`,
      `${JSON.stringify({ ...result, ...extra }, null, 2)}\n`
    );
    return result;
  };
  const stop = async (extra: Record<string, unknown> = {}): Promise<ProbeResult> => {
    try {
      return await finish(extra);
    } finally {
      // Also after a failure (a closed page): the profiler and the trace end, the session goes.
      await release();
    }
  };
  return { stop };
};

/**
 * Milliseconds from the input event of `act` (its first press or key) to the first animation
 * frame in which an element matching `selector` is laid out and in the viewport, read when that
 * frame's callbacks run, so the work the input started counts. `act` must not load the page
 * again. Fails when `act` makes no press or key within 60 s, or the element is not visible 60 s
 * after it.
 */
export const timeToVisible = async (
  page: Page,
  act: () => Promise<void>,
  selector: string
): Promise<number> => {
  await page.evaluate((watched) => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth)
        return false;
      return element.checkVisibility
        ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : true;
    };
    let settle: (outcome: VisibleOutcome) => void = () => {};
    let cancelled = false;
    const start = (event: Event) => {
      unlisten();
      // The event's own time, which counts the wait behind a busy main thread. WebKit stamps
      // synthesized pointer events from another clock; there the handler's time stands in.
      const now = performance.now();
      const age = now - event.timeStamp;
      const startedAt = age >= 0 && age < 60_000 ? event.timeStamp : now;
      const tick = () => {
        if (cancelled) return;
        // Not the frame time given to the callback: that is when the frame began, before the
        // work that ran ahead of this callback.
        const elapsed = performance.now() - startedAt;
        if (Array.from(document.querySelectorAll(watched)).some(visible)) {
          settle({ ms: elapsed });
        } else if (elapsed > 60_000) {
          settle({ error: `timeToVisible: ${watched} was not visible within 60 s` });
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    };
    const unlisten = () => {
      clearTimeout(noInput);
      document.removeEventListener('pointerdown', start, true);
      document.removeEventListener('keydown', start, true);
    };
    const noInput = setTimeout(() => {
      unlisten();
      settle({ error: `timeToVisible: no press or key within 60 s (waiting for ${watched})` });
    }, 60_000);
    // The press, not the click: some controls act on their press.
    document.addEventListener('pointerdown', start, true);
    document.addEventListener('keydown', start, true);
    (window as unknown as ProbeWindow).__perfProbeVisible = {
      // Settles with the error rather than rejecting: nothing may be waiting for it yet.
      done: new Promise<VisibleOutcome>((resolve) => {
        settle = resolve;
      }),
      cancel: () => {
        cancelled = true;
        unlisten();
      },
    };
  }, selector);
  try {
    await act();
    const outcome = await page.evaluate(
      () => (window as unknown as ProbeWindow).__perfProbeVisible?.done
    );
    if (!outcome) throw new Error('timeToVisible: the page loaded again during the act');
    if (outcome.ms === undefined) throw new Error(outcome.error);
    return round(outcome.ms);
  } finally {
    // Also when `act` threw: no listener or frame loop stays behind.
    await page
      .evaluate(() => {
        const target = window as unknown as ProbeWindow;
        target.__perfProbeVisible?.cancel();
        delete target.__perfProbeVisible;
      })
      .catch(() => undefined);
  }
};

/**
 * Types into `target` for `ms` milliseconds, 60 ms between keys, selecting all and deleting after
 * each phrase, and gives the latency of the typed characters: from each keydown to the first task
 * after the next frame, by when that frame has been painted.
 */
export const typeWithLatency = async (page: Page, target: Locator, ms: number): Promise<Stats> => {
  await target.click();
  await page.evaluate(() => {
    const samples: number[] = [];
    const listener = (event: KeyboardEvent) => {
      // A typed character, not an editing command (select all, delete) of the cycle.
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey) return;
      const start = event.timeStamp;
      requestAnimationFrame(() => {
        setTimeout(() => samples.push(performance.now() - start), 0);
      });
    };
    document.addEventListener('keydown', listener, true);
    (window as unknown as ProbeWindow).__perfProbeKeys = { samples, listener };
  });
  try {
    const end = Date.now() + ms;
    do {
      await page.keyboard.type('load test typing probe ', { delay: 60 });
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
    } while (Date.now() < end);
    // The last key's sample lands in the task after the next frame.
    const samples = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const keys = (window as unknown as ProbeWindow).__perfProbeKeys;
          requestAnimationFrame(() => setTimeout(() => resolve(keys?.samples ?? []), 0));
        })
    );
    return stats(samples);
  } finally {
    await page
      .evaluate(() => {
        const target_ = window as unknown as ProbeWindow;
        const keys = target_.__perfProbeKeys;
        if (keys) document.removeEventListener('keydown', keys.listener, true);
        delete target_.__perfProbeKeys;
      })
      .catch(() => undefined);
  }
};
