import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Direction, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
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
  markShownThreadRepliesAsRead,
  markThreadAsRead,
} from '../notifications/readReceipts';
import type { ThreadInitialRenderMode } from '../event-store/threads/threadRenderUtils';
import { getEventTimeline } from '../event-store/timeline/timelinePagination';
import { getFirstLinkedTimeline } from '../event-store/timeline/linkedTimelines';
import {
  getEventElementById,
  TIMELINE_BOTTOM_THRESHOLD_PX,
} from '../event-store/timeline/timelineScrollUtils';
import { isLatestAnchorInReach } from './roomTimelineScroll';
import { waitForScrollQuiescence } from './scrollQuiescence';
import { useReaderSees } from './useReaderSees';
import { conversationOutOfSightAtom } from '../navigation/conversationCover';

/**
 * How long the bottom anchor must stay out of reach before the view counts as scrolled away, so a
 * short overshoot does not flash Jump to Latest.
 */
const SCROLLED_AWAY_DELAY_MS = 500;

/**
 * How many times the scroll area may come to rest before a jump to the read marker has reached
 * it; after that, the bottom observer reads the room once the reader scrolls down.
 */
const MARKER_JUMP_RESTS = 4;

/** Whether the row of `eventId` shows in the scroll area `area`. */
const rowShown = (area: HTMLElement | null | undefined, eventId: string): boolean => {
  const row = getEventElementById(area, eventId);
  if (!area || !row) return false;
  const view = area.getBoundingClientRect();
  const rect = row.getBoundingClientRect();
  return rect.bottom > view.top && rect.top < view.bottom;
};

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
  /**
   * The room's mounted rows, when they hold its threads' replies (the classic view): reading the
   * room reads the threads of those replies too.
   */
  classicRows?: () => MatrixEvent[];
  threadEventsLength: number;
  threadId?: string;
  threadInitialRenderMode: ThreadInitialRenderMode;
  /**
   * The events the open thread renders: reading it at its bottom reaches its newest reply there.
   * The thread model may know newer replies that are not rendered yet.
   */
  threadEvents: readonly MatrixEvent[];
  threadTailLoaded: boolean;
  timelineAtLiveEnd: boolean;
  unreadInfo?: { inLiveTimeline: boolean; readUptoEventId: string };
};

/** The values a read decision takes from the newest render. */
type ReadContext = Pick<
  ReadReceiptControllerOptions,
  | 'getScrollElement'
  | 'handleOpenEvent'
  | 'hideActivity'
  | 'mx'
  | 'room'
  | 'classicRows'
  | 'threadEventsLength'
  | 'threadId'
  | 'threadInitialRenderMode'
  | 'threadEvents'
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

/**
 * Reads the main timeline on the next frame, when the reader has seen its newest rows, and the
 * threads of the replies among them, each up to its newest reply there, as the open thread is.
 */
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
    const rows = context.classicRows?.() ?? [];
    if (rows.length > 0) void markShownThreadRepliesAsRead(mx, roomId, rows, hideActivity);
  });
};

/**
 * Reads the open thread once its opening scroll corrections settle, on the next frame: its
 * tail is loaded, it is past its loading render, and it has a row. It reads up to the reply it
 * renders last (`threadEvents`): the tail can count as loaded while only the root is rendered.
 */
