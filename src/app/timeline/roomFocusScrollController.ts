import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import {
  readScrollPadding,
  type RetryPaginationOptions,
  type ScrollToElement,
  type ScrollToItem,
} from './useVirtualPaginator';
import { scrollToBottom } from '../lib/dom';
import { isLatestAnchorInReach, scrollToLatestEnd } from './roomTimelineScroll';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import type { ThreadTargetCommands } from '../threads/open/threadSessionTypes';
import { shouldPinThreadToBottomOnOpen, type ThreadInitialRenderMode } from '../event-store/threads/threadRenderUtils';
import { getFocusedRoomEventIndex } from '../event-store/timeline/timelinePagination';
import {
  ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS,
  ROOM_FOCUS_OBSERVER_IDLE_MS,
  getEventElementById,
  getRoomFocusScrollOptions,
  getRoomFocusScrollToItemOptions,
  setupFocusObserver,
} from '../event-store/timeline/timelineScrollUtils';

/**
 * The scroll moves of the room timeline that the reader does not make, in the room view and in an
 * open thread: the unread marker a room opens at, the jump to a focused event and its highlight,
 * the newest row a thread opens at, a jump target inside an open thread, the bottom-pin requests,
 * the message being edited, and the at-bottom state (Jump to Latest) at the live end.
 */

/** The timeline's focused event: its row is jumped to while `scrollTo`, highlighted while `highlight`. */
export type RoomTimelineFocusItem = {
  eventId?: string;
  index: number;
  scrollTo: boolean;
  highlight: boolean;
  /**
   * How far below the scroll area's top the row starts, to show a place the reader left (the
   * scroll padding the bars over the rows keep is not taken off); without it, the row's place
   * depends on its position in the rows (`getRoomFocusScrollOptions`).
   */
  offset?: number;
};

/** The shared bottom-pin request: a producer adds 1 to `count` to ask once; `smooth` animates it. */
export type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

export type RoomFocusScrollControllerOptions = {
  /** Scroll movement owned by row measurement, including already rendered corrections. */
  readMeasurementCorrectionPx?: () => number;
  cancelThreadBottomSettle?: () => void;
  alive: () => boolean;
  atBottomAnchorRef: MutableRefObject<HTMLElement | null>;
  editId?: string;
  focusItem?: RoomTimelineFocusItem;
  focusScrollResetToken: unknown;
  /** Whether the room's newest row is its first, so its latest end is the top (`scrollToLatestEnd`). */
  latestAtTopRef?: MutableRefObject<boolean>;
  threadTargets: ThreadTargetCommands;
  pendingThreadOpenTick: number;
  retryPagination: (opts?: RetryPaginationOptions) => void;
  roomId: string;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  scrollThreadEventIntoView?: (eventId: string) => boolean;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  scrollToElement: ScrollToElement;
  scrollToItem: ScrollToItem;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  setFocusItem: Dispatch<SetStateAction<RoomTimelineFocusItem | undefined>>;
  suppressFocusPaginationRef: MutableRefObject<boolean>;
  isThreadOpenBottomPinSuppressed: () => boolean;
  requestThreadOpenBottomPin: () => boolean;
  cancelThreadOpenBottomPin: () => void;
  shouldApplyThreadBottomPin: (count: number) => boolean;
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
  unreadInfo?: { inLiveTimeline: boolean; readUptoEventId: string; scrollTo?: boolean };
  unreadScrollAnchorIndex?: number;
};

type Options = RoomFocusScrollControllerOptions;

/**
 * What hands the scroll position to the reader. A plain `scroll` is not one: the virtual list
 * moves the position by itself when rows above the view change size.
 */
const READER_GESTURES = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const;

/** How long a focus jump waits for its row to show up in the scroll area. */
const ROW_WAIT_MS = ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS;

/** A focus item's jump request and highlight last as long as the longest wait and settle. */
const FOCUS_LIFETIME_MS = ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS + ROOM_FOCUS_OBSERVER_IDLE_MS;

