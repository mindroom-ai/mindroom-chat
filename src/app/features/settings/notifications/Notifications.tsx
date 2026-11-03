import React from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsPageFrame, type SettingsPageProps } from '../SettingsPageFrame';
import { SystemNotification } from './SystemNotification';

/** How this device notifies about new messages. */
export function Notifications({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <SettingsPageFrame title={t('settings.nav.notifications')} requestClose={requestClose}>
      <SystemNotification />
    </SettingsPageFrame>
  );
}
