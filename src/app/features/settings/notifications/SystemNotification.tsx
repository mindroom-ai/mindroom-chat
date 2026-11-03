import React, { useCallback } from 'react';
import { Box, Button, Spinner, Switch, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useAppLanguageCode } from '../../../hooks/useAppLanguageCode';
import { useEmailNotifications } from '../../../hooks/useEmailNotifications';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getNotificationState, usePermissionState } from '../../../hooks/usePermission';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import {
  MindroomNativeNotificationSettings,
  getMindroomEmailNotificationPusherData,
} from '../../../mindroom/notifications/SystemNotificationMindroomExtensions';
import { SequenceCardStyle } from '../styles.css';

const EMAIL_PUSHER_APP_ID = 'm.email';

/** Whether the homeserver emails notifications to the account's address (an `email` pusher). */
function EmailNotification() {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const lang = useAppLanguageCode();
  const [result, refresh] = useEmailNotifications();

  // Matrix spec, client-server API, `POST /pushers/set`: an email pusher has kind `email` and the
  // address as its push key; kind `null` deletes the pusher.
  const updatePusher = useCallback(
    async (email: string, enable: boolean) => {
      await client.setPusher(
        enable
          ? {
              kind: 'email',
              app_id: EMAIL_PUSHER_APP_ID,
              pushkey: email,
              app_display_name: t(
                'featureUi.settings.notifications.systemNotification.emailNotification'
              ),
              device_display_name: email,
              lang,
              data: getMindroomEmailNotificationPusherData(),
              append: true,
            }
          : ({ kind: null, app_id: EMAIL_PUSHER_APP_ID, pushkey: email } as never)
      );
      refresh();
    },
    [client, lang, refresh, t]
  );
  const [setState, setEnabled] = useAsyncCallback(updatePusher);

  let description: React.ReactNode;
  if (result === undefined) {
    description = <Spinner size="50" variant="Secondary" />;
  } else if (result === null) {
    description = (
      <span style={{ color: color.Critical.Main }}>
        {t('featureUi.settings.notifications.systemNotification.unexpectedError')}
      </span>
    );
  } else if (!result.email) {
    description = t(
      'featureUi.settings.notifications.systemNotification.yourAccountDoesNotHaveAnyEmail'
    );
  } else {
    description = t('featureUi.settings.notifications.systemNotification.sendToEmailAddress', {
      email: result.email,
    });
  }

  const busy = setState.status === AsyncStatus.Loading;

  return (
    <SettingTile
      title={t('featureUi.settings.notifications.systemNotification.emailNotification')}
      description={description}
      after={
        result?.email ? (
          busy ? (
            <Spinner variant="Secondary" />
          ) : (
            <Switch
              value={result.enabled}
              onChange={(value: boolean) => setEnabled(result.email as string, value)}
            />
          )
        ) : undefined
      }
    />
  );
}

const askBrowserPermission = () => {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    void window.Notification.requestPermission();
  }
};

/**
 * Desktop notifications need the browser's permission first: an Enable button
 * while it can still be asked, then a switch that only works once granted.
 */
function DesktopNotificationTile({ permission }: { permission: PermissionState }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useSetting(settingsAtom, 'showNotifications');
  const granted = permission === 'granted';

  const control =
    permission === 'prompt' ? (
      <Button size="300" radii="300" fill="Soft" onClick={askBrowserPermission}>
        <Text size="B300">{t('featureUi.settings.notifications.systemNotification.enable')}</Text>
      </Button>
    ) : (
      <Switch value={granted && enabled} disabled={!granted} onChange={setEnabled} />
    );

  const description =
    permission === 'denied'
      ? t('featureUi.settings.notifications.systemNotification.permissionBlocked')
      : t(
          'featureUi.settings.notifications.systemNotification.showDesktopNotificationsWhenMessageArrive'
        );

  return (
    <SettingTile
      title={t('featureUi.settings.notifications.systemNotification.desktopNotifications')}
      description={description}
      after={control}
    />
  );
}

function NotificationSoundTile() {
  const { t } = useTranslation();
  const [sounds, setSounds] = useSetting(settingsAtom, 'isNotificationSounds');
  return (
    <SettingTile
      title={t('featureUi.settings.notifications.systemNotification.notificationSound')}
      description={t(
        'featureUi.settings.notifications.systemNotification.playSoundWhenNewMessageArrive'
      )}
      after={<Switch value={sounds} onChange={setSounds} />}
    />
  );
}

/** Desktop notifications, sounds, native push, and email notifications. */
export function SystemNotification() {
  const { t } = useTranslation();
  const permission = usePermissionState('notifications', getNotificationState());

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('featureUi.settings.notifications.systemNotification.system')}</Text>
      <SequenceCard
        variant="SurfaceVariant"
        className={SequenceCardStyle}
        gap="400"
        direction="Column"
      >
        <DesktopNotificationTile permission={permission} />
        <NotificationSoundTile />
        <MindroomNativeNotificationSettings />
        <EmailNotification />
      </SequenceCard>
    </Box>
  );
}
