import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { MatrixEvent } from 'matrix-js-sdk';
import {
  SCROLL_SESSION_STALE_MS,
  hasActiveWindowTouches,
} from './scrollQuiescence';
import type { ThreadLedgerAnchor } from './threadScrollLedger';

/** Feature flag: `localStorage['mr.threadScrollOwner'] = '1'` (or `VITE_THREAD_SCROLL_OWNER=1`). */
export const THREAD_SCROLL_OWNER_FLAG = 'mr.threadScrollOwner';
/** Test-only cap on the initial headroom budget to force mid-gesture exhaustion in e2e specs. */
export const THREAD_SCROLL_OWNER_TEST_INITIAL_CAP_KEY =
  'mr.threadScrollOwner.testInitialHeadroomPx';

/** Idle quiet window before any rest-time geometry write (trim, top-up, or held-page release). */
export const HEADROOM_IDLE_REST_MS = 500;
/** Default row height estimate before any rows in the view have been measured. */
const DEFAULT_ROW_HEIGHT_PX = 180;
/** Top-up triggers when headroom drops below this multiple of the viewport height. */
const TOP_UP_LOW_WATER_VIEWPORTS = 2;
/** Minimum reserve floor (in viewports) while more history remains. */
const MIN_HISTORY_BUDGET_VIEWPORTS = 4;
/** Trim activates only when the reader is within this distance below row 0 (or inside the reserve). */
const NEAR_TOP_VIEWPORTS = 1.5;
const RUBBER_BAND_EPSILON_PX = 1;
const PROGRAMMATIC_SCROLL_ECHO_MS = 120;

export const isThreadScrollOwnerEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const stored = window.localStorage?.getItem(THREAD_SCROLL_OWNER_FLAG);
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    // Storage access can throw in restricted contexts.
  }
  return import.meta.env.VITE_THREAD_SCROLL_OWNER === '1';
};

const readTestInitialHeadroomCapPx = (): number | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage?.getItem(THREAD_SCROLL_OWNER_TEST_INITIAL_CAP_KEY);
    if (raw === null || raw === '') return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export type ResizeQueueEntry = {
  seq: number;
  delta: number;
};

export type PendingAbsoluteScroll =
  | { kind: 'offset'; target: number; reason: 'trim' | 'topup' | 'held-release' | 'open-init' }
  | { kind: 'bottom'; reason: 'open-init' };

export type HeadroomOwnerStats = {
  ownerEnabled: boolean;
  initBudget: number;
  writes: number;
  trims: number;
  topUps: number;
  heldPages: number;
  releasedHeldPages: number;
  zeroHeadroomGrowthDrifts: number;
  lastHeadroom: number;
  lastAvgRowHeight: number;
  deltas: number[];
};

declare global {
  interface Window {
    __threadScrollOwnerStats?: HeadroomOwnerStats;
  }
}

export const computeAverageMeasuredRowHeight = (
  sizeCache: ReadonlyMap<unknown, number> | undefined,
  fallbackPx = DEFAULT_ROW_HEIGHT_PX,
  measurementsCache?: readonly { key: unknown; size: number }[]
): number => {
  if (measurementsCache && measurementsCache.length > 0) {
    // Combine actual measured DOM heights (from sizeCache) with 0-height folded/hidden rows
    // and estimates for unmeasured rows so the per-event running average matches real totalSize / N.
    let total = 0;
    for (let i = 0; i < measurementsCache.length; i += 1) {
      const size = measurementsCache[i]?.size ?? 0;
      if (Number.isFinite(size) && size > 0) total += size;
    }
    if (total > 0) {
      return Math.max(40, total / measurementsCache.length);
    }
  }
  if (!sizeCache || sizeCache.size === 0) return fallbackPx;
  let sum = 0;
  let count = 0;
  sizeCache.forEach((size) => {
    if (Number.isFinite(size) && size >= 0) {
      sum += size;
      count += 1;
    }
  });
  return count > 0 ? Math.max(40, sum / count) : fallbackPx;
};

export const computeHeadroomBudget = ({
  unloadedReplies,
  unmeasuredLoaded = 0,
  avgRowHeight,
  viewHeight,
  viewWidth = 1200,
  hasMoreHistory,
}: {
  unloadedReplies: number;
  unmeasuredLoaded?: number;
  avgRowHeight: number;
  viewHeight: number;
  viewWidth?: number;
  hasMoreHistory: boolean;
}): number => {
  if (!hasMoreHistory) return 0;
  const safeViewH = Math.max(300, viewHeight || 900);
  const safeAvg = Math.max(40, avgRowHeight || DEFAULT_ROW_HEIGHT_PX);
  const perUnmeasured = viewWidth < 600 ? 70 : 20;
  const raw = Math.round(
    Math.max(0, unloadedReplies) * safeAvg +
      Math.max(0, unmeasuredLoaded) * perUnmeasured +
      safeViewH * TOP_UP_LOW_WATER_VIEWPORTS
  );
  return Math.max(raw, Math.round(safeViewH * MIN_HISTORY_BUDGET_VIEWPORTS));
};

export const isScrollerRubberBanding = (el: HTMLElement): boolean => {
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  return el.scrollTop < -RUBBER_BAND_EPSILON_PX || el.scrollTop > max + RUBBER_BAND_EPSILON_PX;
};