/** An open thread's jump target gives up once this many attempts found its row unmounted. */
const THREAD_TARGET_ATTEMPTS = 3;

type UnreadMarker = NonNullable<Options['unreadInfo']>;

/** An unread marker the room opened at, the view it opened in, and whether aiming at it is over. */
type MarkerOpening = { marker: UnreadMarker; viewKey: string; over: boolean };

/**
 * A room with unread rows opens with the row after its read marker at the top. Rows that load
 * above it move that row, so it is aimed at again as they load, until the reader's first gesture in
 * the room view or until the view changes. Returns what that gesture calls. Rows that run newest
 * first have their unread rows above the marker, so they open at their top instead.
 */
const useUnreadMarkerOpening = ({
  latestAtTopRef,
  roomId,
  scrollToItem,
  threadId,
  unreadInfo,
  unreadScrollAnchorIndex,
}: Pick<
  Options,
  | 'latestAtTopRef'
  | 'roomId'
  | 'scrollToItem'
  | 'threadId'
  | 'unreadInfo'
  | 'unreadScrollAnchorIndex'
>) => {
  const openingRef = useRef<MarkerOpening>();
  useLayoutEffect(() => {
    const viewKey = `${roomId}|${threadId ?? ''}`;
    const previous = openingRef.current;
    // A thread or another room ends the opening of the view it began in.
    if (previous && previous.viewKey !== viewKey) previous.over = true;
    if (threadId || !unreadInfo?.readUptoEventId || latestAtTopRef?.current) return;
    if (!unreadInfo.inLiveTimeline || !unreadInfo.scrollTo) return;
    let opening = previous;
    if (!opening || opening.marker !== unreadInfo) {
      opening = { marker: unreadInfo, viewKey, over: false };
      openingRef.current = opening;
    }
    if (opening.over || unreadScrollAnchorIndex === undefined) return;
    scrollToItem(unreadScrollAnchorIndex, {
      behavior: 'instant',
      align: 'start',
      stopInView: true,
    });
  }, [latestAtTopRef, roomId, scrollToItem, threadId, unreadInfo, unreadScrollAnchorIndex]);
  return useCallback(() => {
    const opening = openingRef.current;
    if (opening) opening.over = true;
  }, []);
};

/**
 * Waits for the row of `eventId` to show up in `scrollArea`, checking at every change of its
 * subtree. Gives up when `stillWanted` turns false at a change, or after ROW_WAIT_MS. Returns what
 * stops the wait.
 */
const waitForEventRow = (
  scrollArea: HTMLElement,
  eventId: string,
  handlers: {
    stillWanted: () => boolean;
    onRow: (row: HTMLElement) => void;
    onGiveUp: () => void;
  }
): (() => void) => {
  const observer = new MutationObserver(() => {
    if (!handlers.stillWanted()) {
      stop();
      handlers.onGiveUp();
      return;
    }
    const row = getEventElementById(scrollArea, eventId);
    if (!row) return;
    stop();
    handlers.onRow(row);
  });
  const timer = setTimeout(() => {
    stop();
    handlers.onGiveUp();
  }, ROW_WAIT_MS);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
  };
  observer.observe(scrollArea, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-message-id'],
  });
  return stop;
};

/** What the room focus jump remembers between renders. */
type FocusJumpMemory = {
  /** The room focus whose jump is under way: its row is awaited or settling. */
  jumping?: RoomTimelineFocusItem;
  /** The focus item the previous room had: it never jumps in the room shown now. */
  leftBehind?: RoomTimelineFocusItem;
  /** The room and focus item of the previous render. */
  roomId: string;
  focusItem?: RoomTimelineFocusItem;
};

/**
 * Jumps to the focused event in the room view while it asks for a jump (`scrollTo`). Edge
 * pagination pauses for the jump; the paginator moves to the row's index, and once the row is in
 * the DOM it is aimed at again while the rows around it load and measure. Then pagination resumes
 * with the row held in place. Any focus item's jump request and highlight end after
 * FOCUS_LIFETIME_MS.
 */
