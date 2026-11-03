import React from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsPageFrame } from '../SettingsPageFrame';
import { MatrixId } from './MatrixId';
import { Profile } from './Profile';







  return (
    <SettingsPageFrame title={t('featureUi.settings.menu.account')} requestClose={requestClose}>
      <Profile />
      <MatrixId />
    </SettingsPageFrame>
  );
}
