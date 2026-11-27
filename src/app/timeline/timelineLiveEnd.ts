import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { VirtualItem, Virtualizer } from '@tanstack/react-virtual';
import { shouldPinThreadToBottomOnOpen } from '../event-store/threads/threadRenderUtils';
import { isScrollNearBottom } from '../event-store/timeline/timelineScrollUtils';
import { scrollToBottom } from '../lib/dom';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import type { LiveReplyStore } from '../messages/live/liveReplyStore';
import { isDisclosureRevealActive } from '../ui/disclosureReveal';
import type {
  RoomFocusScrollControllerOptions,
  RoomTimelineFocusItem,
  ScrollToBottomState,
} from './roomFocusScrollController';
import { READER_INTENT_EVENTS } from './roomTimelineScroll';
import { listShrinkNotRendered } from './timelineListShrink';
import {
  clearVirtualizerHoldOffset,
  hasPendingVirtualizerAnchor,
  readVirtualizerHoldOffset,
  type TimelineScrollLedgerController,
} from './timelineScrollLedgerController';

/** How much further from the newest row a scroll must leave the reader to count as theirs. */
const LEFT_LATEST_ROW_PX = 32;
/** How near the end a held list will have a reader counts as there (rows measure in whole px). */
const AT_HELD_LIST_END_PX = 2;

const distanceBelowView = (element: HTMLElement): number =>
  element.scrollHeight - element.scrollTop - element.clientHeight;

/** Net scroll growth to expose outside `contentRef` while `heldList` freezes its height. */
export const computeHeldEndSpacer = (
  lastEnd: number | undefined,
  listHeight: number,
  inner: HTMLElement | null,
  content: HTMLElement | null,
  startAligned: boolean
): number => {
  const growth =
    lastEnd !== undefined && Number.isFinite(lastEnd) && Number.isFinite(listHeight)
      ? Math.max(0, lastEnd - listHeight)
      : 0;
  if (
    growth <= 0 ||
    !inner ||
    !content ||
    typeof inner.getBoundingClientRect !== 'function' ||
    typeof content.getBoundingClientRect !== 'function'
  ) {
    return growth;
  }
  const contentRect = content.getBoundingClientRect();
  const innerRect = inner.getBoundingClientRect();
  const style = getComputedStyle(content);
  const rawSlack = startAligned
    ? contentRect.bottom - innerRect.bottom - (Number.parseFloat(style.paddingBottom) || 0)
    : innerRect.top - contentRect.top - (Number.parseFloat(style.paddingTop) || 0);
  return Number.isFinite(rawSlack) ? Math.max(0, growth - Math.max(0, rawSlack)) : growth;
};

export type HeldRowsLayoutLedger = Pick<
  TimelineScrollLedgerController,
  'unrenderedRowMove' | 'unrenderedRewrap' | 'unrenderedInRowReport' | 'virtualInnerRef'
> & {
  virtualizer: Pick<TimelineScrollLedgerController['virtualizer'], 'measurementsCache'> & {
    getTotalSize: () => number;
    getVirtualItems: () => VirtualItem[];
  };
};

export type HeldRowsLayoutOptions = {
  ledger: HeldRowsLayoutLedger;
  itemCount: number;
  contentRef: RefObject<HTMLElement | null>;
  latestAtTop: boolean;
  startAligned: boolean;
  forceRender: () => void;
};

export type HeldRowsLayout = {
  virtualItems: VirtualItem[];
  listHeight: number;
  listHeightHeld: boolean;
  heldEndSpacer: number;
  holdOffset: number;
  pendingListShrinkPx: () => number;
};

/**
 * Holds the list height and mounted row set during a ResizeObserver row-report commit so the
 * scroll content does not resize inside the RO loop (avoiding WebKit undelivered-notification
 * errors), exposes any net growth via `heldEndSpacer` outside `contentRef`, and schedules a
 * follow-up render to release the hold.
 */
