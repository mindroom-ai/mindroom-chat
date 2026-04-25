import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, Switch, Button, color, Spinner } from 'folds';
import { IPusherRequest } from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { useActiveSession } from '../../../hooks/useSessionStore';
import { getNotificationState, usePermissionState } from '../../../hooks/usePermission';
import { useEmailNotifications } from '../../../hooks/useEmailNotifications';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useIOSPushEnabled } from '../../../mindroom/native/useIOSPushEnabled';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useClientConfig } from '../../../hooks/useClientConfig';
import {
  NativePushPermission,
  checkIOSPushPermission,
  disableIOSPushPusher,
  isNativeIOSPlatform,
  requestIOSPushPermission,
  resolveIOSPushConfig,
  setIOSPushEnabled,
  unregisterIOSPush,
} from '../../../mindroom/native/iosPush';
import { MINDROOM_APP_NAME, MINDROOM_NOTIFICATION_BRAND } from '../../../mindroom/branding/branding';

function EmailNotification() {
  const mx = useMatrixClient();
  const [result, refreshResult] = useEmailNotifications();

  const [setState, setEnable] = useAsyncCallback(
    useCallback(
      async (email: string, enable: boolean) => {
        if (enable) {
          await mx.setPusher({
            kind: 'email',
            app_id: 'm.email',
            pushkey: email,
            app_display_name: 'Email Notifications',
            device_display_name: email,
            lang: 'en',
            data: {
              brand: MINDROOM_NOTIFICATION_BRAND,
            },
            append: true,
          });
          return;
        }
        await mx.setPusher({
          pushkey: email,
          app_id: 'm.email',
          kind: null,
        } as unknown as IPusherRequest);
      },
      [mx]
    )
  );

  const handleChange = (value: boolean) => {
    if (result && result.email) {
      setEnable(result.email, value).then(() => {
        refreshResult();
      });
    }
  };

  return (
    <SettingTile
      title="Email Notification"
      description={
        <>
          {result && !result.email && (
            <Text as="span" style={{ color: color.Critical.Main }} size="T200">
              Your account does not have any email attached.
            </Text>
          )}
          {result && result.email && <>Send notification to your email. {`("${result.email}")`}</>}
          {result === null && (
            <Text as="span" style={{ color: color.Critical.Main }} size="T200">
              Unexpected Error!
            </Text>
          )}
          {result === undefined && 'Send notification to your email.'}
        </>
      }
      after={
        <>
          {setState.status !== AsyncStatus.Loading &&
            typeof result === 'object' &&
            result?.email && <Switch value={result.enabled} onChange={handleChange} />}
          {(setState.status === AsyncStatus.Loading || result === undefined) && (
            <Spinner variant="Secondary" />
          )}
        </>
      }
    />
  );
}

