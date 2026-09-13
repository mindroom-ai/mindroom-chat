import {
  useCallback,
  type Dispatch,
  type MouseEventHandler,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { NavigateOptions } from 'react-router-dom';
import type { Room } from 'matrix-js-sdk';
import { bumpRecentThread } from '../recent-threads/recentThreads';
import { scrollToBottom } from '../../utils/dom';
import type { OpenRoomEventHandler } from './roomEventOpenController';
import type { ScrollToBottomState } from './roomFocusScrollController';
import { getInitialTimeline, type Timeline } from './timelinePagination';

type NavigateRoom = (roomId: string, eventId?: string, opts?: NavigateOptions) => void;

type NavigateRoomThread = (
  roomId: string,
  threadId: string,
  eventId?: string,
  opts?: NavigateOptions
) => void;

type RoomUnreadInfoLike = {
  readUptoEventId: string;
};

type RefreshLatestThreadSlice = (threadId: string) => Promise<boolean>;

export type RoomTimelineNavigationControllerOptions = {
  eventId?: string;
  handleOpenEvent: OpenRoomEventHandler;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  ignoredUsersSet: Set<string>;
  navigateRoom: NavigateRoom;
  navigateRoomThread: NavigateRoomThread;
  refreshLatestThreadSlice: RefreshLatestThreadSlice;
  room: Room;
  safePaginationLimit: number;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  scrollToBottomRef: MutableRefObject<ScrollToBottomState>;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  showHiddenEvents: boolean;
  threadId?: string;
  threadIdRef: MutableRefObject<string | undefined>;
  unreadInfo?: RoomUnreadInfoLike;
};

export const useRoomTimelineNavigationController = ({
  eventId,
  handleOpenEvent,
  hideMembershipEvents,
  hideNickAvatarEvents,
  ignoredUsersSet,
  navigateRoom,
  navigateRoomThread,
  refreshLatestThreadSlice,
  room,
  safePaginationLimit,
  scrollRef,
  scrollToBottomRef,
  setAtBottom,
  setTimeline,
  showHiddenEvents,
  threadId,
  threadIdRef,
  unreadInfo,
}: RoomTimelineNavigationControllerOptions) => {
  const handleJumpToLatest = useCallback(async () => {
    if (threadId) {
      if (eventId) {
        navigateRoomThread(room.roomId, threadId, undefined, { replace: true });
      }

      const didPaginateToLatest = await refreshLatestThreadSlice(threadId);
      if (threadIdRef.current !== threadId) return;
      if (didPaginateToLatest) {
        scrollToBottomRef.current.count += 1;
        scrollToBottomRef.current.smooth = false;
        setAtBottom(true);
        return;
      }

      const scrollEl = scrollRef.current;
      if (scrollEl) {
        scrollToBottom(scrollEl, 'instant');
        setAtBottom(true);
      }
      return;
    }

    if (eventId) {
      navigateRoom(room.roomId, undefined, { replace: true });
    }
    setTimeline(
      getInitialTimeline(room, safePaginationLimit, {
        threadId,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
      })
    );
    scrollToBottomRef.current.count += 1;
    scrollToBottomRef.current.smooth = false;
  }, [
    eventId,
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    navigateRoom,
    navigateRoomThread,
    refreshLatestThreadSlice,
    room,
    safePaginationLimit,
    scrollRef,
    scrollToBottomRef,
    setAtBottom,
    setTimeline,
    showHiddenEvents,
    threadId,
    threadIdRef,
  ]);

  const handleJumpToUnread = useCallback(() => {
    if (unreadInfo?.readUptoEventId) {
      void handleOpenEvent(unreadInfo.readUptoEventId, false);
    }
  }, [handleOpenEvent, unreadInfo]);

  const handleOpenReply: MouseEventHandler = useCallback(
    (evt) => {
      const threadRootId = evt.currentTarget.getAttribute('data-thread-root-id');
      const recentThreadSummaryText =
        evt.currentTarget.getAttribute('data-thread-summary')?.trim() || undefined;
      if (threadRootId) {
        bumpRecentThread(room.roomId, threadRootId, undefined, recentThreadSummaryText);
        navigateRoomThread(room.roomId, threadRootId);
        return;
      }
      const targetId = evt.currentTarget.getAttribute('data-event-id');
      if (!targetId) return;
      void handleOpenEvent(targetId);
    },
    [handleOpenEvent, navigateRoomThread, room.roomId]
  );

  const handleOpenCompactThread = useCallback(
    (threadRootId: string, recentThreadSummaryText?: string) => {
      bumpRecentThread(room.roomId, threadRootId, undefined, recentThreadSummaryText);
      navigateRoomThread(room.roomId, threadRootId);
    },
    [navigateRoomThread, room.roomId]
  );

  return {
    handleJumpToLatest,
    handleJumpToUnread,
    handleOpenCompactThread,
    handleOpenReply,
  };
};