const useRoomFocusJump = ({
  alive,
  focusItem,
  focusScrollResetToken,
  retryPagination,
  roomId,
  scrollRef,
  scrollToElement,
  scrollToItem,
  setFocusItem,
  suppressFocusPaginationRef,
  threadFilteredEventsRef,
  threadId,
}: Pick<
  Options,
  | 'alive'
  | 'focusItem'
  | 'focusScrollResetToken'
  | 'retryPagination'
  | 'roomId'
  | 'scrollRef'
  | 'scrollToElement'
  | 'scrollToItem'
  | 'setFocusItem'
  | 'suppressFocusPaginationRef'
  | 'threadFilteredEventsRef'
  | 'threadId'
>) => {
  const [memory] = useState<FocusJumpMemory>(() => ({ roomId, focusItem }));
  // In the render that shows another room, before any effect: a focus of the previous room must
  // never land in this one, whether its row is still awaited or its item is still current.
  if (memory.roomId !== roomId) {
    memory.jumping = undefined;
    memory.leftBehind = memory.focusItem;
  }
  memory.roomId = roomId;
  memory.focusItem = focusItem;

  useLayoutEffect(() => {
    const stops: Array<() => void> = [];
    const stopEverything = () => {
      stops.forEach((stop) => stop());
      if (memory.jumping === focusItem) memory.jumping = undefined;
      suppressFocusPaginationRef.current = false;
    };

    if (focusItem && (focusItem.scrollTo || focusItem.highlight)) {
      const lifetime = setTimeout(() => {
        if (!alive()) return;
        setFocusItem((current) =>
          current === focusItem ? { ...focusItem, scrollTo: false, highlight: false } : current
        );
      }, FOCUS_LIFETIME_MS);
      stops.push(() => clearTimeout(lifetime));
    }

    if (threadId || !focusItem?.scrollTo || focusItem === memory.leftBehind) {
      memory.jumping = undefined;
      suppressFocusPaginationRef.current = false;
      return stopEverything;
    }

    const focus = focusItem;
    const rows = threadFilteredEventsRef.current;
    const position = getFocusedRoomEventIndex(rows, focus.eventId, focus.index);
    // `scrollToElement` aligns a row's start below the scroll padding, as it is at each call.
    const { offset } = focus;
    const rowPlacement = () =>
      offset === undefined
        ? getRoomFocusScrollOptions(position, rows.length)
        : {
            behavior: 'instant' as const,
            align: 'start' as const,
            offset: offset - (scrollRef.current ? readScrollPadding(scrollRef.current).top : 0),
          };

    const finish = (resumePagination: boolean) => {
      if (memory.jumping === focus) memory.jumping = undefined;
      suppressFocusPaginationRef.current = false;
      if (resumePagination) retryPagination({ preserveAnchorIndex: position });
    };

    // Aims at the row, then again at every size change of it or the scroll area until they rest.
    const landOn = (row: HTMLElement) => {
      scrollToElement(row, rowPlacement());
      const scrollContainer = scrollRef.current;
      if (!scrollContainer) {
        finish(true);
        return;
      }
      let cancelled = false;
      const endSettle = setupFocusObserver({
        scrollContainer,
        target: row,
        onRecenter: () => {
          scrollToElement(row, rowPlacement());
        },
        onDone: () => {
          if (!cancelled) finish(true);
        },
      });
      stops.push(() => {
        cancelled = true;
        endSettle();
      });
    };

    memory.jumping = focus;
    suppressFocusPaginationRef.current = true;
    scrollToItem(
      position,
      offset === undefined
        ? getRoomFocusScrollToItemOptions(position, rows.length)
        : { ...rowPlacement(), stopInView: false }
    );

    const { eventId } = focus;
    const scrollArea = scrollRef.current;
    const mountedRow = eventId ? getEventElementById(scrollArea, eventId) : null;
    if (mountedRow) {
      landOn(mountedRow);
    } else if (eventId && scrollArea && typeof MutationObserver !== 'undefined') {
      stops.push(
        waitForEventRow(scrollArea, eventId, {
          stillWanted: () => alive() && memory.jumping === focus,
          onRow: landOn,
          onGiveUp: () => finish(false),
        })
      );
    } else {
      finish(false);
    }
    return stopEverything;
  }, [
    alive,
    focusItem,
    focusScrollResetToken,
    memory,
    retryPagination,
    scrollRef,
    scrollToElement,
    scrollToItem,
    setFocusItem,
    suppressFocusPaginationRef,
    threadFilteredEventsRef,
    threadId,
  ]);
};