function IOSPushNotification() {
  const mx = useMatrixClient();
  const clientConfig = useClientConfig();
  const activeSession = useActiveSession();
  const sessionId = activeSession?.sessionId;
  const nativePushNotifications = useIOSPushEnabled(sessionId);
  const iosPushConfig = useMemo(
    () => resolveIOSPushConfig(clientConfig, sessionId),
    [clientConfig, sessionId]
  );
  const [permission, setPermission] = useState<NativePushPermission>('prompt');

  const refreshPermission = useCallback(async () => {
    try {
      setPermission(await checkIOSPushPermission());
    } catch {
      setPermission('denied');
    }
  }, []);

  useEffect(() => {
    if (!isNativeIOSPlatform()) return;
    refreshPermission();
  }, [refreshPermission]);

  const [toggleState, togglePush] = useAsyncCallback(
    useCallback(
      async (enabled: boolean) => {
        if (!iosPushConfig) {
          throw new Error(
            'Native push is not configured. Set push.ios.enabled/appId/gatewayUrl in config.json.'
          );
        }

        if (!enabled) {
          setIOSPushEnabled(false, sessionId);
          await disableIOSPushPusher(mx, iosPushConfig, sessionId);
          await unregisterIOSPush().catch(() => undefined);
          return;
        }

        let nextPermission = await checkIOSPushPermission();
        if (nextPermission !== 'granted') {
          nextPermission = await requestIOSPushPermission();
        }

        setPermission(nextPermission);
        if (nextPermission !== 'granted') {
          setIOSPushEnabled(false, sessionId);
          return;
        }

        setIOSPushEnabled(true, sessionId);
      },
      [iosPushConfig, mx, sessionId]
    )
  );

  if (!isNativeIOSPlatform()) return null;

  const handleToggle = (enabled: boolean) => {
    togglePush(enabled)
      .catch(() => undefined)
      .finally(() => {
        refreshPermission();
      });
  };

  const description = (
    <>
      {!iosPushConfig && (
        <Text as="span" style={{ color: color.Critical.Main }} size="T200">
          Native iOS push is not configured by the deployment. Add `push.ios` settings in
          `config.json`.
        </Text>
      )}
      {iosPushConfig && toggleState.status === AsyncStatus.Error && (
        <Text as="span" style={{ color: color.Critical.Main }} size="T200">
          {toggleState.error instanceof Error
            ? toggleState.error.message
            : 'Failed to update native push settings.'}
        </Text>
      )}
      {iosPushConfig && toggleState.status !== AsyncStatus.Error && permission === 'denied' && (
        <Text as="span" style={{ color: color.Critical.Main }} size="T200">
          Notification permission is denied. Enable notifications for {MINDROOM_APP_NAME} in iOS
          Settings.
        </Text>
      )}
      {iosPushConfig && toggleState.status !== AsyncStatus.Error && permission === 'prompt' && (
        <span>Allow native iOS push notifications for background message alerts.</span>
      )}
      {iosPushConfig &&
        toggleState.status !== AsyncStatus.Error &&
        permission === 'granted' &&
        nativePushNotifications && (
          <span>Device registered for native iOS push notifications.</span>
        )}
      {iosPushConfig &&
        toggleState.status !== AsyncStatus.Error &&
        permission === 'granted' &&
        !nativePushNotifications && <span>Native iOS push is disabled for this device.</span>}
    </>
  );

  let control = <Text size="T200">Unavailable</Text>;
  if (toggleState.status === AsyncStatus.Loading) {
    control = <Spinner variant="Secondary" />;
  } else if (iosPushConfig) {
    if (permission === 'prompt' && !nativePushNotifications) {
      control = (
        <Button size="300" radii="300" onClick={() => handleToggle(true)}>
          <Text size="B300">Enable</Text>
        </Button>
      );
    } else {
      control = (
        <Switch
          value={nativePushNotifications}
          onChange={handleToggle}
        />
      );
    }
  }

  return (
    <SequenceCard
      className={SequenceCardStyle}
      variant="SurfaceVariant"
      direction="Column"
      gap="400"
    >
      <SettingTile title="iOS Push Notifications" description={description} after={control} />
    </SequenceCard>
  );
}

export function SystemNotification() {
  const notifPermission = usePermissionState('notifications', getNotificationState());
  const [showNotifications, setShowNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [isNotificationSounds, setIsNotificationSounds] = useSetting(
    settingsAtom,
    'isNotificationSounds'
  );

  const requestNotificationPermission = () => {
    if ('Notification' in window) {
      window.Notification.requestPermission();
    }
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">System</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Desktop Notifications"
          description={
            notifPermission === 'denied' ? (
              <Text as="span" style={{ color: color.Critical.Main }} size="T200">
                {'Notification' in window
                  ? 'Notification permission is blocked. Please allow notification permission from browser address bar.'
                  : 'Notifications are not supported by the system.'}
              </Text>
            ) : (
              <span>Show desktop notifications when message arrive.</span>
            )
          }
          after={
            notifPermission === 'prompt' ? (
              <Button size="300" radii="300" onClick={requestNotificationPermission}>
                <Text size="B300">Enable</Text>
              </Button>
            ) : (
              <Switch
                disabled={notifPermission !== 'granted'}
                value={showNotifications}
                onChange={setShowNotifications}
              />
            )
          }
        />
      </SequenceCard>
      <IOSPushNotification />
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title="Notification Sound"
          description="Play sound when new message arrive."
          after={<Switch value={isNotificationSounds} onChange={setIsNotificationSounds} />}
        />
      </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <EmailNotification />
      </SequenceCard>
    </Box>
  );
}
