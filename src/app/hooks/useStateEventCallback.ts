import { useEffect } from 'react';
import { MatrixClient, MatrixEvent, RoomState, RoomStateEvent } from 'matrix-js-sdk';

/**
 * Receives one state event as the client applies it: the event, the room state it changed and
 * the event it replaced, if any (`RoomStateEvent.Events`).
 */
export type StateEventCallback = (
  event: MatrixEvent,
  state: RoomState,
  replacedEvent: MatrixEvent | null
) => void;

/**
 * Runs `callback` for each state event the client applies, in any of its rooms; filter by room
 * and type inside it. A new callback identity subscribes again, so memoize it.
 */
export function useStateEventCallback(mx: MatrixClient, callback: StateEventCallback): void {
  useEffect(() => {
    mx.on(RoomStateEvent.Events, callback);
    return () => {
      mx.removeListener(RoomStateEvent.Events, callback);
    };
  }, [callback, mx]);
}
