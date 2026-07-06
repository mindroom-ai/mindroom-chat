import type { Page } from '@playwright/test';

/**
 * Shared scroll-ride harness for the virtualized thread timeline.
 *
 * Every device-report class so far (momentum kill, white gaps, snap-back,
 * reverse-flash, blank-screens-under-latency) is visible in ONE per-frame
 * trace: scrollTop, coverage gap, anchor displacement, app writes, thread
 * count. Individual specs kept re-implementing subsets of that sampler and
 * asserting subsets of the budgets — the 2026-07-06 blank-screens
 * regression shipped through a spec that asserted anchor jumps but not
 * coverage. This module is the single driver + analyzer so every ride
 * measures the full invariant set, under realistic environment knobs
 * (relations latency, CPU throttle).
 */

export type RideFrame = {
  t: number;
  scrollTop: number;
  scrollHeight: number;
  // Max uncovered vertical span in the viewport core (10%..90%).
  gapPx: number;
  // Absolute anchor displacement beyond the driven delta for this frame
  // (0 when the anchor was re-picked this frame).
  jumpPx: number;
  driven: number;
  threadCount: number;
  distFromBottom: number;
};

export type TileSnap = { i: string | null; id: string | null; top: number; h: number };

export type RideReport = {
  error?: string;
  frames: RideFrame[];
  appWrites: { kind: string; value: number; t: number }[];
  // Tile photographs around frames whose jump exceeded the capture
  // threshold (30px), capped.
  jumpEvents: { t: number; jump: number; before: TileSnap[]; after: TileSnap[] }[];
  threadCountStart: number;
  threadCountEnd: number;
  probes: Record<string, number>;
};

export type RideBudgets = {
  maxGapPx: number;
  maxJumpPx: number;
  totalJumpPx: number;
  minFrames: number;
};

export const FULL_RIDE_BUDGETS: RideBudgets = {
  // Same numbers as the momentum spec's historical budgets: a gap is a
  // blank band the reader sees; a jump is content shifting under the
  // reader.
  maxGapPx: 120,
  maxJumpPx: 40,
  totalJumpPx: 120,
  minFrames: 60,
};

export type RideViolation = { budget: keyof RideBudgets; actual: number; allowed: number };

export const analyzeRide = (
  report: RideReport,
  budgets: RideBudgets = FULL_RIDE_BUDGETS
): { violations: RideViolation[]; maxGapPx: number; maxJumpPx: number; totalJumpPx: number } => {
  const maxGapPx = Math.round(Math.max(0, ...report.frames.map((f) => f.gapPx)));
  const maxJumpPx = Math.round(Math.max(0, ...report.frames.map((f) => f.jumpPx)));
  const totalJumpPx = Math.round(report.frames.reduce((sum, f) => sum + f.jumpPx, 0));
  const violations: RideViolation[] = [];
  if (report.frames.length < budgets.minFrames) {
    violations.push({ budget: 'minFrames', actual: report.frames.length, allowed: budgets.minFrames });
  }
  if (maxGapPx >= budgets.maxGapPx) {
    violations.push({ budget: 'maxGapPx', actual: maxGapPx, allowed: budgets.maxGapPx });
  }
  if (maxJumpPx >= budgets.maxJumpPx) {
    violations.push({ budget: 'maxJumpPx', actual: maxJumpPx, allowed: budgets.maxJumpPx });
  }
  if (totalJumpPx >= budgets.totalJumpPx) {
    violations.push({ budget: 'totalJumpPx', actual: totalJumpPx, allowed: budgets.totalJumpPx });
  }
  return { violations, maxGapPx, maxJumpPx, totalJumpPx };
};

/**
 * Wraps the scroll write surfaces before any app code runs; writes made
 * while `window.__driverDepth > 0` are the test's own and are not
 * recorded. Must be called before page.goto.
 */
