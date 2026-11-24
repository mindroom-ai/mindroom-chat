import type { Page } from '@playwright/test';

export type ProbeMode = 'open' | 'scrollUp';

export type JumpFrame = {
  t: number;
  frame: number;
  mag: number;
  reasons: string[];
  scrollTop: number;
  dScroll: number;
  appDelta: number;
  median: number;
  spread: number;
  unexplained: number;
  dBottomGap: number;
  bottomGapPx: number;
  marginTop: number;
  listHeight: number;
  threadCount: number;
  visibleCount: number;
  anchorId?: string;
  anchorTop?: number;
  anchorDriftPx?: number;
  writes?: { api: string; delta: number; wheelLive: boolean; msSinceWheel: number; caller: string }[];
};

export type ProbeReport = {
  visibleFrames: number;
  scrolledPx: number;
  threadCountStart: number;
  threadCountEnd: number;
  minVisibleCount: number;
  maxRowJumpPx: number;
  maxBottomGapJumpPx: number;
  maxReversalPx: number;
  maxUnexplainedPx: number;
  maxSpreadPx: number;
  maxAnchorDriftPx: number;
  maxBottomOffsetPx: number;
  lostPlaceFrames: number;
  jumps: JumpFrame[];
};

type WindowWithProbe = {
  __threadJumpProbe: {
    start: (mode: ProbeMode) => void;
    stop: () => ProbeReport;
    clearCacheStore: () => Promise<number>;
    findScroller: () => HTMLElement | null;
  };
};

/**
 * Init script installed before navigation: watches animation frames on the thread scroller,
 * tracks programmatic scroll writes, per-frame row movement/reversals/spread, and cumulative
 * row travel against cumulative wheel input when each unclamped scroll-up burst settles.
 */
