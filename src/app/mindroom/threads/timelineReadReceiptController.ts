import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Direction } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
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
import { getEventTimeline, getFirstLinkedTimeline } from './timelinePagination';
import type { ThreadInitialRenderMode } from './threadRenderUtils';
import { getThreadUnread } from './roomThreadList';
import { isThreadReplyEvent } from './threadUtils';

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
  compactCardId,
  getScrollElement,
  handleOpenEvent,
  hideActivity,
  mx,
  onScreenEventsRef,
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
  /** Set while the compact view is shown: its newest card, which keys a try; null for none. */
  compactCardId?: string | null;
  getScrollElement: () => HTMLElement | null | undefined;
  handleOpenEvent: OpenEventHandler;
  hideActivity: boolean;
  mx: MatrixClient;
  /** The rows on screen, including the thread replies classic shows inline. */
  onScreenEventsRef: MutableRefObject<() => MatrixEvent[]>;
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
  const markShownAsRead = useCallback(() => {
    markMainTimelineAsRead(mx, room.roomId, hideActivity);
    // A main receipt reads no thread replies, so each unread thread shown inline gets its own.
    const replies = onScreenEventsRef
      .current()
      .filter((event) => isThreadReplyEvent(event.getId() ?? '', event.threadRootId));
    const shownIds = new Set(replies.map((event) => event.getId()));
    const isShown = (event: MatrixEvent) => shownIds.has(event.getId());
    new Set(replies.map((event) => event.threadRootId!)).forEach((rootId) => {
      const thread = room.getThread(rootId);
      if (thread && getThreadUnread(thread, mx.getSafeUserId())) {
        markThreadAsRead(mx, room.roomId, rootId, hideActivity, isShown);
      }
    });
  }, [hideActivity, mx, onScreenEventsRef, room]);

  const tryAutoMarkAsRead = useCallback(() => {
    const readUptoEventId = readUptoEventIdRef.current;
    if (!readUptoEventId) {
      requestAnimationFrame(markShownAsRead);
      return;
    }
    const evtTimeline = getEventTimeline(room, readUptoEventId);
    const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
    if (latestTimeline === room.getLiveTimeline()) {
      requestAnimationFrame(markShownAsRead);
    }
  }, [markShownAsRead, readUptoEventIdRef, room]);

  // The compact view has no bottom or mark-read control: seeing it reads its newest card.
  const lastCompactTargetRef = useRef<string>();
  const markCompactCardsAsRead = useCallback(() => {
    if (!compactCardId) return;
    requestAnimationFrame(() => {
      const onScreen = new Set(onScreenEventsRef.current().map((event) => event.getId()));
      const isOnScreen = (event: MatrixEvent) => onScreen.has(event.getId());
      markMainTimelineAsRead(mx, room.roomId, hideActivity, isOnScreen, lastCompactTargetRef);
    });
  }, [compactCardId, hideActivity, mx, onScreenEventsRef, room.roomId]);

  useEffect(() => {
    if (document.hasFocus()) markCompactCardsAsRead();
  }, [compactCardId, markCompactCardsAsRead]);

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
  ]);

  const debounceSetAtBottom = useDebounce(
    useCallback(
      (entry: IntersectionObserverEntry) => {
        if (!entry.isIntersecting) setAtBottom(false);
      },
      [setAtBottom]
    ),
    { wait: 1000 }
  );

  useIntersectionObserver(
    useCallback(
      (entries) => {
        const target = atBottomAnchorRef.current;
        if (!target) return;
        const targetEntry = getIntersectionObserverEntry(target, entries);
        if (targetEntry) debounceSetAtBottom(targetEntry);
        if (targetEntry?.isIntersecting && atLiveEndRef.current) {
          setAtBottom(true);
          if (document.hasFocus()) {
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
      () => ({
        root: getScrollElement(),
        rootMargin: '100px',
      }),
      [getScrollElement]
    ),
    useCallback(() => atBottomAnchorRef.current, [atBottomAnchorRef])
  );

  useDocumentFocusChange(
    useCallback(
      (inFocus) => {
        if (inFocus && compactCardId !== undefined) {
          markCompactCardsAsRead();
          return;
        }
        if (inFocus && atBottomRef.current) {
          if (threadId) {
            if (atLiveEndRef.current) {
              tryAutoMarkThreadAsRead();
            }
            return;
          }
          if (unreadInfo?.inLiveTimeline) {
            handleOpenEvent(unreadInfo.readUptoEventId, false, (scrolled) => {
              // The unread event is already in view, so mark as read immediately.
              if (!scrolled) {
                tryAutoMarkAsRead();
              }
            });
            return;
          }
          tryAutoMarkAsRead();
        }
      },
      [
        atBottomRef,
        atLiveEndRef,
        compactCardId,
        handleOpenEvent,
        markCompactCardsAsRead,
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