export const installScrollWriteProbe = (page: Page): Promise<void> =>
  page.addInitScript(() => {
    const w = window as Window & {
      __appScrollWrites?: { kind: string; value: number; t: number }[];
      __driverDepth?: number;
    };
    w.__appScrollWrites = [];
    w.__driverDepth = 0;
    const record = (kind: string, el: unknown, value: number) => {
      if ((w.__driverDepth ?? 0) > 0) return;
      if (!(el instanceof HTMLElement) || el.dataset.e2eScroller !== '1') return;
      w.__appScrollWrites!.push({ kind, value, t: performance.now() });
    };
    const scrollTopDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    if (scrollTopDesc?.set && scrollTopDesc.get) {
      Object.defineProperty(Element.prototype, 'scrollTop', {
        configurable: true,
        get() {
          return scrollTopDesc.get!.call(this);
        },
        set(value: number) {
          record('scrollTop', this, value);
          scrollTopDesc.set!.call(this, value);
        },
      });
    }
    (['scrollTo', 'scrollBy'] as const).forEach((name) => {
      const original = Element.prototype[name];
      Element.prototype[name] = function wrapped(this: Element, ...args: unknown[]) {
        const first = args[0];
        const top =
          typeof first === 'object' && first !== null
            ? (first as { top?: number }).top
            : (args[1] as number | undefined);
        if (typeof top === 'number') record(name, this, top);
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      } as (typeof Element.prototype)[typeof name];
    });
  });

/**
 * Injects realistic latency into /relations continuation pages (the
 * pagination fetches). Local fetches complete in ~30ms, so quiescence-
 * deferred commits always land neatly inside the first pause — on real
 * networks they take seconds and land mid-ride (including through the
 * waitForScrollQuiescence 2.5s force-commit cap). Returns an unroute
 * function.
 */
export const throttleRelationsContinuations = async (
  page: Page,
  delayMs: number
): Promise<() => Promise<void>> => {
  const matcher = (url: URL) => url.pathname.includes('/relations/') && url.searchParams.has('from');
  await page.route(matcher, async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
    await route.continue();
  });
  return () => page.unroute(matcher);
};

/** Aborts /relations continuations — leaves an open with a partial window. */
export const abortRelationsContinuations = async (page: Page): Promise<() => Promise<void>> => {
  const matcher = (url: URL) => url.pathname.includes('/relations/') && url.searchParams.has('from');
  await page.route(matcher, (route) => route.abort());
  return () => page.unroute(matcher);
};

/**
 * CDP CPU throttle: desktop chromium mounts a row batch in one frame
 * where a phone takes several — the difference between "no gap" and a
 * visible blank band.
 */
export const throttleCpu = async (page: Page, rate: number): Promise<void> => {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
};

export type FlickCycle = {
  steps: number;
  stepPx: number;
  pauseMs: number;
};

/**
 * Drives flick/pause cycles on the thread scroller and records the full
 * per-frame trace, INCLUDING through the pauses. `teleportTo` positions
 * the ride start (driver-tagged, settled outside the sampled window).
 * A wheel gesture is dispatched at each cycle start (user intent for the
 * auto-paginate trigger and the settle-cancel paths).
 */
