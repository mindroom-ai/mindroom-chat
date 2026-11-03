import React, { useCallback } from 'react';
import { Box, Button, Spinner, Switch, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { getNotificationState, usePermissionState } from '../../../hooks/usePermission';
import { useEmailNotifications } from '../../../hooks/useEmailNotifications';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useAppLanguageCode } from '../../../hooks/useAppLanguageCode';
import {
  getMindroomEmailNotificationPusherData,
  MindroomNativeNotificationSettings,
} from '../../../mindroom/notifications/SystemNotificationMindroomExtensions';
import { SequenceCardStyle } from '../styles.css';

const EMAIL_PUSHER_APP_ID = 'm.email';




  const lang = useAppLanguageCode();
  const [result, refresh] = useEmailNotifications();








            pushkey: email,
            app_display_name: t('featureUi.settings.notifications.systemNotification.emailAppName'),
            device_display_name: email,
            lang,
            data: getMindroomEmailNotificationPusherData(),
            append: true,
          });
        } else {
          await mx.setPusher({
            kind: null,
            app_id: EMAIL_PUSHER_APP_ID,
            pushkey: email,
          } as never);
        }
        refresh();
      },
      [mx, lang, refresh, t]
    )
  );

  let description: React.ReactNode;
  if (result === undefined) {
    description = t('featureUi.settings.notifications.systemNotification.emailLoading');
  } else if (result === null) {
    description = (
      <span style={{ color: color.Critical.Main }}>
        {t('featureUi.settings.notifications.systemNotification.emailUnavailable')}
      </span>
    );
  } else if (!result.email) {
    description = t('featureUi.settings.notifications.systemNotification.emailNoAddress');
  } else {
    description = t('featureUi.settings.notifications.systemNotification.emailDescription', {
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









  const permission = usePermissionState('notifications', getNotificationState());
  const [showNotifications, setShowNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [notificationSounds, setNotificationSounds] = useSetting(
    settingsAtom,
    'isNotificationSounds'
  );

  const requestPermission = () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;






















            permission === 'prompt' ? (
              <Button size="300" radii="300" fill="Soft" onClick={requestPermission}>
                <Text size="B300">
                  {t('featureUi.settings.notifications.systemNotification.enable')}
                </Text>
              </Button>
            ) : (
              <Switch
                disabled={permission !== 'granted'}
                value={permission === 'granted' && showNotifications}
                onChange={setShowNotifications}
              />
            )
          }
        />
        <SettingTile
          title={t('featureUi.settings.notifications.systemNotification.notificationSound')}
          description={t(
            'featureUi.settings.notifications.systemNotification.notificationSoundDescription'
          )}
          after={<Switch value={notificationSounds} onChange={setNotificationSounds} />}
        />
        <MindroomNativeNotificationSettings />
        <EmailNotification />
      </SequenceCard>
    </Box>
  );
}
