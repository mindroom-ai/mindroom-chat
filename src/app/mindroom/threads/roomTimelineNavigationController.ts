import {
  useCallback,
  type Dispatch,
  type MouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { Room } from 'matrix-js-sdk';
import type { NavigateOptions } from 'react-router-dom';
import { getInitialTimeline, type Timeline } from './timelinePagination';

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
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  ignoredUsersSet: Set<string>;
  navigateRoom: (roomId: string, eventId?: string, opts?: NavigateOptions) => void;
  navigateRoomThread: (
    roomId: string,
    threadId: string,
    eventId?: string,
    opts?: NavigateOptions
  ) => void;
  room: Room;
  prefetchDepth: number;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  showHiddenEvents: boolean;
  /** Classic (Full) rooms render thread replies inline. */
  showThreadRepliesInRoom?: boolean;
  threadId?: string;
  /** Read marker of the room, for Jump to Unread. */
  readUptoEventId?: string;
};

/** Jump to Latest, Jump to Unread, and reply-quote navigation for the room or thread timeline. */
export const useRoomTimelineNavigationController = ({
  eventId,
  handleOpenEvent,
  hideMembershipEvents,
  hideNickAvatarEvents,
  ignoredUsersSet,
  navigateRoom,
  navigateRoomThread,
  room,
  prefetchDepth,
  scrollToBottomRef,
  setAtBottom,
  setTimeline,
  showHiddenEvents,
  showThreadRepliesInRoom,
  threadId,
  readUptoEventId,
}: RoomTimelineNavigationControllerOptions) => {
  const pinToBottom = useCallback(() => {
    // An instant jump: the newest rows replace the window, so there is nothing to animate.
    const { count } = scrollToBottomRef.current;
    scrollToBottomRef.current = { count: count + 1, smooth: false };
    setAtBottom(true);
  }, [scrollToBottomRef, setAtBottom]);

  /**
   * Show the newest messages. A thread already renders its whole reply list, so it only drops a
   * permalink and pins to the bottom, synchronously; the room swaps back to its live window.
   */
  const handleJumpToLatest = useCallback((): void => {
    // A permalink left in the address would focus its event again on the next render.
    const leavePermalink = Boolean(eventId);
    if (!threadId) {
      if (leavePermalink) navigateRoom(room.roomId, undefined, { replace: true });
      const filters = {
        hideMembershipEvents,
        hideNickAvatarEvents,
        ignoredUsersSet,
        showHiddenEvents,
        showThreadRepliesInRoom,
        threadId: undefined,
      };
      setTimeline(getInitialTimeline(room, prefetchDepth, filters));
    } else if (leavePermalink) {
      navigateRoomThread(room.roomId, threadId, undefined, { replace: true });
    }
    pinToBottom();
  }, [
    eventId,
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    navigateRoom,
    navigateRoomThread,
    pinToBottom,
    prefetchDepth,
    room,
    setTimeline,
    showHiddenEvents,
    showThreadRepliesInRoom,
    threadId,
  ]);

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