export const useHeldRowsLayout = ({
  ledger,
  itemCount,
  contentRef,
  latestAtTop,
  startAligned,
  forceRender,
}: HeldRowsLayoutOptions): HeldRowsLayout => {
  const { virtualizer, virtualInnerRef } = ledger;
  const virtualizerRef = useLatestRef(virtualizer);
  const pendingListShrinkPx = useCallback(
    () => listShrinkNotRendered(virtualInnerRef.current, virtualizerRef.current.measurementsCache),
    [virtualInnerRef, virtualizerRef]
  );

  const prevItemCountRef = useRef(itemCount);
  const itemCountChanged = prevItemCountRef.current !== itemCount;
  const renderedList = virtualInnerRef.current?.style;
  const deferRowReport =
    !itemCountChanged &&
    !hasPendingVirtualizerAnchor(virtualizer) &&
    ledger.unrenderedRowMove() &&
    ledger.unrenderedInRowReport();
  const heldList =
    deferRowReport && !ledger.unrenderedRewrap() && renderedList?.height ? renderedList : undefined;
  // Never call `virtualizer.getTotalSize()` while `heldList` is truthy.
  const listHeight = heldList ? Number.parseFloat(heldList.height) : virtualizer.getTotalSize();

  const windowItems = virtualizer.getVirtualItems();
  const mountedRowKeysRef = useRef<ReadonlySet<VirtualItem['key']>>(undefined);
  const mountedRowKeys = mountedRowKeysRef.current;
  const virtualItems =
    deferRowReport && mountedRowKeys
      ? windowItems.filter((item) => mountedRowKeys.has(item.key))
      : windowItems;
  useLayoutEffect(() => {
    prevItemCountRef.current = itemCount;
    mountedRowKeysRef.current = new Set(virtualItems.map((item) => item.key));
  });

  const deferredRowReportRender = !!heldList || virtualItems.length !== windowItems.length;
  // No dep array: consecutive ResizeObserver commits can both render deferred.
  useEffect(() => {
    if (deferredRowReportRender) forceRender();
  });

  const holdOffset = readVirtualizerHoldOffset(virtualizer);
  const heldEndSpacer =
    !latestAtTop && heldList && holdOffset === 0 && itemCount > 0
      ? computeHeldEndSpacer(
          virtualizer.measurementsCache[itemCount - 1]?.end,
          listHeight,
          virtualInnerRef.current,
          contentRef.current,
          startAligned
        )
      : 0;

  return {
    virtualItems,
    listHeight,
    listHeightHeld: !!heldList,
    heldEndSpacer,
    holdOffset,
    pendingListShrinkPx,
  };
};

export type ThreadOpeningPinOptions = Pick<
  RoomFocusScrollControllerOptions,
  | 'readMeasurementCorrectionPx'
  | 'isThreadOpenBottomPinSuppressed'
  | 'requestThreadOpenBottomPin'
  | 'scrollRef'
  | 'scrollThreadToEnd'
  | 'setAtBottom'
  | 'threadEventsLength'
  | 'threadId'
  | 'threadInitialRenderMode'
  | 'threadLatestOpenPending'
  | 'threadOpenedAtLatest'
  | 'threadUserScrolled'
>;

/**
 * A thread opened at its newest row is held there while its rows arrive and measure, until the
 * reader's first gesture or a jump target suppresses the opening pin.
 */
const tryPinThreadOpening = (o: ThreadOpeningPinOptions, scrollArea: HTMLElement): boolean => {
  const pinned = shouldPinThreadToBottomOnOpen({
    suppressOpenBottomPin: o.isThreadOpenBottomPinSuppressed(),
    threadId: o.threadId,
    threadLatestOpenPending: o.threadLatestOpenPending,
    threadOpenedAtLatest: o.threadOpenedAtLatest,
    hasUserScrollIntent: o.threadUserScrolled,
    threadInitialRenderMode: o.threadInitialRenderMode,
    threadEventCount: o.threadEventsLength,
  });
  if (!pinned || !o.requestThreadOpenBottomPin()) return false;
  if (o.scrollThreadToEnd) o.scrollThreadToEnd(false);
  else scrollToBottom(scrollArea, 'instant');
  return true;
};

