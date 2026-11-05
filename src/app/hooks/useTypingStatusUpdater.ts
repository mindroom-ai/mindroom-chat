import { useCallback, useEffect, useRef } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { TYPING_TIMEOUT_MS } from '../state/typingMembers';

/**
 * A function the composer calls with `true` while the user types and `false` when they stop.
 * Sends a typing notice when typing starts, a stop notice when it ends, and a stop notice when
 * the started one would expire, so other clients never show a stale indicator. With `hidden`
 * (the Hide Typing & Read Receipts setting) no typing notice goes out; one sent before the
 * setting was turned on still gets its stop.
 */
export const useTypingStatusUpdater = (
  mx: MatrixClient,
  roomId: string,
  hidden = false
): ((typing: boolean) => void) => {
  const typingRef = useRef(false);
  const expiryRef = useRef<ReturnType<typeof setTimeout>>();

  const send = useCallback(
    (typing: boolean) => {
      mx.sendTyping(roomId, typing, TYPING_TIMEOUT_MS).catch(() => undefined);
    },
    [mx, roomId]
  );

  const clearExpiry = useCallback(() => {
    if (expiryRef.current === undefined) return;
    clearTimeout(expiryRef.current);
    expiryRef.current = undefined;
  }, []);

  // Leaving the room, or the account, while typing ends the notice there at once; otherwise
  // the others would see this person typing until it expires.
  useEffect(
    () => () => {
      clearExpiry();
      if (!typingRef.current) return;
      typingRef.current = false;
      send(false);
    },
    [clearExpiry, send]
  );

  return useCallback(
    (typing: boolean) => {
      if (typing && !hidden) {
        if (typingRef.current) return;
        typingRef.current = true;
        send(true);
        clearExpiry();
        expiryRef.current = setTimeout(() => {
          expiryRef.current = undefined;
          if (!typingRef.current) return;
          typingRef.current = false;
          send(false);
        }, TYPING_TIMEOUT_MS);
        return;
      }
      if (!typingRef.current) return;
      typingRef.current = false;
      clearExpiry();
      send(false);
    },
    [hidden, send, clearExpiry]
  );
};
