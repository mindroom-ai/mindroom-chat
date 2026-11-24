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
import { readTopInset } from '../ui/styles/threadHeaderInset';
import {
  createBatchedMeasurementRef,
  createScrollMountMeasurement,
  measureMountedRows,
} from './batchedMeasurementRef';
import { installRideTraceRecorder, isRideTraceEnabled } from './rideTraceRecorder';
import { planRoomLedgerRender, type RoomLedgerAnchor } from './roomScrollLedger';
import { STATUS_BAR_SCROLL_TOP_EVENT } from '../native/statusBarTapScroll';
import { isDesktopWebKit } from '../lib/user-agent';
import { isIOSWebKitDevice } from './scrollQuiescence';
import { listShrinkAfterResize, pastEndCorrection } from './useListEndClamp';

type VirtualItemKey = string | number | bigint;

export type TimelineScrollLedgerControllerOptions = {
  /**
   * The room's rows keep the reader's rows still when rows land above them: in the Threads view
   * sorted by last reply, newest first, whose top is the room's latest end. Asked whenever the
   * reader's row is recorded; a reader it answers false for (at the latest end) sees new rows
   * arrive.
   */
  anchorRoomRows?: () => boolean;
  estimateSize: (index?: number) => number;
  getItemKey: (index: number) => VirtualItemKey;
  getScrollElement: () => HTMLDivElement | null;
  itemCount: number;
  /** Whether the room's newest row sits at index 0 (Threads view sorted newest-first). */
  latestAtTop?: boolean;
  roomId: string;
  threadId?: string;
  /** Keep thread virtual item 0 (Load Older) mounted while scrolled down. */
  pinThreadLeadingItem?: boolean;
  automaticFill?: {
    geometryReader: MutableRefObject<() => string | undefined>;
  };
};

export type TimelineScrollLedgerController = {
  holdThreadBannerResize: (deltaPx: number, scrollTop: number) => void;
  measureElement: (node: Element | null) => void;
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
  virtualInnerRef: RefObject<HTMLDivElement | null>;
  virtualizer: ReactVirtualizer<HTMLDivElement, Element>;
};

/**
 * virtual-core 3.19 preserves `_holdOffset` across scroll commands and `cancelScroll()`.
 * Clear it on explicit jumps, pins, and status-bar taps so quiescence cannot shift the landed
 * scroll position away from the target.
 */
export const readVirtualizerHoldOffset = (virtualizer: unknown): number =>
  (virtualizer as { _holdOffset?: number } | null | undefined)?._holdOffset ?? 0;

export const clearVirtualizerHoldOffset = (virtualizer: {
  cancelScroll: () => void;
  scrollElement?: { scrollTop: number } | null;
  scrollOffset?: number | null;
}): void => {
  const internal = virtualizer as {
    _holdOffset?: number;
    notify?: (sync: boolean) => void;
  };
  if (!internal._holdOffset) return;
  internal._holdOffset = 0;
  if (virtualizer.scrollElement) {
    virtualizer.scrollOffset = virtualizer.scrollElement.scrollTop;
  }
  internal.notify?.(false);
};

/**
 * Owns the timeline virtualizer, its resize-observer rewrap coordination,
 * status-bar tap handling, and newest-first Threads-view row anchoring.
 */
