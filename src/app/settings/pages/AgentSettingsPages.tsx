import { useTranslation } from 'react-i18next';
import { SettingTile } from '../../ui/setting-tile';
import {
  SettingsPageFrame,
  type SettingsPageProps,
} from '../../ui/settings/SettingsPageFrame';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { AdvancedFold } from '../../ui/settings/AdvancedFold';
import { SequenceCardStyle } from '../../ui/settings/styles.css';
import { useComputerApiUrls } from '../../computer/useComputerApiUrl';
import { MindroomComputerSettings } from '../../computer/ComputerSettings';
import { MindroomConnectionsSettings } from '../../connections/ConnectionsSettings';

/** Agents & connections › Connected accounts: the portal where agents get their accounts. */
export function ConnectionsSettingsPage({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <SettingsPageFrame title={t('settings.general.connections.title')} requestClose={requestClose}>
      <MindroomConnectionsSettings className={SequenceCardStyle} />
    </SettingsPageFrame>
  );
}

/**
 * Agents & connections › Computers: the MindRoom server this device uses for agents' computers,
 * with the address field for another one in the Advanced fold.
 */
export function ComputersSettingsPage({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const { urls } = useComputerApiUrls();

  return (
    <SettingsPageFrame
      title={t('settings.general.computers.sectionTitle')}
      requestClose={requestClose}
    >
      <SettingsSection>
        <SettingTile
          focusId="computerServerInUse"
          title={t('featureUi.settings.computers.inUse')}
          description={
            urls.length > 0 ? urls.join(', ') : t('featureUi.settings.computers.inUseNone')
          }
        />
      </SettingsSection>
      <AdvancedFold>
        <MindroomComputerSettings className={SequenceCardStyle} />
      </AdvancedFold>
    </SettingsPageFrame>
  );
}
