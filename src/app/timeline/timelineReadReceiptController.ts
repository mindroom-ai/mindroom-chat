import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Direction, type MatrixClient, type Room } from 'matrix-js-sdk';
import { useDebounce } from '../lib/hooks/useDebounce';
import { useDocumentFocusChange } from '../lib/hooks/useDocumentFocusChange';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../lib/hooks/useIntersectionObserver';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import {
  markMainTimelineAsRead,
  markRoomAndThreadsAsRead,
  markThreadAsRead,
} from '../notifications/readReceipts';
import type { ThreadInitialRenderMode } from '../event-store/threads/threadRenderUtils';
import { getEventTimeline } from '../event-store/timeline/timelinePagination';
import { getFirstLinkedTimeline } from '../event-store/timeline/linkedTimelines';
import { TIMELINE_BOTTOM_THRESHOLD_PX } from '../event-store/timeline/timelineScrollUtils';
import { isLatestAnchorInReach } from './roomTimelineScroll';

/**
 * How long the bottom anchor must stay out of reach before the view counts as scrolled away, so a
 * short overshoot does not flash Jump to Latest.
 */
const SCROLLED_AWAY_DELAY_MS = 500;

type ReadReceiptControllerOptions = {
  atBottom: boolean;
  atBottomAnchorRef: MutableRefObject<HTMLElement | null>;
  atBottomRef: MutableRefObject<boolean>;
  atLiveEndRef: MutableRefObject<boolean>;
  getScrollElement: () => HTMLElement | null | undefined;
  /** Whether the latest-end anchor sits at the top: the room's newest row is its first. */
  latestAtTop?: boolean;
  handleOpenEvent: (
    eventId: string,
    highlight?: boolean,
    onScroll?: (scrolled: boolean) => void
  ) => void | Promise<void>;
  hideActivity: boolean;
  mx: MatrixClient;
  readUptoEventIdRef: MutableRefObject<string | undefined>;
  room: Room;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  threadEventsLength: number;
  threadId?: string;
  threadInitialRenderMode: ThreadInitialRenderMode;
  threadTailLoaded: boolean;
  timelineAtLiveEnd: boolean;
  unreadInfo?: { inLiveTimeline: boolean; readUptoEventId: string };
};

/** The values a read decision takes from the newest render. */
type ReadContext = Pick<
  ReadReceiptControllerOptions,
  | 'handleOpenEvent'
  | 'hideActivity'
  | 'mx'
  | 'room'
  | 'threadEventsLength'
  | 'threadId'
  | 'threadInitialRenderMode'
  | 'threadTailLoaded'
  | 'unreadInfo'
>;

/**
 * Whether the reader has seen the newest rows of the room: they have no read marker yet, or the
 * loaded chain that holds the marker runs forward into the live timeline. A marker that is not
 * loaded, or that sits in history cut off from the live end, leaves the rows after it unseen.
 */
const markerReachesLiveTimeline = (room: Room, markerEventId: string | undefined): boolean => {
  if (!markerEventId) return true;
  const markerTimeline = getEventTimeline(room, markerEventId);
  if (!markerTimeline) return false;
  return getFirstLinkedTimeline(markerTimeline, Direction.Forward) === room.getLiveTimeline();
};

/**
 * Whether the reader is still where a read was decided when its frame comes: in the same room
 * and thread, at the bottom of its live end, with the window focused. A frame can come late on a
 * busy machine, and what arrived after the reader left, scrolled away or switched windows was
 * not seen.
 */
type StillReading = (roomId: string, threadId: string | undefined) => boolean;

/** Reads the main timeline on the next frame, when the reader has seen its newest rows. */
const readRoomOnNextFrame = (
  context: ReadContext,
  markerEventId: string | undefined,
  stillReading: StillReading
): void => {
  const { hideActivity, mx, room } = context;
  if (!markerReachesLiveTimeline(room, markerEventId)) return;
  const { roomId } = room;
  requestAnimationFrame(() => {
    if (!stillReading(roomId, undefined)) return;
    void markMainTimelineAsRead(mx, roomId, hideActivity);
  });
};

/**
 * Reads the open thread on the next frame, once its newest replies are loaded and rendered: its
 * tail is loaded, it is past its loading render, and it has a row.
 */
const readThreadOnNextFrame = (context: ReadContext, stillReading: StillReading): void => {
  const { hideActivity, mx, room, threadId } = context;
  if (!threadId || !context.threadTailLoaded) return;
  if (context.threadInitialRenderMode === 'loading' || context.threadEventsLength === 0) return;
  const { roomId } = room;
  requestAnimationFrame(() => {
    if (!stillReading(roomId, threadId)) return;
    void markThreadAsRead(mx, roomId, threadId, hideActivity);
  });
};

/**
 * Tracks whether the reader is at the bottom of the timeline, sends read receipts once they have
 * seen its newest rows (at the bottom of the live end with the window focused, on coming back to
 * the window, and while an open thread loads or grows at its bottom), and gives the timeline its
 * Mark as Read action.
 */
