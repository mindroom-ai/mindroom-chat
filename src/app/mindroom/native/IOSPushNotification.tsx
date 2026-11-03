import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Switch, Text, color } from 'folds';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { SequenceCardStyle } from '../../features/settings/styles.css';
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

function IOSPushNotificationTile() {



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
        if (pushConfig) await disableIOSPushPusher(mx, pushConfig, sessionId);
        await unregisterIOSPush();
      },
      [mx, pushConfig, sessionId]
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












        description={
          <Box direction="Column" gap="100" as="span">
            <span>{t('mindroomUi.native.iOSPushNotification.description')}</span>
            {permission === 'denied' && (
              <Text as="span" size="T200" role="note">
                {t('mindroomUi.native.iOSPushNotification.permissionDenied')}
              </Text>
            )}
            {toggleState.status === AsyncStatus.Error && (
              <Text as="span" size="T200" role="alert" style={{ color: color.Critical.Main }}>
                {t('mindroomUi.native.iOSPushNotification.failedToUpdateNativePushSettings')}
              </Text>
            )}
          </Box>
        }
        after={
          <Switch
            variant="Primary"
            value={enabled && permission !== 'denied'}
            disabled={busy}
            onChange={handleChange}
          />
        }
      />
    </SequenceCard>
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
