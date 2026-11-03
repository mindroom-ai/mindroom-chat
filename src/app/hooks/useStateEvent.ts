import { useCallback, useMemo } from 'react';
import { EventTimeline, MatrixEvent, Room } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';
import { useStateEventCallback } from './useStateEventCallback';
import { useForceUpdate } from './useForceUpdate';

/** The room's live state event of `type` at `stateKey`, following changes. */
export const useStateEvent = (
  room: Room,
  type: StateEvent | string,
  stateKey = ''
): MatrixEvent | undefined => {
  const [version, refresh] = useForceUpdate();



      (event: MatrixEvent) => {
        if (
          event.getRoomId() === room.roomId &&
          event.getType() === type &&
          event.getStateKey() === stateKey
        ) {
          refresh();
        }
      },
      [room.roomId, type, stateKey, refresh]
    )
  );

  return useMemo(() => {
    void version;
    return (
      room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(type, stateKey) ??
      undefined
    );
  }, [room, type, stateKey, version]);
};
