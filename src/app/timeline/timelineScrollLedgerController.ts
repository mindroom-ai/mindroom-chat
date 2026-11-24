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
  measureElement as measureRowElement,
  observeElementRect,
  useVirtualizer,
  type Range,
  type ReactVirtualizer,
} from '@tanstack/react-virtual';
import { threadScrollRange } from './threadScrollRange';
import { useClampedCorrectionFinish } from './clampedScrollCorrection';
import { listShrinkAfterResize } from './useListEndClamp';
import { countCacheProbe } from '../event-store/cache/cacheProbe';
import { readTopInset } from '../ui/styles/threadHeaderInset';
import {
  createBatchedMeasurementRef,
  createScrollMountMeasurement,
  measureMountedRows,
} from './batchedMeasurementRef';
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
} from '../event-store/threads/threadRenderUtils';
import { planRoomLedgerRender, type RoomLedgerAnchor } from './roomScrollLedger';
import { STATUS_BAR_SCROLL_TOP_EVENT } from '../native/statusBarTapScroll';

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
   * The height of the rows this render lists above the reader's rows in place of a row the last
   * commit showed there (the events of a membership fold that came apart). It folds with this
   * render as a pending room fold does, to which it is added once the render commits.
   */
  exposedRoomRowsPx?: number;
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
  threadId?: string;
  /** Keep thread virtual item 0 (Load Older) mounted while scrolled down. */
  pinThreadLeadingItem?: boolean;
  /**
   * What the room timeline renders above its rows: the room intro and the line above its rows.
   */
  leadingKey?: string;
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
  leadingRef: RefObject<HTMLDivElement | null>;
  /** The correction virtual-core applied that the rows do not show yet, in px. */
  unrenderedCorrectionPx: () => number;
  /** Applied upward measurement corrections, including those whose rows already rendered. */
  readMeasurementCorrectionPx: () => number;
  /** Whether a row changed size in place and the rows after it are not rendered at their new places yet. */
  unrenderedRowMove: () => boolean;
  /**
   * Whether rows that are not rendered at their new sizes yet changed size as the scroll area's
   * width changed: the render that shows them may give the list its new height before the paint.
   */
  unrenderedRewrap: () => boolean;
  /**
   * Whether a size that is not rendered yet came from the rows' observer: the render that shows it
   * before the paint then runs in the browser's ResizeObserver loop.
   */
  unrenderedInRowReport: () => boolean;
  /** The part of the ledger that rows folded above the reader brought with their own height, in px. */
  readRowFoldPx: () => number;
  /**
   * The position the last settle wrote, once: the scroll that lands there is the ledger's own, not
   * the reader's. Each call takes it, so a later scroll to the same place counts as theirs.
   */
  takeSettledScrollTop: () => number | undefined;
  virtualInnerRef: RefObject<HTMLDivElement | null>;
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
  exposedRoomRowsPx = 0,
  roomFoldHeld = false,
  roomFoldPriceRef,
  roomId,
  rowsKey,
  threadId,
  pinThreadLeadingItem = false,
  leadingKey = '',
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
  const ledgerSettleWantedRef = useRef(false);
  // The part of the room ledger that rows added above the reader brought with their own height
  // until the next settle: anchored room rows new to the list (`RoomLedgerFold.addedPx`), rows a
  // room window's page mounts above the reader, and dropped size-change corrections (staged in
  // `droppedRowFoldPxRef` until the render that paints their margin) do not shrink the list end.
  const rowFoldPxRef = useRef(0);
  const droppedRowFoldPxRef = useRef(0);
  // Fold pricing must use the previous committed cache. Reading the current
  // virtualizer during render would create a TDZ and couple planning to a
  // mutable instance.
  const ledgerFoldSizeCacheRef = useRef<Map<VirtualItemKey, number>>(undefined);

  const priceRoomRowForLedger = useCallback(
    (key: VirtualItemKey, index: number): number =>
      ledgerFoldSizeCacheRef.current?.get(key) ?? estimateSize(index),
    [estimateSize]
  );
  // The room's leading content (its start, the room intro, mounts once history reaches it, a
  // screen ahead of the reader) is folded while it lies above the reader's view. Threads use
  // upstream TanStack anchoring (anchorTo: 'end') and render Load Older as a virtual item.
  const leadingRef = useRef<HTMLDivElement>(null);
  const leadingCommittedRef = useRef({ key: '', px: 0 });
  const committedLeading = leadingCommittedRef.current;
  const leadingRenderPx = leadingKey === committedLeading.key ? committedLeading.px : 0;
  const roomLeadingAboveViewRef = useRef(false);
  const leadingHeld =
    !resettingLedgerView && !threadId && !!leadingKey && roomLeadingAboveViewRef.current;
  const leadingFoldPx = leadingHeld ? leadingRenderPx - committedLeading.px : 0;
  // Anchored room rows: rows a render puts above the reader's first visible row are folded,
  // whatever put them there (a new thread at the top, a page that widened the window).
  const roomLedgerAnchorRef = useRef<RoomLedgerAnchor>(undefined);
  const anchoringRoomRows = !threadId && !!anchorRoomRows;
  const roomRowKeys = anchoringRoomRows
    ? Array.from({ length: itemCount }, (_, index) => getItemKey(index))
    : [];
  const roomLedgerFold =
    anchoringRoomRows && !resettingLedgerView
      ? planRoomLedgerRender(roomLedgerAnchorRef.current, roomRowKeys, priceRoomRowForLedger)
      : undefined;
  const roomLedgerFoldPx = roomLedgerFold?.foldPx ?? 0;
  const roomLedgerAddedPx = roomLedgerFold?.addedPx ?? 0;
  // Room pagination records its exact prepend height before requesting the
  // range update. Keep that debt pending until the matching render commits;
  // abandoned concurrent renders neither lose nor double-apply it. Anchored
  // room rows price those rows themselves. The rows a render itself lists
  // above the reader are that render's value, pending only once it commits.
  const roomFoldPxAtRender =
    resettingLedgerView || threadId || roomFoldHeld || anchoringRoomRows
      ? 0
      : pendingRoomFoldPxRef.current + exposedRoomRowsPx;
  // One immutable snapshot feeds virtualizer.scrollMargin, the inner margin,
  // and every tile top for this paint (rooms only; threads stay at 0).
  const ledgerPxAtRender =
    resettingLedgerView || threadId
      ? 0
      : scrollCompensationPxRef.current + leadingFoldPx + roomFoldPxAtRender + roomLedgerFoldPx;
  const droppedRowFoldPxAtRender =
    resettingLedgerView || threadId ? 0 : droppedRowFoldPxRef.current;
  useInsertionEffect(() => {
    if (threadId) return;
    rowFoldPxRef.current += droppedRowFoldPxAtRender;
    droppedRowFoldPxRef.current -= droppedRowFoldPxAtRender;
  });

  // Before the fold below takes what this render folded: a held render leaves it pending.
  useLayoutEffect(() => {
    if (resettingLedgerView || threadId || anchoringRoomRows) return;
    pendingRoomFoldPxRef.current += exposedRoomRowsPx;
  });
  useLayoutEffect(() => {
    if (resettingLedgerView || threadId) return;

    const foldPx = leadingFoldPx + roomFoldPxAtRender + roomLedgerFoldPx;
    if (foldPx !== 0) {
      // Preserve measurement corrections that arrived between render and
      // this effect; only add the render plan's delta.
      scrollCompensationPxRef.current += foldPx;
      rowFoldPxRef.current += roomLedgerAddedPx + roomFoldPxAtRender;
      ledgerSettleWantedRef.current = true;
    }
    if (anchoringRoomRows) pendingRoomFoldPxRef.current = 0;
    else pendingRoomFoldPxRef.current -= roomFoldPxAtRender;
  }, [
    anchoringRoomRows,
    ledgerViewKey,
    pendingRoomFoldPxRef,
    resettingLedgerView,
    roomFoldPxAtRender,
    roomLedgerAddedPx,
    roomLedgerFoldPx,
    leadingFoldPx,
    threadId,
  ]);

  // Core only notifies when visible indices change. A height-only resize
  // inside one tall row must still refresh the pixel buffer. Reuse its
  // observer, which remains attached when room/thread views share a scroller.
  const [, setViewportResizeTick] = useState(0);
  const observeThreadHeightRef = useRef(!!threadId);
  useInsertionEffect(() => {
    observeThreadHeightRef.current = !!threadId;
  }, [threadId]);
  // A new width of the scroll area (a splitter's drag, a window's resize) wraps every row anew in
  // the same layout. In the pass of the browser's ResizeObserver loop that reports the scroll
  // area, the scroll content inside it may still change size: its own observers (the scrollbar,
  // the minimap, the follow-growth observer) are reported in the next pass. The render before
  // the paint then gives the list its new height, and the pins of that commit reach the newest
  // row before the browser paints it away from the composer. In any other pass, also a later
  // one of the same frame, that render leaves the content's size alone, or the loop would end
  // with those observers unreported ("ResizeObserver loop completed with undelivered
  // notifications"). The pass is known in two ways, since the browser may call the scroll
  // area's observer before or after the rows':
  // - The scroll area's observer measures the mounted rows itself, inside its own report.
  // - The rows' observer finds a width the scroll area's observer has not been told of yet. The
  //   browser gathers what a pass reports before it calls any observer, so that width is
  //   reported in this pass too. Not covered: another observer's callback that changes the
  //   scroll area's width itself, after the browser gathered and before the rows are reported.
  // Widths are compared unrounded: a row wraps anew at a change of a fraction of a pixel.
  // `reportedWidthRef` is the scroll area and the width its observer was last told of.
  const reportedWidthRef = useRef<{ scrollElement: Element; width: number }>(undefined);
  // Whether the scroll area has a width its observer has not been told of, as the report of
  // the rows' observer that runs now found it; undefined between its reports.
  const widthUnreportedRef = useRef<boolean>(undefined);
  // Whether the row measured last wrapped anew, until the correction hook reads it or the
  // observer's callback returns: a row that kept its size asks for no correction, and a size set
  // later without a measurement (a fold, a hidden row) did not wrap anew.
  const rowRewrappedRef = useRef(false);
  // Whether the render queued before the paint shows rows that wrapped anew. The microtask that
  // runs that render takes it back, whether or not the render commits.
  const unrenderedRewrapRef = useRef(false);
  const measureRow = useCallback(
    (
      element: Element,
      entry: ResizeObserverEntry | undefined,
      instance: Parameters<typeof measureRowElement>[2]
    ): number => {
      const scrollElement = getScrollElement();
      if (entry && scrollElement && widthUnreportedRef.current === undefined) {
        const reported = reportedWidthRef.current;
        widthUnreportedRef.current =
          reported?.scrollElement === scrollElement &&
          reported.width !== scrollElement.getBoundingClientRect().width;
        // The browser runs microtasks when the observer's callback returns.
        queueMicrotask(() => {
          widthUnreportedRef.current = undefined;
          rowRewrappedRef.current = false;
        });
      }
      rowRewrappedRef.current = !!entry && !!widthUnreportedRef.current;
      return measureRowElement(element, entry, instance);
    },
    [getScrollElement]
  );
  const observeTimelineRect = useCallback<typeof observeElementRect>((instance, onRect) => {
    let previousHeight: number | undefined;
    // virtual-core reads the rect once itself, before its observer reports.
    let observing = false;
    const stop = observeElementRect(instance, (rect) => {
      const heightChanged = previousHeight !== rect.height;
      previousHeight = rect.height;
      const { scrollElement } = instance;
      if (scrollElement) {
        const width = scrollElement.getBoundingClientRect().width;
        const reported = reportedWidthRef.current;
        reportedWidthRef.current = { scrollElement, width };
        if (observing && reported?.scrollElement === scrollElement && reported.width !== width) {
          // Not `measureRow`: without an entry it takes the row as not wrapped anew.
          measureMountedRows(instance, () => {
            rowRewrappedRef.current = true;
          });
          rowRewrappedRef.current = false;
        }
      }
      onRect(rect);
      if (heightChanged && observeThreadHeightRef.current) {
        setViewportResizeTick((tick) => tick + 1);
      }
    });
    observing = true;
    return stop;
  }, []);
  // Extraction runs after useVirtualizer returns, against this render's
  // instance/options. A fresh callback invalidates the range cache on resize.
  const rangeExtractor = (range: Range): number[] =>
    threadScrollRange(range, virtualizer, pinThreadLeadingItem);
  const virtualizer = useVirtualizer<HTMLDivElement, Element>({
    count: itemCount,
    getScrollElement,
    estimateSize,
    overscan: 10,
    // Keep key-based prepend anchoring (`anchorTo: 'end'`) on threads, but disable
    // virtual-core's list-only `wasAtEnd` check (`getVirtualDistanceFromEnd() <= scrollEndThreshold`)
    // because thread scrollers include header and composer padding outside the virtual list.
    // Bottom-following is owned solely by the thread pin hooks (`useThreadOpeningPin` / `useLatestRowPin`).
    ...(threadId ? { anchorTo: 'end' as const, scrollEndThreshold: -1, rangeExtractor } : {}),
    observeElementRect: observeTimelineRect,
    measureElement: measureRow,
    scrollMargin: threadId ? 0 : -ledgerPxAtRender,
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
    roomFoldPriceRef.current = priceRoomRowForLedger;
    virtualizerRef.current = virtualizer;
  }, [priceRoomRowForLedger, roomFoldPriceRef, virtualizer]);

  // The room's rows, where the list sits in the scroll content and the headers' inset;
  // the reader's row is recorded at every commit and scroll.
  const roomLedgerViewRef = useRef<{
    keys: readonly (string | number | bigint)[];
    priceRow: RoomLedgerAnchor['priceRow'];
    listTop: number;
    inset: number;
  }>(undefined);
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
      priceRow: priceRoomRowForLedger,
      listTop:
        scrollElement.scrollTop -
        (scrollElement.getBoundingClientRect().top -
          inner.getBoundingClientRect().top -
          ledgerPxAtRender),
      inset: readTopInset(scrollElement),
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
  // Whether the room's leading content lies above the reader's view (the scroll area below the
  // bars over its top, its scroll padding), as of the last commit or scroll.
  const noteRoomLeadingPlace = useCallback(() => {
    const scrollElement = getScrollElement();
    const leading = leadingRef.current;
    roomLeadingAboveViewRef.current =
      !!scrollElement &&
      !!leading &&
      leading.getBoundingClientRect().bottom <=
        scrollElement.getBoundingClientRect().top + readTopInset(scrollElement);
  }, [getScrollElement]);
  useLayoutEffect(() => {
    if (threadId) {
      leadingCommittedRef.current = { key: '', px: 0 };
      return;
    }
    const leading = leadingRef.current;
    const leadingPx = leading?.offsetHeight ?? 0;
    leadingCommittedRef.current = { key: leadingKey, px: leadingPx };
    if (leadingHeld && leadingPx !== leadingRenderPx) {
      // Applied by a synchronous re-render, before this commit paints.
      scrollCompensationPxRef.current += leadingPx - leadingRenderPx;
      ledgerSettleWantedRef.current = true;
      setLedgerCommitTick((tick) => tick + 1);
    }
    noteRoomLeadingPlace();
  });
  const roomLeadingShown = !threadId && !!leadingKey;
  useEffect(() => {
    const scrollElement = getScrollElement();
    if (!scrollElement || !roomLeadingShown) return undefined;
    scrollElement.addEventListener('scroll', noteRoomLeadingPlace, { passive: true });
    return () => scrollElement.removeEventListener('scroll', noteRoomLeadingPlace);
  }, [getScrollElement, noteRoomLeadingPlace, roomLeadingShown]);

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
    | {
        px: number;
        /** The part of `px` that rows brought with their own height (`rowFoldPxRef`). */
        rowFoldPx: number;
        preSettleScrollTop: number;
        settledScrollTop: number;
        at: number;
      }
    | undefined
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
      const inner = virtualInnerRef.current;
      if (!scrollElement || !inner || !threadId || scrollTop <= 0) return;
      if (
        inner.getBoundingClientRect().top - deltaPx >
        scrollElement.getBoundingClientRect().top + readTopInset(scrollElement)
      ) {
        return;
      }
      scrollElement.scrollTop = scrollTop + deltaPx;
    },
    [getScrollElement, threadId]
  );

  const settledScrollTopRef = useRef<number | undefined>(undefined);
  const takeSettledScrollTop = useCallback(() => {
    const settledScrollTop = settledScrollTopRef.current;
    settledScrollTopRef.current = undefined;
    return settledScrollTop;
  }, []);

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
      settledScrollTopRef.current = settledScrollTop;
      if (Math.abs(px) >= SETTLE_DISCARD_MIN_LEDGER_PX) {
        settleDiscardWatchRef.current = {
          px,
          rowFoldPx,
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
    void waitForScrollQuiescence(getScrollElement(), { maxWaitMs: Infinity }).then(() => {
      if (!alive() || ledgerGenerationRef.current !== generation) return;
      compensationSettleArmedRef.current = false;
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
  const handleAppliedCorrection = useCallback(
    (deltaPx: number, atEnd: boolean) => {
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
    },
    [noteAppliedCorrection]
  );
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
      if (unrenderedRowMoveRef.current) flushSync(() => setLedgerCommitTick((tick) => tick + 1));
      unrenderedRewrapRef.current = false;
    });
  }, []);
  const unrenderedRowMove = useCallback(() => unrenderedRowMoveRef.current, []);
  const unrenderedRewrap = useCallback(() => unrenderedRewrapRef.current, []);
  // Whether the rows' observer reported a size since the last commit. A row measured as it
  // mounts (`createScrollMountMeasurement`) is sized outside of the observer's report.
  const unrenderedInRowReportRef = useRef(false);
  const unrenderedInRowReport = useCallback(() => unrenderedInRowReportRef.current, []);
  useInsertionEffect(() => {
    unrenderedCorrectionPxRef.current = 0;
    unrenderedEndCorrectionPxRef.current = 0;
    unrenderedRowMoveRef.current = false;
    unrenderedInRowReportRef.current = false;
    // The render that showed the rows wrapped anew has committed: a later one asks again.
    unrenderedRewrapRef.current = false;
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
    if (threadId) {
      const onThreadStatusBarScrollTop = (event: Event) => {
        event.preventDefault();
        const v = virtualizerRef.current;
        v.cancelScroll();
        // virtual-core 3.19 preserves _holdOffset across scroll commands and cancelScroll();
        // clear it on this explicit jump to top so quiescence cannot push scrollTop off 0.
        (v as unknown as { _holdOffset: number })._holdOffset = 0;
        if (typeof scrollElement.scrollTo === 'function') {
          scrollElement.scrollTo({ top: 0 });
        } else {
          scrollElement.scrollTop = 0;
        }
        v.scrollOffset = scrollElement.scrollTop;
        flushSync(() => setLedgerCommitTick((tick) => tick + 1));
      };
      scrollElement.addEventListener(STATUS_BAR_SCROLL_TOP_EVENT, onThreadStatusBarScrollTop);
      return () =>
        scrollElement.removeEventListener(STATUS_BAR_SCROLL_TOP_EVENT, onThreadStatusBarScrollTop);
    }
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
    // How far the reader's wheel asked to scroll since the last scroll event. A mouse wheel's
    // notch moves about as far as a settle can: a move back toward the pre-settle offset that the
    // wheel accounts for is the reader's, not the compositor reasserting it (a trackpad's momentum
    // ticks are far shorter than such a reassertion). Lines and pages account for any move.
    let wheelPx = 0;
    const onLedgerBoundaryWheel = (event: WheelEvent) => {
      wheelPx += event.deltaMode === 0 ? event.deltaY : Math.sign(event.deltaY) * Infinity;
    };
    const onLedgerBoundaryScroll = () => {
      const currentScrollTop = scrollElement.scrollTop;
      const previousScrollTop = ledgerBoundaryScrollTopRef.current ?? currentScrollTop;
      const wheeledPx = wheelPx;
      wheelPx = 0;
      const delta = currentScrollTop - previousScrollTop;
      const wheeled =
        delta !== 0 &&
        Math.sign(wheeledPx) === Math.sign(delta) &&
        Math.abs(wheeledPx) >= Math.abs(delta) - SETTLE_DISCARD_HELD_SLACK_PX;
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
          !wheeled &&
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
          // The rows' part comes back with the margin, in the render that paints it: without
          // it the end clamp read that part of the restored margin as rows that shrank.
          droppedRowFoldPxRef.current += watch.rowFoldPx;
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
    // Status-bar tap jumps straight to the top of the loaded rows: drop any unsettled offset
    // ledger atomically before writing `scrollTop = 0`, so neither the boundary guard at 0 nor
    // a later quiescence settle shifts `scrollTop` back down by the accumulated positive fold.
    // Pending room folds are cleared as well so any in-flight room prepend becomes the new top
    // rather than folding above it.
    const onStatusBarScrollTop = (event: Event) => {
      event.preventDefault();
      const inner = virtualInnerRef.current;
      const hadLedger =
        scrollCompensationPxRef.current !== 0 ||
        rowFoldPxRef.current !== 0 ||
        droppedRowFoldPxRef.current !== 0 ||
        pendingRoomFoldPxRef.current !== 0 ||
        (inner !== null && inner.style.marginTop !== '');
      ledgerGenerationRef.current += 1;
      compensationSettleArmedRef.current = false;
      ledgerSettleWantedRef.current = false;
      settleDiscardWatchRef.current = undefined;
      settledScrollTopRef.current = undefined;
      scrollCompensationPxRef.current = 0;
      rowFoldPxRef.current = 0;
      droppedRowFoldPxRef.current = 0;
      pendingRoomFoldPxRef.current = 0;
      roomLedgerAnchorRef.current = undefined;
      roomLeadingAboveViewRef.current = false;
      wheelPx = 0;
      if (inner) inner.style.marginTop = '';
      if (typeof scrollElement.scrollTo === 'function') {
        scrollElement.scrollTo({ top: 0 });
      } else {
        scrollElement.scrollTop = 0;
      }
      const top = scrollElement.scrollTop;
      ledgerBoundaryScrollTopRef.current = top;
      if (hadLedger) {
        virtualizerRef.current.scrollOffset = top;
        virtualizerRef.current.setOptions({ ...virtualizerRef.current.options, scrollMargin: 0 });
        flushSync(() => setLedgerCommitTick((tick) => tick + 1));
      }
    };
    scrollElement.addEventListener('touchstart', onLedgerBoundaryTouchStart, {
      capture: true,
      passive: true,
    });
    scrollElement.addEventListener('wheel', onLedgerBoundaryWheel, { passive: true });
    scrollElement.addEventListener('scroll', onLedgerBoundaryScroll, { passive: true });
    scrollElement.addEventListener(STATUS_BAR_SCROLL_TOP_EVENT, onStatusBarScrollTop);
    return () => {
      scrollElement.removeEventListener('touchstart', onLedgerBoundaryTouchStart, true);
      scrollElement.removeEventListener('wheel', onLedgerBoundaryWheel);
      scrollElement.removeEventListener('scroll', onLedgerBoundaryScroll);
      scrollElement.removeEventListener(STATUS_BAR_SCROLL_TOP_EVENT, onStatusBarScrollTop);
    };
  }, [
    getScrollElement,
    handleDroppedCorrection,
    pendingRoomFoldPxRef,
    settleScrollCompensation,
    threadId,
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
  useInsertionEffect(() => {
    commitLedgerMargin();
  });
  useLayoutEffect(() => {
    // The inner ref is unattached during the initial insertion effect.
    commitLedgerMargin();
    if (!threadId && ledgerSettleWantedRef.current) {
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
        droppedRowFoldPxRef.current += deltaPx;
        handleDroppedCorrection(deltaPx);
      },
      shouldDeferAutomaticFillCorrection: (item) =>
        !!isAutomaticFillActive?.() && (item.index ?? itemCount) < itemCount - 1,
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
      if (widthUnreportedRef.current !== undefined) unrenderedInRowReportRef.current = true;
      const apply = decide(...args);
      // An applied correction renders before the paint already, and the offset ledger moves
      // the rows of a dropped one in its own commit; the newest row moves no row after it, but
      // one that wrapped anew moves the list's end, which the pins of that render follow.
      const [item] = args;
      const rewrapped = rowRewrappedRef.current;
      rowRewrappedRef.current = false;
      // Always with this render before the paint, whose microtask takes it back: the render an
      // applied correction queues is skipped when corrections of one report add up to nothing
      // (a row grew, another shrank), and the permission then lasted into a pass of rows alone.
      if (rewrapped && !dropped) unrenderedRewrapRef.current = true;
      if (!dropped && (rewrapped || (!apply && (item.index ?? itemCount) < itemCount - 1))) {
        renderRowMoveBeforePaint();
      }
      return apply;
    };
  }, [
    isAutomaticFillActive,
    handleAppliedCorrection,
    handleDroppedCorrection,
    itemCount,
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
      droppedRowFoldPxRef.current = 0;
      pendingRoomFoldPxRef.current = 0;
      ledgerGenerationRef.current += 1;
      compensationSettleArmedRef.current = false;
      ledgerSettleWantedRef.current = false;
      roomLedgerAnchorRef.current = undefined;
      ledgerBoundaryScrollTopRef.current = undefined;
      settledScrollTopRef.current = undefined;
      settleDiscardWatchRef.current = undefined;
    }
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = threadId
      ? (item, delta, instance) => {
          const offset = instance.scrollOffset ?? 0;
          const adjust = instance.itemSizeCache?.has(item.key)
            ? item.end <= offset
            : item.start < offset;
          if (adjust && delta < 0) measurementCorrectionPxRef.current += delta;
          return adjust;
        }
      : measurementScrollCorrectionHook;
  }, [
    ledgerViewKey,
    measurementScrollCorrectionHook,
    pendingRoomFoldPxRef,
    resettingLedgerView,
    threadId,
    virtualizer,
  ]);

  const readRowFoldPx = useCallback(() => rowFoldPxRef.current, []);

  return {
    endSettleDiscardWatch,
    holdThreadBannerResize,
    ledgerPxAtRender,
    measureElement,
    readRowFoldPx,
    takeSettledScrollTop,
    leadingRef,
    unrenderedCorrectionPx,
    unrenderedRowMove,
    unrenderedRewrap,
    unrenderedInRowReport,
    virtualInnerRef,
    virtualizer,
    readMeasurementCorrectionPx,
  };
};
