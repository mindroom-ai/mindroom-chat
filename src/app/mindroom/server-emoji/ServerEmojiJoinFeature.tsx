import { useEffect } from 'react';
import { type IPushRule, type MatrixClient, PushRuleKind } from 'matrix-js-sdk';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { roomMuteRule } from '../../hooks/useRoomsNotificationPreferences';
import { useClientStartupContext } from '../../pages/client/ClientStartupContext';
import { getServerEmojiRoomAddress } from './serverEmojiConfig';
import { useServerEmojiRoom } from './useServerEmojiRoom';

// Per client, so a reconnect or a remount does not repeat what this session already tried.
const joinAttempts = new WeakMap<MatrixClient, Set<string>>();
const muteAttempts = new WeakMap<MatrixClient, Set<string>>();

const firstTime = (attempts: WeakMap<MatrixClient, Set<string>>, mx: MatrixClient, key: string) => {
  let seen = attempts.get(mx);
  if (!seen) {
    seen = new Set();
    attempts.set(mx, seen);
  }
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
};

const hasRoomOverride = (mx: MatrixClient, roomId: string): boolean => {
  const rules = mx.getAccountData('m.push_rules' as never)?.getContent() as
    | { global?: { override?: IPushRule[] } }
    | undefined;
  return rules?.global?.override?.some((rule) => rule.rule_id === roomId) ?? false;
};

/**
 * Account data naming the server emoji rooms this account muted once already. The mute happens
 * once per account, so a person who unmutes the room keeps it unmuted on every device.
 */
const MUTED_ROOMS_TYPE = 'io.mindroom.server_emoji_muted';

const readMutedRooms = (mx: MatrixClient): string[] => {
  const rooms: unknown = mx.getAccountData(MUTED_ROOMS_TYPE as never)?.getContent()?.rooms;
  return Array.isArray(rooms)
    ? rooms.filter((room): room is string => typeof room === 'string')
    : [];
};

const muteServerEmojiRoom = async (mx: MatrixClient, roomId: string) => {
  try {
    await mx.addPushRule('global', PushRuleKind.Override, roomId, roomMuteRule(roomId));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[server-emoji] could not mute the server emoji room', roomId, error);
    return;
  }
  try {
    const rooms = [...readMutedRooms(mx).filter((room) => room !== roomId), roomId];
    await mx.setAccountData(MUTED_ROOMS_TYPE as never, { rooms } as never);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[server-emoji] could not record that the room was muted', roomId, error);
  }
};

/**
 * Joins the emoji room the homeserver names in its well-known, so its packs are available to
 * everyone on the server, and mutes it once: packs are state, and nothing posted there should
 * notify. It waits for the first sync, since that may show the user is in the room already, and
 * since the account data that says the room was muted before comes with it.
 */
export function ServerEmojiJoinFeature() {
  const mx = useMatrixClient();
  const address = getServerEmojiRoomAddress(useAutoDiscoveryInfo());
  const room = useServerEmojiRoom();
  const { hasCompletedInitialSync } = useClientStartupContext();
  const roomId = room?.roomId;

  useEffect(() => {
    if (!address || roomId || !hasCompletedInitialSync) return;
    if (!firstTime(joinAttempts, mx, address)) return;
    mx.joinRoom(address).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[server-emoji] could not join the server emoji room', address, error);
    });
  }, [address, hasCompletedInitialSync, mx, roomId]);

  useEffect(() => {
    if (!roomId || !hasCompletedInitialSync || hasRoomOverride(mx, roomId)) return;
    if (readMutedRooms(mx).includes(roomId)) return;
    if (!firstTime(muteAttempts, mx, roomId)) return;
    void muteServerEmojiRoom(mx, roomId);
  }, [hasCompletedInitialSync, mx, roomId]);

  return null;
}
