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
import { useVirtualizer, type ReactVirtualizer } from '@tanstack/react-virtual';
import { countCacheProbe } from './cacheProbe';
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
} from './threadRenderUtils';
import {
  buildThreadFoldBaseline,
  planThreadLedgerRender,
  type ThreadLedgerEvent,
  type ThreadVirtualPrependCapture,
} from './threadScrollLedger';

type VirtualItemKey = string | number | bigint;

export type ThreadPrependLedgerCapture = {
  threadId: string;
  anchorEventId: string;
  anchorIndex: number;
  anchorSeq: number;
};

export type TimelineScrollLedgerControllerOptions = {
  alive: () => boolean;
  clearPendingThreadAnchor: () => void;
  estimateSize: (index?: number) => number;
  getItemKey: (index: number) => VirtualItemKey;
  getScrollElement: () => HTMLDivElement | null;
  itemCount: number;
  pendingRoomFoldPxRef: MutableRefObject<number>;
  roomFoldPriceRef: MutableRefObject<(key: VirtualItemKey, index: number) => number>;
  roomId: string;
  threadEventIndexMap: ReadonlyMap<string, number>;
  threadEvents: readonly ThreadLedgerEvent[];
  threadId?: string;
  threadInitialRenderMode: ThreadInitialRenderMode;
  threadPaginatingBack: boolean;
  threadPendingAnchorSeq?: number;
};

