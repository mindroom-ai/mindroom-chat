import { useAtomValue } from 'jotai';
import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import InviteSound from '../../../../public/sound/invite.ogg';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useActiveSession } from '../../hooks/useSessionStore';
import { useClientConfig } from '../../hooks/useClientConfig';
import { usePreviousValue } from '../../hooks/usePreviousValue';
import { getInboxInvitesPath } from '../../pages/pathUtils';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { notificationPermission, setFavicon } from '../../utils/dom';
import { MINDROOM_FAVICON_SRC } from '../branding/branding';
import {
  checkIOSPushPermission,
  disableIOSPushPusher,
  isNativeIOSPlatform,
  registerIOSPush,
  resolveIOSPushConfig,
  setIOSPushEnabled,
  unregisterIOSPush,
  upsertIOSPushPusher,
} from '../native/iosPush';
import { useIOSPushEnabled } from '../native/useIOSPushEnabled';

const LogoUnreadSVG = MINDROOM_FAVICON_SRC;
const LogoHighlightSVG = MINDROOM_FAVICON_SRC;

function MindroomFaviconUpdater() {
  const roomToUnread = useAtomValue(roomToUnreadAtom);

  useEffect(() => {
    let notification = false;
    let highlight = false;
    roomToUnread.forEach((unread) => {
      if (unread.total > 0) {
        notification = true;
      }
      if (unread.highlight > 0) {
        highlight = true;
      }
    });

    if (notification) {
      setFavicon(highlight ? LogoHighlightSVG : LogoUnreadSVG);
    } else {
      setFavicon(MINDROOM_FAVICON_SRC);
    }
  }, [roomToUnread]);

  return null;
}

function MindroomInviteNotifications() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const invites = useAtomValue(allInvitesAtom);
  const perviousInviteLen = usePreviousValue(invites.length, 0);
  const mx = useMatrixClient();

  const navigate = useNavigate();
  const [showNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [notificationSound] = useSetting(settingsAtom, 'isNotificationSounds');

  const notify = useCallback(
    (count: number) => {
      const noti = new window.Notification('Invitation', {
        icon: MINDROOM_FAVICON_SRC,
        badge: MINDROOM_FAVICON_SRC,
        body: `You have ${count} new invitation request.`,
        silent: true,
      });

      noti.onclick = () => {
        if (!window.closed) navigate(getInboxInvitesPath());
        noti.close();
      };
    },
    [navigate]
  );

  const playSound = useCallback(() => {
    const audioElement = audioRef.current;
    audioElement?.play();
  }, []);

  useEffect(() => {
    if (invites.length > perviousInviteLen && mx.getSyncState() === 'SYNCING') {
      if (showNotifications && notificationPermission('granted')) {
        notify(invites.length - perviousInviteLen);
      }

      if (notificationSound) {
        playSound();
      }
    }
  }, [mx, invites, perviousInviteLen, showNotifications, notificationSound, notify, playSound]);

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio ref={audioRef} style={{ display: 'none' }}>
      <source src={InviteSound} type="audio/ogg" />
    </audio>
  );
}

function MindroomNativeIOSPushFeature() {
  const mx = useMatrixClient();
  const clientConfig = useClientConfig();
  const activeSession = useActiveSession();
  const sessionId = activeSession?.sessionId;
  const nativePushNotifications = useIOSPushEnabled(sessionId);

  useEffect(() => {
    const pushConfig = resolveIOSPushConfig(clientConfig, sessionId);
    if (!isNativeIOSPlatform() || !pushConfig) return undefined;

    let disposed = false;
    let registrationHandle: PluginListenerHandle | undefined;
    let registrationErrorHandle: PluginListenerHandle | undefined;

    const setupNativePush = async () => {
      const registrationListener = await PushNotifications.addListener('registration', (token) => {
        if (disposed) return;
        upsertIOSPushPusher(mx, pushConfig, token.value, sessionId).catch(async () => {
          setIOSPushEnabled(false, sessionId);
          await disableIOSPushPusher(mx, pushConfig, sessionId).catch(() => undefined);
          await unregisterIOSPush().catch(() => undefined);
        });
      });
      if (disposed) {
        registrationListener.remove().catch(() => undefined);
        return;
      }
      registrationHandle = registrationListener;

      const registrationErrorListener = await PushNotifications.addListener(
        'registrationError',
        () => {
          setIOSPushEnabled(false, sessionId);
          disableIOSPushPusher(mx, pushConfig, sessionId).catch(() => undefined);
          unregisterIOSPush().catch(() => undefined);
        }
      );
      if (disposed) {
        registrationErrorListener.remove().catch(() => undefined);
        return;
      }
      registrationErrorHandle = registrationErrorListener;

      if (!nativePushNotifications) {
        await disableIOSPushPusher(mx, pushConfig, sessionId);
        await unregisterIOSPush().catch(() => undefined);
        return;
      }

      const permission = await checkIOSPushPermission();
      if (permission !== 'granted') {
        setIOSPushEnabled(false, sessionId);
        await disableIOSPushPusher(mx, pushConfig, sessionId);
        await unregisterIOSPush().catch(() => undefined);
        return;
      }

      await registerIOSPush();
    };

    setupNativePush().catch(async () => {
      setIOSPushEnabled(false, sessionId);
      await disableIOSPushPusher(mx, pushConfig, sessionId).catch(() => undefined);
      await unregisterIOSPush().catch(() => undefined);
    });

    return () => {
      disposed = true;
      registrationHandle?.remove().catch(() => undefined);
      registrationErrorHandle?.remove().catch(() => undefined);
    };
  }, [clientConfig, mx, nativePushNotifications, sessionId]);

  return null;
}

export function MindroomClientNonUIFeatures() {
  return (
    <>
      <MindroomFaviconUpdater />
      <MindroomInviteNotifications />
      <MindroomNativeIOSPushFeature />
    </>
  );
}
