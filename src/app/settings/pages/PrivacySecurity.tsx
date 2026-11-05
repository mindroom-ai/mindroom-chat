import { useTranslation } from 'react-i18next';
import { useOwnDeviceTrust } from '../../account/verification/useOwnDeviceTrust';
import { SettingsPageFrame, type SettingsPageProps } from '../../ui/settings/SettingsPageFrame';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingSwitchTile } from '../../ui/settings/SettingSwitchTile';
import { AdvancedFold } from '../../ui/settings/AdvancedFold';
import { BlockedUsers } from '../../account/settings/BlockedUsers';
import { DeviceSettings } from '../../account/devices/Devices';
import { LocalKeyBackup } from '../../account/devices/LocalKeyBackup';

/**
 * What others learn from this client (activity, link previews in encrypted rooms), who is
 * blocked, and the account's encryption and sessions; key files sit in the Advanced fold.
 */
export function PrivacySecurity({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const trust = useOwnDeviceTrust();

  return (
    <SettingsPageFrame
      title={t('featureUi.settings.menu.pages.privacy')}
      requestClose={requestClose}
    >
      <SettingsSection title={t('featureUi.settings.sections.privacy')}>
        <SettingSwitchTile
          focusId="hideActivity"
          setting="hideActivity"
          title={t('settings.general.editor.hideActivity')}
          description={t('settings.general.editor.hideActivityDescription')}
        />
        <SettingSwitchTile
          focusId="encUrlPreview"
          setting="encUrlPreview"
          title={t('settings.general.messages.urlPreviewEncrypted')}
        />
      </SettingsSection>
      <BlockedUsers />
      <DeviceSettings trust={trust} />
      {trust && (
        <AdvancedFold>
          <LocalKeyBackup />
        </AdvancedFold>
      )}
    </SettingsPageFrame>
  );
}
