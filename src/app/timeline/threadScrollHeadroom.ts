import type { MutableRefObject } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { ThreadLedgerAnchor } from './threadScrollLedger';

/** Feature flag: `localStorage['mindroom.threadScrollOwner'] = '1'` (OFF by default). */
export const THREAD_SCROLL_OWNER_FLAG = 'mindroom.threadScrollOwner';

/** Idle quiet window before any rest-time geometry write (trim, top-up, or held-page release). */
export const HEADROOM_IDLE_REST_MS = 500;
/** Default row height estimate before any rows in the view have been measured. */
export const DEFAULT_ROW_HEIGHT_PX = 180;
/** Top-up triggers when headroom drops below this multiple of the viewport height. */
export const TOP_UP_LOW_WATER_VIEWPORTS = 2;
/** Minimum reserve floor (in viewports) while more history remains. */
export const MIN_HISTORY_BUDGET_VIEWPORTS = 4;
/** Trim activates only when the reader is within this distance below row 0 (or inside the reserve). */
export const NEAR_TOP_VIEWPORTS = 1.5;
const RUBBER_BAND_EPSILON_PX = 1;

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

/**
 * Isolated policy for a fast fling that carries `scrollTop` into the loading reserve
 * (`scrollTop < headroomPx`).
 * - `'glide'`: let the reader slide into the loading lines while pages fill from the bottom up.
 * - `'clamp'`: hard-clamp `scrollTop` at `headroomPx` (row 0) until pages arrive.
 */
export type ReserveEntryPolicy = 'glide' | 'clamp';
export const RESERVE_ENTRY_POLICY: ReserveEntryPolicy = 'glide';

export const resolveReserveEntryTarget = (
  scrollTop: number,
  headroomPx: number,
  policy: ReserveEntryPolicy = RESERVE_ENTRY_POLICY
): number | undefined => {
  if (policy === 'clamp' && headroomPx > 0 && scrollTop < headroomPx) {
    return headroomPx;
  }
  return undefined;
};

export type ResizeQueueEntry = {
  seq: number;
  delta: number;
  /** Virtual item index, key, and pre-resize size when the entry came from a row measurement. */
  itemIndex?: number;
  itemKey?: unknown;
  oldSize?: number;
};

export type PendingThreadScrollFact =
  | { kind: 'pin-bottom'; behavior?: ScrollBehavior; markAtBottom?: boolean }
  | { kind: 'jump-index'; index: number; align?: 'start' | 'center' | 'end' }
  | {
      kind: 'jump-element';
      element: HTMLElement;
      align?: 'start' | 'center' | 'end';
      offset?: number;
      stopInView?: boolean;
      behavior?: ScrollBehavior;
    }
  | { kind: 'clamp-reserve'; target: number }
  | { kind: 'status-bar-top' };

export type PendingAbsoluteScroll = { kind: 'offset'; target: number } | { kind: 'bottom' };

export type ThreadScrollOwnerState = {
  viewKey: string;
  committedHeadroomPx: number;
  headroomInitialized: boolean;
  lastAvgRowHeight: number;
  sizeCache: ReadonlyMap<unknown, number> | undefined;
  anchorRef: MutableRefObject<ThreadLedgerAnchor | undefined> | undefined;
  presentedEvents: MatrixEvent[];
  heldRawEvents: MatrixEvent[] | undefined;
  heldPrependEstimatePx: number;
  pendingReleaseAfterTopUp: boolean;
  pendingReconcileAfterWrite: boolean;
  pendingBottomReconcile: boolean;
  aboveResizeQueue: ResizeQueueEntry[];
  nextResizeSeq: number;
  pendingFacts: PendingThreadScrollFact[];
  pendingAbsoluteScroll: PendingAbsoluteScroll | undefined;
  idleIntentQueued: boolean;
  lastActivityAt: number;
  lastScrollEventAt: number;
  scrollSessionLive: boolean;
  sampledScrollTop: number;
  lastProgrammaticScrollTop: number | undefined;
  lastProgrammaticWriteAt: number;
  bottomPinned: boolean;
  lastPinnedTop: number | undefined;
  bumpCommitTick: () => void;
};

export const createThreadScrollOwnerState = (
  initialEvents: MatrixEvent[],
  bumpCommitTick: () => void = () => undefined
): ThreadScrollOwnerState => ({
  viewKey: '',
  committedHeadroomPx: 0,
  headroomInitialized: false,
  lastAvgRowHeight: DEFAULT_ROW_HEIGHT_PX,
  sizeCache: undefined,
  anchorRef: undefined,
  presentedEvents: initialEvents,
  heldRawEvents: undefined,
  heldPrependEstimatePx: 0,
  pendingReleaseAfterTopUp: false,
  pendingReconcileAfterWrite: false,
  pendingBottomReconcile: false,
  aboveResizeQueue: [],
  nextResizeSeq: 0,
  pendingFacts: [],
  pendingAbsoluteScroll: undefined,
  idleIntentQueued: false,
  lastActivityAt: 0,
  lastScrollEventAt: 0,
  scrollSessionLive: false,
  sampledScrollTop: 0,
  lastProgrammaticScrollTop: undefined,
  lastProgrammaticWriteAt: 0,
  bottomPinned: false,
  lastPinnedTop: undefined,
  bumpCommitTick,
});

export const resetThreadScrollOwnerState = (
  state: ThreadScrollOwnerState,
  viewKey: string,
  initialEvents: MatrixEvent[]
): void => {
  const { anchorRef, bumpCommitTick } = state;
  Object.assign(state, createThreadScrollOwnerState(initialEvents, bumpCommitTick), {
    viewKey,
    anchorRef,
  });
};