export const installThreadJumpProbe = () => {
  type RowSnap = { top: number; h: number };
  const cacheDbs = new Set<IDBDatabase>();
  const origIdbTransaction =
    typeof IDBDatabase !== 'undefined' ? IDBDatabase.prototype.transaction : undefined;
  if (origIdbTransaction) {
    IDBDatabase.prototype.transaction = function wrappedTransaction(
      this: IDBDatabase,
      storeNames: string | Iterable<string>,
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions
    ) {
      if (this.objectStoreNames.contains('events') && this.objectStoreNames.contains('meta')) {
        cacheDbs.add(this);
      }
      return origIdbTransaction.call(this, storeNames, mode, options);
    };
  }

  const initialState = () => ({
    active: false,
    mode: 'open' as ProbeMode,
    writeDelta: 0,
    frameWrites: [] as { api: string; delta: number; wheelLive: boolean; msSinceWheel: number; caller: string }[],
    lastWheelAt: -Infinity,
    wheelPx: 0,
    burstWheelPx: 0,
    burstRowPx: 0,
    burstClamped: false,
    quietFrames: 0,
    scroller: null as HTMLElement | null,
    jumps: [] as JumpFrame[],
    visibleFrames: 0,
    scrolledPx: 0,
    threadCountStart: -1,
    threadCountEnd: -1,
    minVisibleCount: Number.POSITIVE_INFINITY,
    maxRowJumpPx: 0,
    maxBottomGapJumpPx: 0,
    maxReversalPx: 0,
    maxUnexplainedPx: 0,
    maxSpreadPx: 0,
    maxAnchorDriftPx: 0,
    maxBottomOffsetPx: 0,
    lostPlaceFrames: 0,
    anchorId: '',
    anchorBaseTop: Number.NaN,
    prevListHeight: -1,
    prevMarginTop: 0,
    prevRows: new Map<string, RowSnap>(),
    prevMounted: new Map<string, number>(),
    prevScrollTop: 0,
    prevBottomGap: Number.NaN,
    hasVisibleBaseline: false,
  });

  const probe = {
    ...initialState(),
    async clearCacheStore(): Promise<number> {
      if (!origIdbTransaction) return 0;
      let cleared = 0;
      for (const db of Array.from(cacheDbs)) {
        try {
          const stores = ['events', 'meta'].filter((name) => db.objectStoreNames.contains(name));
          if (stores.length === 0) continue;
          await new Promise<void>((resolve, reject) => {
            const tx = origIdbTransaction.call(db, stores, 'readwrite');
            stores.forEach((name) => tx.objectStore(name).clear());
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
          cleared += 1;
        } catch {
          // Closed connection from a previous view; skip.
        }
      }
      return cleared;
    },
    findScroller(): HTMLElement | null {
      const inner = document.querySelector<HTMLElement>('[data-timeline-rows][data-thread-count]');
      if (!inner) return null;
      let node = inner.parentElement;
      while (node) {
        const { overflowY } = getComputedStyle(node);
        if (overflowY === 'auto' || overflowY === 'scroll') return node;
        node = node.parentElement;
      }
      return null;
    },
    flushSettledBurst(now: number) {
      if (this.mode === 'scrollUp' && (this.burstWheelPx < 0 || this.burstRowPx !== 0)) {
        // Clamping at scrollTop=0 may excuse rows travelling less than the wheel asked,
        // never more (overshoot) and never backward (net negative row travel).
        const rawDrift = this.burstRowPx + this.burstWheelPx;
        const drift = !this.burstClamped
          ? rawDrift
          : rawDrift > 0
          ? rawDrift
          : this.burstRowPx < 0
          ? this.burstRowPx
          : 0;
        if (Math.abs(drift) > this.maxUnexplainedPx) this.maxUnexplainedPx = Math.abs(drift);
        if (Math.abs(drift) >= 8 && this.jumps.length < 40) {
          this.jumps.push({
            t: Math.round(now),
            frame: this.visibleFrames,
            mag: Math.round(Math.abs(drift)),
            reasons: [`burstDrift(${Math.round(drift)}px)`],
            scrollTop: Math.round(this.prevScrollTop),
            dScroll: 0,
            appDelta: 0,
            median: Math.round(this.burstRowPx),
            spread: 0,
            unexplained: Math.round(drift),
            dBottomGap: 0,
            bottomGapPx: Number.isFinite(this.prevBottomGap) ? this.prevBottomGap : -9999,
            marginTop: Math.round(this.prevMarginTop),
            listHeight: Math.round(this.prevListHeight),
            threadCount: this.threadCountEnd,
            visibleCount: this.prevRows.size,
          });
        }
      }
      this.burstWheelPx = 0;
      this.burstRowPx = 0;
      this.burstClamped = false;
    },
    start(mode: ProbeMode) {
      Object.assign(this, initialState(), { active: true, mode });
      this.scroller = this.findScroller();
      this.prevScrollTop = this.scroller?.scrollTop ?? 0;
    },
    stop(): ProbeReport {
      this.flushSettledBurst(performance.now());
      this.active = false;
      return {
        visibleFrames: this.visibleFrames,
        scrolledPx: Math.round(this.scrolledPx),
        threadCountStart: this.threadCountStart,
        threadCountEnd: this.threadCountEnd,
        minVisibleCount: Number.isFinite(this.minVisibleCount) ? this.minVisibleCount : 0,
        maxRowJumpPx: Math.round(this.maxRowJumpPx),
        maxBottomGapJumpPx: Math.round(this.maxBottomGapJumpPx),
        maxReversalPx: Math.round(this.maxReversalPx),
        maxUnexplainedPx: Math.round(this.maxUnexplainedPx),
        maxSpreadPx: Math.round(this.maxSpreadPx),
        maxAnchorDriftPx: Math.round(this.maxAnchorDriftPx),
        maxBottomOffsetPx: Math.round(this.maxBottomOffsetPx),
        lostPlaceFrames: this.lostPlaceFrames,
        jumps: this.jumps,
      };
    },
  };

  (window as unknown as WindowWithProbe).__threadJumpProbe = probe;

  const recordWrite = (el: unknown, value: number, api: string): number => {
    if (!probe.active) return 0;
    if (!probe.scroller || !probe.scroller.isConnected) probe.scroller = probe.findScroller();
    if (!probe.scroller || el !== probe.scroller) return 0;
    const from = probe.scroller.scrollTop;
    if (probe.mode === 'scrollUp' && from <= 1) probe.burstClamped = true;
    const delta = value - from;
    probe.writeDelta += delta;
    const msSinceWheel = Math.round(performance.now() - probe.lastWheelAt);
    const caller = (new Error().stack || "")
      .split("\n")
      .slice(2, 6)
      .map((line) => line.trim())
      .join(" <- ");
    probe.frameWrites.push({
      api,
      delta: Math.round(delta),
      wheelLive: msSinceWheel <= 150,
      msSinceWheel,
      caller,
    });
    return delta;
  };

  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  if (desc?.get && desc.set) {
    const { get, set } = desc;
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return get.call(this);
      },
      set(value: number) {
        recordWrite(this, value, 'scrollTop');
        set.call(this, value);
      },
    });
  }
  (['scrollTo', 'scrollBy'] as const).forEach((name) => {
    const orig = Element.prototype[name] as (...args: unknown[]) => void;
    Element.prototype[name] = function wrapped(this: Element, ...args: unknown[]) {
      const first = args[0];
      const top =
        typeof first === 'object' && first !== null ? (first as { top?: number }).top : args[1];
      if (typeof top === 'number') {
        recordWrite(this, name === 'scrollBy' ? this.scrollTop + top : top, name);
      }
      orig.apply(this, args);
    };
  });
  window.addEventListener(
    'wheel',
    (event) => {
      probe.wheelPx += event.deltaY;
      probe.lastWheelAt = performance.now();
    },
    { capture: true, passive: true }
  );

  const tick = (now: number) => {
    if (probe.active) {
      if (!probe.scroller || !probe.scroller.isConnected) probe.scroller = probe.findScroller();
      const scroller = probe.scroller;
      const inner =
        scroller?.querySelector<HTMLElement>('[data-timeline-rows][data-thread-count]') ?? null;
      if (scroller && inner && getComputedStyle(inner).visibility !== 'hidden') {
        probe.visibleFrames += 1;
        const threadCount = Number(inner.dataset.threadCount ?? -1);
        if (probe.threadCountStart < 0 && threadCount >= 0) probe.threadCountStart = threadCount;
        if (threadCount >= 0) probe.threadCountEnd = threadCount;

        const scrollTop = scroller.scrollTop;
        const marginTop = Number.parseFloat(inner.style.marginTop || '0') || 0;
        const listHeight = Number.parseFloat(inner.style.height || '0') || 0;
        const appDelta = probe.writeDelta;
        probe.writeDelta = 0;
        const frameWrites = probe.frameWrites;
        probe.frameWrites = [];
        const wheelPx = probe.wheelPx;
        probe.wheelPx = 0;

        const view = scroller.getBoundingClientRect();
        const current = new Map<string, RowSnap>();
        const moved: number[] = [];
        const mounted = new Map<string, number>();
        const carried: { before: number; px: number }[] = [];
        const allRows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-item]'));
        allRows.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const id =
            el.dataset.eventId || el.dataset.messageId || el.getAttribute('data-index') || '';
          if (!id || rect.height === 0) return;
          mounted.set(id, rect.top);
          const before = probe.prevMounted.get(id);
          if (before !== undefined) carried.push({ before, px: rect.top - before });
          if (rect.bottom <= view.top || rect.top >= view.bottom) return;
          const snap: RowSnap = { top: rect.top, h: rect.height };
          current.set(id, snap);
          const prev = probe.prevRows.get(id);
          if (!prev) return;
          const shown = Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top);
          if (shown > 8 && prev.top < view.bottom - 8 && prev.top + prev.h > view.top + 8) {
            moved.push(snap.top - prev.top);
          }
        });

        const lostPlace =
          moved.length === 0 && carried.length === 0 && current.size > 0 && probe.prevRows.size > 0;
        if (moved.length === 0 && carried.length > 0) {
          const distance = (row: { before: number }) => Math.abs(row.before - view.top);
          moved.push(
            carried.reduce((near, row) => (distance(row) < distance(near) ? row : near)).px
          );
        }

        const lastRow = allRows[allRows.length - 1];
        const bottomGapPx = lastRow
          ? Math.round(view.bottom - lastRow.getBoundingClientRect().bottom)
          : Number.NaN;
        const bottomOffsetPx = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight - scrollTop
        );
        if (probe.hasVisibleBaseline && bottomOffsetPx > probe.maxBottomOffsetPx) {
          probe.maxBottomOffsetPx = bottomOffsetPx;
        }

        if (!probe.anchorId && current.size > 0) {
          const visibleIds = Array.from(current.keys());
          const chosenId = visibleIds[visibleIds.length - 1] ?? '';
          const chosenSnap = current.get(chosenId);
          if (chosenId && chosenSnap) {
            probe.anchorId = chosenId;
            probe.anchorBaseTop = chosenSnap.top - view.top;
          }
        }
        const anchorTopNow =
          probe.anchorId && mounted.has(probe.anchorId)
            ? mounted.get(probe.anchorId)! - view.top
            : Number.NaN;
        const anchorDriftPx =
          Number.isFinite(anchorTopNow) && Number.isFinite(probe.anchorBaseTop)
            ? anchorTopNow - probe.anchorBaseTop
            : Number.NaN;
        if (Number.isFinite(anchorDriftPx) && Math.abs(anchorDriftPx) > probe.maxAnchorDriftPx) {
          probe.maxAnchorDriftPx = Math.abs(anchorDriftPx);
        }

        const populated = threadCount > 0 || allRows.length > 0;
        if ((populated || probe.hasVisibleBaseline) && current.size < probe.minVisibleCount) {
          probe.minVisibleCount = current.size;
        }
        let dScroll = 0;
        let dBottomGap = 0;
        let median = 0;
        let spread = 0;
        let unexplained = 0;
        const reasons: string[] = [];
        if (probe.hasVisibleBaseline) {
          dScroll = scrollTop - probe.prevScrollTop;
          dBottomGap =
            Number.isFinite(bottomGapPx) && Number.isFinite(probe.prevBottomGap)
              ? bottomGapPx - probe.prevBottomGap
              : 0;
          probe.scrolledPx += Math.abs(dScroll);

          const ds = [...moved].sort((a, b) => a - b);
          median = ds.length > 0 ? ds[Math.floor(ds.length / 2)] ?? 0 : 0;
          spread = ds.length > 0 ? Math.max(...ds.map((d) => Math.abs(d - median))) : 0;
          const movedPx = dScroll - appDelta;
          unexplained = ds.length > 0 ? median + movedPx : 0;

          // Track cumulative wheel input vs cumulative row travel per scrollUp burst.
          if (probe.mode === 'scrollUp') {
            if (wheelPx !== 0) probe.burstWheelPx += wheelPx;
            if (ds.length > 0) probe.burstRowPx += median;
            if (scrollTop <= 1 && (wheelPx < 0 || probe.burstWheelPx < 0)) {
              probe.burstClamped = true;
            }
          }

          if (Math.abs(median) > probe.maxRowJumpPx) probe.maxRowJumpPx = Math.abs(median);
          if (Math.abs(dBottomGap) > probe.maxBottomGapJumpPx) {
            probe.maxBottomGapJumpPx = Math.abs(dBottomGap);
          }
          if (median < 0 && -median > probe.maxReversalPx) probe.maxReversalPx = -median;
          if (Math.abs(unexplained) > probe.maxUnexplainedPx) {
            probe.maxUnexplainedPx = Math.abs(unexplained);
          }
          if (spread > probe.maxSpreadPx) probe.maxSpreadPx = spread;
          if (lostPlace) probe.lostPlaceFrames += 1;

          if (probe.mode === 'open') {
            if (Math.abs(median) >= 4) reasons.push(`rowMove(${Math.round(median)}px)`);
            if (Math.abs(dBottomGap) >= 10) reasons.push(`bottomGap(${Math.round(dBottomGap)}px)`);
          } else {
            if (median <= -6) reasons.push(`reversal(${Math.round(median)}px)`);
            if (Math.abs(unexplained) >= 8) {
              reasons.push(`unexplained(${Math.round(unexplained)}px)`);
            }
            if (spread >= 4) reasons.push(`spread(${Math.round(spread)}px)`);
            if (lostPlace) reasons.push('lostPlace');
          }

          const quiet = wheelPx === 0 && dScroll === 0 && appDelta === 0 && Math.abs(median) < 1;
          probe.quietFrames = quiet ? probe.quietFrames + 1 : 0;
        }
        if (
          (populated || probe.hasVisibleBaseline) &&
          probe.mode === 'open' &&
          current.size === 0
        ) {
          reasons.push('blankScreen(0 rows)');
        }
        if (reasons.length > 0 && probe.jumps.length < 40) {
          const mag = Math.max(
            Math.abs(median),
            Math.abs(unexplained),
            spread,
            probe.mode === 'open' ? Math.abs(dBottomGap) : 0
          );
          probe.jumps.push({
            t: Math.round(now),
            frame: probe.visibleFrames,
            mag: Math.round(mag),
            reasons,
            scrollTop: Math.round(scrollTop),
            dScroll: Math.round(dScroll),
            appDelta: Math.round(appDelta),
            median: Math.round(median),
            spread: Math.round(spread),
            unexplained: Math.round(unexplained),
            dBottomGap: Math.round(dBottomGap),
            bottomGapPx: Number.isFinite(bottomGapPx) ? bottomGapPx : -9999,
            marginTop: Math.round(marginTop),
            listHeight: Math.round(listHeight),
            threadCount,
            visibleCount: current.size,
            anchorId: probe.anchorId || undefined,
            anchorTop: Number.isFinite(anchorTopNow) ? Math.round(anchorTopNow) : undefined,
            anchorDriftPx: Number.isFinite(anchorDriftPx) ? Math.round(anchorDriftPx) : undefined,
            writes: frameWrites.length > 0 ? frameWrites : undefined,
          });
        }

        probe.prevListHeight = Math.round(listHeight);
        probe.prevMarginTop = marginTop;
        probe.prevRows = current;
        probe.prevMounted = mounted;
        probe.prevScrollTop = scrollTop;
        probe.prevBottomGap = bottomGapPx;
        if (
          probe.hasVisibleBaseline &&
          probe.quietFrames === 4 &&
          (probe.burstWheelPx !== 0 || probe.burstRowPx !== 0)
        ) {
          probe.flushSettledBurst(now);
        }
        if (current.size > 0) probe.hasVisibleBaseline = true;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

