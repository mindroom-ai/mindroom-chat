import React from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsPageFrame, type SettingsPageProps } from '../SettingsPageFrame';
import { MatrixId } from './MatrixId';
import { Profile } from './Profile';

/** The signed-in account: profile and Matrix ID. */
export function Account({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <SettingsPageFrame title={t('settings.nav.account')} requestClose={requestClose}>
      <Profile />
      <MatrixId />
    </SettingsPageFrame>
  );
}
