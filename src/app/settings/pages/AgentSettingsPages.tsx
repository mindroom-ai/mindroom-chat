import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'folds';
import { SettingTile } from '../../ui/SettingTile';
import { SettingsPageFrame, type SettingsPageProps } from '../../ui/settings/SettingsPageFrame';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { AdvancedFold } from '../../ui/settings/AdvancedFold';
import { SequenceCardStyle } from '../../ui/settings/styles.css';
import { useComputerApiUrls } from '../../computer/useComputerApiUrl';
import { ComputerSettings } from '../../computer/ComputerSettings';
import { computerServicePreferenceAtom } from '../../computer/computerServiceSettings';
import { ConnectionsSettings } from '../../connections/ConnectionsSettings';

/** Agents & connections › Connected accounts: the portal where agents get their accounts. */
export function ConnectionsSettingsPage({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <SettingsPageFrame title={t('settings.general.connections.title')} requestClose={requestClose}>
      <ConnectionsSettings className={SequenceCardStyle} />
    </SettingsPageFrame>
  );
}

/**
 * Agents & connections › Computers: the MindRoom server this device uses for agents' computers,
 * with the address field for another one in the Advanced fold.
 */
export function ComputersSettingsPage({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const { urls, discovered } = useComputerApiUrls();
  const setPreference = useSetAtom(computerServicePreferenceAtom);
  // A server found from the agents is in use but not saved, and secret requests accept only a saved one.
  const found = discovered ? urls[0] : undefined;

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
          after={
            found !== undefined && (
              <Button
                onClick={() => setPreference(found)}
                variant="Secondary"
                fill="Soft"
                size="300"
                radii="300"
              >
                <Text size="B300">
                  {t('featureUi.settings.computers.useServer', { host: new URL(found).host })}
                </Text>
              </Button>
            )
          }
        >
          {found !== undefined && (
            <Text priority="300" size="T200">
              {t('featureUi.settings.computers.foundNotSaved')}
            </Text>
          )}
        </SettingTile>
      </SettingsSection>
      <AdvancedFold>
        <ComputerSettings className={SequenceCardStyle} />
      </AdvancedFold>
    </SettingsPageFrame>
  );
}
