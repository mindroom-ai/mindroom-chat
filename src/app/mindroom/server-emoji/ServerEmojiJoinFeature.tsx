import { useEffect } from 'react';
import { ConditionKind, type IPushRule, type MatrixClient, PushRuleKind } from 'matrix-js-sdk';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { useMatrixClient } from '../../hooks/useMatrixClient';
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
 * Joins the emoji room the homeserver names in its well-known, so its packs are available to
 * everyone on the server, and mutes it: packs are state, and nothing posted there should notify.
 * It waits for the first sync, since that may show the user is in the room already.
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
    if (!roomId || hasRoomOverride(mx, roomId)) return;
    if (!firstTime(muteAttempts, mx, roomId)) return;


      actions: [],
    }).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[server-emoji] could not mute the server emoji room', roomId, error);
    });
  }, [mx, roomId]);

  return null;
}