export type TimelineScrollLedgerController = {
  captureThreadPrepend: (capture: ThreadPrependLedgerCapture) => void;
  clearThreadPrependCapture: () => void;
  ledgerPxAtRender: number;
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
  inner.style.marginTop = '';
  scrollElement.scrollTop += px;
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
  clearPendingThreadAnchor,
  estimateSize,
  getItemKey,
  getScrollElement,
  itemCount,
  pendingRoomFoldPxRef,
  roomFoldPriceRef,
  roomId,
  threadEventIndexMap,
  threadEvents,
  threadId,
  threadInitialRenderMode,
  threadPaginatingBack,
  threadPendingAnchorSeq,
}: TimelineScrollLedgerControllerOptions): TimelineScrollLedgerController => {
  const scrollCompensationPxRef = useRef(0);
  const virtualInnerRef = useRef<HTMLDivElement>(null);
  const compensationSettleArmedRef = useRef(false);
  // Bumped by the room/thread commit-time reset: an armed quiescence wait
  // from a disconnected view must never settle the next view's ledger.
  const ledgerGenerationRef = useRef(0);
  const ledgerViewKey = `${roomId}|${threadId ?? ''}`;
  const compensationResetKeyRef = useRef(ledgerViewKey);
  const resettingLedgerView = compensationResetKeyRef.current !== ledgerViewKey;
  const [, setLedgerCommitTick] = useState(0);
  const threadVirtualPrependCaptureRef = useRef<ThreadVirtualPrependCapture>();
  const ledgerSettleWantedRef = useRef(false);
  // Fold pricing must use the previous committed cache. Reading the current
  // virtualizer during render would create a TDZ and couple planning to a
  // mutable instance.
  const ledgerFoldSizeCacheRef = useRef<Map<VirtualItemKey, number>>();

  const priceThreadRowForLedger = useCallback(
    (key: VirtualItemKey, index: number): number =>
      ledgerFoldSizeCacheRef.current?.get(key) ?? estimateSize(index),
    [estimateSize]
  );
  const threadEventsRef = useRef(threadEvents);
  threadEventsRef.current = threadEvents;

  const buildLedgerFoldBaseline = useCallback(
    (boundaryIndex: number): Map<string, number> =>
      buildThreadFoldBaseline(threadEventsRef.current, boundaryIndex, priceThreadRowForLedger),
    [priceThreadRowForLedger]
  );

  const captureThreadPrepend = useCallback(
    ({
      threadId: captureThreadId,
      anchorEventId,
      anchorIndex,
      anchorSeq,
    }: ThreadPrependLedgerCapture) => {
      const currentThreadEvents = threadEventsRef.current;
      threadVirtualPrependCaptureRef.current = {
        threadId: captureThreadId,
        anchorEventId,
        anchorSeq,
        abovePrices: buildLedgerFoldBaseline(anchorIndex),
        foldedEvents: currentThreadEvents,
      };
    },
    [buildLedgerFoldBaseline]
  );

  const clearThreadPrependCapture = useCallback(() => {
    threadVirtualPrependCaptureRef.current = undefined;
  }, []);

  // Thread prepend planning is pure. Its mutations are applied only after
  // React commits the render that consumed this plan.
  const threadLedgerRenderPlan = planThreadLedgerRender({
    capture: resettingLedgerView ? undefined : threadVirtualPrependCaptureRef.current,
    eventIndexMap: threadEventIndexMap,
    paginatingBack: threadPaginatingBack,
    pendingAnchorSeq: threadPendingAnchorSeq,
    priceRow: priceThreadRowForLedger,
    threadEvents,
    threadId,
  });
  // Room pagination records its exact prepend height before requesting the
  // range update. Keep that debt pending until the matching render commits;
  // abandoned concurrent renders neither lose nor double-apply it.
  const roomFoldPxAtRender = resettingLedgerView ? 0 : pendingRoomFoldPxRef.current;
  // One immutable snapshot feeds virtualizer.scrollMargin, the inner margin,
  // and every tile top for this paint.
  const ledgerPxAtRender = resettingLedgerView
    ? 0
    : scrollCompensationPxRef.current + threadLedgerRenderPlan.foldPx + roomFoldPxAtRender;

  useLayoutEffect(() => {
    if (resettingLedgerView) return;

    const foldPx = threadLedgerRenderPlan.foldPx + roomFoldPxAtRender;
    if (foldPx !== 0) {
      // Preserve measurement corrections that arrived between render and
      // this effect; only add the render plan's delta.
      scrollCompensationPxRef.current += foldPx;
      ledgerSettleWantedRef.current = true;
    }
    pendingRoomFoldPxRef.current -= roomFoldPxAtRender;
    threadVirtualPrependCaptureRef.current = threadLedgerRenderPlan.nextCapture;
    if (threadLedgerRenderPlan.clearPendingAnchor) clearPendingThreadAnchor();
    if (threadLedgerRenderPlan.probe) countCacheProbe(threadLedgerRenderPlan.probe);
  }, [
    clearPendingThreadAnchor,
    ledgerViewKey,
    pendingRoomFoldPxRef,
    resettingLedgerView,
    roomFoldPxAtRender,
    threadLedgerRenderPlan,
  ]);

  const virtualizer = useVirtualizer<HTMLDivElement, Element>({
    count: itemCount,
    getScrollElement,
    estimateSize,
    overscan: 10,
    scrollMargin: -ledgerPxAtRender,
    // The caller intentionally supplies a fresh function on each render so
    // updated estimates reach unmeasured virtual-core rows.
    getItemKey,
  });
  const virtualizerRef = useRef(virtualizer);

  useLayoutEffect(() => {
    ledgerFoldSizeCacheRef.current = virtualizer.itemSizeCache;
    roomFoldPriceRef.current = priceThreadRowForLedger;
    virtualizerRef.current = virtualizer;
  }, [priceThreadRowForLedger, roomFoldPriceRef, virtualizer]);

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

  useLayoutEffect(() => {
    const inner = virtualInnerRef.current;
    if (!inner) return;
    const marginTop = ledgerPxAtRender === 0 ? '' : `${-ledgerPxAtRender}px`;
    if (inner.style.marginTop !== marginTop) inner.style.marginTop = marginTop;
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

  const measurementScrollCorrectionHook = useMemo(
    () =>
      buildMeasurementScrollCorrectionHook({
        isIOSWebKitDevice,
        onDroppedCorrection: handleDroppedCorrection,
      }),
    [handleDroppedCorrection]
  );

  // Configure only the committed virtualizer; abandoned renders must not
  // mutate the live instance.
  useInsertionEffect(() => {
    // Reset after React accepts this commit but before callback refs can
    // synchronously report measurements for the new surface. Resetting in a
    // layout effect can erase a correction emitted by a newly attached tile.
    if (resettingLedgerView) {
      compensationResetKeyRef.current = ledgerViewKey;
      scrollCompensationPxRef.current = 0;
      pendingRoomFoldPxRef.current = 0;
      ledgerGenerationRef.current += 1;
      compensationSettleArmedRef.current = false;
      ledgerSettleWantedRef.current = false;
      threadVirtualPrependCaptureRef.current = undefined;
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

  return {
    captureThreadPrepend,
    clearThreadPrependCapture,
    ledgerPxAtRender,
    virtualInnerRef,
    virtualizer,
  };
};
