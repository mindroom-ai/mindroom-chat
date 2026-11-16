import { useCallback } from 'react';
import type { Room } from 'matrix-js-sdk';
import type { ThreadForkRef } from '../../event-store/threads/threadFork';
import { navigateToRoomThread } from '../../navigation/threadNavigation';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { currentHistoryLocation } from '../../routes/historyStack';
import { withSearchParam } from '../../routes/pathUtils';

/**
 * Opens the fork draft at `ref` in the room's thread column: its thread up to the fork point, and a
 * composer whose first message starts the fork (`?threadId=<thread>&forkAt=<event>`). As for any
 * thread opened from a page, its back button returns to that page.
 */
export const useStartThreadFork = (room: Room): ((ref: ThreadForkRef) => void) => {
  const { navigatePath, roomPath } = useRoomNavigate();
  return useCallback(
    (ref: ThreadForkRef) =>
      navigateToRoomThread({
        roomId: room.roomId,
        threadId: ref.threadId,
        navigateRoomThreadDirect: (roomId, threadId, eventId, opts) =>
          navigatePath(
            withSearchParam(roomPath(roomId, eventId), { threadId, forkAt: ref.eventId }),
            opts
          ),
        location: currentHistoryLocation(),
      }),
    [navigatePath, room.roomId, roomPath]
  );
};
