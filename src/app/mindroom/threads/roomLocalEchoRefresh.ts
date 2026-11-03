import { useEffect, useRef } from 'react';
import { RoomEvent, type MatrixEvent, type Room, type RoomEventHandlerMap } from 'matrix-js-sdk';

export type LocalEchoRefreshMeta = {
  /** The echo was just added; later calls report a status change (sent, failed, cancelled). */
  initial: boolean;
};

/** Call `onRefresh` whenever a local echo of `room` is added or changes its send status. */
export const useRoomLocalEchoRefresh = (
  room: Room,
  onRefresh: (mEvent: MatrixEvent, meta: LocalEchoRefreshMeta) => void
): void => {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const handleLocalEchoUpdated: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (
      mEvent,
      eventRoom,
      oldEventId,
      oldStatus
    ) => {
      if (eventRoom?.roomId !== room.roomId) return;
      onRefreshRef.current(mEvent, {
        initial: oldEventId === undefined && oldStatus === undefined,
      });
    };
    room.on(RoomEvent.LocalEchoUpdated, handleLocalEchoUpdated);
    return () => {
      room.removeListener(RoomEvent.LocalEchoUpdated, handleLocalEchoUpdated);
    };
  }, [room]);
};
