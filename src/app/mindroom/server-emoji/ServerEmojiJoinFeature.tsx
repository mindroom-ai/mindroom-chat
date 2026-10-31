import { useEffect, useRef } from 'react';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientStartupContext } from '../../pages/client/ClientStartupContext';
import { useServerEmojiRoomAddress } from './serverEmojiConfig';
import { useServerEmojiRoom } from './useServerEmojiRoom';

/**
 * Joins the room the homeserver names for server emoji, at most once per session and address.
 * A refused join (banned, or an alias that names nothing) is logged and not retried.
 */
export function ServerEmojiJoinFeature() {
  const mx = useMatrixClient();
  const address = useServerEmojiRoomAddress();
  const room = useServerEmojiRoom();
  // A cached shell can mount before the first sync shows a room joined from another device.
  const { hasCompletedInitialSync } = useClientStartupContext();
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    if (!address || room || !hasCompletedInitialSync || attempted.current.has(address)) return;
    attempted.current.add(address);
    mx.joinRoom(address).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[server-emoji] could not join the server emoji room', address, error);
    });
  }, [mx, address, room, hasCompletedInitialSync]);

  return null;
}