/**
 * A thread opened at its newest row is held there while its rows arrive and measure, until the
 * reader's first gesture or a jump target suppresses the opening pin.
 */
const useThreadOpeningPin = ({
  readMeasurementCorrectionPx,
  isThreadOpenBottomPinSuppressed,
  requestThreadOpenBottomPin,
  scrollRef,
  setAtBottom,
  threadEventsLength,
  threadId,
  threadInitialRenderMode,
  threadLatestOpenPending,
  threadOpenedAtLatest,
  threadUserScrolled,
}: Pick<
  Options,
  | 'readMeasurementCorrectionPx'
  | 'isThreadOpenBottomPinSuppressed'
  | 'requestThreadOpenBottomPin'
  | 'scrollRef'
  | 'setAtBottom'
  | 'threadEventsLength'
  | 'threadId'
  | 'threadInitialRenderMode'
  | 'threadLatestOpenPending'
  | 'threadOpenedAtLatest'
  | 'threadUserScrolled'
>) => {
  // Whether the effect below pinned in this commit; the one after it then has nothing to do.
  const pinnedInCommitRef = useRef(false);
  // Where the last pin, or the last commit that found the view at the bottom, left the scroll
  // position: a view above it was moved up by something else than the rows growing.
  const pinnedPositionRef = useRef<{ top: number; correction: number }>();
  useLayoutEffect(() => {
    if (!threadId) return;
    const pinned = shouldPinThreadToBottomOnOpen({
      suppressOpenBottomPin: isThreadOpenBottomPinSuppressed(),
      threadId,
      threadLatestOpenPending,
      threadOpenedAtLatest,
      hasUserScrollIntent: threadUserScrolled,
      threadInitialRenderMode,
      threadEventCount: threadEventsLength,
    });
    const scrollArea = scrollRef.current;
    if (!pinned || !scrollArea || !requestThreadOpenBottomPin()) return;
    scrollToBottom(scrollArea, 'instant');
    setAtBottom(true);
    pinnedInCommitRef.current = true;
    pinnedPositionRef.current = {
      top: scrollArea.scrollTop,
      correction: readMeasurementCorrectionPx?.() ?? 0,
    };
  }, [
    readMeasurementCorrectionPx,
    isThreadOpenBottomPinSuppressed,
    requestThreadOpenBottomPin,
    scrollRef,
    setAtBottom,
    threadEventsLength,
    threadId,
    threadInitialRenderMode,
    threadLatestOpenPending,
    threadOpenedAtLatest,
    threadUserScrolled,
  ]);
  // Rows measure after the commit that pinned them: one taller than its estimate (a tool call, a
  // reasoning summary) pushes the newest reply below the view. The commit that renders the
  // measurement pins it again, as long as the opening pin holds and nothing else moved the view
  // up (a script or assistive technology scrolls without the gestures that end the pin).
  useLayoutEffect(() => {
    if (pinnedInCommitRef.current) {
      pinnedInCommitRef.current = false;
      return;
    }
    const scrollArea = scrollRef.current;
    if (!threadId || !scrollArea) return;
    const correction = readMeasurementCorrectionPx?.() ?? 0;
    if (scrollArea.scrollHeight - scrollArea.clientHeight - scrollArea.scrollTop <= 1) {
      pinnedPositionRef.current = { top: scrollArea.scrollTop, correction };
      return;
    }
    const pinnedPosition = pinnedPositionRef.current;
    if (!pinnedPosition) return;
    // A shrink correction moves the scroll up even while other rows grow in the same pass.
    // Compare against the position after our own corrections, so only an additional upward
    // scroll hands ownership away. The ledger keeps the sum across its pre-paint renders.
    const correctedTop = pinnedPosition.top + correction - pinnedPosition.correction;
    if (scrollArea.scrollTop < correctedTop - 1) return;
    const pinned = shouldPinThreadToBottomOnOpen({
      suppressOpenBottomPin: isThreadOpenBottomPinSuppressed(),
      threadId,
      threadLatestOpenPending,
      threadOpenedAtLatest,
      hasUserScrollIntent: threadUserScrolled,
      threadInitialRenderMode,
      threadEventCount: threadEventsLength,
    });
    if (!pinned || !requestThreadOpenBottomPin()) return;
    scrollToBottom(scrollArea, 'instant');
    pinnedPositionRef.current = { top: scrollArea.scrollTop, correction };
  });
};