export const useTimelineReadReceiptController = ({
  atBottom,
  atBottomAnchorRef,
  atBottomRef,
  atLiveEndRef,
  getScrollElement,
  latestAtTop = false,
  handleOpenEvent,
  hideActivity,
  mx,
  readUptoEventIdRef,
  room,
  setAtBottom,
  threadEventsLength,
  threadId,
  threadInitialRenderMode,
  threadTailLoaded,
  timelineAtLiveEnd,
  unreadInfo,
}: ReadReceiptControllerOptions): { handleMarkAsRead: () => void } => {
  const contextRef = useLatestRef<ReadContext>({
    handleOpenEvent,
    hideActivity,
    mx,
    room,
    threadEventsLength,
    threadId,
    threadInitialRenderMode,
    threadTailLoaded,
    unreadInfo,
  });

  // The view is gone once it unmounts; a frame it scheduled then reads nothing.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // Measured when the frame comes, not taken from the "at bottom" state, which lags behind the
  // reader's scroll: the anchor is within reach of the scroll area's lower edge (its upper edge
  // when the newest row is first).
  const latestAtTopRef = useLatestRef(latestAtTop);
  const stillReading = useCallback<StillReading>(
    (roomId, threadId) => {
      const context = contextRef.current;
      if (!mountedRef.current || context.room.roomId !== roomId || context.threadId !== threadId)
        return false;
      const anchor = atBottomAnchorRef.current;
      if (!anchor || !atLiveEndRef.current || !document.hasFocus()) return false;
      return isLatestAnchorInReach(anchor, getScrollElement(), latestAtTopRef.current);
    },
    [atBottomAnchorRef, atLiveEndRef, contextRef, getScrollElement, latestAtTopRef]
  );

  const confirmScrolledAway = useCallback(
    (anchorInReach: boolean) => {
      if (!anchorInReach) setAtBottom(false);
    },
    [setAtBottom]
  );
  const settleScrolledAway = useDebounce(confirmScrolledAway, { wait: SCROLLED_AWAY_DELAY_MS });

  // The scroll area is the root, grown by the bottom threshold below its lower edge only (above
  // its upper edge when the anchor is at the top), so the anchor counts as reached while it is at
  // most that far beyond the visible rows.
  const getObserverOptions = useCallback(
    (): IntersectionObserverInit => ({
      root: getScrollElement() ?? null,
      rootMargin: latestAtTop
        ? `${TIMELINE_BOTTOM_THRESHOLD_PX}px 0px 0px`
        : `0px 0px ${TIMELINE_BOTTOM_THRESHOLD_PX}px`,
    }),
    [getScrollElement, latestAtTop]
  );
  const getAnchor = useCallback(() => atBottomAnchorRef.current, [atBottomAnchorRef]);

  const handleAnchorReports = (entries: IntersectionObserverEntry[]) => {
    const report = getIntersectionObserverEntry(atBottomAnchorRef.current, entries);
    if (!report) return;
    // Every report restarts the wait, and only the last one decides whether the reader left.
    settleScrolledAway(report.isIntersecting);
    if (!report.isIntersecting) return;
    setAtBottom(true);
    if (!atLiveEndRef.current || !document.hasFocus()) return;
    const context = contextRef.current;
    if (context.threadId) readThreadOnNextFrame(context, stillReading);
    else readRoomOnNextFrame(context, readUptoEventIdRef.current, stillReading);
  };
  const observer = useIntersectionObserver(handleAnchorReports, getObserverOptions, getAnchor);

  // Coming back to the live end while the anchor stayed within reach changes nothing the observer
  // watches, so it would stay silent: observing the anchor afresh makes it report again.
  useEffect(() => {
    const anchor = atBottomAnchorRef.current;
    if (!timelineAtLiveEnd || !observer || !anchor) return;
    observer.unobserve(anchor);
    observer.observe(anchor);
  }, [atBottomAnchorRef, observer, timelineAtLiveEnd]);

  const handleWindowFocus = useCallback(
    (inFocus: boolean) => {
      if (!inFocus || !atBottomRef.current) return;
      const context = contextRef.current;
      if (context.threadId) {
        if (atLiveEndRef.current) readThreadOnNextFrame(context, stillReading);
        return;
      }
      const marker = context.unreadInfo;
      if (!marker?.inLiveTimeline) {
        readRoomOnNextFrame(context, readUptoEventIdRef.current, stillReading);
        return;
      }
      // Go to the read marker, without a highlight. When it was already in view nothing moved,
      // so the reader has seen the rows after it.
      void context.handleOpenEvent(marker.readUptoEventId, false, (scrolled) => {
        if (!scrolled)
          readRoomOnNextFrame(contextRef.current, readUptoEventIdRef.current, stillReading);
      });
    },
    [atBottomRef, atLiveEndRef, contextRef, readUptoEventIdRef, stillReading]
  );
  useDocumentFocusChange(handleWindowFocus);

  // A thread that opens at its newest reply, or gets a reply while the reader sits at its
  // bottom with the window focused, is read.
  useEffect(() => {
    if (!threadId || !atBottom || !timelineAtLiveEnd || !document.hasFocus()) return;
    readThreadOnNextFrame(contextRef.current, stillReading);
  }, [
    atBottom,
    contextRef,
    stillReading,
    threadEventsLength,
    threadId,
    threadInitialRenderMode,
    threadTailLoaded,
    timelineAtLiveEnd,
  ]);

  const { roomId } = room;
  const handleMarkAsRead = useCallback(() => {
    if (threadId) {
      void markThreadAsRead(mx, roomId, threadId, hideActivity);
      return;
    }
    void markRoomAndThreadsAsRead(mx, roomId, hideActivity);
  }, [hideActivity, mx, roomId, threadId]);

  return { handleMarkAsRead };
};
