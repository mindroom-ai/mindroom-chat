import {
  useCallback,
  useEffect,
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
import { getEventTimeline, getFirstLinkedTimeline } from '../event-store/timeline/timelinePagination';
import { TIMELINE_BOTTOM_THRESHOLD_PX } from '../event-store/timeline/timelineScrollUtils';

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

/** Reads the main timeline on the next frame, when the reader has seen its newest rows. */
const readRoomOnNextFrame = (context: ReadContext, markerEventId: string | undefined): void => {
  const { hideActivity, mx, room } = context;
  if (!markerReachesLiveTimeline(room, markerEventId)) return;
  const { roomId } = room;
  requestAnimationFrame(() => {
    void markMainTimelineAsRead(mx, roomId, hideActivity);
  });
};

/**
 * Reads the open thread on the next frame, once its newest replies are loaded and rendered: its
 * tail is loaded, it is past its loading render, and it has a row.
 */
const readThreadOnNextFrame = (context: ReadContext): void => {
  const { hideActivity, mx, room, threadId } = context;
  if (!threadId || !context.threadTailLoaded) return;
  if (context.threadInitialRenderMode === 'loading' || context.threadEventsLength === 0) return;
  const { roomId } = room;
  requestAnimationFrame(() => {
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

  const confirmScrolledAway = useCallback(
    (anchorInReach: boolean) => {
      if (!anchorInReach) setAtBottom(false);
    },
    [setAtBottom]
  );
  const settleScrolledAway = useDebounce(confirmScrolledAway, { wait: SCROLLED_AWAY_DELAY_MS });

  // The scroll area is the root, grown by the bottom threshold below its lower edge only, so the
  // anchor counts as reached while it is at most that far below the visible rows.
  const getObserverOptions = useCallback(
    (): IntersectionObserverInit => ({
      root: getScrollElement() ?? null,
      rootMargin: `0px 0px ${TIMELINE_BOTTOM_THRESHOLD_PX}px`,
    }),
    [getScrollElement]
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
    if (context.threadId) readThreadOnNextFrame(context);
    else readRoomOnNextFrame(context, readUptoEventIdRef.current);
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
        if (atLiveEndRef.current) readThreadOnNextFrame(context);
        return;
      }
      const marker = context.unreadInfo;
      if (!marker?.inLiveTimeline) {
        readRoomOnNextFrame(context, readUptoEventIdRef.current);
        return;
      }
      // Go to the read marker, without a highlight. When it was already in view nothing moved,
      // so the reader has seen the rows after it.
      void context.handleOpenEvent(marker.readUptoEventId, false, (scrolled) => {
        if (!scrolled) readRoomOnNextFrame(contextRef.current, readUptoEventIdRef.current);
      });
    },
    [atBottomRef, atLiveEndRef, contextRef, readUptoEventIdRef]
  );
  useDocumentFocusChange(handleWindowFocus);

  // A thread that opens at its newest reply, or gets a reply while the reader sits at its
  // bottom with the window focused, is read.
  useEffect(() => {
    if (!threadId || !atBottom || !timelineAtLiveEnd || !document.hasFocus()) return;
    readThreadOnNextFrame(contextRef.current);
  }, [
    atBottom,
    contextRef,
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
