import { useEffect, useReducer, useRef, type RefObject } from 'react';
import { MatrixEventEvent, type MatrixEvent } from 'matrix-js-sdk';
import { isUnreadableYet } from '../../matrix/decryptionWaits';

const REPAINT_EVENTS = [MatrixEventEvent.Decrypted, MatrixEventEvent.Replaced] as const;

/**
 * Re-render the host when an encrypted row on screen decrypts or gets new content from an edit,
 * or when an edit already on a row decrypts.
 * An encrypted edit, such as each step of an agent reply streaming in an encrypted room, replaces
 * its target only once decrypted, after the timeline change that brought it; an edit in a room
 * without encryption replaces its target before that change. Listens to exactly the events the
 * last render showed: new rows subscribe, rows that left the screen unsubscribe.
 */
export const useDecryptionRepaint = (renderedEventsRef: RefObject<MatrixEvent[]>): number => {
  const [decryptions, repaint] = useReducer((value: number) => value + 1, 0);
  const subscribedRef = useRef(new Set<MatrixEvent>());
  useEffect(() => {
    const subscribed = subscribedRef.current;
    const current = new Set<MatrixEvent>();
    (renderedEventsRef.current ?? []).forEach((event) => {
      if (event.isEncrypted?.()) current.add(event);
      // The SDK can put an edit on the event before it decrypts the edit (one the server bundles
      // with the event); the row shows what it says once it decrypts.
      const replacement = event.replacingEvent?.();
      if (replacement && isUnreadableYet(replacement)) current.add(replacement);
    });
    subscribed.forEach((event) => {
      if (current.has(event)) return;
      REPAINT_EVENTS.forEach((name) => event.removeListener(name, repaint));
      subscribed.delete(event);
    });
    current.forEach((event) => {
      // Rows can hold stand-ins for events that never decrypt and emit nothing.
      if (subscribed.has(event) || typeof event.on !== 'function') return;
      REPAINT_EVENTS.forEach((name) => event.on(name, repaint));
      subscribed.add(event);
    });
  });
  useEffect(
    () => () => {
      subscribedRef.current.forEach((event) =>
        REPAINT_EVENTS.forEach((name) => event.removeListener(name, repaint))
      );
      subscribedRef.current.clear();
    },
    []
  );
  return decryptions;
};
