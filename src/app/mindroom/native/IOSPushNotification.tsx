import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, color, Spinner, Switch, Text } from 'folds';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { useActiveSession } from '../../hooks/useSessionStore';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClientConfig } from '../../hooks/useClientConfig';
import { SequenceCardStyle } from '../../features/settings/styles.css';
import { toSupportedLanguageCode } from '../../i18nLanguages';
import { MINDROOM_APP_NAME } from '../branding/branding';
import {
  NativePushPermission,
  checkIOSPushPermission,
  disableIOSPushPusher,
  isNativeIOSPlatform,
  requestIOSPushPermission,
  resolveIOSPushConfig,
  setIOSPushEnabled,
  unregisterIOSPush,
} from './iosPush';
import { useIOSPushEnabled } from './useIOSPushEnabled';

export function IOSPushNotification() {
  const mx = useMatrixClient();
  const clientConfig = useClientConfig();
  const activeSession = useActiveSession();
  const { i18n } = useTranslation();
  const language = toSupportedLanguageCode(i18n.resolvedLanguage ?? i18n.language);
  const sessionId = activeSession?.sessionId;
  const nativePushNotifications = useIOSPushEnabled(sessionId);
  const iosPushConfig = useMemo(
    () => resolveIOSPushConfig(clientConfig, sessionId, language),
    [clientConfig, language, sessionId]
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
      control = <Switch value={nativePushNotifications} onChange={handleToggle} />;
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
