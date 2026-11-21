import { useCallback, useMemo } from 'react';
import { EventTimeline, MatrixEvent, Room } from 'matrix-js-sdk';
import { StateEvent } from '../types/room';
import { useStateEventCallback } from './useStateEventCallback';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';

/** The room's live state event of `type` at `stateKey`, following changes; `null` skips it. */
export const useStateEvent = (
  room: Room,
  type: StateEvent | string,
  stateKey: string | null = ''
): MatrixEvent | undefined => {
  const [version, refresh] = useForceUpdate();

  const refreshOnMatch = useCallback(
    (event: MatrixEvent) => {
      const matches =
        stateKey !== null &&
        event.getRoomId() === room.roomId &&
        event.getType() === type &&
        event.getStateKey() === stateKey;
      if (matches) refresh();
    },
    [room.roomId, type, stateKey, refresh]
  );
  useStateEventCallback(room.client, refreshOnMatch);

  return useMemo(() => {
    void version;
    if (stateKey === null) return undefined;
    return (
      room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(type, stateKey) ??
      undefined
    );
  }, [room, type, stateKey, version]);
};