export const computeTrimPlan = ({
  headroomPx,
  scrollTop,
  viewHeight,
  viewWidth,
  unmeasuredAbove,
}: {
  headroomPx: number;
  scrollTop: number;
  viewHeight: number;
  viewWidth: number;
  unmeasuredAbove: number;
}): { nextHeadroom: number; trim: number; targetScrollTop: number } | undefined => {
  if (headroomPx <= 0) return undefined;
  const safeViewH = Math.max(300, viewHeight || 900);
  const nearTop = scrollTop <= headroomPx + safeViewH * NEAR_TOP_VIEWPORTS;
  if (!nearTop) return undefined;
  const inReserve = scrollTop < headroomPx;
  if (inReserve) {
    // Reader is inside the reserve (Home, thumb-to-top, long flick): target the oldest row.
    return {
      nextHeadroom: 0,
      trim: headroomPx,
      targetScrollTop: 0,
    };
  }
  const perUnmeasured = viewWidth < 600 ? 20 : 0;
  const keepCushion = Math.min(
    headroomPx,
    Math.max(0, unmeasuredAbove) * perUnmeasured,
    Math.round(safeViewH * 0.5)
  );
  const nextHeadroom = keepCushion;
  const trim = headroomPx - nextHeadroom;
  if (trim <= 0.5) return undefined;
  return {
    nextHeadroom,
    trim,
    targetScrollTop: Math.max(0, scrollTop - trim),
  };
};

export const estimatePrependedHeight = ({
  rawEvents,
  presentedEvents,
  anchor,
  threadId,
  sizeCache,
  avgRowHeight,
  fillReserve = false,
}: {
  rawEvents: MatrixEvent[];
  presentedEvents: MatrixEvent[];
  anchor: ThreadLedgerAnchor | undefined;
  threadId: string | undefined;
  sizeCache: ReadonlyMap<unknown, number> | undefined;
  avgRowHeight: number;
  fillReserve?: boolean;
}): number => {
  if (!threadId || rawEvents === presentedEvents) {
    return 0;
  }
  let boundaryEventId: string | undefined;
  if (anchor) {
    // If the reader is anchored at the root itself, history lands below it (foldPx = 0).
    if (anchor.threadId !== threadId || anchor.eventId === threadId) {
      return 0;
    }
    boundaryEventId = anchor.eventId;
  } else if (fillReserve) {
    // Reader is inside the headroom reserve above row 0: price new replies before the earliest
    // existing non-root reply so pages fill the reserve from the bottom up.
    for (let i = 0; i < presentedEvents.length; i += 1) {
      const id = presentedEvents[i]?.getId();
      if (id && id !== threadId) {
        boundaryEventId = id;
        break;
      }
    }
  }
  if (!boundaryEventId) {
    return 0;
  }
  const boundaryIndex = rawEvents.findIndex((event) => event.getId() === boundaryEventId);
  if (boundaryIndex <= 0) return 0;
  const presentedIds = new Set<string>();
  for (let i = 0; i < presentedEvents.length; i += 1) {
    const id = presentedEvents[i]?.getId();
    if (id) presentedIds.add(id);
  }
  const fallback = Math.max(40, avgRowHeight || DEFAULT_ROW_HEIGHT_PX);
  let estimatedPx = 0;
  for (let i = 0; i < boundaryIndex; i += 1) {
    const id = rawEvents[i]?.getId();
    if (!id || id === threadId || presentedIds.has(id)) continue;
    estimatedPx += sizeCache?.get(id) ?? fallback;
  }
  return estimatedPx;
};

const supportsScrollEndEvents = (): boolean =>
  typeof window !== 'undefined' && 'onscrollend' in window;

export type ThreadHeadroomGateHandle = {
  viewKey: string;
  committedHeadroomPx: number;
  headroomInitialized: boolean;
  initialTestCapApplied: boolean;
  lastAvgRowHeight: number;
  sizeCache: ReadonlyMap<unknown, number> | undefined;
  anchorRef: React.MutableRefObject<ThreadLedgerAnchor | undefined> | undefined;
  presentedEvents: MatrixEvent[];
  heldRawEvents: MatrixEvent[] | undefined;
  heldPrependEstimatePx: number;
  pendingReleaseAfterTopUp: boolean;
  pendingReconcileAfterWrite: boolean;
  pendingBottomReconcile: boolean;
  aboveResizeQueue: ResizeQueueEntry[];
  nextResizeSeq: number;
  pendingAbsoluteScroll: PendingAbsoluteScroll | undefined;
  idleIntentQueued: boolean;
  lastActivityAt: number;
  lastScrollEventAt: number;
  scrollSessionLive: boolean;
  sampledScrollTop: number;
  lastProgrammaticScrollTop: number | undefined;
  lastProgrammaticWriteAt: number;
  stats: HeadroomOwnerStats;
  bumpCommitTick: () => void;
};

const createEmptyStats = (ownerEnabled: boolean): HeadroomOwnerStats => ({
  ownerEnabled,
  initBudget: 0,
  writes: 0,
  trims: 0,
  topUps: 0,
  heldPages: 0,
  releasedHeldPages: 0,
  zeroHeadroomGrowthDrifts: 0,
  lastHeadroom: 0,
  lastAvgRowHeight: DEFAULT_ROW_HEIGHT_PX,
  deltas: [],
});