/**
 * Brings the thread session's pending jump target into view in the open thread. A row in the DOM
 * is centred; otherwise the thread's virtual list scrolls toward it and the session tries again on
 * the next frame, until THREAD_TARGET_ATTEMPTS attempts found no row.
 */
const useThreadJumpTarget = ({
  cancelThreadBottomSettle,
  pendingThreadOpenTick,
  scrollRef,
  scrollThreadEventIntoView,
  scrollToElement,
  setFocusItem,
  threadEventIndexMapRef,
  threadId,
  threadTargets,
  threadTimelineTick,
}: Pick<
  Options,
  | 'cancelThreadBottomSettle'
  | 'pendingThreadOpenTick'
  | 'scrollRef'
  | 'scrollThreadEventIntoView'
  | 'scrollToElement'
  | 'setFocusItem'
  | 'threadEventIndexMapRef'
  | 'threadId'
  | 'threadTargets'
  | 'threadTimelineTick'
>) => {
  useLayoutEffect(() => {
    if (!threadId) return;
    const target = threadTargets.getPending();
    if (!target) return;
    const { requestId, eventId } = target;
    if (target.threadId !== threadId) {
      threadTargets.discard(requestId);
      return;
    }
    const index = threadEventIndexMapRef.current.get(eventId);
    if (index !== undefined) {
      setFocusItem({ eventId, index, scrollTo: false, highlight: target.highlight });
    }
    const row = getEventElementById(scrollRef.current, eventId);
    if (row) {
      // The opening pin must not pull the reader back from the target.
      cancelThreadBottomSettle?.();
      scrollToElement(row, { align: 'center', behavior: 'instant', stopInView: true });
      threadTargets.complete(requestId, true);
      return;
    }
    if (target.attempts >= THREAD_TARGET_ATTEMPTS) {
      threadTargets.complete(requestId, false);
      return;
    }
    scrollThreadEventIntoView?.(eventId);
    threadTargets.advanceAttempt(requestId);
    requestAnimationFrame(() => threadTargets.wakeRetry(requestId));
  }, [
    cancelThreadBottomSettle,
    pendingThreadOpenTick,
    scrollRef,
    scrollThreadEventIntoView,
    scrollToElement,
    setFocusItem,
    threadEventIndexMapRef,
    threadId,
    threadTargets,
    threadTimelineTick,
  ]);
};

/** How many frames a smooth bottom pin may run before it is finished at once. */
const SMOOTH_PIN_MAX_FRAMES = 60;

