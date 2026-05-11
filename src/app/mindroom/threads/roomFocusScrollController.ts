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

type RestorePendingThreadBackPaginationAnchor = (
  scrollRoot: HTMLElement | null | undefined,
  threadId: string | undefined,
  eventCount?: number
) => boolean;

type RetryPagination = (opts?: RetryPaginationOptions) => void;

export type RoomFocusScrollControllerOptions = {
  alive: () => boolean;
  atBottomAnchorRef: MutableRefObject<HTMLElement | null>;
  editId?: string;
  focusItem?: RoomTimelineFocusItem;
  focusScrollResetToken: unknown;
  pendingThreadOpenRef: MutableRefObject<PendingThreadOpen | undefined>;
  pendingThreadOpenTick: number;
  restorePendingThreadBackPaginationAnchor: RestorePendingThreadBackPaginationAnchor;
  retryPagination: RetryPagination;
  roomId: string;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
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
  threadTimelineTick: number;
  timelineAtLiveEnd: boolean;
  unreadInfo?: RoomUnreadInfoLike;
  unreadScrollAnchorIndex?: number;
};

export const useRoomFocusScrollController = ({
  alive,
  atBottomAnchorRef,
  editId,
  focusItem,
  focusScrollResetToken,
  pendingThreadOpenRef,
  pendingThreadOpenTick,
  restorePendingThreadBackPaginationAnchor,
  retryPagination,
  roomId,
  scrollRef,
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

    const cancelPendingOpenBottomPin = () => {
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

    scrollEl.addEventListener('scroll', cancelPendingOpenBottomPin, { passive: true });
    return () => {
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
        threadInitialRenderMode,
        threadEventCount: threadEventsLength,
      })
    ) {
      return;
    }
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    scrollToBottom(scrollEl, 'instant');
    setAtBottom(true);
  }, [
    scrollRef,
    setAtBottom,
    threadEventsLength,
    threadId,
    threadInitialRenderMode,
    threadLatestOpenPending,
    suppressThreadOpenBottomPinRef,
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
      scrollToElement(target, {
        behavior: 'smooth',
        align: 'center',
        stopInView: true,
      });
      if (pendingOpen.onScroll) pendingOpen.onScroll(true);
      pendingThreadOpenRef.current = undefined;
      return;
    }

    if (pendingOpen.attempts >= 2) {
      if (pendingOpen.onScroll) pendingOpen.onScroll(false);
      pendingThreadOpenRef.current = undefined;
      return;
    }

    pendingThreadOpenRef.current = {
      ...pendingOpen,
      attempts: pendingOpen.attempts + 1,
    };
    requestAnimationFrame(() => {
      if (!pendingThreadOpenRef.current) return;
      setPendingThreadOpenTick((val) => val + 1);
    });
  }, [
    pendingThreadOpenRef,
    pendingThreadOpenTick,
    scrollRef,
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

  useLayoutEffect(() => {
    restorePendingThreadBackPaginationAnchor(scrollRef.current, threadId, threadEventsLength);
  }, [
    restorePendingThreadBackPaginationAnchor,
    scrollRef,
    threadEventsLength,
    threadId,
    threadTimelineTick,
  ]);

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