const resetGateForView = (
  gate: ThreadHeadroomGateHandle,
  viewKey: string,
  ownerEnabled: boolean,
  initialEvents: MatrixEvent[]
) => {
  gate.viewKey = viewKey;
  gate.committedHeadroomPx = 0;
  gate.headroomInitialized = false;
  gate.initialTestCapApplied = false;
  gate.lastAvgRowHeight = DEFAULT_ROW_HEIGHT_PX;
  gate.sizeCache = undefined;
  // Keep gate.anchorRef attached to the controller ref; reset its contents via ledger reset.
  gate.presentedEvents = initialEvents;
  gate.heldRawEvents = undefined;
  gate.heldPrependEstimatePx = 0;
  gate.pendingReleaseAfterTopUp = false;
  gate.pendingReconcileAfterWrite = false;
  gate.pendingBottomReconcile = false;
  gate.aboveResizeQueue = [];
  gate.nextResizeSeq = 0;
  gate.pendingAbsoluteScroll = undefined;
  gate.idleIntentQueued = false;
  gate.lastActivityAt = 0;
  gate.lastScrollEventAt = 0;
  gate.scrollSessionLive = false;
  gate.sampledScrollTop = 0;
  gate.lastProgrammaticScrollTop = undefined;
  gate.lastProgrammaticWriteAt = 0;
  gate.stats = createEmptyStats(ownerEnabled);
  if (ownerEnabled && typeof window !== 'undefined') {
    window.__threadScrollOwnerStats = gate.stats;
  }
};

/**
 * Gates `rawThreadEvents` at the timeline boundary so that when headroom is exhausted
 * mid-gesture, a fetched prepend page is held out of `threadEvents` until scroll rest.
 * Pure with respect to DOM layout: reads only committed headroom and committed anchor.
 */
export const useThreadHeadroomEventsGate = ({
  viewKey,
  threadId,
  ownerEnabled,
  rawThreadEvents,
  threadUserScrolled,
}: {
  viewKey: string;
  threadId: string | undefined;
  ownerEnabled: boolean;
  rawThreadEvents: MatrixEvent[];
  threadUserScrolled: boolean;
}): {
  gate: ThreadHeadroomGateHandle;
  presentedThreadEvents: MatrixEvent[];
  hasHeldThreadEvents: boolean;
} => {
  const [, setCommitTick] = useState(0);
  const bumpCommitTick = useCallback(() => {
    setCommitTick((t) => t + 1);
  }, []);

  const gateRef = useRef<ThreadHeadroomGateHandle | undefined>(undefined);
  if (!gateRef.current) {
    gateRef.current = {
      viewKey: '',
      committedHeadroomPx: 0,
      headroomInitialized: false,
      initialTestCapApplied: false,
      lastAvgRowHeight: DEFAULT_ROW_HEIGHT_PX,
      sizeCache: undefined,
      anchorRef: undefined,
      presentedEvents: rawThreadEvents,
      heldRawEvents: undefined,
      heldPrependEstimatePx: 0,
      pendingReleaseAfterTopUp: false,
      pendingReconcileAfterWrite: false,
      pendingBottomReconcile: false,
      aboveResizeQueue: [],
      nextResizeSeq: 0,
      pendingAbsoluteScroll: undefined,
      idleIntentQueued: false,
      lastActivityAt: 0,
      lastScrollEventAt: 0,
      scrollSessionLive: false,
      sampledScrollTop: 0,
      lastProgrammaticScrollTop: undefined,
      lastProgrammaticWriteAt: 0,
      stats: createEmptyStats(ownerEnabled),
      bumpCommitTick,
    };
  }
  const gate = gateRef.current;
  gate.bumpCommitTick = bumpCommitTick;

  if (gate.viewKey !== viewKey) {
    resetGateForView(gate, viewKey, ownerEnabled, rawThreadEvents);
  }

  if (!ownerEnabled || !threadId) {
    gate.presentedEvents = rawThreadEvents;
    gate.heldRawEvents = undefined;
    gate.heldPrependEstimatePx = 0;
    return {
      gate,
      presentedThreadEvents: rawThreadEvents,
      hasHeldThreadEvents: false,
    };
  }

  // If a held page was just released by the commit-time layout effect, adopt it directly.
  if (gate.presentedEvents === rawThreadEvents) {
    gate.heldRawEvents = undefined;
    gate.heldPrependEstimatePx = 0;
  } else if (!threadUserScrolled) {
    // Still opening (before first user gesture): accept immediately; open-init tops up headroom.
    gate.presentedEvents = rawThreadEvents;
    gate.heldRawEvents = undefined;
    gate.heldPrependEstimatePx = 0;
  } else {
    const insideReserve =
      gate.anchorRef?.current === undefined && gate.committedHeadroomPx > 0;
    const estimatedPrependPx = estimatePrependedHeight({
      rawEvents: rawThreadEvents,
      presentedEvents: gate.presentedEvents,
      anchor: gate.anchorRef?.current,
      threadId,
      sizeCache: gate.sizeCache,
      avgRowHeight: gate.lastAvgRowHeight,
      fillReserve: insideReserve,
    });
    // Rule of iron: once a page is held out of threadEvents mid-gesture, NEVER release it during
    // render; only the single commit-time layout effect at genuine rest releases it.
    // When inside the reserve, pages fill the reserve from the bottom up as long as enough
    // headroom remains; if remaining headroom would be exhausted, hold until rest.
    const requiredHeadroomPx = estimatedPrependPx > 0 ? Math.ceil(estimatedPrependPx) : 0;
    if (gate.heldRawEvents !== undefined || requiredHeadroomPx > gate.committedHeadroomPx) {
      if (gate.heldRawEvents !== rawThreadEvents) {
        gate.stats.heldPages += 1;
      }
      gate.heldRawEvents = rawThreadEvents;
      gate.heldPrependEstimatePx = Math.max(gate.heldPrependEstimatePx, estimatedPrependPx);
    } else {
      gate.presentedEvents = rawThreadEvents;
      gate.heldRawEvents = undefined;
      gate.heldPrependEstimatePx = 0;
    }
  }

  return {
    gate,
    presentedThreadEvents: gate.presentedEvents,
    hasHeldThreadEvents: gate.heldRawEvents !== undefined,
  };
};

