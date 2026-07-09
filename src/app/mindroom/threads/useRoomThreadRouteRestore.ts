import { useCallback, useEffect } from 'react';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { removeRecentThread } from '../recent-threads/recentThreads';
import type { RoomViewMode } from './roomViewMode';

type UseRoomThreadRouteRestoreOptions = {
  eventId?: string;
  roomId: string;
  threadId?: string;
  viewMode: RoomViewMode;
};

export const useRoomThreadRouteRestore = ({
  eventId,
  roomId,
  threadId,
  viewMode,
}: UseRoomThreadRouteRestoreOptions): ((failedThreadId: string) => void) => {
  const { navigateRoom } = useRoomNavigate();

  useEffect(() => {
    if (viewMode !== 'classic' || !threadId) return;

    navigateRoom(roomId, eventId ?? threadId, { replace: true });
  }, [eventId, navigateRoom, roomId, threadId, viewMode]);

  return useCallback(
    (failedThreadId: string) => {
      removeRecentThread(roomId, failedThreadId);
    },
    [roomId]
  );
};
