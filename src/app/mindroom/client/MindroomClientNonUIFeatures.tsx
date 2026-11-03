import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { KnownMembership, type MatrixClient } from 'matrix-js-sdk';
import { PushNotifications } from '@capacitor/push-notifications';
import InviteSound from '../../../../public/sound/invite.ogg';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useActiveSession } from '../../hooks/useSessionStore';
import { useClientStartupContext } from '../../pages/client/ClientStartupContext';
import { useSetting } from '../../state/hooks/settings';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { settingsAtom } from '../../state/settings';
import { useCanvasIndexRecorder } from '../canvas/canvasIndex';
import { useComputerApiUrls } from '../computer/useComputerApiUrl';
import { useCrossRoomThreadIndex } from '../cross-room-threads/useCrossRoomThreadIndex';
import {
  cloudflareAccessAllowsPush,
  useCloudflareAccessSignInRequired,
} from '../native/cloudflareAccess';
import {
  checkIOSPushPermission,
  disableIOSPushPusher,
  isNativeIOSPlatform,
  registerIOSPush,
  resolveIOSPushConfig,
  upsertIOSPushPusher,
} from '../native/iosPush';
import { useIOSPushEnabled } from '../native/useIOSPushEnabled';
import { playChime } from '../notifications/playChime';
import { useBindMindroomAccountSettings } from '../settings/useMindroomAccountSettings';

const invitedRoomIds = (mx: MatrixClient): string[] =>
  mx
    .getRooms()
    .filter((room) => room.getMyMembership() === KnownMembership.Invite)
    .map((room) => room.roomId);

/**
 * Chimes and shows a system notification for each new invite. Invites the client already had
 * when it started, or when the account switched, are not new: the list is reset to the current
 * client's invites first, since it may still hold the previous account's.
 */
export function MindroomInviteNotifications() {



  const setInvites = useSetAtom(allInvitesAtom);
  const [showNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [notificationSounds] = useSetting(settingsAtom, 'isNotificationSounds');
  const seen = useRef<Set<string>>(new Set());
  const previous = useRef<readonly string[]>([]);
  // The list as rendered before the baseline; its stale entries are never treated as new.
  const stale = useRef<readonly string[]>();

  useLayoutEffect(() => {
    const baseline = invitedRoomIds(mx);
    seen.current = new Set(baseline);
    previous.current = baseline;
    stale.current = invites;
    setInvites({ type: 'INITIALIZE', rooms: baseline });
    // Only a client change resets the baseline; `invites` is read for the stale marker alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, setInvites]);

  useEffect(() => {
    if (invites === stale.current) return;
    const before = new Set(previous.current);
    previous.current = invites;
    const current = new Set(invites);
    // A room that left the list can invite again later, and then it is new again.
    seen.current.forEach((roomId) => {
      if (!current.has(roomId)) seen.current.delete(roomId);
    });
    const added = invites.filter((roomId) => !before.has(roomId) && !seen.current.has(roomId));
    added.forEach((roomId) => seen.current.add(roomId));
    if (added.length === 0) return;

    if (notificationSounds) playChime(InviteSound).catch(() => undefined);
    const SystemNotification = typeof window === 'undefined' ? undefined : window.Notification;
    if (showNotifications && SystemNotification?.permission === 'granted') {
      // eslint-disable-next-line no-new
      new SystemNotification(t('mindroomUi.notifications.invitation.title'), {
        body: t('mindroomUi.notifications.invitation.body', { count: added.length }),
        silent: true,
      });
    }
  }, [invites, notificationSounds, showNotifications, t]);

  return null;
}

/**
 * Keeps the Canvases list and the "agent showed its computer" record current on every route,
 * while this deployment has canvases or a computer service.
 */
export function CanvasIndexFeature() {
  const mx = useMatrixClient();
  const canvasesEnabled = useClientConfig().mindroom?.canvas?.enabled === true;
  const computersAvailable = useComputerApiUrls().urls.length > 0;
  useCanvasIndexRecorder(mx, canvasesEnabled || computersAvailable);
  return null;
}

/**
 * Keeps the cross-room thread index (Threads page, recent threads, command palette) current for
 * the whole session. Mount it once, at client scope.
 */
export function CrossRoomThreadIndexFeature() {
  useCrossRoomThreadIndex();
  return null;
}

/** Keeps the account's `io.mindroom.settings` account data in the settings atom. */
export function MindroomAccountSettingsFeature() {
  useBindMindroomAccountSettings(useMatrixClient());
  return null;
}

type Latest<T> = { current: T };

const useLatest = <T,>(value: T): Latest<T> => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};

/**
 * On the iOS app, registers for APNs while push is on and sends the device token to the
 * homeserver as a pusher. A private server behind Cloudflare Access waits for its sign-in; a
 * server whose Access policy keeps pushes off has the pusher removed. A failed registration is
 * logged, and never turns the user's push setting off.
 */
export function MindroomNativeIOSPushFeature() {
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
  const latest = useLatest({ enabled, signInRequired, pushAllowed });
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

type PushTarget = { roomId: string; eventId?: string };

const readPushTarget = (data: unknown): PushTarget | undefined => {
  if (!data || typeof data !== 'object') return undefined;
  const { room_id: roomId, event_id: eventId } = data as Record<string, unknown>;
  if (typeof roomId !== 'string' || !roomId.startsWith('!')) return undefined;
  return { roomId, eventId: typeof eventId === 'string' ? eventId : undefined };
};

/**
 * On the iOS app, opens the message of a tapped push notification once the first sync is done.
 * A push for a room this account is not in (another account's, or a room left) is ignored.
 */
export function MindroomNativeIOSPushOpenFeature() {
  const mx = useMatrixClient();
  const { navigateRoom } = useRoomNavigate();
  const { hasCompletedInitialSync } = useClientStartupContext();
  const [target, setTarget] = useState<PushTarget>();
  const native = isNativeIOSPlatform();

  useEffect(() => {
    if (!native) return undefined;
    const handle = PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const next = readPushTarget(action.notification.data);
      if (next) setTarget(next);
    });
    return () => {
      handle.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, [native]);

  useEffect(() => {
    if (!target || !hasCompletedInitialSync) return;
    setTarget(undefined);
    if (mx.getRoom(target.roomId)?.getMyMembership() !== KnownMembership.Join) return;
    navigateRoom(target.roomId, target.eventId);
  }, [hasCompletedInitialSync, mx, navigateRoom, target]);

  return null;
}
