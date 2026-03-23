import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { RoomEvent } from 'matrix-js-sdk/lib/models/room';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { useEffect, useMemo } from 'react';
import { useForceUpdate } from '../../hooks/useForceUpdate';
import { getValidThreadRootEvent } from './threadUtils';

export const useThreadRootEvent = (room: Room, threadRootId?: string): MatrixEvent | undefined => {
  const [version, forceUpdate] = useForceUpdate();
  const roomEvents = room as Room & {
    on: (event: string, listener: (...args: any[]) => void) => void;
    removeListener: (event: string, listener: (...args: any[]) => void) => void;
  };

  useEffect(() => {
    if (!threadRootId) return undefined;

    const handleThreadChange = (thread?: { id?: string }) => {
      if (!thread || thread.id === threadRootId) {
        forceUpdate();
      }
    };

    const handleTimelineEvent = (event: MatrixEvent) => {
      if (event.getId() === threadRootId || event.threadRootId === threadRootId) {
        forceUpdate();
      }
    };

    roomEvents.on(ThreadEvent.New, handleThreadChange);
    roomEvents.on(ThreadEvent.Update, handleThreadChange);
    roomEvents.on(ThreadEvent.NewReply, handleThreadChange);
    roomEvents.on(ThreadEvent.Delete, handleThreadChange);
    roomEvents.on(RoomEvent.Timeline, handleTimelineEvent);

    return () => {
      roomEvents.removeListener(ThreadEvent.New, handleThreadChange);
      roomEvents.removeListener(ThreadEvent.Update, handleThreadChange);
      roomEvents.removeListener(ThreadEvent.NewReply, handleThreadChange);
      roomEvents.removeListener(ThreadEvent.Delete, handleThreadChange);
      roomEvents.removeListener(RoomEvent.Timeline, handleTimelineEvent);
    };
  }, [forceUpdate, roomEvents, threadRootId]);

  return useMemo(() => getValidThreadRootEvent(room, threadRootId), [room, threadRootId, version]);
};