export const runFlickRide = (
  page: Page,
  opts: {
    teleportTo?: number;
    teleportSettleMs?: number;
    cycles: FlickCycle[];
    tailSampleMs?: number;
  }
): Promise<RideReport> =>
  page.evaluate(async (rideOpts) => {
    const w = window as Window & {
      __appScrollWrites?: { kind: string; value: number; t: number }[];
      __driverDepth?: number;
      __MINDROOM_CACHE_PROBE__?: { snapshot: () => Record<string, number | undefined> };
    };
    const row = document.querySelector('[data-message-item]');
    let candidate: HTMLElement | null = row?.parentElement ?? null;
    while (candidate) {
      const { overflowY } = getComputedStyle(candidate);
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        candidate.scrollHeight > candidate.clientHeight
      ) {
        break;
      }
      candidate = candidate.parentElement;
    }
    const scroller = candidate;
    if (!scroller) {
      return {
        error: 'no scroller found',
        frames: [],
        appWrites: [],
        jumpEvents: [],
        threadCountStart: -1,
        threadCountEnd: -1,
        probes: {},
      };
    }
    scroller.dataset.e2eScroller = '1';

    const raf = () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    const readThreadCount = () =>
      Number(
        (scroller.querySelector('[data-thread-count]') as HTMLElement | null)?.dataset
          .threadCount ?? -1
      );
    const readProbes = (): Record<string, number> => {
      const snapshot = w.__MINDROOM_CACHE_PROBE__?.snapshot() ?? {};
      return Object.fromEntries(
        Object.entries(snapshot).filter(
          ([key, value]) =>
            typeof value === 'number' &&
            (key.startsWith('threadPaginateBack') || key === 'threadAutoPaginateBackFired')
        )
      ) as Record<string, number>;
    };
    type TileSnap = { i: string | null; id: string | null; top: number; h: number };
    const readTileSnaps = (): TileSnap[] =>
      Array.from(scroller.querySelectorAll('[data-index]')).map((tile) => ({
        i: tile.getAttribute('data-index'),
        id:
          tile.querySelector('[data-message-id]')?.getAttribute('data-message-id')?.slice(0, 12) ??
          null,
        top: Math.round((tile as HTMLElement).offsetTop),
        h: Math.round(tile.getBoundingClientRect().height),
      }));
    const readGap = (): number => {
      const rect = scroller.getBoundingClientRect();
      const top = rect.top + rect.height * 0.1;
      const bottom = rect.bottom - rect.height * 0.1;
      const tiles = Array.from(scroller.querySelectorAll('[data-index]'))
        .map((tile) => tile.getBoundingClientRect())
        .filter((r) => r.bottom > top && r.top < bottom)
        .sort((a, b) => a.top - b.top);
      let cursor = top;
      let maxGap = 0;
      tiles.forEach((r) => {
        if (r.top > cursor) maxGap = Math.max(maxGap, r.top - cursor);
        cursor = Math.max(cursor, r.bottom);
      });
      if (cursor < bottom) maxGap = Math.max(maxGap, bottom - cursor);
      return maxGap;
    };
    const pickAnchor = (): Element | null => {
      const rows = Array.from(document.querySelectorAll('[data-message-item]'));
      const mid = window.innerHeight / 2;
      let best: Element | null = null;
      let bestDistance = Infinity;
      rows.forEach((r) => {
        const rect = r.getBoundingClientRect();
        const distance = Math.abs((rect.top + rect.bottom) / 2 - mid);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = r;
        }
      });
      return best;
    };

    const frames: {
      t: number;
      scrollTop: number;
      scrollHeight: number;
      gapPx: number;
      jumpPx: number;
      driven: number;
      threadCount: number;
      distFromBottom: number;
    }[] = [];
    const jumpEvents: { t: number; jump: number; before: TileSnap[]; after: TileSnap[] }[] = [];
    let jumpAnchor: Element | null = null;
    let jumpAnchorTop = 0;
    let lastTileSnaps: TileSnap[] = [];
    const sample = (driven: number) => {
      const t = performance.now();
      let jumpPx = 0;
      if (jumpAnchor && jumpAnchor.isConnected) {
        const rect = jumpAnchor.getBoundingClientRect();
        if (rect.bottom > -800 && rect.top < window.innerHeight + 800) {
          jumpPx = Math.abs(rect.top - jumpAnchorTop - driven);
          jumpAnchorTop = rect.top;
          const tiles = readTileSnaps();
          if (jumpPx > 30 && jumpEvents.length < 6) {
            jumpEvents.push({ t, jump: Math.round(jumpPx), before: lastTileSnaps, after: tiles });
          }
          lastTileSnaps = tiles;
        } else {
          jumpAnchor = pickAnchor();
          jumpAnchorTop = jumpAnchor?.getBoundingClientRect().top ?? 0;
          lastTileSnaps = readTileSnaps();
        }
      } else {
        jumpAnchor = pickAnchor();
        jumpAnchorTop = jumpAnchor?.getBoundingClientRect().top ?? 0;
        lastTileSnaps = readTileSnaps();
      }
      frames.push({
        t,
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        gapPx: Math.round(readGap()),
        jumpPx,
        driven,
        threadCount: readThreadCount(),
        distFromBottom: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
      });
    };

    const writes = w.__appScrollWrites ?? [];
    const writesBefore = writes.length;
    const threadCountStart = readThreadCount();
    const probesStart = readProbes();

    if (typeof rideOpts.teleportTo === 'number') {
      w.__driverDepth! += 1;
      scroller.scrollTop = rideOpts.teleportTo;
      w.__driverDepth! -= 1;
      const settleUntil = performance.now() + (rideOpts.teleportSettleMs ?? 600);
      while (performance.now() < settleUntil) {
        // eslint-disable-next-line no-await-in-loop
        await raf();
      }
    }
    sample(0);

    for (const cycle of rideOpts.cycles) {
      scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
      for (let step = 0; step < cycle.steps; step += 1) {
        const prevTop = scroller.scrollTop;
        w.__driverDepth! += 1;
        scroller.scrollTop -= cycle.stepPx;
        w.__driverDepth! -= 1;
        // eslint-disable-next-line no-await-in-loop
        await raf();
        sample(prevTop - scroller.scrollTop);
      }
      const pauseUntil = performance.now() + cycle.pauseMs;
      while (performance.now() < pauseUntil) {
        // eslint-disable-next-line no-await-in-loop
        await raf();
        sample(0);
      }
    }
    const tailUntil = performance.now() + (rideOpts.tailSampleMs ?? 0);
    while (performance.now() < tailUntil) {
      // eslint-disable-next-line no-await-in-loop
      await raf();
      sample(0);
    }

    const probesEnd = readProbes();
    const probes = Object.fromEntries(
      Object.entries(probesEnd).map(([key, value]) => [key, value - (probesStart[key] ?? 0)])
    );

    return {
      frames,
      appWrites: writes.slice(writesBefore),
      jumpEvents,
      threadCountStart,
      threadCountEnd: readThreadCount(),
      probes,
    };
  }, opts);

