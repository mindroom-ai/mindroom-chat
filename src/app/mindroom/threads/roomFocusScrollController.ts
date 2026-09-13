import {
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import { scrollToBottom } from '../../utils/dom';
import type {
  RetryPaginationOptions,
  ScrollToElement,
  ScrollToItem,
} from '../../hooks/useVirtualPaginator';
import { getFocusedRoomEventIndex } from './timelinePagination';
import type { PendingThreadOpen } from './threadOpenTargetEvent';
import { shouldPinThreadToBottomOnOpen, type ThreadInitialRenderMode } from './threadRenderUtils';
import {
  getEventElementById,
  getRoomFocusScrollOptions,
  getRoomFocusScrollToItemOptions,
  isAnchorVisibleInScroll,
  isScrollNearBottom,
  ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS,
  ROOM_FOCUS_OBSERVER_IDLE_MS,
  setupFocusObserver,
} from './timelineScrollUtils';

export type RoomTimelineFocusItem = {
  eventId?: string;
  index: number;
  scrollTo: boolean;
  highlight: boolean;
};

export type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

type PendingRoomFocus = {
  eventId: string;
};

type RoomUnreadInfoLike = {
  inLiveTimeline: boolean;
  readUptoEventId: string;
  scrollTo?: boolean;
};

type RetryPagination = (opts?: RetryPaginationOptions) => void;

export type RoomFocusScrollControllerOptions = {
  cancelThreadBottomSettle?: () => void;
  alive: () => boolean;
  atBottomAnchorRef: MutableRefObject<HTMLElement | null>;
  editId?: string;
  focusItem?: RoomTimelineFocusItem;
  focusScrollResetToken: unknown;
  pendingThreadOpenRef: MutableRefObject<PendingThreadOpen | undefined>;
  pendingThreadOpenTick: number;
  retryPagination: RetryPagination;
  roomId: string;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  scrollThreadEventIntoView?: (eventId: string) => boolean;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  scrollToElement: ScrollToElement;
  scrollToItem: ScrollToItem;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  setFocusItem: Dispatch<SetStateAction<RoomTimelineFocusItem | undefined>>;
  setPendingThreadOpenTick: Dispatch<SetStateAction<number>>;
  suppressFocusPaginationRef: MutableRefObject<boolean>;
  suppressThreadOpenBottomPinRef: MutableRefObject<boolean>;
  threadEventIndexMapRef: MutableRefObject<Map<string, number>>;
  threadEventsLength: number;
  threadFilteredEvents: MatrixEvent[];
  threadFilteredEventsRef: MutableRefObject<MatrixEvent[]>;
  threadId?: string;
  threadInitialRenderMode: ThreadInitialRenderMode;
  threadLatestOpenPending: boolean;
  threadOpenedAtLatest: boolean;
  threadUserScrolled: boolean;
  threadTimelineTick: number;
  timelineAtLiveEnd: boolean;
  unreadInfo?: RoomUnreadInfoLike;
  unreadScrollAnchorIndex?: number;
};

export const useRoomFocusScrollController = ({
  cancelThreadBottomSettle,
  alive,
  atBottomAnchorRef,
  editId,
  focusItem,
  focusScrollResetToken,
  pendingThreadOpenRef,
  pendingThreadOpenTick,
  retryPagination,
  roomId,
  scrollRef,
  scrollThreadEventIntoView,
  scrollToBottomRef,
  scrollToElement,
  scrollToItem,
  setAtBottom,
  setFocusItem,
  setPendingThreadOpenTick,
  suppressFocusPaginationRef,
  suppressThreadOpenBottomPinRef,
  threadEventIndexMapRef,
  threadEventsLength,
  threadFilteredEvents,
  threadFilteredEventsRef,
  threadId,
  threadInitialRenderMode,
  threadLatestOpenPending,
  threadOpenedAtLatest,
  threadUserScrolled,
  threadTimelineTick,
  timelineAtLiveEnd,
  unreadInfo,
  unreadScrollAnchorIndex,
}: RoomFocusScrollControllerOptions): void => {
  const pendingRoomFocusRef = useRef<PendingRoomFocus | undefined>();

  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollToBottom(scrollEl);
    }
  }, [scrollRef]);

  useEffect(() => {
    if (!threadId || !threadLatestOpenPending) return undefined;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return undefined;

    // Only user-intended scrolls may cancel the open bottom pin. Virtualized
    // timelines also scroll programmatically (bottom pins and scroll-offset
    // adjustments when rows above the viewport re-measure), so a bare scroll
    // event is not evidence of user intent.
    let lastUserScrollIntentTs = 0;
    const markUserScrollIntent = () => {
      lastUserScrollIntentTs = Date.now();
    };
    const cancelPendingOpenBottomPin = () => {
      if (Date.now() - lastUserScrollIntentTs > 400) return;
      if (
        isScrollNearBottom({
          scrollHeight: scrollEl.scrollHeight,
          scrollTop: scrollEl.scrollTop,
          clientHeight: scrollEl.clientHeight,
        })
      ) {
        return;
      }
      suppressThreadOpenBottomPinRef.current = true;
    };

    const userScrollIntentEvents = [
      'wheel',
      'touchstart',
      'touchmove',
      'pointerdown',
      'keydown',
    ] as const;
    userScrollIntentEvents.forEach((eventType) => {
      scrollEl.addEventListener(eventType, markUserScrollIntent, { passive: true });
    });
    scrollEl.addEventListener('scroll', cancelPendingOpenBottomPin, { passive: true });
    return () => {
      userScrollIntentEvents.forEach((eventType) => {
        scrollEl.removeEventListener(eventType, markUserScrollIntent);
      });
      scrollEl.removeEventListener('scroll', cancelPendingOpenBottomPin);
    };
  }, [scrollRef, suppressThreadOpenBottomPinRef, threadId, threadLatestOpenPending]);

  useLayoutEffect(() => {
    if (threadId) return;
    const { readUptoEventId, inLiveTimeline, scrollTo } = unreadInfo ?? {};
    if (readUptoEventId && inLiveTimeline && scrollTo && unreadScrollAnchorIndex !== undefined) {
      scrollToItem(unreadScrollAnchorIndex, {
        behavior: 'instant',
        align: 'start',
        stopInView: true,
      });
    }
  }, [roomId, scrollToItem, threadId, unreadInfo, unreadScrollAnchorIndex]);

  useEffect(() => {
    if (threadId || !focusItem?.eventId) return;

    const nextIndex = threadFilteredEventsRef.current.findIndex(
      (event) => event.getId() === focusItem.eventId
    );
    if (nextIndex === -1 || nextIndex === focusItem.index) return;

    setFocusItem((currentItem) => {
      if (
        !currentItem ||
        currentItem.eventId !== focusItem.eventId ||
        currentItem.index === nextIndex
      ) {
        return currentItem;
      }

      return {
        ...currentItem,
        index: nextIndex,
      };
    });
  }, [focusItem, setFocusItem, threadFilteredEvents, threadFilteredEventsRef, threadId]);

  useLayoutEffect(() => {
    let clearFocusTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let roomFocusObserver: MutationObserver | undefined;
    let roomFocusObserverTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let roomFocusResizeCleanup: (() => void) | undefined;
    let allowObserverPaginationHandoff = true;
    const focusEventId = focusItem?.eventId;
    const focusIndex =
      !threadId && focusItem
        ? getFocusedRoomEventIndex(threadFilteredEventsRef.current, focusEventId, focusItem.index)
        : focusItem?.index ?? 0;
    const focusItemCount = threadFilteredEventsRef.current.length;
    const focusScrollToItemOptions = getRoomFocusScrollToItemOptions(focusIndex, focusItemCount);
    const focusScrollOptions = getRoomFocusScrollOptions(focusIndex, focusItemCount);

    const clearPendingRoomFocus = (resumePagination: boolean) => {
      roomFocusObserver?.disconnect();
      roomFocusObserver = undefined;

      if (roomFocusObserverTimeoutId !== undefined) {
        clearTimeout(roomFocusObserverTimeoutId);
        roomFocusObserverTimeoutId = undefined;
      }

      if (pendingRoomFocusRef.current?.eventId === focusEventId) {
        pendingRoomFocusRef.current = undefined;
      }

      suppressFocusPaginationRef.current = false;

      if (resumePagination) {
        retryPagination({
          preserveAnchorIndex: focusIndex,
        });
      }
    };

    const startRoomFocusObserver = (target: HTMLElement) => {
      const scrollContainer = scrollRef.current;
      if (!scrollContainer) {
        clearPendingRoomFocus(true);
        return;
      }

      roomFocusResizeCleanup = setupFocusObserver({
        scrollContainer,
        target,
        onRecenter: () => {
          scrollToElement(target, focusScrollOptions);
        },
        onDone: () => {
          roomFocusResizeCleanup = undefined;
          if (!allowObserverPaginationHandoff) return;
          clearPendingRoomFocus(true);
        },
        idleMs: ROOM_FOCUS_OBSERVER_IDLE_MS,
        hardMs: ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS,
      });
    };

    if (!threadId && focusItem && focusItem.scrollTo) {
      suppressFocusPaginationRef.current = true;

      scrollToItem(focusIndex, focusScrollToItemOptions);
      const target = focusEventId ? getEventElementById(scrollRef.current, focusEventId) : null;

      if (target) {
        scrollToElement(target, focusScrollOptions);
        startRoomFocusObserver(target);
      } else if (focusEventId && scrollRef.current && typeof MutationObserver !== 'undefined') {
        pendingRoomFocusRef.current = {
          eventId: focusEventId,
        };
        roomFocusObserver = new MutationObserver(() => {
          if (!alive()) {
            clearPendingRoomFocus(false);
            return;
          }

          if (pendingRoomFocusRef.current?.eventId !== focusEventId) return;

          const observedTarget = getEventElementById(scrollRef.current, focusEventId);
          if (!observedTarget) return;

          scrollToElement(observedTarget, focusScrollOptions);
          roomFocusObserver?.disconnect();
          roomFocusObserver = undefined;
          if (roomFocusObserverTimeoutId !== undefined) {
            clearTimeout(roomFocusObserverTimeoutId);
            roomFocusObserverTimeoutId = undefined;
          }
          startRoomFocusObserver(observedTarget);
        });
        roomFocusObserver.observe(scrollRef.current, {
          childList: true,
          subtree: true,
        });
        roomFocusObserverTimeoutId = setTimeout(() => {
          if (pendingRoomFocusRef.current?.eventId !== focusEventId) return;
          clearPendingRoomFocus(false);
        }, ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS);
      } else {
        pendingRoomFocusRef.current = undefined;
        suppressFocusPaginationRef.current = false;
      }
    } else {
      pendingRoomFocusRef.current = undefined;
      suppressFocusPaginationRef.current = false;
    }

    if (focusItem) {
      clearFocusTimeoutId = setTimeout(() => {
        if (!alive()) return;
        setFocusItem((currentItem) => {
          if (currentItem === focusItem) return undefined;
          return currentItem;
        });
      }, 2000);
    }

    return () => {
      allowObserverPaginationHandoff = false;
      roomFocusResizeCleanup?.();
      roomFocusResizeCleanup = undefined;
      clearPendingRoomFocus(false);
      if (clearFocusTimeoutId !== undefined) {
        clearTimeout(clearFocusTimeoutId);
      }
    };
  }, [
    alive,
    focusItem,
    focusScrollResetToken,
    retryPagination,
    scrollRef,
    scrollToElement,
    scrollToItem,
    setFocusItem,
    suppressFocusPaginationRef,
    threadFilteredEventsRef,
    threadId,
  ]);

  useLayoutEffect(() => {
    if (!threadId) return;
    if (
      !shouldPinThreadToBottomOnOpen({
        suppressOpenBottomPin: suppressThreadOpenBottomPinRef.current,
        threadId,
        threadLatestOpenPending,
        // Hydration bands land long after the open chain completes
        // (background prefetch/reconciler): the pin holds until the
        // user's FIRST real scroll gesture, then the reader owns the
        // position (device symptom: open at bottom, drift to the middle
        // as history streams in).
        threadOpenedAtLatest,
        hasUserScrollIntent: threadUserScrolled,
        threadInitialRenderMode,
        threadEventCount: threadEventsLength,
      })
    ) {
      return;
    }
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    scrollToBottom(scrollEl, 'instant');
    // Arm the gesture-cancellable bottom-settle loop for this band: the
    // freshly-mounted tail rows measure over the next frames and their
    // own estimate error re-opens the gap (self/below resizes are
    // uncompensated by design) — a single write pins to the ESTIMATED
    // bottom only.
    scrollToBottomRef.current = {
      count: scrollToBottomRef.current.count + 1,
      smooth: false,
    };
    setAtBottom(true);
  }, [
    scrollRef,
    scrollToBottomRef,
    setAtBottom,
    suppressThreadOpenBottomPinRef,
    threadEventsLength,
    threadId,
    threadInitialRenderMode,
    threadLatestOpenPending,
    threadOpenedAtLatest,
    threadUserScrolled,
  ]);

  useLayoutEffect(() => {
    if (!threadId) return;
    const pendingOpen = pendingThreadOpenRef.current;
    if (!pendingOpen) return;
    if (pendingOpen.threadId !== threadId) {
      pendingThreadOpenRef.current = undefined;
      return;
    }

    const nextItemIndex = threadEventIndexMapRef.current.get(pendingOpen.eventId);
    if (typeof nextItemIndex === 'number') {
      setFocusItem({
        eventId: pendingOpen.eventId,
        index: nextItemIndex,
        scrollTo: false,
        highlight: pendingOpen.highlight,
      });
    }
    const target = getEventElementById(scrollRef.current, pendingOpen.eventId);
    if (target) {
      // Same contract as handleOpenEvent's mounted branch: a programmatic
      // jump emits no user scroll-intent events, so an active bottom-settle
      // loop (open-at-latest pin) would yank the jump back to the bottom.
      cancelThreadBottomSettle?.();
      scrollToElement(target, {
        behavior: 'smooth',
        align: 'center',
        stopInView: true,
      });
      if (pendingOpen.onScroll) pendingOpen.onScroll(true);
      pendingThreadOpenRef.current = undefined;
      return;
    }

    if (pendingOpen.attempts >= 3) {
      if (pendingOpen.onScroll) pendingOpen.onScroll(false);
      pendingThreadOpenRef.current = undefined;
      return;
    }

    // Under thread virtualization an off-screen target never mounts on its own;
    // ask the timeline to scroll the virtual index into view before retrying.
    scrollThreadEventIntoView?.(pendingOpen.eventId);

    pendingThreadOpenRef.current = {
      ...pendingOpen,
      attempts: pendingOpen.attempts + 1,
    };
    requestAnimationFrame(() => {
      if (!pendingThreadOpenRef.current) return;
      setPendingThreadOpenTick((val) => val + 1);
    });
  }, [
    cancelThreadBottomSettle,
    pendingThreadOpenRef,
    pendingThreadOpenTick,
    scrollRef,
    scrollThreadEventIntoView,
    scrollToElement,
    setFocusItem,
    setPendingThreadOpenTick,
    threadEventIndexMapRef,
    threadId,
    threadTimelineTick,
  ]);

  const scrollToBottomCount = scrollToBottomRef.current.count;
  useLayoutEffect(() => {
    if (scrollToBottomCount > 0) {
      const scrollEl = scrollRef.current;
      if (scrollEl) {
        scrollToBottom(scrollEl, scrollToBottomRef.current.smooth ? 'smooth' : 'instant');
      }
    }
  }, [scrollRef, scrollToBottomCount, scrollToBottomRef]);

  useEffect(() => {
    if (!editId) return;

    const editMsgElement = getEventElementById(scrollRef.current, editId) ?? undefined;
    if (editMsgElement) {
      scrollToElement(editMsgElement, {
        align: 'center',
        behavior: 'smooth',
        stopInView: true,
      });
    }
  }, [editId, scrollRef, scrollToElement]);

  useEffect(() => {
    if (!timelineAtLiveEnd) {
      setAtBottom(false);
      return;
    }

    const anchor = atBottomAnchorRef.current;
    const scroll = scrollRef.current;
    if (anchor && scroll && isAnchorVisibleInScroll(anchor, scroll)) {
      setAtBottom(true);
    }
  }, [atBottomAnchorRef, scrollRef, setAtBottom, timelineAtLiveEnd]);
};
