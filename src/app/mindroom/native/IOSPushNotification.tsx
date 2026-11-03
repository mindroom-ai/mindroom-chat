import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Switch, Text, color } from 'folds';
import { SettingTile } from '../../components/setting-tile';
import { SettingsCard } from '../../features/settings/SettingsCard';
import { MINDROOM_APP_NAME } from '../branding/branding';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useActiveSession } from '../../hooks/useSessionStore';
import { cloudflareAccessAllowsPush } from './cloudflareAccess';
import {
  checkIOSPushPermission,
  disableIOSPushPusher,
  isNativeIOSPlatform,
  type NativePushPermission,
  requestIOSPushPermission,
  resolveIOSPushConfig,
  setIOSPushEnabled,
  unregisterIOSPush,
} from './iosPush';
import { useIOSPushEnabled } from './useIOSPushEnabled';

/** The explanation under the switch: what push does, the device's state, and the last failure. */
function PushDescription({ status, failed }: { status: string; failed: boolean }) {
  const { t } = useTranslation();
  // The tile wraps this in a paragraph, so only inline elements go inside.
  return (
    <Box as="span" direction="Column" gap="100">
      <span>
        {t(
          'mindroomUi.native.iOSPushNotification.allowNativeIosPushNotificationsForBackgroundMessageAlerts'
        )}
      </span>
      <span>{status}</span>
      {failed && (
        <Text as="span" size="T200" style={{ color: color.Critical.Main }}>
          {t('mindroomUi.native.iOSPushNotification.failedToUpdateNativePushSettings')}
        </Text>
      )}
    </Box>
  );
}

function IOSPushNotificationTile() {
  const matrixClient = useMatrixClient();
  const clientConfig = useClientConfig();
  const { t } = useTranslation();
  const sessionId = useActiveSession()?.sessionId;
  const language = useAppLanguageCode();
  const enabled = useIOSPushEnabled(sessionId);
  const pushConfig = useMemo(
    () => resolveIOSPushConfig(clientConfig, sessionId, language),
    [clientConfig, language, sessionId]
  );
  const [permission, setPermission] = useState<NativePushPermission>();

  const refreshPermission = useCallback(() => {
    checkIOSPushPermission().then(setPermission, () => setPermission(undefined));
  }, []);

  useEffect(() => {
    refreshPermission();
  }, [refreshPermission]);

  const [toggleState, toggle] = useAsyncCallback<void, unknown, [boolean]>(
    useCallback(
      async (next: boolean) => {
        if (next) {
          let current = await checkIOSPushPermission();
          if (current === 'prompt') current = await requestIOSPushPermission();
          if (current !== 'granted') throw new Error('Notification permission was not granted.');
          // MindroomNativeIOSPushFeature registers with APNs and the homeserver once this is on.
          setIOSPushEnabled(true, sessionId);
          return;
        }
        setIOSPushEnabled(false, sessionId);
        if (pushConfig) await disableIOSPushPusher(matrixClient, pushConfig, sessionId);
        await unregisterIOSPush();
      },
      [matrixClient, pushConfig, sessionId]
    )
  );

  const handleChange = (next: boolean) => {
    toggle(next)
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[IOSPushNotification] Failed to update native push settings:', error);
      })
      .finally(refreshPermission);
  };

  const busy = toggleState.status === AsyncStatus.Loading;
  let status = t('mindroomUi.native.iOSPushNotification.nativeIosPushIsDisabledForThisDevice');
  if (!pushConfig) {
    status = t(
      'mindroomUi.native.iOSPushNotification.nativeIosPushIsNotConfiguredByTheDeploymentAdd'
    );
  } else if (permission === 'denied') {
    status = t('mindroomUi.native.iOSPushNotification.permissionDenied', {
      appName: MINDROOM_APP_NAME,
    });
  } else if (enabled && permission === 'granted') {
    status = t(
      'mindroomUi.native.iOSPushNotification.deviceRegisteredForNativeIosPushNotifications'
    );
  }

  return (
    <SettingsCard>
      <SettingTile
        title={t('mindroomUi.native.iOSPushNotification.iosPushNotifications')}
        description={
          <PushDescription status={status} failed={toggleState.status === AsyncStatus.Error} />
        }
        after={
          <Switch
            variant="Primary"
            value={enabled && permission !== 'denied'}
            disabled={busy || !pushConfig}
            onChange={handleChange}
          />
        }
      />
    </SettingsCard>
  );
}

/**
 * Settings → Notifications on the iOS app: the switch for push notifications through APNs.
 * Absent elsewhere, and for a homeserver whose Cloudflare Access policy keeps pushes off.
 */
export function IOSPushNotification() {
  const mx = useMatrixClient();
  if (!isNativeIOSPlatform() || !cloudflareAccessAllowsPush(mx.getHomeserverUrl())) return null;
  return <IOSPushNotificationTile />;
}
