import { useCallback } from 'react';
import type { Room } from 'matrix-js-sdk';
import type { ThreadForkRef } from '../../event-store/threads/threadFork';
import { navigateToRoomThread } from '../../navigation/threadNavigation';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { currentHistoryLocation } from '../../routes/historyStack';
import { withSearchParam } from '../../routes/pathUtils';

/**
 * Opens a fork draft at `ref` in `targetRoomId ?? room.roomId`:
 * - Same-room (`sourceRoomId === destRoomId`): `?threadId=<thread>&forkAt=<event>` with the event
 *   in the room path so the thread loads around it.
 * - Cross-room (`sourceRoomId !== destRoomId`): `<destRoomPath>?forkRoom=<sourceRoomId>&forkThread=<thread>&forkAt=<event>`
 *   leaving `threadId` unset.
 * In both cases, its back button returns to where the fork was started.
 */
export const useStartThreadFork = (
  room: Room
): ((ref: ThreadForkRef, targetRoomId?: string) => void) => {
  const { navigatePath, roomPath } = useRoomNavigate();
  return useCallback(
    (ref: ThreadForkRef, targetRoomId?: string) => {
      const sourceRoomId = ref.roomId ?? room.roomId;
      const destRoomId = targetRoomId ?? room.roomId;
      const isCrossRoom = sourceRoomId !== destRoomId;
      navigateToRoomThread({
        roomId: destRoomId,
        threadId: ref.threadId,
        eventId: isCrossRoom ? undefined : ref.eventId,
        navigateRoomThreadDirect: (roomId, threadId, eventId, opts) =>
          navigatePath(
            isCrossRoom
              ? withSearchParam(roomPath(roomId), {
                  forkRoom: sourceRoomId,
                  forkThread: threadId,
                  forkAt: ref.eventId,
                })
              : withSearchParam(roomPath(roomId, eventId), { threadId, forkAt: ref.eventId }),
            opts
          ),
        location: currentHistoryLocation(),
      });
    },
    [navigatePath, room.roomId, roomPath]
  );
};
