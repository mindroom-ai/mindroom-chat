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

type Fanout = { callbacks: Set<StateEventCallback>; dispatch: StateEventCallback };

// Every sidebar row, header and timeline row may follow some state event; one client listener
// per client passes each event to all of them, so the client's listener count stays the same
// however many rows are mounted.
const fanouts = new WeakMap<MatrixClient, Fanout>();

const subscribe = (mx: MatrixClient, callback: StateEventCallback): (() => void) => {
  let fanout = fanouts.get(mx);
  if (!fanout) {
    const callbacks = new Set<StateEventCallback>();
    const dispatch: StateEventCallback = (event, state, replacedEvent) => {
      // A callback may subscribe or unsubscribe others while it runs.
      Array.from(callbacks).forEach((each) => {
        if (callbacks.has(each)) each(event, state, replacedEvent);
      });
    };
    fanout = { callbacks, dispatch };
    fanouts.set(mx, fanout);
    mx.on(RoomStateEvent.Events, dispatch);
  }
  const { callbacks, dispatch } = fanout;
  callbacks.add(callback);
  return () => {
    callbacks.delete(callback);
    if (callbacks.size > 0 || fanouts.get(mx) !== fanout) return;
    fanouts.delete(mx);
    mx.removeListener(RoomStateEvent.Events, dispatch);
  };
};

/**
 * Runs `callback` for each state event the client applies, in any of its rooms; filter by room
 * and type inside it. A new callback identity subscribes again, so memoize it.
 */
export function useStateEventCallback(mx: MatrixClient, callback: StateEventCallback): void {
  useEffect(() => subscribe(mx, callback), [callback, mx]);
}