export const useThreadOpeningPin = (o: ThreadOpeningPinOptions): void => {
  const optsRef = useLatestRef(o);
  const pinnedInCommitRef = useRef(false);
  const pinnedPositionRef = useRef<{ top: number; correction: number }>(undefined);
  useLayoutEffect(() => {
    const cur = optsRef.current;
    const scrollArea = cur.scrollRef.current;
    if (!cur.threadId || !scrollArea || !tryPinThreadOpening(cur, scrollArea)) return;
    cur.setAtBottom(true);
    pinnedInCommitRef.current = true;
    pinnedPositionRef.current = {
      top: scrollArea.scrollTop,
      correction: cur.readMeasurementCorrectionPx?.() ?? 0,
    };
  }, [
    optsRef,
    o.readMeasurementCorrectionPx,
    o.isThreadOpenBottomPinSuppressed,
    o.requestThreadOpenBottomPin,
    o.scrollRef,
    o.scrollThreadToEnd,
    o.setAtBottom,
    o.threadEventsLength,
    o.threadId,
    o.threadInitialRenderMode,
    o.threadLatestOpenPending,
    o.threadOpenedAtLatest,
    o.threadUserScrolled,
  ]);
  // Rows measure after the commit that pinned them; re-pin if still at our corrected position.
  useLayoutEffect(() => {
    if (pinnedInCommitRef.current) {
      pinnedInCommitRef.current = false;
      return;
    }
    const scrollArea = o.scrollRef.current;
    if (
      !o.threadId ||
      !scrollArea ||
      !shouldPinThreadToBottomOnOpen({
        suppressOpenBottomPin: o.isThreadOpenBottomPinSuppressed(),
        threadId: o.threadId,
        threadLatestOpenPending: o.threadLatestOpenPending,
        threadOpenedAtLatest: o.threadOpenedAtLatest,
        hasUserScrollIntent: o.threadUserScrolled,
        threadInitialRenderMode: o.threadInitialRenderMode,
        threadEventCount: o.threadEventsLength,
      })
    ) {
      return;
    }
    const correction = o.readMeasurementCorrectionPx?.() ?? 0;
    if (scrollArea.scrollHeight - scrollArea.clientHeight - scrollArea.scrollTop <= 1) {
      pinnedPositionRef.current = { top: scrollArea.scrollTop, correction };
      return;
    }
    const prev = pinnedPositionRef.current;
    if (!prev || scrollArea.scrollTop < prev.top + correction - prev.correction - 1) return;
    if (!tryPinThreadOpening(o, scrollArea)) return;
    pinnedPositionRef.current = { top: scrollArea.scrollTop, correction };
  });
};

export type TimelineLiveEndViewState = {
  view: string | undefined;
  roomId: string | undefined;
};

export type TimelineLiveEndOptions = {
  /** The rows pinned at the latest end: the room's, an open thread's once scrolled, or none. */
  surface?: 'room' | 'thread';
  itemCount?: number;
  virtualizer?: Pick<Virtualizer<HTMLDivElement, Element>, 'scrollToIndex' | 'cancelScroll'>;
  /** Whether this commit keeps the list's old height over rows that changed size. */
  listHeightHeld?: boolean;
  /** Whether opening this room shows its newest row (not its unread marker or an event). */
  opensAtLatest?: boolean;
  /** Whether the room's newest row is its first (`scrollToLatestEnd`). */
  latestAtTop?: boolean;
  roomId?: string;
  scrollElement: HTMLElement | null;
  /** The bottom pins asked for: each new `count` that a commit sees asks for the newest row. */
  scrollToBottomRef?: MutableRefObject<ScrollToBottomState>;
  committedView?: string;
  /** Persistent committed view/room state across remounts (e.g. RoomSurface ↔ Compact switches). */
  viewStateRef?: MutableRefObject<TimelineLiveEndViewState>;
  focusItem?: RoomTimelineFocusItem;
  /** Runs at each gesture or scroll that hands the position to the reader in the room view. */
  onReaderGesture?: () => void;
  /**
   * The room that rows which shrank still take in the list until React renders it
   * (`listShrinkNotRendered`).
   */
  pendingListShrinkPx?: () => number;
  /** Scroll content container observed for streaming-growth follow and end clamping. */
  contentRef?: RefObject<HTMLElement | null>;
  /** Footer height probe observed alongside `contentRef` to clamp past-end scroll positions. */
  footerProbeRef?: RefObject<HTMLElement | null>;
  /** Live viewport bottom check for streaming-growth follow pinning. */
  isViewportAtBottomNow?: () => boolean;
  /** Whether the timeline is currently at its live end (not scrolled into older history). */
  atLiveEndRef?: MutableRefObject<boolean>;
  /** Live streaming reply frame store for the current client. */
  liveReplies?: LiveReplyStore;
};

/**
 * Owns staying pinned at the timeline's live end across commits and ResizeObserver passes:
 * - pre-paint latest-row pin while a request holds (open, Jump to Latest, send, live follow),
 * - shared reader-intent listeners + capture-phase scroll detection to hand ownership back,
 * - one late passive ResizeObserver that follows live streaming growth and then clamps past-end
 *   scroll positions against unrendered list shrink.
 */
