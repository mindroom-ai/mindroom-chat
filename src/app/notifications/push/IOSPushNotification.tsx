import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Switch, Text, color } from 'folds';
import { SettingTile } from '../../ui/SettingTile';
import { SettingsCard } from '../../ui/settings/SettingsCard';
import { MINDROOM_APP_NAME } from '../../ui/branding/branding';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { AsyncStatus, useAsyncCallback } from '../../lib/hooks/useAsyncCallback';
import { useClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useActiveSession } from '../../matrix/session/useSessionStore';
import { cloudflareAccessAllowsPush } from '../../native/cloudflareAccess';
import {
  checkIOSPushPermission,
  disableIOSPushPusher,
  isNativeAndroidPushPlatform,
  isNativePushPlatform,
  type NativePushPermission,
  registerIOSPush,
  requestIOSPushPermission,
  resolveIOSPushConfig,
  setIOSPushEnabled,
} from './iosPush';
import { useIOSPushEnabled, useNativeAndroidPushConfigured } from './useIOSPushEnabled';

/** The explanation under the switch: what push does, the device's state, and the last failure. */
function PushDescription({
  summary,
  status,
  failed,
}: {
  summary: string;
  status: string;
  failed: boolean;
}) {
  const { t } = useTranslation();
  // The tile wraps this in a paragraph, so only inline elements go inside.
  return (
    <Box as="span" direction="Column" gap="100">
      <span>{summary}</span>
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
          setIOSPushEnabled(true, sessionId);
          // Granting permission does not make NativeIOSPushFeature register (on a fresh install
          // push is already on), so register here; its listener sends the token as the pusher.
          await registerIOSPush();
          return;
        }
        setIOSPushEnabled(false, sessionId);
        // Only this account's pusher goes: the device stays registered with APNs for the others.
        if (pushConfig) await disableIOSPushPusher(matrixClient, pushConfig, sessionId);
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

  const isAndroid = isNativeAndroidPushPlatform();
  const busy = toggleState.status === AsyncStatus.Loading;
  const title = isAndroid
    ? t('mindroomUi.native.androidPushNotification.title')
    : t('mindroomUi.native.iOSPushNotification.iosPushNotifications');
  const summary = isAndroid
    ? t('mindroomUi.native.androidPushNotification.description')
    : t(
        'mindroomUi.native.iOSPushNotification.allowNativeIosPushNotificationsForBackgroundMessageAlerts'
      );
  let status = isAndroid
    ? t('mindroomUi.native.androidPushNotification.disabled')
    : t('mindroomUi.native.iOSPushNotification.nativeIosPushIsDisabledForThisDevice');
  if (!pushConfig) {
    status = isAndroid
      ? t('mindroomUi.native.androidPushNotification.notConfigured')
      : t('mindroomUi.native.iOSPushNotification.nativeIosPushIsNotConfiguredByTheDeploymentAdd');
  } else if (permission === 'denied') {
    status = isAndroid
      ? t('mindroomUi.native.androidPushNotification.permissionDenied', {
          appName: MINDROOM_APP_NAME,
        })
      : t('mindroomUi.native.iOSPushNotification.permissionDenied', {
          appName: MINDROOM_APP_NAME,
        });
  } else if (enabled && permission === 'granted') {
    status = isAndroid
      ? t('mindroomUi.native.androidPushNotification.registered')
      : t('mindroomUi.native.iOSPushNotification.deviceRegisteredForNativeIosPushNotifications');
  }

  return (
    <SettingsCard>
      <SettingTile
        focusId={isAndroid ? 'androidPushNotifications' : 'pushNotifications'}
        title={title}
        description={
          <PushDescription
            summary={summary}
            status={status}
            failed={toggleState.status === AsyncStatus.Error}
          />
        }
        after={
          <Switch
            variant="Primary"
            value={!!pushConfig && enabled && permission === 'granted'}
            disabled={busy || !pushConfig}
            onChange={handleChange}
          />
        }
      />
    </SettingsCard>
  );
}

/**
 * Settings → Notifications on native iOS and Android apps: the switch for push notifications
 * through APNs or FCM. Absent elsewhere, and for a homeserver whose Cloudflare Access policy
 * keeps pushes off.
 */
export function IOSPushNotification() {
  const mx = useMatrixClient();
  const isAndroid = isNativeAndroidPushPlatform();
  const androidPushConfigured = useNativeAndroidPushConfigured();
  if (!isNativePushPlatform() || !cloudflareAccessAllowsPush(mx.getHomeserverUrl())) return null;
  if (isAndroid && !androidPushConfigured) return null;
  return <IOSPushNotificationTile />;
}
