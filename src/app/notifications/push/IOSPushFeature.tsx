import { useEffect, useMemo, useState } from 'react';
import { KnownMembership } from 'matrix-js-sdk';
import { PushNotifications } from '@capacitor/push-notifications';
import { useNavigate } from 'react-router-dom';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { useClientConfig } from '../../config/useClientConfig';
import { useLatestRef } from '../../lib/hooks/useLatestRef';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { useActiveSession } from '../../matrix/session/useSessionStore';
import { setActiveSession, type StoredSession } from '../../matrix/session/sessions';
import { resolveSessionRestorePath } from '../../routes/sessionRouteRestore';
import { OPENED_FROM_OUTSIDE_STATE } from '../../routes/historyStack';
import { useClientStartupContext } from '../../matrix/ClientStartupContext';
import {
  cloudflareAccessAllowsPush,
  useCloudflareAccessSignInRequired,
} from '../../native/cloudflareAccess';
import {
  checkIOSPushPermission,
  disableIOSPushPusher,
  findIOSPushAccount,
  IOS_PUSH_ACCOUNT_KEY,
  isNativeIOSPlatform,
  registerIOSPush,
  resolveIOSPushConfig,
  upsertIOSPushPusher,
} from './iosPush';
import { useIOSPushEnabled } from './useIOSPushEnabled';

/**
 * On the iOS app, registers for APNs while push is on and sends the device token to the
 * homeserver as a pusher. A private server behind Cloudflare Access waits for its sign-in; a
 * server whose Access policy keeps pushes off has the pusher removed. A failed registration is
 * logged, and never turns the user's push setting off.
 */
export function NativeIOSPushFeature() {
  const mx = useMatrixClient();
  const clientConfig = useClientConfig();
  const sessionId = useActiveSession()?.sessionId;
  const language = useAppLanguageCode();
  const enabled = useIOSPushEnabled(sessionId);
  const homeserverUrl = mx.getHomeserverUrl();
  const signInRequired = useCloudflareAccessSignInRequired(homeserverUrl);
  const pushAllowed = cloudflareAccessAllowsPush(homeserverUrl);
  const pushConfig = resolveIOSPushConfig(clientConfig, sessionId, language);
  const configKey = pushConfig ? JSON.stringify(pushConfig) : undefined;
  const stableConfig = useMemo(
    () => (configKey ? pushConfig : undefined),
    // The config object is rebuilt each render; its content decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configKey]
  );
  const latest = useLatestRef({ enabled, signInRequired, pushAllowed });
  const native = isNativeIOSPlatform();

  // Tokens can arrive from a registration started earlier, so the listener lives as long as the client.
  useEffect(() => {
    if (!native || !stableConfig) return undefined;
    const handle = PushNotifications.addListener('registration', ({ value }) => {
      const state = latest.current;
      if (!state.pushAllowed) {
        disableIOSPushPusher(mx, stableConfig, sessionId).catch(() => undefined);
        return;
      }
      if (!state.enabled || state.signInRequired) return;
      upsertIOSPushPusher(mx, stableConfig, value, sessionId).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[ios-push] could not register the pusher', error);
      });
    });
    return () => {
      handle.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, [latest, mx, native, sessionId, stableConfig]);

  useEffect(() => {
    if (!native || !stableConfig) return;
    if (!pushAllowed) {
      disableIOSPushPusher(mx, stableConfig, sessionId).catch(() => undefined);
      return;
    }
    if (!enabled || signInRequired) return;
    let active = true;
    checkIOSPushPermission()
      .then((permission) => {
        if (active && permission === 'granted') return registerIOSPush();
        return undefined;
      })
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[ios-push] could not register with APNs', error);
      });
    return () => {
      active = false;
    };
  }, [enabled, mx, native, pushAllowed, sessionId, signInRequired, stableConfig]);

  return null;
}

type PushTarget = { roomId: string; eventId?: string; accountTag?: string };

const readPushTarget = (data: unknown): PushTarget | undefined => {
  if (!data || typeof data !== 'object') return undefined;
  const {
    room_id: roomId,
    event_id: eventId,
    [IOS_PUSH_ACCOUNT_KEY]: accountTag,
  } = data as Record<string, unknown>;
  if (typeof roomId !== 'string' || !roomId.startsWith('!')) return undefined;
  return {
    roomId,
    eventId: typeof eventId === 'string' ? eventId : undefined,
    accountTag: typeof accountTag === 'string' ? accountTag : undefined,
  };
};

/** The push that made another account active, until that account's pages mount and take it. */
let switchedPush: { sessionId: string; target: PushTarget } | undefined;

/** Makes the stored account a push is for active when it is not; returns it once it is. */
const switchToPushAccount = (
  target: PushTarget,
  activeSessionId: string | undefined
): StoredSession | undefined => {
  const owner = target.accountTag ? findIOSPushAccount(target.accountTag) : undefined;
  if (!owner || owner.sessionId === activeSessionId) return undefined;
  try {
    return setActiveSession(owner.sessionId) ? owner : undefined;
  } catch {
    return undefined;
  }
};

/**
 * On the iOS app, opens the message of a tapped push notification once the first sync is done.
 * A push of another signed-in account makes that account active and opens there. A push for a
 * room this account is not in (an account signed out, a room left) is ignored.
 */
export function NativeIOSPushOpenFeature() {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const sessionId = useActiveSession()?.sessionId;
  const { navigateRoom } = useRoomNavigate();
  const { hasCompletedInitialSync } = useClientStartupContext();
  const [target, setTarget] = useState<PushTarget>();
  const latest = useLatestRef({ navigate, sessionId });
  const native = isNativeIOSPlatform();

  useEffect(() => {
    if (!native) return undefined;
    const handle = PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const next = readPushTarget(action.notification.data);
      if (!next) return;
      const owner = switchToPushAccount(next, latest.current.sessionId);
      if (!owner) {
        setTarget(next);
        return;
      }
      // The switch mounts the account's pages anew, which open the push after its first sync.
      switchedPush = { sessionId: owner.sessionId, target: next };
      latest.current.navigate(resolveSessionRestorePath(owner.lastKnownPath));
    });
    return () => {
      handle.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, [latest, native]);

  useEffect(() => {
    if (!sessionId || switchedPush?.sessionId !== sessionId) return;
    setTarget(switchedPush.target);
    switchedPush = undefined;
  }, [sessionId]);

  useEffect(() => {
    if (!target || !hasCompletedInitialSync) return;
    setTarget(undefined);
    if (mx.getRoom(target.roomId)?.getMyMembership() !== KnownMembership.Join) return;
    // Its back buttons lead to its room and the room's list, not to where the app was left.
    navigateRoom(target.roomId, target.eventId, { state: OPENED_FROM_OUTSIDE_STATE });
  }, [hasCompletedInitialSync, mx, navigateRoom, target]);

  return null;
}
