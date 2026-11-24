import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { KnownMembership, RoomMemberEvent, RoomStateEvent, type MatrixClient } from 'matrix-js-sdk';
import { App as NativeApp } from '@capacitor/app';
import { PushNotifications } from '@capacitor/push-notifications';
import { useNavigate } from 'react-router-dom';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { useClientConfig } from '../../config/useClientConfig';
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
  isNativeNotificationsAvailable,
  syncNativeNotificationAccount,
} from '../../native/nativeNotifications';
import {
  checkIOSPushPermission,
  disableIOSPushPusher,
  findIOSPushAccount,
  getOrCreateIOSPushProfileTag,
  getStoredIOSPushProfileTag,
  IOS_PUSH_ACCOUNT_KEY,
  isNativeIOSPlatform,
  reconcileIOSPushNativeState,
  registerIOSPush,
  resolveEffectiveIOSPushFormat,
  resolveIOSPushConfig,
  upsertIOSPushPusher,
  type NativePushPermission,
} from './iosPush';
import {
  collectJoinedMemberAvatars,
  prewarmNativeNotificationAvatars,
} from './nativeNotificationAvatars';
import { useIOSPushEnabled } from './useIOSPushEnabled';

export { collectJoinedMemberAvatars } from './nativeNotificationAvatars';

