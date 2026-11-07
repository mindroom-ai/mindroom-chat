import { useCallback, useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { Method, type MatrixClient } from 'matrix-js-sdk';
import { TYPING_TIMEOUT_MS } from '../matrix/state/typingMembers';
import { conversationCoveredAtom } from '../navigation/conversationCover';

/**
 * A function the composer calls with `true` while the user types and `false` when they stop.
 * Sends a typing notice when typing starts, a stop notice when it ends, and a stop notice when
 * the started one would expire, so other clients never show a stale indicator. With `hidden`
 * (the Hide Typing & Read Receipts setting) no typing notice goes out; one sent before the
 * setting was turned on still gets its stop. While a plugin's cover hides the conversation none
 * goes out either, and one already out stops as the cover shows.
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

  const stop = useCallback(() => {
    if (!typingRef.current) return;
    typingRef.current = false;
    clearExpiry();
    send(false);
  }, [clearExpiry, send]);

  const covered = useAtomValue(conversationCoveredAtom);
  useEffect(() => {
    if (covered) stop();
  }, [covered, stop]);

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
  // does not run. The stop goes out as the page goes, in a request that outlives it. It must
  // start before the handler returns: `authedRequest` first awaits the token refresher, and by
  // then the page can be gone, so this builds the authorized request itself.
  useEffect(() => {
    const stopOnPageHide = () => {
      clearExpiry();
      if (!typingRef.current) return;
      typingRef.current = false;
      const userId = mx.getUserId();
      const accessToken = mx.getAccessToken();
      if (!userId || !accessToken) return;
      const path = `/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(userId)}`;
      mx.http
        .requestOtherUrl(
          Method.Put,
          mx.http.getUrl(path),
          { typing: false },
          { keepAlive: true, headers: { Authorization: `Bearer ${accessToken}` } }
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
      if (typing && !hidden && !covered) {
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
      stop();
    },
    [clearExpiry, covered, hidden, send, stop]
  );
};
