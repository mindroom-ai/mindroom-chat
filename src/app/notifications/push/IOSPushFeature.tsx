import { useEffect, useMemo, useRef, useState } from 'react';
import { KnownMembership, RoomMemberEvent, RoomStateEvent, type MatrixClient } from 'matrix-js-sdk';
import { App as NativeApp } from '@capacitor/app';
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
  hasCloudflareAccess,
  useCloudflareAccessSignInRequired,
} from '../../native/cloudflareAccess';
import {
  clearAllNativeNotificationAccounts,
  clearNativeNotificationAccount,
  syncNativeNotificationAccount,
  syncNativeNotificationAvatars,
  type NativeNotificationAvatarEntry,
} from '../../native/nativeNotifications';
import {
  checkIOSPushPermission,
  disableIOSPushPusher,
  findIOSPushAccount,
  getOrCreateIOSPushProfileTag,
  getStoredIOSPushProfileTag,
  IOS_PUSH_ACCOUNT_KEY,
  isNativeIOSPlatform,
  registerIOSPush,
  resolveIOSPushConfig,
  upsertIOSPushPusher,
  type NativePushPermission,
} from './iosPush';
import { useIOSPushEnabled } from './useIOSPushEnabled';

const MAX_NATIVE_NOTIFICATION_AVATARS = 200;
const NATIVE_AVATAR_SYNC_DEBOUNCE_MS = 1000;

/**
 * The avatars of the other members of the joined rooms, one entry for each room a member is in:
 * a member can have another avatar in each room. Rooms come by their latest activity and members
 * with an avatar before those without, so the cap keeps what the next notifications will show.
 *
 * Only the member's own avatar in the room counts. The SDK's `User.avatarUrl` is whichever room's
 * membership it saw last, so it would put one room's avatar on a room where the member has none.
 */
export const collectJoinedMemberAvatars = (mx: MatrixClient): NativeNotificationAvatarEntry[] => {
  const ownUserId = mx.getUserId?.();
  const rooms = (mx.getRooms?.() ?? [])
    .filter((room) => room.getMyMembership?.() === 'join')
    .map((room) => ({ room, lastActive: room.getLastActiveTimestamp?.() ?? 0 }))
    .sort((a, b) => b.lastActive - a.lastActive || a.room.roomId.localeCompare(b.room.roomId));
  const withAvatar: NativeNotificationAvatarEntry[] = [];
  const withoutAvatar: NativeNotificationAvatarEntry[] = [];

  for (const { room } of rooms) {
    // Once avatars alone fill the cap, a less active room adds nothing that is kept.
    if (withAvatar.length >= MAX_NATIVE_NOTIFICATION_AVATARS) break;
    const members =
      room.getJoinedMembers?.() ??
      room.getMembers?.().filter((member) => member.membership === KnownMembership.Join) ??
      [];
    const sortedMembers = [...members].sort((a, b) => a.userId.localeCompare(b.userId));
    for (const member of sortedMembers) {
      const sender = member.userId;
      if (!sender || sender === ownUserId) continue;
      const rawMxc = member.getMxcAvatarUrl?.() ?? null;
      const mxcUrl = typeof rawMxc === 'string' && rawMxc.startsWith('mxc://') ? rawMxc : null;
      (mxcUrl === null ? withoutAvatar : withAvatar).push({ roomId: room.roomId, sender, mxcUrl });
    }
  }

  return [...withAvatar, ...withoutAvatar].slice(0, MAX_NATIVE_NOTIFICATION_AVATARS);
};

/**
 * On the iOS app, registers for APNs while push is on and sends the device token to the
 * homeserver as a pusher. A private server behind Cloudflare Access waits for its sign-in; a
 * server whose Access policy keeps pushes off has the pusher removed. A failed registration is
 * logged, and never turns the user's push setting off.
 *
 * While the account's pushes name their sender and iOS allows notifications, it also gives the
 * notification extension what it needs to show the sender's avatar (the account and the avatars
 * of its room members), and takes that away again once either no longer holds.
 */