export const useTimelineLiveEnd = ({
  surface,
  itemCount = 0,
  virtualizer,
  listHeightHeld,
  opensAtLatest = false,
  latestAtTop = false,
  roomId,
  scrollElement,
  scrollToBottomRef,
  committedView,
  viewStateRef,
  focusItem,
  onReaderGesture,
  pendingListShrinkPx,
  contentRef,
  footerProbeRef,
  isViewportAtBottomNow,
  atLiveEndRef,
  liveReplies,
}: TimelineLiveEndOptions): void => {
  const requestRef = useRef(opensAtLatest && !focusItem);
  const seenCountRef = useRef(scrollToBottomRef?.current.count ?? 0);
  const seenFocusRef = useRef(focusItem);
  const internalViewStateRef = useRef<TimelineLiveEndViewState>({ view: committedView, roomId });
  const activeViewStateRef = viewStateRef ?? internalViewStateRef;
  const latestRef = useLatestRef({
    surface,
    virtualizer,
    onReaderGesture,
    latestAtTop,
    pendingListShrinkPx,
    scrollToBottomRef,
  });

  useLayoutEffect(() => {
    if (activeViewStateRef.current.view === committedView) return;
    const sameRoom = activeViewStateRef.current.roomId === roomId;
    activeViewStateRef.current = { view: committedView, roomId };
    // Another room opens as the first one did; another view of the same room at its newest row.
    requestRef.current = sameRoom || opensAtLatest;
  }, [activeViewStateRef, committedView, opensAtLatest, roomId]);

  // Every commit compares the count as it is then: a render that React bails out of keeps the
  // count it read without running its effects, so effect dependencies would miss that pin.
  useLayoutEffect(() => {
    if (!scrollToBottomRef) return;
    const { count } = scrollToBottomRef.current;
    if (count === seenCountRef.current) return;
    seenCountRef.current = count;
    requestRef.current = true;
  });

  useLayoutEffect(() => {
    if (seenFocusRef.current === focusItem) return;
    seenFocusRef.current = focusItem;
    // A jump to an event owns the position from here.
    if (focusItem) requestRef.current = false;
  }, [focusItem]);

  // A thread's request starts with the reader's own scrolling: what was asked before belongs to
  // the pin the thread opened with.
  const surfaceAtLastCommitRef = useRef(surface);
  useLayoutEffect(() => {
    if (surfaceAtLastCommitRef.current === surface) return;
    surfaceAtLastCommitRef.current = surface;
    if (surface === 'thread') requestRef.current = false;
  });

  useLayoutEffect(() => {
    if (!surface || !requestRef.current || itemCount === 0) return;
    if (virtualizer) clearVirtualizerHoldOffset(virtualizer);
    if (surface === 'room' && latestAtTop) {
      scrollElement?.scrollTo({ top: 0 });
      return;
    }
    // A commit that holds the list's height over rows that shrank ends the list below its newest
    // row (`listShrinkNotRendered`). A reader the correction for those rows left where the list
    // will end is at the newest row: the end the list has now would show a blank band above the
    // composer for a frame. Any other reader is brought to the end the list has.
    const heldPx = listHeightHeld ? (pendingListShrinkPx?.() ?? 0) : 0;
    if (
      heldPx >= 1 &&
      scrollElement &&
      Math.abs(distanceBelowView(scrollElement) - heldPx) < AT_HELD_LIST_END_PX
    ) {
      return;
    }
    if (surface === 'room') virtualizer?.scrollToIndex(itemCount - 1, { align: 'end' });
    else if (scrollElement) scrollToBottom(scrollElement, 'instant');
  });

  useEffect(() => {
    if (!scrollElement) return undefined;
    const listEnd = () =>
      scrollElement.scrollHeight -
      scrollElement.clientHeight -
      (latestRef.current.pendingListShrinkPx?.() ?? 0);
    const release = () => {
      const cur = latestRef.current;
      requestRef.current = false;
      if (cur.scrollToBottomRef) seenCountRef.current = cur.scrollToBottomRef.current.count;
      cur.virtualizer?.cancelScroll();
      if (cur.surface === 'room') cur.onReaderGesture?.();
    };
    // Capture-phase scroll detection runs ahead of the virtualizer, whose scroll handler renders
    // synchronously and would re-pin before seeing a scrollbar/script/AT scroll away from latest.
    const roomBelow = () => Math.max(0, listEnd() - scrollElement.scrollTop);
    let lastTop = scrollElement.scrollTop;
    let lastBelow = roomBelow();
    let lastHeight = scrollElement.clientHeight;
    const followScroll = () => {
      const top = scrollElement.scrollTop;
      const below = roomBelow();
      const height = scrollElement.clientHeight;
      const lowerEdgeRose = top < lastTop && top + height < lastTop + lastHeight;
      const leftLatest = latestRef.current.latestAtTop
        ? top > lastTop + LEFT_LATEST_ROW_PX
        : lowerEdgeRose && below > lastBelow + LEFT_LATEST_ROW_PX;
      if (leftLatest) release();
      lastTop = top;
      lastBelow = below;
      lastHeight = height;
    };

    const content = contentRef?.current ?? null;
    const probe = footerProbeRef?.current ?? null;
    const follow =
      content && liveReplies && isViewportAtBottomNow && atLiveEndRef && roomId !== undefined
        ? { content, liveReplies, isViewportAtBottomNow, atLiveEndRef, roomId }
        : undefined;
    let pinned = follow ? follow.isViewportAtBottomNow() : false;
    let contentHeight: number | undefined;
    let framesAtGesture = follow ? follow.liveReplies.frameCount(follow.roomId) : 0;
    let seenScrollHeight = scrollElement.scrollHeight;

    const onReaderIntent = () => {
      if (follow) framesAtGesture = follow.liveReplies.frameCount(follow.roomId);
      release();
    };
    const onPassiveScroll = follow
      ? () => {
          // The browser's own scroll when the end shrinks (the composer's typing line going) can
          // be reported after the content grew again, before this observed the growth: judge the
          // reader against the content as last observed, or the growth would leave them behind.
          if (scrollElement.scrollHeight > seenScrollHeight) {
            pinned = isScrollNearBottom({
              scrollHeight: seenScrollHeight,
              scrollTop: scrollElement.scrollTop,
              clientHeight: scrollElement.clientHeight,
            });
            return;
          }
          seenScrollHeight = scrollElement.scrollHeight;
          pinned = follow.isViewportAtBottomNow();
        }
      : undefined;

    let observer: ResizeObserver | undefined;
    if (content && (follow || probe) && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        if (follow) {
          const entry = entries.find(({ target }) => target === follow.content);
          if (entry) {
            const grew = contentHeight !== undefined && entry.contentRect.height > contentHeight;
            const shrank = contentHeight !== undefined && entry.contentRect.height < contentHeight;
            const framed = follow.liveReplies.frameCount(follow.roomId) !== framesAtGesture;
            contentHeight = entry.contentRect.height;
            seenScrollHeight = scrollElement.scrollHeight;
            if (isDisclosureRevealActive(scrollElement)) {
              framesAtGesture = follow.liveReplies.frameCount(follow.roomId);
              pinned = follow.isViewportAtBottomNow();
            } else if (grew && framed && pinned && follow.atLiveEndRef.current) {
              scrollElement.scrollTo({ top: Math.max(0, listEnd()), behavior: 'instant' });
            } else if (shrank || (grew && !framed)) {
              pinned = follow.isViewportAtBottomNow();
            }
          }
        }
        if (probe) {
          const end = listEnd();
          if (scrollElement.scrollTop > end) scrollElement.scrollTop = Math.max(0, end);
        }
      });
      observer.observe(content);
      if (probe) observer.observe(probe);
    }

    READER_INTENT_EVENTS.forEach((name) =>
      scrollElement.addEventListener(name, onReaderIntent, { passive: true })
    );
    scrollElement.addEventListener('scroll', followScroll, { capture: true, passive: true });
    if (onPassiveScroll) {
      scrollElement.addEventListener('scroll', onPassiveScroll, { passive: true });
    }
    return () => {
      observer?.disconnect();
      READER_INTENT_EVENTS.forEach((name) =>
        scrollElement.removeEventListener(name, onReaderIntent)
      );
      scrollElement.removeEventListener('scroll', followScroll, { capture: true });
      if (onPassiveScroll) scrollElement.removeEventListener('scroll', onPassiveScroll);
    };
  }, [
    atLiveEndRef,
    contentRef,
    footerProbeRef,
    isViewportAtBottomNow,
    latestRef,
    liveReplies,
    roomId,
    scrollElement,
  ]);
};
