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










  );






            if (atLiveEndRef.current) {
              tryAutoMarkThreadAsRead();
            }
            return;
          }













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
