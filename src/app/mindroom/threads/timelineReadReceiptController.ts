import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Direction } from 'matrix-js-sdk';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../hooks/useIntersectionObserver';
import { useDebounce } from '../../hooks/useDebounce';
import { useDocumentFocusChange } from '../../hooks/useDocumentFocusChange';
import {
  markMainTimelineAsRead,
  markRoomAndThreadsAsRead,
  markThreadAsRead,
} from '../notifications/readReceipts';
import {
  getEventTimeline,
  getFirstLinkedTimeline,
} from './timelinePagination';
import type { ThreadInitialRenderMode } from './threadRenderUtils';

type RoomUnreadInfoLike = {
  inLiveTimeline: boolean;
  readUptoEventId: string;
};

type OpenEventHandler = (
  eventId: string,
  highlight?: boolean,
  onScroll?: (scrolled: boolean) => void
) => void | Promise<void>;

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
}: {
  atBottom: boolean;
  atBottomAnchorRef: MutableRefObject<HTMLElement | null>;
  atBottomRef: MutableRefObject<boolean>;
  atLiveEndRef: MutableRefObject<boolean>;
  getScrollElement: () => HTMLElement | null | undefined;
  handleOpenEvent: OpenEventHandler;
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
  unreadInfo?: RoomUnreadInfoLike;
}) => {
  const tryAutoMarkAsRead = useCallback(() => {
    // Mark the main timeline read only when the read marker lies on the chain that reaches
    // the live end; a marker in older, unlinked history means the newest rows were not seen.
    const markerEventId = readUptoEventIdRef.current;
    const markerTimeline = markerEventId ? getEventTimeline(room, markerEventId) : undefined;
    const markerChainEnd =
      markerTimeline && getFirstLinkedTimeline(markerTimeline, Direction.Forward);
    if (!markerEventId || markerChainEnd === room.getLiveTimeline()) {
      // Wait a frame so the rows that brought the reader to the bottom have painted.
      requestAnimationFrame(() => void markMainTimelineAsRead(mx, room.roomId, hideActivity));
    }
  }, [hideActivity, mx, readUptoEventIdRef, room]);

  const tryAutoMarkThreadAsRead = useCallback(() => {
    if (
      !threadId ||
      threadTailLoaded === false ||
      threadInitialRenderMode === 'loading' ||
      threadEventsLength === 0
    ) {
      return;
    }

    requestAnimationFrame(() => markThreadAsRead(mx, room.roomId, threadId, hideActivity));
  }, [
    hideActivity,
    mx,
    room.roomId,
    threadEventsLength,
    threadId,
    threadInitialRenderMode,
    threadTailLoaded,






    { wait: 500 }
  );

  useIntersectionObserver(
    useCallback(
      (entries: IntersectionObserverEntry[]) => {
        const anchorEntry = getIntersectionObserverEntry(atBottomAnchorRef.current, entries);
        if (!anchorEntry) return;
        // Leaving the bottom settles after a pause, so a short bounce does not flicker it.
        debounceSetAtBottom(anchorEntry);
        if (anchorEntry.isIntersecting) {
          setAtBottom(true);
          if (atLiveEndRef.current && document.hasFocus()) {
            if (threadId) {
              tryAutoMarkThreadAsRead();
            } else {
              tryAutoMarkAsRead();
            }
          }
        }
      },
      [
        atBottomAnchorRef,
        atLiveEndRef,
        debounceSetAtBottom,
        setAtBottom,
        threadId,
        tryAutoMarkAsRead,
        tryAutoMarkThreadAsRead,
      ]
    ),
    useCallback(
      (): IntersectionObserverInit => ({
        root: getScrollElement() ?? null,
        rootMargin: '0px 0px 96px 0px',
      }),
      [getScrollElement]
    ),
    useCallback(() => atBottomAnchorRef.current, [atBottomAnchorRef])
  );

  useDocumentFocusChange(
    useCallback(
      (inFocus: boolean) => {
        if (inFocus && atBottomRef.current) {
          if (threadId) {
            if (atLiveEndRef.current) {
              tryAutoMarkThreadAsRead();
            }
            return;
          }
          const marker = unreadInfo?.inLiveTimeline ? unreadInfo.readUptoEventId : undefined;
          if (!marker) {
            tryAutoMarkAsRead();
            return;
          }
          // Show the reader where they left off; when that row is already on screen there is
          // nothing above it they missed, so the room counts as read.
          void handleOpenEvent(marker, false, (scrolled) => {
            if (!scrolled) tryAutoMarkAsRead();
          });
        }
      },
      [
        atBottomRef,
        atLiveEndRef,
        handleOpenEvent,
        threadId,
        tryAutoMarkAsRead,
        tryAutoMarkThreadAsRead,
        unreadInfo,
      ]
    )
  );

  useEffect(() => {
    if (
      !threadId ||
      !atBottom ||
      !timelineAtLiveEnd ||
      !threadTailLoaded ||
      threadInitialRenderMode === 'loading' ||
      threadEventsLength === 0 ||
      !document.hasFocus()
    ) {
      return;
    }

    tryAutoMarkThreadAsRead();
  }, [
    atBottom,
    threadEventsLength,
    threadId,
    threadInitialRenderMode,
    threadTailLoaded,
    timelineAtLiveEnd,
    tryAutoMarkThreadAsRead,
  ]);

  const handleMarkAsRead = useCallback(() => {
    if (threadId) {
      markThreadAsRead(mx, room.roomId, threadId, hideActivity);
      return;
    }
    markRoomAndThreadsAsRead(mx, room.roomId, hideActivity);
  }, [hideActivity, mx, room.roomId, threadId]);

  return { handleMarkAsRead };
};