export type HeadroomRenderSnapshot = {
  headroomPxAtRender: number;
  renderedResizeSeq: number;
  zeroHeadroomDrift: boolean;
};

/**
 * Pure render calculation: reads ONLY committed headroom plus queued facts.
 * Never reads live `scrollElement.scrollTop`, never calls `Date.now()`, never writes scroll.
 */
export const computeHeadroomRenderSnapshot = (
  gate: ThreadHeadroomGateHandle,
  {
    ownerEnabled,
    resettingLedgerView,
    prependFoldPx,
    leadingFoldPx,
  }: {
    ownerEnabled: boolean;
    resettingLedgerView: boolean;
    prependFoldPx: number;
    leadingFoldPx: number;
  }
): HeadroomRenderSnapshot => {
  if (!ownerEnabled || resettingLedgerView) {
    return { headroomPxAtRender: 0, renderedResizeSeq: 0, zeroHeadroomDrift: false };
  }
  let resizeDelta = 0;
  let renderedResizeSeq = 0;
  for (let i = 0; i < gate.aboveResizeQueue.length; i += 1) {
    const entry = gate.aboveResizeQueue[i]!;
    resizeDelta += entry.delta;
    if (entry.seq > renderedResizeSeq) renderedResizeSeq = entry.seq;
  }
  const totalAboveDelta = prependFoldPx + leadingFoldPx + resizeDelta;
  const rawNext = gate.committedHeadroomPx - totalAboveDelta;
  if (rawNext >= 0) {
    return { headroomPxAtRender: rawNext, renderedResizeSeq, zeroHeadroomDrift: false };
  }
  // Headroom reached zero on a row growth above the reader (e.g. a late image):
  // clamp at 0 and accept anchor drift rather than writing scrollTop.
  return {
    headroomPxAtRender: 0,
    renderedResizeSeq,
    zeroHeadroomDrift: totalAboveDelta > 0,
  };
};

export type UseThreadHeadroomCommitOptions = {
  gate: ThreadHeadroomGateHandle;
  snapshot: HeadroomRenderSnapshot;
  ownerEnabled: boolean;
  resettingLedgerView: boolean;
  threadId: string | undefined;
  threadEvents: MatrixEvent[];
  expectedThreadEvents: number;
  hasMoreHistory: boolean;
  rawHasMoreHistory: boolean;
  threadUserScrolled: boolean;
  threadOpenedAtLatest: boolean;
  getScrollElement: () => HTMLDivElement | null;
  virtualInnerRef: React.RefObject<HTMLDivElement | null>;
  virtualizerRef: React.MutableRefObject<Virtualizer<HTMLDivElement, Element>>;
  anchorRef: React.MutableRefObject<ThreadLedgerAnchor | undefined>;
  sizeCacheRef: React.MutableRefObject<Map<unknown, number> | undefined>;
  onAfterScrollWrite?: (scrollTop: number) => void;
};

