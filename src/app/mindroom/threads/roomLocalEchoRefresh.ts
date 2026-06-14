import { useEffect } from 'react';
import { Room, RoomEvent, RoomEventHandlerMap } from 'matrix-js-sdk';

export const useRoomLocalEchoRefresh = (room: Room, onRefresh: () => void) => {
  useEffect(() => {
    const handleLocalEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (
      _event,
      eventRoom
    ) => {
      if (eventRoom.roomId !== room.roomId) return;
      onRefresh();
    };

    room.on(RoomEvent.LocalEchoUpdated, handleLocalEcho);
    return () => {
      room.removeListener(RoomEvent.LocalEchoUpdated, handleLocalEcho);
    };
  }, [room, onRefresh]);
};
