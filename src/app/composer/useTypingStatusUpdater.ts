import { useCallback, useEffect, useRef } from 'react';
import { Method, type MatrixClient } from 'matrix-js-sdk';
import { TYPING_TIMEOUT_MS } from '../matrix/state/typingMembers';

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

  // Leaving the page (a reload, a link, a closed tab) unmounts nothing, so the effect above
  // does not run. The stop goes out as the page goes, in a request that outlives it.
  useEffect(() => {
    const stopOnPageHide = () => {
      clearExpiry();
      if (!typingRef.current) return;
      typingRef.current = false;
      const userId = mx.getUserId();
      if (!userId || mx.isGuest()) return;
      mx.http
        .authedRequest(
          Method.Put,
          `/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(userId)}`,
          undefined,
          { typing: false },
          { keepAlive: true }
        )
        .catch(() => undefined);
    };
    // No page, no pagehide (a test renderer without a DOM).
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('pagehide', stopOnPageHide);
    return () => window.removeEventListener('pagehide', stopOnPageHide);
  }, [clearExpiry, mx, roomId]);

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
