import { useTranslation } from 'react-i18next';
import { SettingsPageFrame, type SettingsPageProps } from '../../ui/settings/SettingsPageFrame';
import { AccountDeactivation } from './AccountDeactivation';
import { ContactInfo } from './ContactInfo';
import { MatrixId } from './MatrixId';
import { Profile } from './Profile';

/** The signed-in account: profile, Matrix ID, email and deactivation. */
export function Account({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <SettingsPageFrame title={t('settings.nav.account')} requestClose={requestClose}>
      <Profile />
      <MatrixId />
      <ContactInfo />
      <AccountDeactivation />
    </SettingsPageFrame>
  );
}