export const useTimelineScrollLedgerController = ({
  anchorRoomRows,
  estimateSize,
  getItemKey,
  getScrollElement,
  itemCount,
  latestAtTop = false,
  roomId,
  threadId,
  pinThreadLeadingItem = false,
  automaticFill,
}: TimelineScrollLedgerControllerOptions): TimelineScrollLedgerController => {
  const virtualInnerRef = useRef<HTMLDivElement>(null);
  const viewKey = `${roomId}|${threadId ?? ''}`;
  const viewKeyRef = useRef(viewKey);
  const resettingView = viewKeyRef.current !== viewKey;
  const [, setCommitTick] = useState(0);
  // Pricing for newest-first Threads-view reorders uses the previous committed cache.
  const anchorSizeCacheRef = useRef<Map<VirtualItemKey, number>>(undefined);

  const priceRoomRowForAnchor = useCallback(
    (key: VirtualItemKey, index: number): number =>
      anchorSizeCacheRef.current?.get(key) ?? estimateSize(index),
    [estimateSize]
  );

  // Anchored room rows (newest-first Threads view): rows a render puts above the reader's first
  // visible row shift scrollTop directly on commit so the reader keeps their place.
  const roomLedgerAnchorRef = useRef<RoomLedgerAnchor>(undefined);
  const anchoringRoomRows = !threadId && !!anchorRoomRows;
  const roomRowKeys = anchoringRoomRows
    ? Array.from({ length: itemCount }, (_, index) => getItemKey(index))
    : [];
  const roomAnchorDeltaPx =
    anchoringRoomRows && !resettingView
      ? planRoomLedgerRender(roomLedgerAnchorRef.current, roomRowKeys, priceRoomRowForAnchor).foldPx
      : 0;

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
  //   reported in this pass too.
  // Widths are compared unrounded: a row wraps anew at a change of a fraction of a pixel.
  const reportedWidthRef = useRef<{ scrollElement: Element; width: number }>(undefined);
  const widthUnreportedRef = useRef<boolean>(undefined);
  const rowRewrappedRef = useRef(false);
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
  // Oldest-first rooms and threads use upstream key-based prepend anchoring (`anchorTo: 'end'`)
  // with `scrollEndThreshold: -1` because scrollers include header and composer padding outside
  // the virtual list; bottom-following is owned by the pin hooks. Newest-first Threads view keeps
  // `anchorTo: 'start'` and anchors reorders via `roomScrollLedger`.
  const anchorToEnd = !!threadId || !latestAtTop;
  const holdScrollDuringWheel = anchorToEnd && isDesktopWebKit();
  const virtualizer = useVirtualizer<HTMLDivElement, Element>({
    count: itemCount,
    getScrollElement,
    estimateSize,
    overscan: 10,
    ...(anchorToEnd
      ? { anchorTo: 'end' as const, scrollEndThreshold: -1, holdScrollDuringWheel }
      : {}),
    ...(threadId ? { rangeExtractor } : {}),
    observeElementRect: observeTimelineRect,
    measureElement: measureRow,
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
    anchorSizeCacheRef.current = virtualizer.itemSizeCache;
    virtualizerRef.current = virtualizer;
  }, [virtualizer]);

  // The newest-first Threads view's rows, where the list sits in the scroll content and the
  // headers' inset; the reader's row is recorded at every commit and scroll.
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
    if (!anchoringRoomRows || roomAnchorDeltaPx === 0) return;
    const scrollElement = getScrollElement();
    if (!scrollElement) return;
    const nextTop = Math.max(0, scrollElement.scrollTop + roomAnchorDeltaPx);
    scrollElement.scrollTop = nextTop;
    virtualizerRef.current.scrollOffset = nextTop;
    setCommitTick((tick) => tick + 1);
  }, [anchoringRoomRows, getScrollElement, roomAnchorDeltaPx]);
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
      priceRow: priceRoomRowForAnchor,
      listTop:
        scrollElement.scrollTop -
        (scrollElement.getBoundingClientRect().top - inner.getBoundingClientRect().top),
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

  // The banner above a thread's rows changes height without a timeline commit (tags, resolution,
  // pins, wrapping). A reader in the rows keeps their row in place; a reader at the top stays.
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

  const measurementCorrectionPxRef = useRef(0);
  const readMeasurementCorrectionPx = useCallback(() => measurementCorrectionPxRef.current, []);
  // A row that changes size in view or wraps anew moves sibling rows or the list end, which
  // virtual-core renders in React's next task: render them in a microtask before paint instead.
  const unrenderedRowMoveRef = useRef(false);
  const renderRowMoveBeforePaint = useCallback(() => {
    if (unrenderedRowMoveRef.current) return;
    unrenderedRowMoveRef.current = true;
    queueMicrotask(() => {
      if (unrenderedRowMoveRef.current) flushSync(() => setCommitTick((tick) => tick + 1));
      unrenderedRewrapRef.current = false;
    });
  }, []);
  const unrenderedRowMove = useCallback(() => unrenderedRowMoveRef.current, []);
  const unrenderedRewrap = useCallback(() => unrenderedRewrapRef.current, []);
  // Whether the rows' observer reported a size since the last commit. A row measured as it
  // mounts (`createScrollMountMeasurement`) is sized outside of the observer's report.
  const unrenderedInRowReportRef = useRef(false);
  const unrenderedInRowReport = useCallback(() => unrenderedInRowReportRef.current, []);
  const unrenderedRowMovesPxRef = useRef(0);
  useInsertionEffect(() => {
    unrenderedRowMoveRef.current = false;
    unrenderedInRowReportRef.current = false;
    // The render that showed the rows wrapped anew has committed: a later one asks again.
    unrenderedRewrapRef.current = false;
    unrenderedRowMovesPxRef.current = 0;
  });

  useEffect(() => {
    const scrollElement = getScrollElement();
    if (!scrollElement) return undefined;
    const onStatusBarScrollTop = (event: Event) => {
      event.preventDefault();
      const v = virtualizerRef.current;
      v.cancelScroll();
      clearVirtualizerHoldOffset(v);
      roomLedgerAnchorRef.current = undefined;
      if (typeof scrollElement.scrollTo === 'function') {
        scrollElement.scrollTo({ top: 0 });
      } else {
        scrollElement.scrollTop = 0;
      }
      v.scrollOffset = scrollElement.scrollTop;
      flushSync(() => setCommitTick((tick) => tick + 1));
    };
    scrollElement.addEventListener(STATUS_BAR_SCROLL_TOP_EVENT, onStatusBarScrollTop);
    return () =>
      scrollElement.removeEventListener(STATUS_BAR_SCROLL_TOP_EVENT, onStatusBarScrollTop);
  }, [getScrollElement]);

  useEffect(() => {
    if (!isRideTraceEnabled()) return undefined;
    const scrollElement = getScrollElement();
    if (!scrollElement) return undefined;
    return installRideTraceRecorder(scrollElement, () => virtualInnerRef.current, {
      roomId,
      threadId,
    });
  }, [getScrollElement, roomId, threadId]);

  useLayoutEffect(() => {
    if (!automaticFill) return;
    automaticFill.geometryReader.current = () => {
      const root = getScrollElement();
      const inner = virtualInnerRef.current;
      const holdOffset = readVirtualizerHoldOffset(virtualizer);
      if (!root || !inner || holdOffset !== 0) return undefined;
      const items = virtualizer.getVirtualItems();
      if (items.some((item) => !virtualizer.itemSizeCache.has(item.key))) return undefined;
      return `${root.clientHeight}|${root.scrollTop}|${root.scrollHeight}|${items
        .map((item) => `${item.key}:${item.start}:${item.size}`)
        .join(',')}`;
    };
  }, [automaticFill, getScrollElement, virtualizer]);

  // Configure only the committed virtualizer; abandoned renders must not
  // mutate the live instance.
  useInsertionEffect(() => {
    if (resettingView) {
      viewKeyRef.current = viewKey;
      roomLedgerAnchorRef.current = undefined;
    }
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta, instance) => {
      if (widthUnreportedRef.current !== undefined) unrenderedInRowReportRef.current = true;
      const offset = instance.scrollOffset ?? 0;
      const above = instance.itemSizeCache?.has(item.key)
        ? item.end <= offset
        : item.start < offset;
      const rewrapped = rowRewrappedRef.current;
      rowRewrappedRef.current = false;
      if (rewrapped) unrenderedRewrapRef.current = true;
      if (above) {
        if (delta < 0) measurementCorrectionPxRef.current += delta;
        if (readVirtualizerHoldOffset(instance) === 0) unrenderedRowMovesPxRef.current += delta;
        renderRowMoveBeforePaint();
        return true;
      }
      let endCorrection = 0;
      let shownPx: number | undefined;
      if (delta < 0 && !isIOSWebKitDevice() && readVirtualizerHoldOffset(instance) === 0) {
        const scrollElement = instance.scrollElement;
        const liveOffset = scrollElement?.scrollTop ?? offset;
        const rowMovesPx = unrenderedRowMovesPxRef.current;
        shownPx =
          item.index !== undefined
            ? listShrinkAfterResize(
                virtualInnerRef.current,
                instance.measurementsCache,
                0,
                item.index,
                delta
              )
            : undefined;
        endCorrection = pastEndCorrection(
          delta,
          liveOffset,
          liveOffset - rowMovesPx,
          scrollElement,
          shownPx,
          rowMovesPx
        );
      }
      if (endCorrection < 0 && (instance.scrollElement?.scrollTop ?? offset) + endCorrection >= 0) {
        measurementCorrectionPxRef.current += endCorrection;
        if (shownPx === undefined) unrenderedRowMovesPxRef.current += endCorrection;
        renderRowMoveBeforePaint();
        const applyAdjustment = (
          instance as unknown as { applyScrollAdjustment?: (deltaPx: number) => boolean }
        ).applyScrollAdjustment;
        if (endCorrection !== delta && typeof applyAdjustment === 'function') {
          applyAdjustment.call(instance, endCorrection);
          return false;
        }
        return true;
      }
      if (rewrapped || (item.index ?? itemCount) < itemCount - 1) {
        renderRowMoveBeforePaint();
      }
      return false;
    };
  }, [itemCount, renderRowMoveBeforePaint, resettingView, viewKey, virtualizer]);

  return {
    holdThreadBannerResize,
    measureElement,
    unrenderedRowMove,
    unrenderedRewrap,
    unrenderedInRowReport,
    virtualInnerRef,
    virtualizer,
    readMeasurementCorrectionPx,
  };
};
