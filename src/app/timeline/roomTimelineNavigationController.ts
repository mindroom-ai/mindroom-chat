import {
  useCallback,
  type Dispatch,
  type MouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { Room } from 'matrix-js-sdk';
import type { NavigateOptions } from 'react-router-dom';
import { getInitialTimeline, type Timeline } from '../event-store/timeline/timelinePagination';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { countsRoomRows } from './roomTimelineClassicRows';

type ScrollToBottomState = {
  count: number;
  smooth: boolean;
};

type OpenEventHandler = (
  eventId: string,
  highlight?: boolean,
  onScroll?: (scrolled: boolean) => void
) => void | Promise<void>;

export type RoomTimelineNavigationControllerOptions = {
  /** Event the route focuses (a permalink), if any. */
  eventId?: string;
  handleOpenEvent: OpenEventHandler;
  hideMembershipEvents?: boolean;
  hideNickAvatarEvents?: boolean;
  ignoredUsersSet?: Set<string>;
  navigateRoom?: (roomId: string, eventId?: string, opts?: NavigateOptions) => void;
  navigateRoomThread: (
    roomId: string,
    threadId: string,
    eventId?: string,
    opts?: NavigateOptions
  ) => void;
  room: Room;
  prefetchDepth?: number;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  setTimeline?: Dispatch<SetStateAction<Timeline>>;
  showHiddenEvents?: boolean;
  /** Classic (Full) rooms render thread replies inline. */
  showThreadRepliesInRoom?: boolean;
  threadId?: string;
  /** Read marker of the room, for Jump to Unread. */
  readUptoEventId?: string;
};

/** Jump to Latest, Jump to Unread, and reply-quote navigation for the room or thread timeline. */
const EMPTY_IGNORED = new Set<string>();

export const useRoomTimelineNavigationController = (o: RoomTimelineNavigationControllerOptions) => {
  const { handleOpenEvent, readUptoEventId, scrollToBottomRef, setAtBottom } = o;
  const optsRef = useLatestRef(o);
  const handleJumpToLatest = useCallback((): void => {
    const cur = optsRef.current;
    const leavePermalink = Boolean(cur.eventId);
    if (!cur.threadId) {
      if (leavePermalink) cur.navigateRoom?.(cur.room.roomId, undefined, { replace: true });
      cur.setTimeline?.(
        countsRoomRows(
          getInitialTimeline(cur.room, cur.prefetchDepth ?? 0, {
            hideMembershipEvents: cur.hideMembershipEvents ?? false,
            hideNickAvatarEvents: cur.hideNickAvatarEvents ?? false,
            ignoredUsersSet: cur.ignoredUsersSet ?? EMPTY_IGNORED,
            showHiddenEvents: cur.showHiddenEvents ?? false,
            showThreadRepliesInRoom: cur.showThreadRepliesInRoom,
            threadId: undefined,
          })
        )
      );
    } else if (leavePermalink) {
      cur.navigateRoomThread(cur.room.roomId, cur.threadId, undefined, { replace: true });
    }
    // An instant jump: the newest rows replace the window, so there is nothing to animate.
    scrollToBottomRef.current = { count: scrollToBottomRef.current.count + 1, smooth: false };
    setAtBottom(true);
  }, [optsRef, scrollToBottomRef, setAtBottom]);

  /** Open the room at the reader's read marker. */
  const handleJumpToUnread = useCallback((): void => {
    if (!readUptoEventId) return;
    void handleOpenEvent(readUptoEventId, false);
  }, [handleOpenEvent, readUptoEventId]);

  /** Click on a reply quote: open the quoted event (`data-event-id` on the clicked element). */
  const handleOpenReply = useCallback(
    (evt: MouseEvent<HTMLElement>) => {
      const targetId = evt.currentTarget.getAttribute('data-event-id');
      if (!targetId) return;
      void handleOpenEvent(targetId, true);
    },
    [handleOpenEvent]
  );

  return {
    handleJumpToLatest,
    handleJumpToUnread,
    handleOpenReply,
  };
};
