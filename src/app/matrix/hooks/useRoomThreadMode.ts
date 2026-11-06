import { useCallback } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import {
  ROOM_THREAD_MODE_EVENT,
  getRoomThreadMode,
  type RoomThreadMode,
} from '../protocol/roomThreadMode';
import { useMatrixClient } from './useMatrixClient';
import { useStateEventCallback } from './useStateEventCallback';

/**
 * The room's `io.mindroom.thread_mode`, following changes while `watch` holds; without `watch` it
 * reads nothing and is undefined.
 */
export const useRoomThreadMode = (roomId: string, watch: boolean): RoomThreadMode | undefined => {
  const mx = useMatrixClient();
  const [, refresh] = useForceUpdate();
  const refreshOnMatch = useCallback(
    (event: MatrixEvent) => {
      if (
        watch &&
        event.getRoomId() === roomId &&
        event.getType() === ROOM_THREAD_MODE_EVENT &&
        event.getStateKey() === ''
      ) {
        refresh();
      }
    },
    [refresh, roomId, watch]
  );
  useStateEventCallback(mx, refreshOnMatch);
  return watch ? getRoomThreadMode(mx.getRoom(roomId)) : undefined;
};
