import { useTranslation } from 'react-i18next';
import { MindroomInterfaceSettings } from '../../../mindroom/settings/MindroomInterfaceSettings';
import { SettingsPageFrame, type SettingsPageProps } from '../SettingsPageFrame';
import { SequenceCardStyle } from '../styles.css';

/** The switches for the sidebar's buttons, kept in the account so every device follows them. */
export function Sidebar({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <SettingsPageFrame title={t('featureUi.settings.sidebar.title')} requestClose={requestClose}>
      <MindroomInterfaceSettings className={SequenceCardStyle} />
    </SettingsPageFrame>
  );
}
