import React from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsPageFrame, type SettingsPageProps } from '../SettingsPageFrame';
import { AccountDeactivation } from './AccountDeactivation';
import { BlockedUsers } from './BlockedUsers';
import { ContactInfo } from './ContactInfo';
import { MatrixId } from './MatrixId';
import { Profile } from './Profile';

/** The signed-in account: profile, Matrix ID, email, blocked users and deactivation. */
export function Account({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <SettingsPageFrame title={t('settings.nav.account')} requestClose={requestClose}>
      <Profile />
      <MatrixId />
      <ContactInfo />
      <BlockedUsers />
      <AccountDeactivation />
    </SettingsPageFrame>
  );
}