/**
 * Finishes a smooth scroll to the end of `scrollArea` that stops short. It aims at the end the area
 * had when it started, so rows that grow while it runs end below it, and any scroll the timeline
 * writes meanwhile stops it (the composer's typing line arriving with the reader's own message
 * does). The reader would be left above the newest row, which then no longer counts them as at the
 * bottom, and nothing would follow the reply. A frame in which it has not moved and is not at the
 * end takes the end at once, as long as `wanted` says the request still holds and nothing moved
 * the area up meanwhile.
 */
const finishSmoothBottomPin = (scrollArea: HTMLElement, wanted: () => boolean) => {
  if (typeof requestAnimationFrame === 'undefined') return;
  let frames = 0;
  let lastTop = Number.NaN;
  const check = () => {
    if (!wanted() || !scrollArea.isConnected) return;
    const below = scrollArea.scrollHeight - scrollArea.clientHeight - scrollArea.scrollTop;
    // At the end, or moved up by something else that owns the position now (a jump).
    if (below <= 1 || scrollArea.scrollTop < lastTop) return;
    if (scrollArea.scrollTop === lastTop || frames >= SMOOTH_PIN_MAX_FRAMES) {
      scrollToBottom(scrollArea, 'instant');
      return;
    }
    lastTop = scrollArea.scrollTop;
    frames += 1;
    requestAnimationFrame(check);
  };
  // The animation starts in the frame after the request.
  requestAnimationFrame(() => requestAnimationFrame(check));
};

/**
 * Applies the shared bottom-pin requests. Every commit compares the request count as it is then
 * with the one the previous commit saw, so a request made earlier in the same commit (the thread's
 * opening pin, which scrolls at once) is taken there and never again later. A new count scrolls
 * the area to its latest end, unless the guard says a gesture of the reader dropped that request. A
 * smooth one to the bottom is finished at once if it stops short, until a newer request or a
 * gesture.
 */
const useBottomPinRequests = ({
  latestAtTopRef,
  scrollRef,
  scrollToBottomRef,
  shouldApplyThreadBottomPin,
}: Pick<
  Options,
  'latestAtTopRef' | 'scrollRef' | 'scrollToBottomRef' | 'shouldApplyThreadBottomPin'
>) => {
  const seenCountRef = useRef(scrollToBottomRef.current.count);
  const guardRef = useLatestRef(shouldApplyThreadBottomPin);
  useLayoutEffect(() => {
    const { count, smooth } = scrollToBottomRef.current;
    if (count === seenCountRef.current) return;
    seenCountRef.current = count;
    if (count <= 0 || !shouldApplyThreadBottomPin(count)) return;
    const scrollArea = scrollRef.current;
    if (!scrollArea) return;
    const latestAtTop = !!latestAtTopRef?.current;
    scrollToLatestEnd(scrollArea, latestAtTop, smooth ? 'smooth' : 'instant');
    if (smooth && !latestAtTop) {
      finishSmoothBottomPin(
        scrollArea,
        () => scrollToBottomRef.current.count === count && guardRef.current(count)
      );
    }
  });
};

/** The gesture listeners on a scroll area, what they were attached for, and what removes them. */
type GestureListeners = {
  scrollArea: HTMLElement;
  threadId?: string;
  cancelThreadOpenBottomPin: () => void;
  detach: () => void;
};

/**
 * The reader's gestures on the scroll area: in an open thread they end its opening pin, in the
 * room view they end the aiming at the unread marker.
 */
