import React from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsPageFrame } from '../SettingsPageFrame';
import { SystemNotification } from './SystemNotification';







  return (
    <SettingsPageFrame title={t('settings.nav.notifications')} requestClose={requestClose}>
      <SystemNotification />
    </SettingsPageFrame>
  );
}
