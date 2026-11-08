import {
  useCallback,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import {
  observeElementRect,
  useVirtualizer,
  type Range,
  type ReactVirtualizer,
} from '@tanstack/react-virtual';
import { threadScrollRange } from './threadScrollRange';
import { useClampedCorrectionFinish } from './clampedScrollCorrection';
import { listShrinkAfterResize } from './useListEndClamp';
import { countCacheProbe } from '../event-store/cache/cacheProbe';
import { createBatchedMeasurementRef, createScrollMountMeasurement } from './batchedMeasurementRef';
import { installRideTraceRecorder, isRideTraceEnabled } from './rideTraceRecorder';
import {
  hasActiveWindowTouches,
  isIOSWebKitDevice,
  waitForScrollQuiescence,
} from './scrollQuiescence';
import {
  SETTLE_DISCARD_HELD_SLACK_PX,
  SETTLE_DISCARD_MIN_LEDGER_PX,
  SETTLE_DISCARD_WINDOW_MS,
  buildMeasurementScrollCorrectionHook,
  isDiscardedSettleWrite,
  shouldSettleLedgerAtBoundary,
  type ThreadInitialRenderMode,
} from '../event-store/threads/threadRenderUtils';
import {
  planThreadLedgerRender,
  type ThreadLedgerAnchor,
  type ThreadLedgerEvent,
} from './threadScrollLedger';
import { planRoomLedgerRender, type RoomLedgerAnchor } from './roomScrollLedger';

type VirtualItemKey = string | number | bigint;

export type TimelineScrollLedgerControllerOptions = {
  alive: () => boolean;
  /**
   * The room's rows keep the reader's rows still when rows land above them, as for a thread's
   * rows: in the Threads view sorted by last reply, newest first, whose top is the room's latest
   * end. Asked whenever the reader's row is recorded; a reader it answers false for (at the
   * latest end) sees new rows arrive.
   */
  anchorRoomRows?: () => boolean;
  estimateSize: (index?: number) => number;
  getItemKey: (index: number) => VirtualItemKey;
  getScrollElement: () => HTMLDivElement | null;
  itemCount: number;
  pendingRoomFoldPxRef: MutableRefObject<number>;
  /**
   * This render still shows the window the pending room fold was priced against: the rows it
   * prices are not mounted yet (a scroll renders the virtual list at once, before the window's
   * update), so the fold waits for the render that mounts them.
   */
  roomFoldHeld?: boolean;
  roomFoldPriceRef: MutableRefObject<(key: VirtualItemKey, index: number) => number>;
  roomId: string;
  /**
   * Changes when the room's rows are replaced rather than added to: the ledger starts over, as
   * for another room, since its folds and its settle watch belong to rows that are gone.
   */
  rowsKey?: number;
  threadEventIndexMap: ReadonlyMap<string, number>;
  threadEvents: readonly ThreadLedgerEvent[];
  threadId?: string;
  threadInitialRenderMode: ThreadInitialRenderMode;
  /** What the thread renders between its banner and its rows. */
  threadLeadingKey?: string;
  automaticFill?: {
    isActive: () => boolean;
    geometryReader: MutableRefObject<() => string | undefined>;
  };
};

export type TimelineScrollLedgerController = {
  /** Ends the discarded-settle watch: the timeline is about to jump to a row. */
  endSettleDiscardWatch: () => void;
  holdThreadBannerResize: (deltaPx: number, scrollTop: number) => void;
  ledgerPxAtRender: number;
  measureElement: (node: Element | null) => void;
  threadLeadingRef: RefObject<HTMLDivElement>;
  /** The correction virtual-core applied that the rows do not show yet, in px. */
  unrenderedCorrectionPx: () => number;
  /** Applied upward measurement corrections, including those whose rows already rendered. */
  readMeasurementCorrectionPx: () => number;
  /** Whether a row changed size in place and the rows after it are not rendered at their new places yet. */
  unrenderedRowMove: () => boolean;
  /** The part of the ledger that rows folded above the reader brought with their own height, in px. */
  readRowFoldPx: () => number;
  virtualInnerRef: RefObject<HTMLDivElement>;
  virtualizer: ReactVirtualizer<HTMLDivElement, Element>;
};

type LedgerSettleVirtualizer<TOptions extends { scrollMargin?: number }> = {
  scrollOffset: number | null;
  options: TOptions;
  setOptions: (options: TOptions) => void;
};

const LEDGER_SNAPSHOT_EPSILON_PX = 0.01;

/**
 * The inline margin is the ledger snapshot React actually committed to the
 * DOM. The mutable accumulator can already contain a newer measurement while
 * the render that pairs that measurement with scrollMargin/tile positions is
 * still pending.
 */
const isLedgerSettleSnapshotCurrent = (
  inner: { style: { marginTop: string } },
  liveLedgerPx: number
): boolean => {
  const marginTop = inner.style.marginTop.trim();
  const paintedLedgerPx = marginTop === '' ? 0 : -Number.parseFloat(marginTop);
  return (
    Number.isFinite(paintedLedgerPx) &&
    Math.abs(paintedLedgerPx - liveLedgerPx) <= LEDGER_SNAPSHOT_EPSILON_PX
  );
};

/**
 * The DOM/virtualizer half of a ledger settle, as ONE function so the
 * real-core contract test (timelineScrollLedgerSettle.contract.test.ts)
 * executes the production sequence instead of a re-implementation.
 *
 * Ordering is load-bearing: the scrollTop write echoes asynchronously (iOS
 * may coalesce it away entirely) while setOptions recomputes the window
 * synchronously — so the virtualizer's cached offset must be reconciled to
 * the clamped post-write value FIRST, or the recompute pairs zeroed margin
 * with a pre-write offset and shifts the window by the whole fold,
 * mounting and measuring a band of far-away rows in one 100-240ms frame
 * (the settle-cascade jump: up to +1,531px content growth right after
 * rest, ride-traces 1783802452438 / 1783804190290, pinned in
 * rideTraceReplay.test.ts). Returns the clamped post-write scrollTop, or
 * undefined without mutating anything when the committed margin and live
 * accumulator are different ledger snapshots.
 */
export const applyLedgerSettle = <TOptions extends { scrollMargin?: number }>(
  inner: { style: { marginTop: string } },
  scrollElement: { scrollTop: number },
  px: number,
  virtualizer: LedgerSettleVirtualizer<TOptions>
): number | undefined => {
  // Never clear one committed margin with a different, newer accumulator.
  // The next React commit will paint the newer snapshot coherently; its
  // layout effect re-arms settlement.
  if (!isLedgerSettleSnapshotCurrent(inner, px)) return undefined;
  // Removing a positive margin can clamp a bottom-aligned native offset.
  // Capture the target first or a negative debt would be subtracted twice.
  const targetScrollTop = scrollElement.scrollTop + px;
  inner.style.marginTop = '';
  scrollElement.scrollTop = targetScrollTop;
  // Read back the browser-clamped value instead of assuming old+px.
  const settledScrollTop = scrollElement.scrollTop;
  virtualizer.scrollOffset = settledScrollTop;
  virtualizer.setOptions({ ...virtualizer.options, scrollMargin: 0 });
  return settledScrollTop;
};

/**
 * Owns the timeline virtualizer and its offset-ledger lifecycle.
 *
 * The controller deliberately keeps the render snapshot, commit-time DOM
 * writes, and at-rest settle in one module. A prepend or dropped measurement
 * correction therefore cannot update scrollMargin, the inner margin, or tile
 * positions through independent component paths.
 */
export const useTimelineScrollLedgerController = ({
  alive,
  anchorRoomRows,
  estimateSize,
  getItemKey,
  getScrollElement,
  itemCount,
  pendingRoomFoldPxRef,
  roomFoldHeld = false,
  roomFoldPriceRef,
  roomId,
  rowsKey,
  threadEventIndexMap,
  threadEvents,
  threadId,
  threadInitialRenderMode,
  threadLeadingKey = '',
  automaticFill,
}: TimelineScrollLedgerControllerOptions): TimelineScrollLedgerController => {
  const scrollCompensationPxRef = useRef(0);
  const virtualInnerRef = useRef<HTMLDivElement>(null);
  const compensationSettleArmedRef = useRef(false);
  // Bumped by the room/thread commit-time reset: an armed quiescence wait
  // from a disconnected view must never settle the next view's ledger.
  const ledgerGenerationRef = useRef(0);
  const ledgerViewKey = `${roomId}|${threadId ?? ''}|${rowsKey ?? ''}`;
  const compensationResetKeyRef = useRef(ledgerViewKey);
  const resettingLedgerView = compensationResetKeyRef.current !== ledgerViewKey;
  const [, setLedgerCommitTick] = useState(0);
  // The reader's first visible thread row as of the last commit or scroll.
  // Rows that a later render adds above it are folded, whatever added them.
  const threadLedgerAnchorRef = useRef<ThreadLedgerAnchor>();
  const ledgerSettleWantedRef = useRef(false);
  // The part of the ledger that thread rows added above the reader brought with their own height,
  // until the next settle: a thread's list holds all its rows, so their fold lifts the list without
  // changing the scroll content, and it is no room the list will give up (`listShrinkNotRendered`).
  // So do anchored room rows new to the list (`RoomLedgerFold.addedPx`): the Threads view's list
  // holds all its rows too. Window folds and the content above a thread's rows are left out: a
  // room's page can drop rows from the window below the reader, and the content above the rows is
  // outside the list.
  const rowFoldPxRef = useRef(0);
  // Fold pricing must use the previous committed cache. Reading the current
  // virtualizer during render would create a TDZ and couple planning to a
  // mutable instance.
  const ledgerFoldSizeCacheRef = useRef<Map<VirtualItemKey, number>>();

  const priceThreadRowForLedger = useCallback(
    (key: VirtualItemKey, index: number): number =>
      ledgerFoldSizeCacheRef.current?.get(key) ?? estimateSize(index),
    [estimateSize]
  );
  // Thread prepend planning is pure. Its mutations are applied only after
  // React commits the render that consumed this plan.
  const threadLedgerRenderPlan = planThreadLedgerRender({
    anchor: resettingLedgerView ? undefined : threadLedgerAnchorRef.current,
    eventIndexMap: threadEventIndexMap,
    priceRow: priceThreadRowForLedger,
    threadEvents,
    threadId,
  });
  // The content between the banner and the rows (load error, Load Older)
  // moves every row when its height changes, so it is priced like a row. A
  // render that changes what it shows folds all of its committed height, so
  // the margin lands before anything can read layout and clamp the scroll;
  // each commit then measures what it shows and folds that before paint,
  // where it can only add height. A reader looking at that content (no
  // anchor row) sees it change.
  const threadLeadingRef = useRef<HTMLDivElement>(null);
  const threadLeadingCommittedRef = useRef({ key: '', px: 0 });
  const committedLeading = threadLeadingCommittedRef.current;
  const threadLeadingPx = threadLeadingKey === committedLeading.key ? committedLeading.px : 0;
  const threadLeadingHeld =
    !resettingLedgerView && !!threadId && threadLedgerAnchorRef.current?.threadId === threadId;
  const threadLeadingFoldPx = threadLeadingHeld ? threadLeadingPx - committedLeading.px : 0;
  // Anchored room rows: rows a render puts above the reader's first visible row are folded,
  // whatever put them there (a new thread at the top, a page that widened the window).
  const roomLedgerAnchorRef = useRef<RoomLedgerAnchor>();
  const anchoringRoomRows = !threadId && !!anchorRoomRows;
  const roomRowKeys = anchoringRoomRows
    ? Array.from({ length: itemCount }, (_, index) => getItemKey(index))
    : [];
  const roomLedgerFold =
    anchoringRoomRows && !resettingLedgerView
      ? planRoomLedgerRender(roomLedgerAnchorRef.current, roomRowKeys, priceThreadRowForLedger)
      : undefined;
  const roomLedgerFoldPx = roomLedgerFold?.foldPx ?? 0;
  const roomLedgerAddedPx = roomLedgerFold?.addedPx ?? 0;
  // Room pagination records its exact prepend height before requesting the
  // range update. Keep that debt pending until the matching render commits;
  // abandoned concurrent renders neither lose nor double-apply it. Anchored
  // room rows price those rows themselves.
  const roomFoldPxAtRender =
    resettingLedgerView || roomFoldHeld || anchoringRoomRows ? 0 : pendingRoomFoldPxRef.current;
  // One immutable snapshot feeds virtualizer.scrollMargin, the inner margin,
  // and every tile top for this paint.
  const ledgerPxAtRender = resettingLedgerView
    ? 0
    : scrollCompensationPxRef.current +
      threadLedgerRenderPlan.foldPx +
      threadLeadingFoldPx +
      roomFoldPxAtRender +
      roomLedgerFoldPx;

  useLayoutEffect(() => {
    if (resettingLedgerView) return;

    const foldPx =
      threadLedgerRenderPlan.foldPx + threadLeadingFoldPx + roomFoldPxAtRender + roomLedgerFoldPx;
    if (foldPx !== 0) {
      // Preserve measurement corrections that arrived between render and
      // this effect; only add the render plan's delta.
      scrollCompensationPxRef.current += foldPx;
      rowFoldPxRef.current += threadLedgerRenderPlan.foldPx + roomLedgerAddedPx;
      ledgerSettleWantedRef.current = true;
    }
    if (anchoringRoomRows) pendingRoomFoldPxRef.current = 0;
    else pendingRoomFoldPxRef.current -= roomFoldPxAtRender;
    if (threadLedgerRenderPlan.probe) countCacheProbe(threadLedgerRenderPlan.probe);
  }, [
    anchoringRoomRows,
    ledgerViewKey,
    pendingRoomFoldPxRef,
    resettingLedgerView,
    roomFoldPxAtRender,
    roomLedgerAddedPx,
    roomLedgerFoldPx,
    threadLeadingFoldPx,
    threadLedgerRenderPlan,
  ]);

  // Core only notifies when visible indices change. A height-only resize
  // inside one tall row must still refresh the pixel buffer. Reuse its
  // observer, which remains attached when room/thread views share a scroller.
  const [, setViewportResizeTick] = useState(0);
  const observeThreadHeightRef = useRef(!!threadId);
  useInsertionEffect(() => {
    observeThreadHeightRef.current = !!threadId;
  }, [threadId]);
  const observeTimelineRect = useCallback<typeof observeElementRect>((instance, onRect) => {
    let previousHeight: number | undefined;
    return observeElementRect(instance, (rect) => {
      const heightChanged = previousHeight !== rect.height;
      previousHeight = rect.height;
      onRect(rect);
      if (heightChanged && observeThreadHeightRef.current) {
        setViewportResizeTick((tick) => tick + 1);
      }
    });
  }, []);

  // Extraction runs after useVirtualizer returns, against this render's
  // instance/options. A fresh callback invalidates the range cache on resize.
  const rangeExtractor = (range: Range): number[] => threadScrollRange(range, virtualizer);
  const virtualizer = useVirtualizer<HTMLDivElement, Element>({
    count: itemCount,
    getScrollElement,
    estimateSize,
    overscan: 10,
    ...(threadId ? { rangeExtractor } : {}),
    observeElementRect: observeTimelineRect,
    scrollMargin: -ledgerPxAtRender,
    // The caller intentionally supplies a fresh function on each render so
    // updated estimates reach unmeasured virtual-core rows.
    getItemKey,
  });
  const virtualizerRef = useRef(virtualizer);
  const measureElement = useMemo(
    () => createBatchedMeasurementRef(createScrollMountMeasurement(virtualizer)),
    [virtualizer]
  );

  useLayoutEffect(() => {
    ledgerFoldSizeCacheRef.current = virtualizer.itemSizeCache;
    roomFoldPriceRef.current = priceThreadRowForLedger;
    virtualizerRef.current = virtualizer;
  }, [priceThreadRowForLedger, roomFoldPriceRef, virtualizer]);

  // The reader's view starts below the sticky headers (the scroller's
  // scroll-padding-top). virtual-core does not know the content above the
  // list (header inset, banner, Load Older), so its range can name another
  // row than the one there, and it does not notify React when only that row
  // changes. Each commit therefore records its rows, where the list sits in
  // the scroll content, and the headers' inset; every commit and scroll
  // resolves the anchor from that, and the measurement-correction hook
  // judges which rows are above the reader the same way: the reader's top is
  // virtual-core offset scrollTop + inset - listTop. A settle shifts
  // scrollTop and scrollMargin together, keeping it valid. Above the first
  // row there is no anchor.
  const threadLedgerViewRef = useRef<{
    rows: Omit<ThreadLedgerAnchor, 'eventId' | 'index'>;
    listTop: number;
    inset: number;
  }>();
  const readerTopOffset = useCallback((scrollTop: number) => {
    const view = threadLedgerViewRef.current;
    return view ? scrollTop + view.inset - view.listTop : undefined;
  }, []);
  useInsertionEffect(() => {
    // Rows measured in this commit are judged before the layout effect
    // re-reads the list's offset; the leading content it changed moves it.
    const view = threadLedgerViewRef.current;
    if (view) view.listTop += threadLeadingPx - committedLeading.px;
  });
  const anchorThreadLedgerAt = useCallback(
    (scrollTop: number) => {
      const view = threadLedgerViewRef.current;
      const offset = readerTopOffset(scrollTop);
      const item =
        offset === undefined ? undefined : virtualizerRef.current.getVirtualItemForOffset(offset);
      const index = item && offset !== undefined && item.start <= offset ? item.index : undefined;
      const eventId = index === undefined ? undefined : view?.rows.events[index]?.getId();
      threadLedgerAnchorRef.current =
        view && index !== undefined && eventId ? { ...view.rows, eventId, index } : undefined;
    },
    [readerTopOffset]
  );
  // The room's rows, where the list sits in the scroll content and the headers' inset, as for a
  // thread's rows above; the reader's row is recorded at every commit and scroll.
  const roomLedgerViewRef = useRef<{
    keys: readonly (string | number | bigint)[];
    priceRow: RoomLedgerAnchor['priceRow'];
    listTop: number;
    inset: number;
  }>();
  const anchorRoomRowsRef = useRef(anchorRoomRows);
  useLayoutEffect(() => {
    anchorRoomRowsRef.current = anchorRoomRows;
  });
  const anchorRoomLedgerAt = useCallback((scrollTop: number) => {
    const view = roomLedgerViewRef.current;
    if (!view || !anchorRoomRowsRef.current?.()) {
      roomLedgerAnchorRef.current = undefined;
      return;
    }
    const offset = scrollTop + view.inset - view.listTop;
    const item = virtualizerRef.current.getVirtualItemForOffset(offset);
    const index = item && item.start <= offset ? item.index : undefined;
    const key = index === undefined ? undefined : view.keys[index];
    roomLedgerAnchorRef.current =
      index === undefined || key === undefined
        ? undefined
        : { key, index, keys: view.keys, priceRow: view.priceRow };
  }, []);
  useLayoutEffect(() => {
    const scrollElement = getScrollElement();
    const inner = virtualInnerRef.current;
    if (!anchoringRoomRows || !scrollElement || !inner) {
      roomLedgerViewRef.current = undefined;
      roomLedgerAnchorRef.current = undefined;
      return;
    }
    roomLedgerViewRef.current = {
      keys: roomRowKeys,
      priceRow: priceThreadRowForLedger,
      listTop:
        scrollElement.scrollTop -
        (scrollElement.getBoundingClientRect().top -
          inner.getBoundingClientRect().top -
          ledgerPxAtRender),
      inset: Number.parseFloat(getComputedStyle(scrollElement).scrollPaddingTop) || 0,
    };
    anchorRoomLedgerAt(scrollElement.scrollTop);
  });
  useEffect(() => {
    const scrollElement = getScrollElement();
    if (!scrollElement || !anchoringRoomRows) return undefined;
    const onScroll = () => anchorRoomLedgerAt(scrollElement.scrollTop);
    scrollElement.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollElement.removeEventListener('scroll', onScroll);
  }, [anchorRoomLedgerAt, anchoringRoomRows, getScrollElement]);
  useLayoutEffect(() => {
    if (!threadId) {
      threadLedgerViewRef.current = undefined;
      threadLedgerAnchorRef.current = undefined;
      return;
    }
    const leadingPx = threadLeadingRef.current?.offsetHeight ?? 0;
    threadLeadingCommittedRef.current = { key: threadLeadingKey, px: leadingPx };
    if (threadLeadingHeld && leadingPx !== threadLeadingPx) {
      // Applied by a synchronous re-render, before this commit paints.
      scrollCompensationPxRef.current += leadingPx - threadLeadingPx;
      ledgerSettleWantedRef.current = true;
      setLedgerCommitTick((tick) => tick + 1);
    }
    const scrollElement = getScrollElement();
    const inner = virtualInnerRef.current;
    if (!scrollElement || !inner) {
      threadLedgerViewRef.current = undefined;
      threadLedgerAnchorRef.current = undefined;
      return;
    }
    threadLedgerViewRef.current = {
      rows: { threadId, events: threadEvents, priceRow: priceThreadRowForLedger },
      // A row at virtual-core offset s paints at inner.top + s + ledger.
      listTop:
        scrollElement.scrollTop -
        (scrollElement.getBoundingClientRect().top -
          inner.getBoundingClientRect().top -
          ledgerPxAtRender),
      inset: Number.parseFloat(getComputedStyle(scrollElement).scrollPaddingTop) || 0,
    };
    anchorThreadLedgerAt(scrollElement.scrollTop);
  });
  useEffect(() => {
    const scrollElement = getScrollElement();
    if (!scrollElement || !threadId) return undefined;
    const onScroll = () => anchorThreadLedgerAt(scrollElement.scrollTop);
    scrollElement.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollElement.removeEventListener('scroll', onScroll);
  }, [anchorThreadLedgerAt, getScrollElement, threadId]);

  // Last native/programmatic offset observed by the direction-aware ledger
  // boundary guard (upstream #119). Settlement writes update this
  // synchronously because iOS may coalesce their echoing scroll event; a
  // stale pre-write baseline can invert the direction of the next native
  // momentum frame.
  const ledgerBoundaryScrollTopRef = useRef<number | undefined>(undefined);

  // Discard watchdog (PR #126, second mechanism): a settle write landing
  // inside a touchless scroll session's pause (scrubber/trackpad — no
  // touch events, so no gate can see the session) is DISCARDED by the
  // compositor, which reasserts the pre-settle offset as one large scroll
  // event 74-300ms later (matched-snapshot settles 491/617 in
  // ride-trace-1783829722124 reverted this way; pinned in
  // rideTraceReplay.test.ts). The session-aware quiescence waiter prevents
  // most of these on scrollend-capable WebKit; this watchdog restores the
  // fold to the ledger when a write is reverted anyway.
  const settleDiscardWatchRef = useRef<
    { px: number; preSettleScrollTop: number; settledScrollTop: number; at: number } | undefined
  >(undefined);

  // The banner above the rows changes height mostly without a timeline
  // commit (tags, resolution, pins, wrapping). Its header resizes in a frame
  // callback, before layout, and reports the change with the offset it had;
  // a reader with a row keeps it in place, as with native scroll anchoring.
  // One discrete change is written at once: folded into the ledger, its
  // settle at rest lands after any scroll the reader starts meanwhile. A
  // reader at the very top stays there.
  const holdThreadBannerResize = useCallback(
    (deltaPx: number, scrollTop: number) => {
      const scrollElement = getScrollElement();
      if (!scrollElement || !threadId || threadLedgerAnchorRef.current?.threadId !== threadId)
        return;
      if (scrollTop <= 0) return;
      scrollElement.scrollTop = scrollTop + deltaPx;
      // As after a settle: this write is not a discarded settle's reversal,
      // and its scroll event must not read as the reader's direction.
      settleDiscardWatchRef.current = undefined;
      ledgerBoundaryScrollTopRef.current = scrollElement.scrollTop;
    },
    [getScrollElement, threadId]
  );

  // A jump to a row moves the position itself, and a jump toward the start
  // can land near the pre-settle offset in one large scroll event, the shape
  // of a discarded settle. Restoring the fold then would push the row the
  // jump reached out of view, so every jump ends the watch first.
  const endSettleDiscardWatch = useCallback(() => {
    settleDiscardWatchRef.current = undefined;
  }, []);

  // The settle is one synchronous block. Clearing the DOM margin, shifting
  // scrollTop, and resetting virtual-core's scrollMargin may not be split
  // across paints. scrollTop must be written before setOptions because the
  // latter may synchronously notify React. The cause probes (upstream #116)
  // let a device trace distinguish a true-rest settle from the boundary
  // guard interrupting momentum at the loaded window's edge.
  const settleScrollCompensation = useCallback(
    (cause: 'quiescence' | 'boundary') => {
      const px = scrollCompensationPxRef.current;
      const inner = virtualInnerRef.current;
      const scrollElement = getScrollElement();
      if (px === 0 || !inner || !scrollElement) return;
      if (!isLedgerSettleSnapshotCurrent(inner, px)) {
        // A measurement arrived after the currently painted snapshot. Force
        // (or reinforce) the render for that accumulator, then let its layout
        // effect arm a fresh true-rest wait. Clearing the older margin now is
        // the exact 512->-5 / 216->1 split settle captured on device.
        ledgerSettleWantedRef.current = true;
        setLedgerCommitTick((tick) => tick + 1);
        return;
      }
      scrollCompensationPxRef.current = 0;
      const rowFoldPx = rowFoldPxRef.current;
      rowFoldPxRef.current = 0;
      const preSettleScrollTop = scrollElement.scrollTop;
      // Waiting for the write's scroll event would leave the boundary
      // direction baseline stale (Safari can suppress/coalesce it), so the
      // settle's clamped read-back seeds it directly.
      const settledScrollTop = applyLedgerSettle(inner, scrollElement, px, virtualizerRef.current);
      if (settledScrollTop === undefined) {
        // The preflight above and this call are synchronous, so this branch
        // is unreachable today; it retains the debt defensively in case a
        // callback ever mutates the DOM inside this block. CONTRACT: if
        // applyLedgerSettle ever gains an async step, restoring the px
        // SNAPSHOT here would silently drop any measurement delta that
        // arrived after the pre-read — this restore (and the zero-write
        // above) must then become a compare-and-swap against the live ref.
        scrollCompensationPxRef.current = px;
        rowFoldPxRef.current = rowFoldPx;
        ledgerSettleWantedRef.current = true;
        setLedgerCommitTick((tick) => tick + 1);
        return;
      }
      ledgerBoundaryScrollTopRef.current = settledScrollTop;
      if (Math.abs(px) >= SETTLE_DISCARD_MIN_LEDGER_PX) {
        settleDiscardWatchRef.current = {
          px,
          preSettleScrollTop,
          settledScrollTop,
          at: Date.now(),
        };
      }
      countCacheProbe(cause === 'boundary' ? 'ledgerBoundarySettles' : 'ledgerQuiescenceSettles');
    },
    [getScrollElement]
  );

  const armSettleAtRest = useCallback(() => {
    if (compensationSettleArmedRef.current) return;
    compensationSettleArmedRef.current = true;
    const generation = ledgerGenerationRef.current;
    waitForScrollQuiescence(getScrollElement(), { maxWaitMs: Infinity }).then(() => {
      compensationSettleArmedRef.current = false;
      if (!alive() || ledgerGenerationRef.current !== generation) return;
      settleScrollCompensation('quiescence');
    });
  }, [alive, getScrollElement, settleScrollCompensation]);

  const handleDroppedCorrection = useCallback(
    (deltaPx: number) => {
      scrollCompensationPxRef.current += deltaPx;
      // react-virtual can skip its own update when the visible range is
      // unchanged, so the ledger must force the coherent paint itself.
      setLedgerCommitTick((tick) => tick + 1);
      armSettleAtRest();
    },
    [armSettleAtRest]
  );

  // virtual-core writes an applied correction at once, in a ResizeObserver
  // callback, but the rows it moves render in React's next task, after the
  // browser has painted them unmoved: the reader's view jumps by the
  // correction for a frame. Render them in a microtask, before the paint, and
  // until then let the hook judge rows in the layout React rendered.
  const unrenderedCorrectionPxRef = useRef(0);
  // The part of those that kept the reader at the list's end, which moved no row.
  const unrenderedEndCorrectionPxRef = useRef(0);
  const measurementCorrectionPxRef = useRef(0);
  const noteAppliedCorrection = useClampedCorrectionFinish(getScrollElement);
  const handleAppliedCorrection = useCallback((deltaPx: number, atEnd: boolean) => {
    noteAppliedCorrection(deltaPx);
    // virtual-core writes this correction itself, so the view moves without the compositor: a
    // move back toward the pre-settle offset is no discarded settle any more (a row above that
    // grew and shrank again landed 8 px from it and had the settle folded in a second time).
    settleDiscardWatchRef.current = undefined;
    // Only upward movement can look like relinquished opening ownership. A downward growth
    // adjustment can be clamped before React extends the range, so it cannot cancel this sum.
    measurementCorrectionPxRef.current += Math.min(0, deltaPx);
    if (unrenderedCorrectionPxRef.current === 0) {
      queueMicrotask(() => {
        if (unrenderedCorrectionPxRef.current === 0) return;
        flushSync(() => setLedgerCommitTick((tick) => tick + 1));
      });
    }
    unrenderedCorrectionPxRef.current += deltaPx;
    if (atEnd) unrenderedEndCorrectionPxRef.current += deltaPx;
  }, [noteAppliedCorrection]);
  const unrenderedCorrectionPx = useCallback(() => unrenderedCorrectionPxRef.current, []);
  const unrenderedEndCorrectionPx = useCallback(() => unrenderedEndCorrectionPxRef.current, []);
  const readMeasurementCorrectionPx = useCallback(() => measurementCorrectionPxRef.current, []);
  // A row that changes size where the reader sees it moves the rows after it, which virtual-core
  // also renders in React's next task: for a frame the next row is drawn over a growing row, or
  // apart from a shrinking one. Render them in a microtask as well.
  const unrenderedRowMoveRef = useRef(false);
  const renderRowMoveBeforePaint = useCallback(() => {
    if (unrenderedRowMoveRef.current) return;
    unrenderedRowMoveRef.current = true;
    queueMicrotask(() => {
      if (!unrenderedRowMoveRef.current) return;
      flushSync(() => setLedgerCommitTick((tick) => tick + 1));
    });
  }, []);
  const unrenderedRowMove = useCallback(() => unrenderedRowMoveRef.current, []);
  useInsertionEffect(() => {
    unrenderedCorrectionPxRef.current = 0;
    unrenderedEndCorrectionPxRef.current = 0;
    unrenderedRowMoveRef.current = false;
  });

  // Ledger boundary guard (upstream #119, direction-aware): negative ledger
  // can expose a real top margin, while positive ledger can clamp the
  // bottom, so those edges retain a direction-aware two-viewport guard.
  // Positive ledger has no top blank; it may coast through the remaining
  // physical range and settles only at actual top exhaustion. The
  // distinction comes from two v3 iPhone traces: a +72px bottom settle
  // while travelling away and a +89px top settle 1025px before the hard
  // stop both reversed a live native frame and killed Safari momentum.
  useEffect(() => {
    const scrollElement = getScrollElement();
    if (!scrollElement) return undefined;
    ledgerBoundaryScrollTopRef.current = scrollElement.scrollTop;
    const onLedgerBoundaryTouchStart = () => {
      // iOS can move the compositor without delivering scroll events. Start
      // each touch from the live offset so a gesture that reverses that
      // silent travel is not compared with the previous gesture's baseline.
      ledgerBoundaryScrollTopRef.current = scrollElement.scrollTop;
      // A real finger opens a new causal chain: motion after it is the
      // gesture's, never a late reassertion of a pre-settle offset.
      settleDiscardWatchRef.current = undefined;
    };
    const onLedgerBoundaryScroll = () => {
      const currentScrollTop = scrollElement.scrollTop;
      const previousScrollTop = ledgerBoundaryScrollTopRef.current ?? currentScrollTop;
      const scrollDirection =
        currentScrollTop > previousScrollTop
          ? 'forward'
          : currentScrollTop < previousScrollTop
          ? 'backward'
          : null;
      // Keep the baseline current even while the ledger is zero or below
      // its arming floor. Otherwise the first correction-bearing event can
      // compare against an arbitrarily old offset.
      ledgerBoundaryScrollTopRef.current = currentScrollTop;
      const watch = settleDiscardWatchRef.current;
      if (watch) {
        if (Date.now() - watch.at > SETTLE_DISCARD_WINDOW_MS) {
          settleDiscardWatchRef.current = undefined;
        } else if (
          isDiscardedSettleWrite({
            px: watch.px,
            preSettleScrollTop: watch.preSettleScrollTop,
            previousScrollTop,
            currentScrollTop,
          })
        ) {
          // The compositor reasserted the pre-settle offset: the settle's
          // write is gone while its margin fold already reached the DOM.
          // Restore the fold through the ordinary drop path (coherent
          // commit + fresh true-rest wait); the position itself belongs to
          // the still-live session. Skip the boundary evaluation for this
          // event — its geometry is mid-restoration.
          settleDiscardWatchRef.current = undefined;
          countCacheProbe('ledgerSettleWriteDiscarded');
          handleDroppedCorrection(watch.px);
          return;
        } else if (
          Math.abs(currentScrollTop - watch.settledScrollTop) > SETTLE_DISCARD_HELD_SLACK_PX
        ) {
          // Motion resumed from the settled offset: the write held.
          settleDiscardWatchRef.current = undefined;
        }
      }
      const px = scrollCompensationPxRef.current;
      // Cheap early exit on the hot path (direction tracking above is just
      // scrollTop arithmetic; the common px=0 case still avoids rect reads).
      if (px > -48 && px < 48) return;
      // No settles under a live finger: rewriting scrollTop mid-drag
      // reverses the gesture frame (ride-trace-1783811896380 frame 137:
      // the open-fill's 33k rebase landed on the first in-bounds event of
      // a drag and slipped 98px). #119 gates momentum direction and the
      // rubber-band deferral gates overscroll; this gates the drag itself.
      // The at-rest quiescence settle owns the fold after release.
      if (hasActiveWindowTouches()) return;
      const inner = virtualInnerRef.current;
      if (!inner) return;
      const innerRect = inner.getBoundingClientRect();
      const scrollRect = scrollElement.getBoundingClientRect();
      if (
        shouldSettleLedgerAtBoundary({
          ledgerPx: px,
          innerTop: innerRect.top,
          innerBottom: innerRect.bottom,
          scrollTop: scrollRect.top,
          scrollBottom: scrollRect.bottom,
          scrollOffset: currentScrollTop,
          clientHeight: scrollElement.clientHeight,
          scrollHeight: scrollElement.scrollHeight,
          scrollDirection,
        })
      ) {
        settleScrollCompensation('boundary');
      }
    };
    scrollElement.addEventListener('touchstart', onLedgerBoundaryTouchStart, {
      capture: true,
      passive: true,
    });
    scrollElement.addEventListener('scroll', onLedgerBoundaryScroll, { passive: true });
    return () => {
      scrollElement.removeEventListener('touchstart', onLedgerBoundaryTouchStart, true);
      scrollElement.removeEventListener('scroll', onLedgerBoundaryScroll);
    };
  }, [
    getScrollElement,
    handleDroppedCorrection,
    settleScrollCompensation,
    threadId,
    threadInitialRenderMode,
  ]);

  const commitLedgerMargin = () => {
    const inner = virtualInnerRef.current;
    if (!inner) return;
    const marginTop = ledgerPxAtRender === 0 ? '' : `${-ledgerPxAtRender}px`;
    if (inner.style.marginTop !== marginTop) inner.style.marginTop = marginTop;
  };
  // Height mutations can shrink the physical scroll range. Commit the paired
  // margin before child refs or layout effects read geometry and force native
  // clamping. Run on every accepted commit: settlement may have cleared an
  // otherwise equal margin snapshot imperatively.
  useInsertionEffect(commitLedgerMargin);
  useLayoutEffect(() => {
    // The inner ref is unattached during the initial insertion effect.
    commitLedgerMargin();
    if (ledgerSettleWantedRef.current) {
      ledgerSettleWantedRef.current = false;
      armSettleAtRest();
    }
  });

  useEffect(() => {
    if (!isRideTraceEnabled()) return undefined;
    const scrollElement = getScrollElement();
    if (!scrollElement) return undefined;
    return installRideTraceRecorder(scrollElement, () => virtualInnerRef.current, {
      roomId,
      threadId,
    });
  }, [getScrollElement, roomId, threadId]);

  const isAutomaticFillActive = automaticFill?.isActive;
  const measurementScrollCorrectionHook = useMemo(() => {
    let dropped = false;
    const decide = buildMeasurementScrollCorrectionHook({
      isIOSWebKitDevice,
      onDroppedCorrection: (deltaPx) => {
        dropped = true;
        handleDroppedCorrection(deltaPx);
      },
      shouldDeferAutomaticFillCorrection: (item) =>
        !!isAutomaticFillActive?.() && (item.index ?? itemCount) < itemCount - 1,
      viewportTopOffset: readerTopOffset,
      onAppliedCorrection: handleAppliedCorrection,
      unrenderedCorrectionPx,
      unrenderedEndCorrectionPx,
      listEndShrinkPx: (index, deltaPx) =>
        listShrinkAfterResize(
          virtualInnerRef.current,
          virtualizer.measurementsCache,
          rowFoldPxRef.current,
          index,
          deltaPx
        ),
    });
    return (...args: Parameters<typeof decide>): boolean => {
      dropped = false;
      const apply = decide(...args);
      // An applied correction renders before the paint already, and the offset ledger moves
      // the rows of a dropped one in its own commit; the newest row moves no row after it.
      const [item] = args;
      if (!apply && !dropped && (item.index ?? itemCount) < itemCount - 1) {
        renderRowMoveBeforePaint();
      }
      return apply;
    };
  }, [
    isAutomaticFillActive,
    handleAppliedCorrection,
    handleDroppedCorrection,
    itemCount,
    readerTopOffset,
    renderRowMoveBeforePaint,
    unrenderedCorrectionPx,
    unrenderedEndCorrectionPx,
    virtualizer,
  ]);

  useLayoutEffect(() => {
    if (!automaticFill) return;
    automaticFill.geometryReader.current = () => {
      const root = getScrollElement();
      const inner = virtualInnerRef.current;
      if (
        !root ||
        !inner ||
        pendingRoomFoldPxRef.current !== 0 ||
        scrollCompensationPxRef.current !== 0 ||
        inner.style.marginTop !== ''
      )
        return undefined;
      const items = virtualizer.getVirtualItems();
      if (items.some((item) => !virtualizer.itemSizeCache.has(item.key))) return undefined;
      return `${root.clientHeight}|${root.scrollTop}|${root.scrollHeight}|${items
        .map((item) => `${item.key}:${item.start}:${item.size}`)
        .join(',')}`;
    };
  }, [automaticFill, getScrollElement, pendingRoomFoldPxRef, virtualizer]);

  // Configure only the committed virtualizer; abandoned renders must not
  // mutate the live instance.
  useInsertionEffect(() => {
    // Reset after React accepts this commit but before callback refs can
    // synchronously report measurements for the new surface. Resetting in a
    // layout effect can erase a correction emitted by a newly attached tile.
    if (resettingLedgerView) {
      compensationResetKeyRef.current = ledgerViewKey;
      scrollCompensationPxRef.current = 0;
      rowFoldPxRef.current = 0;
      pendingRoomFoldPxRef.current = 0;
      ledgerGenerationRef.current += 1;
      compensationSettleArmedRef.current = false;
      ledgerSettleWantedRef.current = false;
      threadLedgerAnchorRef.current = undefined;
      roomLedgerAnchorRef.current = undefined;
      ledgerBoundaryScrollTopRef.current = undefined;
      settleDiscardWatchRef.current = undefined;
    }
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = measurementScrollCorrectionHook;
  }, [
    ledgerViewKey,
    measurementScrollCorrectionHook,
    pendingRoomFoldPxRef,
    resettingLedgerView,
    virtualizer,
  ]);

  const readRowFoldPx = useCallback(() => rowFoldPxRef.current, []);

  return {
    endSettleDiscardWatch,
    holdThreadBannerResize,
    ledgerPxAtRender,
    measureElement,
    readRowFoldPx,
    threadLeadingRef,
    unrenderedCorrectionPx,
    unrenderedRowMove,
    virtualInnerRef,
    virtualizer,
    readMeasurementCorrectionPx,
  };
};