const useReaderGestures = (
  {
    cancelThreadOpenBottomPin,
    scrollRef,
    threadId,
  }: Pick<Options, 'cancelThreadOpenBottomPin' | 'scrollRef' | 'threadId'>,
  endMarkerOpening: () => void
) => {
  const [listening] = useState<{ listeners?: GestureListeners }>({});
  // Checked after every commit: the scroll area can mount after its view (Compact has none).
  useEffect(() => {
    const scrollArea = scrollRef.current;
    const attached = listening.listeners;
    if (
      attached?.scrollArea === scrollArea &&
      attached.threadId === threadId &&
      attached.cancelThreadOpenBottomPin === cancelThreadOpenBottomPin
    ) {
      return;
    }
    attached?.detach();
    listening.listeners = undefined;
    if (!scrollArea) return;
    const onGesture = threadId ? () => cancelThreadOpenBottomPin() : endMarkerOpening;
    READER_GESTURES.forEach((type) =>
      scrollArea.addEventListener(type, onGesture, { passive: true })
    );
    listening.listeners = {
      scrollArea,
      threadId,
      cancelThreadOpenBottomPin,
      detach: () => {
        READER_GESTURES.forEach((type) => scrollArea.removeEventListener(type, onGesture));
      },
    };
  });
  useEffect(
    () => () => {
      listening.listeners?.detach();
      listening.listeners = undefined;
    },
    [listening]
  );
};

/** Keeps the room focus item's index at its event's row while rows come and go above it. */
const useFocusIndexTracking = ({
  focusItem,
  setFocusItem,
  threadFilteredEvents,
  threadId,
}: Pick<Options, 'focusItem' | 'setFocusItem' | 'threadFilteredEvents' | 'threadId'>) => {
  useEffect(() => {
    const eventId = focusItem?.eventId;
    if (threadId || !focusItem || !eventId) return;
    const index = getFocusedRoomEventIndex(threadFilteredEvents, eventId, focusItem.index);
    if (index === focusItem.index) return;
    setFocusItem((current) =>
      current?.eventId === eventId && current.index !== index ? { ...current, index } : current
    );
  }, [focusItem, setFocusItem, threadFilteredEvents, threadId]);
};

/** Brings the row of the message being edited into view, unless it already shows in full. */
const useEditedRowInView = ({
  editId,
  scrollRef,
  scrollToElement,
}: Pick<Options, 'editId' | 'scrollRef' | 'scrollToElement'>) => {
  useEffect(() => {
    if (!editId) return;
    const row = getEventElementById(scrollRef.current, editId);
    if (row) scrollToElement(row, { behavior: 'smooth', align: 'center', stopInView: true });
  }, [editId, scrollRef, scrollToElement]);
};

/**
 * Jump to Latest shows while the timeline is away from its live end. Back at the live end it hides
 * when the latest-end anchor is within reach of the scroll area; otherwise scrolling decides.
 */
const useLiveEndAtBottom = ({
  atBottomAnchorRef,
  latestAtTopRef,
  scrollRef,
  setAtBottom,
  timelineAtLiveEnd,
}: Pick<
  Options,
  'atBottomAnchorRef' | 'latestAtTopRef' | 'scrollRef' | 'setAtBottom' | 'timelineAtLiveEnd'
>) => {
  useEffect(() => {
    if (!timelineAtLiveEnd) {
      setAtBottom(false);
      return;
    }
    const anchor = atBottomAnchorRef.current;
    const scrollArea = scrollRef.current;
    if (!anchor || !scrollArea) return;
    if (isLatestAnchorInReach(anchor, scrollArea, !!latestAtTopRef?.current)) setAtBottom(true);
  }, [atBottomAnchorRef, latestAtTopRef, scrollRef, setAtBottom, timelineAtLiveEnd]);
};

/**
 * The room timeline's scroll moves for the room view and an open thread. The order of the parts
 * matters: before paint, the thread's opening pin runs ahead of its jump target, which cancels it,
 * and the bottom-pin requests run ahead of the latest-row pin the timeline calls after this hook.
 */
export const useRoomFocusScrollController = (options: RoomFocusScrollControllerOptions): void => {
  // Before paint.
  const endMarkerOpening = useUnreadMarkerOpening(options);
  useRoomFocusJump(options);
  useThreadOpeningPin(options);
  useThreadJumpTarget(options);
  useBottomPinRequests(options);
  // After paint.
  useReaderGestures(options, endMarkerOpening);
  useFocusIndexTracking(options);
  useEditedRowInView(options);
  useLiveEndAtBottom(options);
};