const readThreadOnceLanded = (context: ReadContext, stillReading: StillReading): void => {
  const { hideActivity, mx, room, threadEvents, threadId } = context;
  if (!threadId || !context.threadTailLoaded) return;
  if (context.threadInitialRenderMode === 'loading' || context.threadEventsLength === 0) return;
  const { roomId } = room;
  const read = () => {
    requestAnimationFrame(() => {
      if (!stillReading(roomId, threadId)) return;
      void markThreadAsRead(mx, roomId, threadId, hideActivity, undefined, threadEvents);
    });
  };
  // The first frame can still measure rows and correct the opening position after its callbacks
  // run. Use the shared scroll-rest check so the receipt does not overtake that landing.
  const scrollArea = context.getScrollElement();
  if (scrollArea) void waitForScrollQuiescence(scrollArea).then(read);
  else read();
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
  classicRows,
  threadEventsLength,
  threadId,
  threadEvents,
  threadInitialRenderMode,
  threadTailLoaded,
  timelineAtLiveEnd,
  unreadInfo,
}: ReadReceiptControllerOptions): { handleMarkAsRead: () => void } => {
  const contextRef = useLatestRef<ReadContext>({
    getScrollElement,
    handleOpenEvent,
    hideActivity,
    mx,
    room,
    classicRows,
    threadEventsLength,
    threadId,
    threadEvents,
    threadInitialRenderMode,
    threadTailLoaded,
    unreadInfo,
  });

  // A phone's navigation drawer, or a plugin's cover, over the timeline hides it as a window
  // without the focus does; once it goes, the reader sees it again.
  const readerSees = useReaderSees();
  const outOfSight = useAtomValue(conversationOutOfSightAtom);

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
      if (!anchor || !atLiveEndRef.current || !readerSees()) return false;
      return isLatestAnchorInReach(anchor, getScrollElement(), latestAtTopRef.current);
    },
    [atBottomAnchorRef, atLiveEndRef, contextRef, getScrollElement, latestAtTopRef, readerSees]
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
    // Away from the live end (a message link's window) the anchor marks only the end of the rows
    // loaded there: Jump to Latest stays offered.
    if (!report.isIntersecting || !atLiveEndRef.current) return;
    setAtBottom(true);
    if (!readerSees()) return;
    const context = contextRef.current;
    if (context.threadId) readThreadOnceLanded(context, stillReading);
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
      if (!inFocus || !readerSees() || !atBottomRef.current) return;
      const context = contextRef.current;
      if (context.threadId) {
        if (atLiveEndRef.current) readThreadOnceLanded(context, stillReading);
        return;
      }
      const marker = context.unreadInfo;
      if (!marker?.inLiveTimeline) {
        readRoomOnNextFrame(context, readUptoEventIdRef.current, stillReading);
        return;
      }
      // Go to the read marker, without a highlight. When it was already in view nothing moved,
      // so the reader has seen the rows after it. A jump to it is measured once it has reached
      // the marker and the scroll area rests (a busy machine may let the area rest before the
      // jump moves it): the newest rows are seen when they are still within reach, and read by
      // the observer once the reader scrolls down to them when they are not.
      const read = () =>
        readRoomOnNextFrame(contextRef.current, readUptoEventIdRef.current, stillReading);
      const readOnceLanded = (rests: number) => {
        void waitForScrollQuiescence(getScrollElement() ?? null).then(() => {
          if (rowShown(getScrollElement(), marker.readUptoEventId)) read();
          else if (rests > 1) readOnceLanded(rests - 1);
        });
      };
      void context.handleOpenEvent(marker.readUptoEventId, false, (scrolled) => {
        if (!scrolled) read();
        else readOnceLanded(MARKER_JUMP_RESTS);
      });
    },
    [
      atBottomRef,
      atLiveEndRef,
      contextRef,
      getScrollElement,
      readerSees,
      readUptoEventIdRef,
      stillReading,
    ]
  );
  useDocumentFocusChange(handleWindowFocus);
  // The drawer or the cover going counts as coming back to the window.
  const coveredRef = useRef(outOfSight);
  useEffect(() => {
    const wasCovered = coveredRef.current;
    coveredRef.current = outOfSight;
    if (wasCovered && !outOfSight) handleWindowFocus(document.hasFocus());
  }, [handleWindowFocus, outOfSight]);

  // A thread that opens at its newest reply, or gets a reply while the reader sits at its
  // bottom with the window focused, is read.
  useEffect(() => {
    if (!threadId || !atBottom || !timelineAtLiveEnd || !readerSees()) return;
    readThreadOnceLanded(contextRef.current, stillReading);
  }, [
    atBottom,
    contextRef,
    readerSees,
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