/**
 * Records the open/hydration settle without any user input: from the
 * first rendered message row, samples distance-from-bottom and thread
 * count for `durationMs`. An open pinned to the latest message must STAY
 * at the bottom while backfill grows the content above it.
 */
export const recordOpenSettle = (
  page: Page,
  durationMs: number
): Promise<{
  error?: string;
  samples: { t: number; distFromBottom: number; threadCount: number; scrollHeight: number }[];
}> =>
  page.evaluate(async (duration) => {
    const row = document.querySelector('[data-message-item]');
    let candidate: HTMLElement | null = row?.parentElement ?? null;
    while (candidate) {
      const { overflowY } = getComputedStyle(candidate);
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        candidate.scrollHeight > candidate.clientHeight
      ) {
        break;
      }
      candidate = candidate.parentElement;
    }
    const scroller = candidate;
    if (!scroller) return { error: 'no scroller found', samples: [] };
    const raf = () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    const readThreadCount = () =>
      Number(
        (scroller.querySelector('[data-thread-count]') as HTMLElement | null)?.dataset
          .threadCount ?? -1
      );
    const samples: { t: number; distFromBottom: number; threadCount: number; scrollHeight: number }[] =
      [];
    const until = performance.now() + duration;
    while (performance.now() < until) {
      // eslint-disable-next-line no-await-in-loop
      await raf();
      samples.push({
        t: performance.now(),
        distFromBottom: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
        threadCount: readThreadCount(),
        scrollHeight: scroller.scrollHeight,
      });
    }
    return { samples };
  }, durationMs);