export function NativeIOSPushFeature() {
  const mx = useMatrixClient();
  const clientConfig = useClientConfig();
  const activeSession = useActiveSession();
  const sessionId = activeSession?.sessionId;
  const language = useAppLanguageCode();
  const enabled = useIOSPushEnabled(sessionId);
  const { hasCompletedInitialSync } = useClientStartupContext();
  const homeserverUrl = mx.getHomeserverUrl();
  const userId = mx.getUserId?.() ?? undefined;
  const signInRequired = useCloudflareAccessSignInRequired(homeserverUrl);
  const pushAllowed = cloudflareAccessAllowsPush(homeserverUrl);
  const native = isNativeIOSPlatform();
  // Only the iOS app reads it: resolving it makes the account's push tag, which browsers never send.
  const pushConfig = native ? resolveIOSPushConfig(clientConfig, sessionId, language) : undefined;
  const configKey = pushConfig ? JSON.stringify(pushConfig) : undefined;
  const stableConfig = useMemo(
    () => (configKey ? pushConfig : undefined),
    // The config object is rebuilt each render; its content decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configKey]
  );
  const [permission, setPermission] = useState<NativePushPermission>();
  // What a rich notification needs of the app itself: pushes that name their sender (an
  // `event_id_only` push does not), turned on here and allowed by the server.
  const richPushConfigured =
    native && stableConfig?.format === 'full' && enabled && pushAllowed && Boolean(sessionId);
  // Only then does the notification extension get the account and its members' avatars.
  const richPushEligible = richPushConfigured && !signInRequired && permission === 'granted';
  // Prefer `activeSession.accessToken` so rotated tokens published to the session store sync
  // immediately without waiting for `matrix-js-sdk` to update its internal field.
  const notificationAccessToken =
    homeserverUrl && !hasCloudflareAccess(homeserverUrl)
      ? activeSession?.accessToken ?? mx.getAccessToken?.() ?? undefined
      : undefined;
  const latest = useLatestRef({ enabled, signInRequired, pushAllowed });
  const lastAvatarSnapshotRef = useRef<string | undefined>(undefined);

  // iOS grants and withdraws the permission outside the app's own state: in its prompt, and in
  // Settings while the app is in the background. Either way the app becomes active again after,
  // so it is read then, and whenever something else that push depends on changes.
  useEffect(() => {
    if (!native) return undefined;
    let latestCheck = 0;
    const refreshPermission = () => {
      latestCheck += 1;
      const check = latestCheck;
      checkIOSPushPermission().then(
        (next) => {
          // An answer that a later check overtook is out of date.
          if (check === latestCheck) setPermission(next);
        },
        () => undefined
      );
    };
    refreshPermission();
    const handle = NativeApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) refreshPermission();
    });
    return () => {
      latestCheck += 1;
      handle.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, [enabled, native, pushAllowed, sessionId, signInRequired, stableConfig]);

  // Sync account metadata (and token when not behind Cloudflare Access) for the Notification
  // Service Extension while rich notifications can show; clear native state once they cannot.
  useEffect(() => {
    if (!native || !sessionId) return;
    if (!richPushEligible) {
      // The first permission check is still out: nothing says yet that the account must go.
      if (richPushConfigured && permission === undefined) return;
      lastAvatarSnapshotRef.current = undefined;
      // iOS denies notifications to the whole app: what every account shares goes, also the
      // accounts that are not active. Anything else that ends it concerns this account alone.
      if (permission === 'denied') {
        clearAllNativeNotificationAccounts().catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[ios-push] could not clear the notification accounts', error);
        });
        return;
      }
      const storedTag = getStoredIOSPushProfileTag(sessionId);
      if (storedTag) {
        clearNativeNotificationAccount(storedTag).catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[ios-push] could not clear notification account', error);
        });
      }
      return;
    }
    if (!homeserverUrl || !userId) return;
    // Always the per-session tag that `mindroom_account` carries in APNs payloads, never a
    // deployment-level `pushConfig.profileTag`.
    const accountTag = getOrCreateIOSPushProfileTag(sessionId);
    // Sign-out removes the Keychain record of the stored tag. A tag that storage did not keep
    // (full, or blocked) would leave a record that nothing can find again.
    if (getStoredIOSPushProfileTag(sessionId) !== accountTag) return;
    syncNativeNotificationAccount({
      accountTag,
      homeserverUrl,
      userId,
      ...(notificationAccessToken ? { accessToken: notificationAccessToken } : {}),
    }).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[ios-push] could not sync notification account', error);
    });
  }, [
    homeserverUrl,
    native,
    notificationAccessToken,
    permission,
    richPushConfigured,
    richPushEligible,
    sessionId,
    userId,
  ]);

  // Pre-warm sender avatars in the shared App Group cache once initial sync completes.
  useEffect(() => {
    if (!richPushEligible || !hasCompletedInitialSync || !userId) return undefined;
    // The effect above stored the tag it synced the account under; without one there is no
    // account to keep avatars for.
    const accountTag = getStoredIOSPushProfileTag(sessionId);
    if (!accountTag) return undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const syncAvatarsNow = () => {
      const avatars = collectJoinedMemberAvatars(mx);
      const snapshot = JSON.stringify({ accountTag, avatars });
      if (snapshot === lastAvatarSnapshotRef.current) return;
      lastAvatarSnapshotRef.current = snapshot;
      syncNativeNotificationAvatars({ accountTag, avatars }).catch((error: unknown) => {
        if (lastAvatarSnapshotRef.current === snapshot) {
          lastAvatarSnapshotRef.current = undefined;
        }
        // eslint-disable-next-line no-console
        console.warn('[ios-push] could not sync notification avatars', error);
      });
    };

    const scheduleSync = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(syncAvatarsNow, NATIVE_AVATAR_SYNC_DEBOUNCE_MS);
    };

    syncAvatarsNow();
    mx.on?.(RoomMemberEvent.Membership, scheduleSync);
    mx.on?.(RoomStateEvent.Members, scheduleSync);

    return () => {
      if (timer !== undefined) clearTimeout(timer);
      mx.removeListener?.(RoomMemberEvent.Membership, scheduleSync);
      mx.removeListener?.(RoomStateEvent.Members, scheduleSync);
    };
  }, [hasCompletedInitialSync, mx, richPushEligible, sessionId, userId]);

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
    mindroom_ring: ring,
  } = data as Record<string, unknown>;
  if (typeof roomId !== 'string' || !roomId.startsWith('!')) return undefined;
  const isRing = ring !== null && typeof ring === 'object';
  return {
    roomId,
    // A tapped call ring opens the room (as the ring card's Open does) rather than jumping to the
    // ring event; the existing call UI then decides whether the call is still live.
    eventId: !isRing && typeof eventId === 'string' ? eventId : undefined,
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
      void latest.current.navigate(resolveSessionRestorePath(owner.lastKnownPath));
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
    // A thread's back button leads to the thread's room, not to where the app was left.
    navigateRoom(target.roomId, target.eventId, { state: OPENED_FROM_OUTSIDE_STATE });
  }, [hasCompletedInitialSync, mx, navigateRoom, target]);

  return null;
}