/**
 * Recovers an item's `end` coordinate in the last painted layout before pending
 * `aboveResizeQueue` entries have been folded into `scrollMargin`.
 *
 * `@tanstack/virtual-core`'s `resizeItem` updates `itemSizeCache` without
 * immediately rebuilding `measurementsCache`. Within one ref-attach or ResizeObserver
 * batch, later `resizeItem` callbacks still see pre-batch coordinates, whereas a
 * callback after an intervening `getMeasurements()` sees rebuilt coordinates shifted
 * by `cached.size - entry.oldSize`. Subtracting only the shift reflected in
 * `measurementsCache` keeps classification exact in both states.
 */
export const computePaintedItemEnd = ({
  item,
  aboveResizeQueue,
  measurementsCache,
}: {
  item: { index: number; end: number };
  aboveResizeQueue: readonly ResizeQueueEntry[];
  measurementsCache: readonly { key: unknown; size: number }[] | undefined;
}): number => {
  if (!measurementsCache || aboveResizeQueue.length === 0) return item.end;
  const seenIndices = new Set<number>();
  let rebuiltShiftAbove = 0;
  for (let i = 0; i < aboveResizeQueue.length; i += 1) {
    const entry = aboveResizeQueue[i]!;
    if (
      entry.itemIndex === undefined ||
      entry.oldSize === undefined ||
      entry.itemIndex >= item.index ||
      seenIndices.has(entry.itemIndex)
    ) {
      continue;
    }
    seenIndices.add(entry.itemIndex);
    const cached = measurementsCache[entry.itemIndex];
    if (cached && (entry.itemKey === undefined || cached.key === entry.itemKey)) {
      rebuiltShiftAbove += cached.size - entry.oldSize;
    }
  }
  return item.end - rebuiltShiftAbove;
};

export const computeAverageMeasuredRowHeight = (
  sizeCache: ReadonlyMap<unknown, number> | undefined,
  fallbackPx = DEFAULT_ROW_HEIGHT_PX,
  measurementsCache?: readonly { key: unknown; size: number }[]
): number => {
  if (measurementsCache && measurementsCache.length > 0) {
    // Include 0-height folded/hidden rows in the denominator so agent threads do not inflate avg.
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
      safeViewH * MIN_HISTORY_BUDGET_VIEWPORTS
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
  // Entire viewport strictly inside the reserve (zero real rows visible): reveal row 0 cleanly
  // once history is complete and the reader rests; no visible real row moves.
  const realRowInView = headroomPx < scrollTop + safeViewH;
  if (!realRowInView) {
    return { nextHeadroom: 0, trim: headroomPx, targetScrollTop: 0 };
  }
  // Both reserve and real rows visible (`scrollTop < headroomPx < scrollTop + viewH`): trim only
  // invisible reserve strictly above the viewport (`[0, scrollTop)`) so visible rows never move.
  if (scrollTop < headroomPx) {
    const invisibleTrim = Math.max(0, scrollTop);
    if (invisibleTrim <= 0.5) return undefined;
    return {
      nextHeadroom: headroomPx - invisibleTrim,
      trim: invisibleTrim,
      targetScrollTop: 0,
    };
  }
  // Entire reserve strictly above viewport (`scrollTop >= headroomPx`): pair headroom and scrollTop.
  const perUnmeasured = viewWidth < 600 ? 20 : 8;
  const keepCushion = Math.min(
    headroomPx,
    Math.max(0, unmeasuredAbove) * perUnmeasured,
    Math.round(safeViewH * 0.5)
  );
  const trim = headroomPx - keepCushion;
  if (trim <= 0.5) return undefined;
  return {
    nextHeadroom: keepCushion,
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
  if (!threadId || rawEvents === presentedEvents) return 0;
  let boundaryEventId: string | undefined;
  if (anchor) {
    if (anchor.threadId !== threadId || anchor.eventId === threadId) return 0;
    boundaryEventId = anchor.eventId;
  } else if (fillReserve) {
    for (let i = 0; i < presentedEvents.length; i += 1) {
      const id = presentedEvents[i]?.getId();
      if (id && id !== threadId) {
        boundaryEventId = id;
        break;
      }
    }
  }
  if (!boundaryEventId) return 0;
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

export type HeadroomRenderSnapshot = {
  headroomPxAtRender: number;
  renderedResizeSeq: number;
};

/**
 * Pure render calculation: reads ONLY committed headroom plus queued facts.
 * Never reads live `scrollTop`, never calls `Date.now()`, never writes scroll.
 */
export const computeHeadroomRenderSnapshot = (
  state: ThreadScrollOwnerState,
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
    return { headroomPxAtRender: 0, renderedResizeSeq: 0 };
  }
  let resizeDelta = 0;
  let renderedResizeSeq = 0;
  for (let i = 0; i < state.aboveResizeQueue.length; i += 1) {
    const entry = state.aboveResizeQueue[i]!;
    resizeDelta += entry.delta;
    if (entry.seq > renderedResizeSeq) renderedResizeSeq = entry.seq;
  }
  const rawNext = state.committedHeadroomPx - (prependFoldPx + leadingFoldPx + resizeDelta);
  // If headroom reaches zero on an above-reader growth, clamp at 0 and accept anchor drift
  // rather than writing scrollTop mid-gesture.
  return { headroomPxAtRender: Math.max(0, rawNext), renderedResizeSeq };
};