export const useThreadHeadroomCommit = ({
  gate,
  snapshot,
  ownerEnabled,
  resettingLedgerView,
  threadId,
  threadEvents,
  expectedThreadEvents,
  hasMoreHistory,
  rawHasMoreHistory,
  threadUserScrolled,
  threadOpenedAtLatest,
  getScrollElement,
  virtualInnerRef,
  virtualizerRef,
  anchorRef,
  sizeCacheRef,
  onAfterScrollWrite,
}: UseThreadHeadroomCommitOptions) => {
  gate.anchorRef = anchorRef;
  const { headroomPxAtRender, renderedResizeSeq, zeroHeadroomDrift } = snapshot;

  const enqueueAboveResize = useCallback(
    (delta: number) => {
      if (!ownerEnabled || delta === 0) return;
      gate.nextResizeSeq += 1;
      gate.aboveResizeQueue.push({ seq: gate.nextResizeSeq, delta });
    },
    [gate, ownerEnabled]
  );

  // Idle / scroll-rest detector: tracks scroll, wheel, touch, pointer, scrollend, rubber-band,
  // and exact scrollTop stability. Enqueues an intent for the single commit-time layout effect.
  const latestRef = useRef({
    hasMoreHistory,
    rawHasMoreHistory,
    threadEventsLength: threadEvents.length,
    expectedThreadEvents,
    threadUserScrolled,
  });
  latestRef.current = {
    hasMoreHistory,
    rawHasMoreHistory,
    threadEventsLength: threadEvents.length,
    expectedThreadEvents,
    threadUserScrolled,
  };

  const isAtRestNow = useCallback(
    (el: HTMLElement | null): boolean => {
      if (!el || !el.isConnected) return false;
      if (hasActiveWindowTouches()) return false;
      if (el.dataset.scrollbarDragging === "true") return false;
      if (isScrollerRubberBanding(el)) return false;
      const now = Date.now();
      if (gate.lastActivityAt > 0 && now - gate.lastActivityAt < HEADROOM_IDLE_REST_MS) {
        return false;
      }
      const sessionStillLive =
        gate.scrollSessionLive && now - gate.lastScrollEventAt < SCROLL_SESSION_STALE_MS;
      if (sessionStillLive) return false;
      if (el.scrollTop !== gate.sampledScrollTop) return false;
      return true;
    },
    [gate]
  );

  const armIdleRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!ownerEnabled || !threadId) return undefined;
    const scrollElement = getScrollElement();
    if (!scrollElement) return undefined;

    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const needsIdleWork = (): boolean => {
      const cur = latestRef.current;
      if (gate.heldRawEvents !== undefined) return true;
      if (!cur.hasMoreHistory && gate.committedHeadroomPx > 0) return true;
      if (cur.hasMoreHistory && cur.threadUserScrolled) {
        const viewH = Math.max(300, scrollElement.clientHeight || 900);
        if (gate.committedHeadroomPx < viewH * TOP_UP_LOW_WATER_VIEWPORTS) return true;
      }
      return false;
    };

    const scheduleCheck = (delayMs: number) => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      gate.sampledScrollTop = scrollElement.scrollTop;
      idleTimer = setTimeout(() => {
        idleTimer = undefined;
        if (!scrollElement.isConnected) return;
        const currentTop = scrollElement.scrollTop;
        if (currentTop !== gate.sampledScrollTop) {
          gate.sampledScrollTop = currentTop;
          gate.lastActivityAt = Date.now();
          scheduleCheck(HEADROOM_IDLE_REST_MS);
          return;
        }
        const now = Date.now();
        const elapsed =
          gate.lastActivityAt > 0 ? now - gate.lastActivityAt : HEADROOM_IDLE_REST_MS;
        const sessionStillLive =
          gate.scrollSessionLive && now - gate.lastScrollEventAt < SCROLL_SESSION_STALE_MS;
        if (
          hasActiveWindowTouches() ||
          scrollElement.dataset.scrollbarDragging === "true" ||
          isScrollerRubberBanding(scrollElement) ||
          sessionStillLive ||
          elapsed < HEADROOM_IDLE_REST_MS
        ) {
          const nextDelay = Math.max(
            60,
            elapsed < HEADROOM_IDLE_REST_MS ? HEADROOM_IDLE_REST_MS - elapsed : 120
          );
          scheduleCheck(nextDelay);
          return;
        }
        if (needsIdleWork()) {
          gate.idleIntentQueued = true;
          gate.bumpCommitTick();
        }
      }, delayMs);
    };

    const markUserActivity = (fromScrollEvent: boolean) => {
      const now = Date.now();
      if (
        fromScrollEvent &&
        gate.lastProgrammaticScrollTop !== undefined &&
        Math.abs(scrollElement.scrollTop - gate.lastProgrammaticScrollTop) <= 1.5 &&
        now - gate.lastProgrammaticWriteAt < PROGRAMMATIC_SCROLL_ECHO_MS
      ) {
        gate.sampledScrollTop = scrollElement.scrollTop;
        return;
      }
      gate.lastActivityAt = now;
      gate.idleIntentQueued = false;
      if (fromScrollEvent && supportsScrollEndEvents()) {
        gate.scrollSessionLive = true;
        gate.lastScrollEventAt = now;
      }
      scheduleCheck(HEADROOM_IDLE_REST_MS);
    };

    const onScroll = () => markUserActivity(true);
    const onWheel = () => markUserActivity(false);
    const onTouchActivity = () => markUserActivity(false);
    const onTouchOrPointerEnd = () => {
      const now = Date.now();
      gate.lastActivityAt = Math.max(gate.lastActivityAt, now);
      scheduleCheck(HEADROOM_IDLE_REST_MS);
    };
    const onScrollEnd = () => {
      gate.scrollSessionLive = false;
      const now = Date.now();
      const remaining =
        gate.lastActivityAt > 0
          ? Math.max(50, HEADROOM_IDLE_REST_MS - (now - gate.lastActivityAt))
          : 50;
      scheduleCheck(remaining);
    };

    armIdleRef.current = () => {
      if (!needsIdleWork()) return;
      const now = Date.now();
      const elapsed =
        gate.lastActivityAt > 0 ? now - gate.lastActivityAt : HEADROOM_IDLE_REST_MS;
      const delay = elapsed >= HEADROOM_IDLE_REST_MS ? 60 : HEADROOM_IDLE_REST_MS - elapsed;
      scheduleCheck(delay);
    };

    scrollElement.addEventListener("scroll", onScroll, { passive: true });
    scrollElement.addEventListener("wheel", onWheel, { passive: true, capture: true });
    scrollElement.addEventListener("scrollend", onScrollEnd, { passive: true });
    scrollElement.addEventListener("touchstart", onTouchActivity, { passive: true, capture: true });
    scrollElement.addEventListener("touchmove", onTouchActivity, { passive: true, capture: true });
    window.addEventListener("touchend", onTouchOrPointerEnd, { passive: true, capture: true });
    window.addEventListener("touchcancel", onTouchOrPointerEnd, { passive: true, capture: true });
    window.addEventListener("pointerup", onTouchOrPointerEnd, { passive: true, capture: true });

    armIdleRef.current();

    return () => {
      armIdleRef.current = () => undefined;
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      scrollElement.removeEventListener("scroll", onScroll);
      scrollElement.removeEventListener("wheel", onWheel, true);
      scrollElement.removeEventListener("scrollend", onScrollEnd);
      scrollElement.removeEventListener("touchstart", onTouchActivity, true);
      scrollElement.removeEventListener("touchmove", onTouchActivity, true);
      window.removeEventListener("touchend", onTouchOrPointerEnd, true);
      window.removeEventListener("touchcancel", onTouchOrPointerEnd, true);
      window.removeEventListener("pointerup", onTouchOrPointerEnd, true);
    };
  }, [gate, getScrollElement, ownerEnabled, threadId, hasMoreHistory]);

  // Single commit-time layout effect:
  // 1. Clears ONLY the resize queue entries consumed by this render (`seq <= renderedResizeSeq`).
  // 2. Updates committed headroom snapshot & running average height.
  // 3. Applies any pending absolute scroll write and reconciles `virtualizer.scrollOffset`
  //    to the actual DOM result (eliminating near-bottom double moves under native clamping).
  // 4. Evaluates open-init or queued idle intents (held-page release, top-up, nearTop trim),
  //    capturing ONE absolute scroll target BEFORE changing the extent.
  useLayoutEffect(() => {
    if (!ownerEnabled || resettingLedgerView) return;

    if (renderedResizeSeq > 0) {
      gate.aboveResizeQueue = gate.aboveResizeQueue.filter(
        (entry) => entry.seq > renderedResizeSeq
      );
    }

    gate.committedHeadroomPx = headroomPxAtRender;
    gate.sizeCache = sizeCacheRef.current;
    gate.anchorRef = anchorRef;
    const avgRowHeight = computeAverageMeasuredRowHeight(
      gate.sizeCache,
      gate.lastAvgRowHeight,
      virtualizerRef.current.measurementsCache
    );
    gate.lastAvgRowHeight = avgRowHeight;
    gate.stats.lastHeadroom = Math.round(headroomPxAtRender);
    gate.stats.lastAvgRowHeight = Math.round(avgRowHeight);
    if (zeroHeadroomDrift) {
      gate.stats.zeroHeadroomGrowthDrifts += 1;
    }

    if (gate.aboveResizeQueue.length > 0) {
      gate.bumpCommitTick();
      return;
    }

    const scrollElement = getScrollElement();
    if (!scrollElement) return;

    const writeAbsoluteScroll = (
      target: number,
      reason: PendingAbsoluteScroll["reason"],
      notifyAnchor: boolean
    ): boolean => {
      const clampedTarget = Math.max(
        0,
        Math.min(target, Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight))
      );
      const prevTop = scrollElement.scrollTop;
      const moved = Math.abs(prevTop - clampedTarget) > 0.5;
      if (moved) {
        gate.lastProgrammaticScrollTop = clampedTarget;
        gate.lastProgrammaticWriteAt = Date.now();
        scrollElement.scrollTop = clampedTarget;
        gate.stats.writes += 1;
        gate.stats.deltas = [...gate.stats.deltas, Math.round(clampedTarget - prevTop)];
      }
      const actual = scrollElement.scrollTop;
      gate.sampledScrollTop = actual;
      gate.lastProgrammaticScrollTop = actual;
      gate.lastProgrammaticWriteAt = Date.now();
      const virt = virtualizerRef.current;
      const offsetChanged = Math.abs((virt.scrollOffset ?? 0) - actual) > 0.5;
      if (offsetChanged) {
        virt.scrollOffset = actual;
      }
      if (notifyAnchor) onAfterScrollWrite?.(actual);
      if (reason === "trim") gate.stats.trims += 1;
      if (reason === "topup" || reason === "held-release") gate.stats.topUps += 1;
      return offsetChanged;
    };

    // Atomic single-commit extent+scroll transition:
    // Captures one absolute target BEFORE shrinking the extent (or pre-grows `inner.style.height`
    // before writing when growing), writes `scrollTop` + reconciles `virtualizer.scrollOffset`
    // immediately so the synchronous React re-render commits matching `scrollMargin` and
    // `scrollTop` without ever mounting rows from an out-of-sync intermediate scroll window.
    const applyHeadroomTransition = ({
      nextHeadroom,
      scrollKind,
      targetScrollTop,
      reason,
      releaseHeldEvents = false,
    }: {
      nextHeadroom: number;
      scrollKind: "offset" | "bottom";
      targetScrollTop?: number;
      reason: PendingAbsoluteScroll["reason"];
      releaseHeldEvents?: boolean;
    }) => {
      const inner = virtualInnerRef.current;
      const virt = virtualizerRef.current;
      const delta = nextHeadroom - gate.committedHeadroomPx;
      const preTop = scrollElement.scrollTop;
      if (!inner) {
        // Fallback if inner ref is not yet attached (first mount).
        gate.committedHeadroomPx = nextHeadroom;
        gate.pendingAbsoluteScroll =
          scrollKind === "bottom"
            ? { kind: "bottom", reason }
            : { kind: "offset", target: Math.max(0, targetScrollTop ?? preTop + delta), reason };
        gate.pendingReleaseAfterTopUp = releaseHeldEvents;
        gate.bumpCommitTick();
        return;
      }
      if (delta > 0) {
        inner.style.height = `${nextHeadroom + virt.getTotalSize()}px`;
      }
      const target =
        scrollKind === "bottom"
          ? delta >= 0
            ? Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
            : Math.max(0, scrollElement.scrollHeight + delta - scrollElement.clientHeight)
          : Math.max(0, targetScrollTop ?? preTop + delta);
      writeAbsoluteScroll(target, reason, false);
      gate.committedHeadroomPx = nextHeadroom;
      gate.pendingReconcileAfterWrite = true;
      gate.pendingBottomReconcile = scrollKind === "bottom";
      gate.pendingReleaseAfterTopUp = releaseHeldEvents;
      gate.bumpCommitTick();
    };

    if (gate.pendingReconcileAfterWrite) {
      gate.pendingReconcileAfterWrite = false;
      const bottomReconcile = gate.pendingBottomReconcile;
      gate.pendingBottomReconcile = false;
      if (bottomReconcile) {
        const maxTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
        if (Math.abs(scrollElement.scrollTop - maxTop) > 1) {
          gate.lastProgrammaticScrollTop = maxTop;
          gate.lastProgrammaticWriteAt = Date.now();
          scrollElement.scrollTop = maxTop;
        }
      }
      const actual = scrollElement.scrollTop;
      gate.sampledScrollTop = actual;
      gate.lastProgrammaticScrollTop = actual;
      gate.lastProgrammaticWriteAt = Date.now();
      const virt = virtualizerRef.current;
      const offsetChanged = Math.abs((virt.scrollOffset ?? 0) - actual) > 0.5;
      if (offsetChanged) {
        virt.scrollOffset = actual;
      }
      onAfterScrollWrite?.(actual);

      if (gate.pendingReleaseAfterTopUp && gate.heldRawEvents !== undefined) {
        gate.pendingReleaseAfterTopUp = false;
        gate.presentedEvents = gate.heldRawEvents;
        gate.heldRawEvents = undefined;
        gate.heldPrependEstimatePx = 0;
        gate.stats.releasedHeldPages += 1;
        gate.bumpCommitTick();
        return;
      }
      if (offsetChanged) {
        gate.bumpCommitTick();
        return;
      }
    }

    const pendingScroll = gate.pendingAbsoluteScroll;
    if (pendingScroll !== undefined) {
      gate.pendingAbsoluteScroll = undefined;
      const target =
        pendingScroll.kind === "bottom"
          ? Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
          : pendingScroll.target;
      const offsetChanged = writeAbsoluteScroll(target, pendingScroll.reason, true);

      if (gate.pendingReleaseAfterTopUp && gate.heldRawEvents !== undefined) {
        gate.pendingReleaseAfterTopUp = false;
        gate.presentedEvents = gate.heldRawEvents;
        gate.heldRawEvents = undefined;
        gate.heldPrependEstimatePx = 0;
        gate.stats.releasedHeldPages += 1;
        gate.bumpCommitTick();
        return;
      }

      if (offsetChanged) {
        gate.bumpCommitTick();
        return;
      }
    }

    const viewH = Math.max(300, scrollElement.clientHeight || 900);
    const viewW = scrollElement.clientWidth || 1200;

    const countUnmeasuredVisible = (events: MatrixEvent[], upToIndex?: number): number => {
      const cache = sizeCacheRef.current;
      const mCache = virtualizerRef.current.measurementsCache;
      const limit = upToIndex !== undefined ? Math.min(upToIndex, events.length) : events.length;
      let count = 0;
      for (let i = 0; i < limit; i += 1) {
        const id = events[i]?.getId();
        if (!id || cache?.has(id)) continue;
        // Skip folded/hidden 0-height rows; they never wrap taller when mounted.
        const est = mCache[i]?.size;
        if (est !== undefined && est <= 0) continue;
        count += 1;
      }
      return count;
    };

    // Opening headroom reservation & recalibration while `!threadUserScrolled`.
    if (!threadUserScrolled && hasMoreHistory && threadEvents.length > 0) {
      const unloaded = Math.max(0, expectedThreadEvents - threadEvents.length);
      const unmeasuredVisible = countUnmeasuredVisible(threadEvents);
      let desired = computeHeadroomBudget({
        unloadedReplies: unloaded,
        unmeasuredLoaded: unmeasuredVisible,
        avgRowHeight,
        viewHeight: viewH,
        viewWidth: viewW,
        hasMoreHistory: true,
      });
      const testCap = readTestInitialHeadroomCapPx();
      if (testCap !== undefined && !gate.initialTestCapApplied) {
        desired = Math.min(desired, testCap);
      }
      const shouldSeed = !gate.headroomInitialized;
      const shouldRecalibrate =
        testCap === undefined &&
        (gate.committedHeadroomPx < desired * 0.85 ||
          gate.committedHeadroomPx > desired * 1.25 + viewH);
      if (shouldSeed || shouldRecalibrate) {
        gate.headroomInitialized = true;
        if (testCap !== undefined) gate.initialTestCapApplied = true;
        const delta = desired - gate.committedHeadroomPx;
        if (Math.abs(delta) > 1) {
          gate.stats.initBudget = Math.round(desired);
          applyHeadroomTransition({
            nextHeadroom: desired,
            scrollKind: threadOpenedAtLatest ? "bottom" : "offset",
            targetScrollTop: Math.max(0, scrollElement.scrollTop + delta),
            reason: "open-init",
          });
          return;
        }
      }
    }

    // If history finished loading while still pinned on open (!threadUserScrolled), release
    // excess headroom before the reader ever scrolls. On narrow phone viewports keep a modest
    // wrap cushion (capped at 2 viewports) for unmeasured rows above so scrolling up absorbs
    // mobile line-wrap growth with zero anchor drift; desktop trims cleanly to 0.
    if (
      !threadUserScrolled &&
      !hasMoreHistory &&
      gate.committedHeadroomPx > 0 &&
      threadEvents.length > 0 &&
      gate.heldRawEvents === undefined
    ) {
      const unmeasuredVisible = countUnmeasuredVisible(threadEvents);
      const keepCushion =
        viewW < 600
          ? Math.min(gate.committedHeadroomPx, unmeasuredVisible * 12, Math.round(viewH * 2))
          : 0;
      const trim = gate.committedHeadroomPx - keepCushion;
      if (trim > 1) {
        const preTop = scrollElement.scrollTop;
        applyHeadroomTransition({
          nextHeadroom: keepCushion,
          scrollKind: threadOpenedAtLatest ? "bottom" : "offset",
          targetScrollTop: Math.max(0, preTop - trim),
          reason: "trim",
        });
        return;
      }
    }

    if (!gate.idleIntentQueued) {
      if (
        gate.heldRawEvents !== undefined ||
        (!hasMoreHistory && gate.committedHeadroomPx > 0) ||
        (hasMoreHistory &&
          threadUserScrolled &&
          gate.committedHeadroomPx < viewH * TOP_UP_LOW_WATER_VIEWPORTS)
      ) {
        armIdleRef.current();
      }
      return;
    }

    gate.idleIntentQueued = false;
    if (!isAtRestNow(scrollElement)) {
      armIdleRef.current();
      return;
    }

    // Priority 1: Release a held page that arrived when headroom was exhausted mid-gesture.
    if (gate.heldRawEvents !== undefined) {
      const heldEvents = gate.heldRawEvents;
      const unloadedAfter = Math.max(0, expectedThreadEvents - heldEvents.length);
      const unmeasuredAfter = countUnmeasuredVisible(threadEvents, anchorRef.current?.index);
      const perUnmeasured = viewW < 600 ? 70 : 10;
      const prependExactEstimate = Math.ceil(gate.heldPrependEstimatePx);
      const targetHeadroom = rawHasMoreHistory
        ? Math.max(
            computeHeadroomBudget({
              unloadedReplies: unloadedAfter,
              unmeasuredLoaded: unmeasuredAfter,
              avgRowHeight,
              viewHeight: viewH,
              viewWidth: viewW,
              hasMoreHistory: true,
            }) + prependExactEstimate,
            prependExactEstimate + Math.round(viewH * MIN_HISTORY_BUDGET_VIEWPORTS)
          )
        : Math.max(
            prependExactEstimate +
              Math.min(unmeasuredAfter * perUnmeasured, 12_000) +
              Math.round(viewH * 1.25),
            prependExactEstimate
          );
      const delta = targetHeadroom - gate.committedHeadroomPx;
      if (delta > 1) {
        applyHeadroomTransition({
          nextHeadroom: targetHeadroom,
          scrollKind: "offset",
          targetScrollTop: scrollElement.scrollTop + delta,
          reason: "held-release",
          releaseHeldEvents: true,
        });
        return;
      }
      gate.presentedEvents = heldEvents;
      gate.heldRawEvents = undefined;
      gate.heldPrependEstimatePx = 0;
      gate.stats.releasedHeldPages += 1;
      gate.bumpCommitTick();
      return;
    }

    // Priority 2: Rest-time top-up whenever headroom drops below ~2 viewports (even after user scroll).
    if (
      hasMoreHistory &&
      threadUserScrolled &&
      gate.committedHeadroomPx < viewH * TOP_UP_LOW_WATER_VIEWPORTS
    ) {
      const unloaded = Math.max(0, expectedThreadEvents - threadEvents.length);
      const anchorIdx = anchorRef.current?.index ?? threadEvents.length;
      const unmeasuredAbove = countUnmeasuredVisible(threadEvents, anchorIdx);
      const targetHeadroom = computeHeadroomBudget({
        unloadedReplies: unloaded,
        unmeasuredLoaded: unmeasuredAbove,
        avgRowHeight,
        viewHeight: viewH,
        viewWidth: viewW,
        hasMoreHistory: true,
      });
      const delta = targetHeadroom - gate.committedHeadroomPx;
      if (delta > 1) {
        applyHeadroomTransition({
          nextHeadroom: targetHeadroom,
          scrollKind: "offset",
          targetScrollTop: scrollElement.scrollTop + delta,
          reason: "topup",
        });
        return;
      }
    }

    // Priority 3: Rest-time trim ONLY when history is complete (`!hasMoreHistory`) AND `nearTop`.
    if (!hasMoreHistory && gate.committedHeadroomPx > 0 && threadEvents.length > 0) {
      const preTop = scrollElement.scrollTop;
      const anchorIdx = anchorRef.current?.index ?? 0;
      const unmeasuredAbove =
        preTop >= gate.committedHeadroomPx && anchorIdx > 0
          ? countUnmeasuredVisible(threadEvents, anchorIdx)
          : 0;
      const plan = computeTrimPlan({
        headroomPx: gate.committedHeadroomPx,
        scrollTop: preTop,
        viewHeight: viewH,
        viewWidth: viewW,
        unmeasuredAbove,
      });
      if (plan) {
        applyHeadroomTransition({
          nextHeadroom: plan.nextHeadroom,
          scrollKind: "offset",
          targetScrollTop: plan.targetScrollTop,
          reason: "trim",
        });
      }
    }
  });

  return {
    enqueueAboveResize,
  };
};