const NATIVE_AVATAR_SYNC_DEBOUNCE_MS = 1000;

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
  // The notification extension is part of the iPhone and iPad app only: the Mac app registers
  // for pushes as they do, but has no extension to share accounts and avatars with.
  const nativeNotificationsAvailable = isNativeNotificationsAvailable();
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
  // `event_id_only` push does not, and a server behind Cloudflare Access gets no other), turned
  // on here and allowed by the server.
  const richPushConfigured =
    nativeNotificationsAvailable &&
    stableConfig !== undefined &&
    resolveEffectiveIOSPushFormat(stableConfig, homeserverUrl) === 'full' &&
    enabled &&
    pushAllowed &&
    Boolean(sessionId);
  // Only then does the notification extension get the account and its members' avatars.
  const richPushEligible = richPushConfigured && !signInRequired && permission === 'granted';
  const lastAvatarSnapshotRef = useRef<string | undefined>(undefined);
  // The tag under which the app has stored the account, once it has: it keeps avatars only for
  // an account it knows.
  const [sharedAccountTag, setSharedAccountTag] = useState<string>();
  // Counts the times the app became active while the account was not shared although it should
  // be, as after the app could not store it: each is another try.
  const [foregroundTick, setForegroundTick] = useState(0);
  const onAppForeground = useEffectEvent((activeSessionId: string | undefined) => {
    if (richPushEligible && sharedAccountTag !== getStoredIOSPushProfileTag(activeSessionId)) {
      setForegroundTick((tick) => tick + 1);
    }
  });
  const onPushRegistration = useEffectEvent(
    (
      client: MatrixClient,
      config: NonNullable<typeof stableConfig>,
      activeSessionId: string | undefined,
      value: string
    ) => {
      if (!pushAllowed) {
        disableIOSPushPusher(client, config, activeSessionId).catch(() => undefined);
        return;
      }
      if (!enabled || signInRequired) return;
      upsertIOSPushPusher(client, config, value, activeSessionId).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[ios-push] could not register the pusher', error);
      });
    }
  );

  // iOS grants and withdraws the permission outside the app's own state: in its prompt, and in
  // Settings while the app is in the background. Either way the app becomes active again after,
  // so it is read then, and whenever something else that push depends on changes.
  useEffect(() => {
    if (!nativeNotificationsAvailable) return undefined;
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
      if (!isActive) return;
      refreshPermission();
      onAppForeground(sessionId);
    });
    return () => {
      latestCheck += 1;
      handle.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, [enabled, nativeNotificationsAvailable, pushAllowed, sessionId, signInRequired, stableConfig]);

  // Share the account with the Notification Service Extension while rich notifications can
  // show, and take away what may no longer be shared once they cannot.
  useEffect(() => {
    if (!nativeNotificationsAvailable || !sessionId) return undefined;
    if (!richPushEligible) {
      // The first permission check is still out: nothing says yet that the account must go.
      if (richPushConfigured && permission === undefined) return undefined;
      lastAvatarSnapshotRef.current = undefined;
      setSharedAccountTag(undefined);
      // Never rejects. What it leaves is removed when the app next becomes active
      // (useReconcileNativeNotifications).
      void reconcileIOSPushNativeState({ clientConfig, permission });
      return undefined;
    }
    if (!userId) return undefined;
    // Always the per-session tag that `mindroom_account` carries in APNs payloads, never a
    // deployment-level `pushConfig.profileTag`.
    const accountTag = getOrCreateIOSPushProfileTag(sessionId);
    // Only the accounts whose tag is stored are kept when the shared accounts are reconciled. A
    // tag that storage did not keep (full, or blocked) would be shared now and removed then.
    if (getStoredIOSPushProfileTag(sessionId) !== accountTag) return undefined;

    let cancelled = false;
    const shareAccount = async () => {
      // First the accounts that may no longer share go, the other accounts on the device among
      // them. The app takes both changes in the order they are asked for.
      await reconcileIOSPushNativeState({ clientConfig, permission: 'granted' });
      // Asked for now, the account would be stored after the reconcile of a later effect.
      if (cancelled) return;
      await syncNativeNotificationAccount({ accountTag, userId });
      if (!cancelled) setSharedAccountTag(accountTag);
    };
    shareAccount().catch((error: unknown) => {
      // Tried again when the app next becomes active.
      // eslint-disable-next-line no-console
      console.warn('[ios-push] could not sync notification account', error);
    });
    return () => {
      cancelled = true;
    };
  }, [
    clientConfig,
    foregroundTick,
    nativeNotificationsAvailable,
    permission,
    richPushConfigured,
    richPushEligible,
    sessionId,
    userId,
  ]);

  // Pre-warm sender avatars in the shared App Group cache once initial sync completes.
  useEffect(() => {
    if (!richPushEligible || !hasCompletedInitialSync || !userId) return undefined;
    // Only for the account that the effect above has stored in the app, which keeps no avatars
    // of an account it does not know.
    const accountTag = sharedAccountTag;
    if (!accountTag || accountTag !== getStoredIOSPushProfileTag(sessionId)) return undefined;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The downloads of the latest list, while they are under way.
    let downloads: AbortController | undefined;
    const syncAvatarsNow = (force = false) => {
      const avatars = collectJoinedMemberAvatars(mx);
      const snapshot = JSON.stringify({ accountTag, avatars });
      if (!force && snapshot === lastAvatarSnapshotRef.current) return;
      lastAvatarSnapshotRef.current = snapshot;
      // The app stores nothing for an earlier list than its latest.
      downloads?.abort();
      const controller = new AbortController();
      downloads = controller;
      prewarmNativeNotificationAvatars(mx, accountTag, avatars, controller.signal)
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          if (lastAvatarSnapshotRef.current === snapshot) {
            lastAvatarSnapshotRef.current = undefined;
          }
          // eslint-disable-next-line no-console
          console.warn('[ios-push] could not sync notification avatars', error);
        })
        .finally(() => {
          if (downloads === controller) downloads = undefined;
        });
    };

    const scheduleSync = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => syncAvatarsNow(), NATIVE_AVATAR_SYNC_DEBOUNCE_MS);
    };

    const appStateHandle = NativeApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      // Confirm permission is still granted before re-syncing (it may have been revoked in iOS Settings).
      checkIOSPushPermission().then(
        (next) => {
          if (!disposed && next === 'granted') syncAvatarsNow(true);
        },
        () => undefined
      );
    });
    const handleOnline = () => {
      syncAvatarsNow(true);
    };

    syncAvatarsNow();
    mx.on?.(RoomMemberEvent.Membership, scheduleSync);
    mx.on?.(RoomStateEvent.Members, scheduleSync);
    if (typeof window !== 'undefined') window.addEventListener('online', handleOnline);

    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      if (downloads) {
        // Cut off: the same list is sent again, and what is still missing downloaded.
        downloads.abort();
        lastAvatarSnapshotRef.current = undefined;
      }
      appStateHandle.then((listener) => listener.remove()).catch(() => undefined);
      if (typeof window !== 'undefined') window.removeEventListener('online', handleOnline);
      mx.removeListener?.(RoomMemberEvent.Membership, scheduleSync);
      mx.removeListener?.(RoomStateEvent.Members, scheduleSync);
    };
  }, [hasCompletedInitialSync, mx, richPushEligible, sessionId, sharedAccountTag, userId]);

  // Tokens can arrive from a registration started earlier, so the listener lives as long as the client.
  useEffect(() => {
    if (!native || !stableConfig) return undefined;
    const handle = PushNotifications.addListener('registration', ({ value }) => {
      onPushRegistration(mx, stableConfig, sessionId, value);
    });
    return () => {
      handle.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, [mx, native, sessionId, stableConfig]);

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
  const native = isNativeIOSPlatform();
  const onPushAction = useEffectEvent((data: unknown) => {
    const next = readPushTarget(data);
    if (!next) return;
    const owner = switchToPushAccount(next, sessionId);
    if (!owner) {
      setTarget(next);
      return;
    }
    // The switch mounts the account's pages anew, which open the push after its first sync.
    switchedPush = { sessionId: owner.sessionId, target: next };
    void navigate(resolveSessionRestorePath(owner.lastKnownPath));
  });

  useEffect(() => {
    if (!native) return undefined;
    const handle = PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      onPushAction(action.notification.data);
    });
    return () => {
      handle.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, [native]);

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
