import { useCallback, useEffect, useState } from 'react';
import { Method, type MatrixClient } from 'matrix-js-sdk';
import { TYPING_TIMEOUT_MS } from '../matrix/state/typingMembers';
import { useConversationHidden } from '../navigation/conversationView';

// The composers of a room that type now, per account. A room's typing notice is the room's, not
// one composer's: it starts with the first of them and stops with the last, or as it expires.
type RoomTyping = { composers: Set<object>; expiry?: ReturnType<typeof setTimeout> };
const typingRooms = new WeakMap<MatrixClient, Map<string, RoomTyping>>();

/** Ends the room's notice for all its composers; true when one was on. */
const endRoomTyping = (mx: MatrixClient, roomId: string): boolean => {
  const rooms = typingRooms.get(mx);
  const typing = rooms?.get(roomId);
  if (!typing) return false;
  clearTimeout(typing.expiry);
  rooms?.delete(roomId);
  return true;
};

/**
 * A function the composer calls with `true` while the user types and `false` when they stop.
 * Sends a typing notice when typing starts, a stop notice when it ends, and a stop notice when
 * the started one would expire, so other clients never show a stale indicator. Composers of one
 * room share its notice (the room page's and a thread view's): it stays on while any of them
 * types. With `hidden` (the Hide Typing & Read Receipts setting) no typing notice goes out; one
 * sent before the setting was turned on still gets its stop. While the conversation is hidden,
 * under a plugin's cover or behind a side panel, none goes out either, and one already out stops
 * as it hides.
 */
export const useTypingStatusUpdater = (
  mx: MatrixClient,
  roomId: string,
  hidden = false
): ((typing: boolean) => void) => {
  const [composer] = useState(() => ({}));

  const send = useCallback(
    (typing: boolean) => {
      mx.sendTyping(roomId, typing, TYPING_TIMEOUT_MS).catch(() => undefined);
    },
    [mx, roomId]
  );

  const stop = useCallback(() => {
    const typing = typingRooms.get(mx)?.get(roomId);
    if (!typing?.composers.delete(composer) || typing.composers.size > 0) return;
    endRoomTyping(mx, roomId);
    send(false);
  }, [composer, mx, roomId, send]);

  const conversationHidden = useConversationHidden();
  useEffect(() => {
    if (conversationHidden) stop();
  }, [conversationHidden, stop]);

  // Leaving the room, or the account, while typing ends the notice there at once; otherwise
  // the others would see this person typing until it expires.
  useEffect(() => stop, [stop]);

  // Leaving the page (a reload, a link, a closed tab) unmounts nothing, so the effect above
  // does not run. The stop goes out as the page goes, in a request that outlives it. It must
  // start before the handler returns: `authedRequest` first awaits the token refresher, and by
  // then the page can be gone, so this builds the authorized request itself.
  useEffect(() => {
    const stopOnPageHide = () => {
      if (!endRoomTyping(mx, roomId)) return;
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
  }, [mx, roomId]);

  return useCallback(
    (typing: boolean) => {
      if (typing && !hidden && !conversationHidden) {
        const rooms = typingRooms.get(mx) ?? new Map<string, RoomTyping>();
        typingRooms.set(mx, rooms);
        const room = rooms.get(roomId) ?? { composers: new Set() };
        rooms.set(roomId, room);
        if (room.composers.has(composer)) return;
        room.composers.add(composer);
        if (room.composers.size > 1) return;
        send(true);
        room.expiry = setTimeout(() => {
          if (endRoomTyping(mx, roomId)) send(false);
        }, TYPING_TIMEOUT_MS);
        return;
      }
      // The setting is the account's: it ends the room's notice, whichever composer is typing.
      if (hidden && endRoomTyping(mx, roomId)) {
        send(false);
        return;
      }
      stop();
    },
    [composer, conversationHidden, hidden, mx, roomId, send, stop]
  );
};