export const startProbe = (page: Page, mode: ProbeMode) =>
  page.evaluate((m) => {
    (window as unknown as WindowWithProbe).__threadJumpProbe.start(m);
  }, mode);

export const stopProbe = (page: Page): Promise<ProbeReport> =>
  page.evaluate(() => (window as unknown as WindowWithProbe).__threadJumpProbe.stop());

export const clearProbeCacheStore = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as WindowWithProbe).__threadJumpProbe.clearCacheStore());

export const tapProbeScroller = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as WindowWithProbe).__threadJumpProbe
      .findScroller()
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true }));
  });

export const scrollProbeMidThread = (page: Page) =>
  page.evaluate(() => {
    const scroller = (window as unknown as WindowWithProbe).__threadJumpProbe.findScroller();
    if (!scroller) return { ok: false, before: 0, after: 0 };
    scroller.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true }));
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.min(Math.max(0, before - 600), 400);
    scroller.dispatchEvent(new Event('scroll', { bubbles: false }));
    return { ok: before - scroller.scrollTop >= 150, before, after: scroller.scrollTop };
  });

export const getProbeScrollerCenter = (page: Page) =>
  page.evaluate(() => {
    const scroller = (window as unknown as WindowWithProbe).__threadJumpProbe.findScroller();
    const box = (scroller ?? document.body).getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
