import { useState } from 'react';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Button, Text, color } from 'folds';
import { isBundledApp } from '../../lib/nativeShell';
import { SettingTile } from '../../ui/SettingTile';
import { SettingsPageFrame, type SettingsPageProps } from '../../ui/settings/SettingsPageFrame';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingSwitchTile } from '../../ui/settings/SettingSwitchTile';
import { ChoiceButton } from '../../ui/settings/ChoiceButton';
import { AdvancedFold } from '../../ui/settings/AdvancedFold';
import { SequenceCardStyle } from '../../ui/settings/styles.css';
import { useSetting } from '../../preferences/useSetting';
import { settingsAtom } from '../../preferences/settings';
import { MID_TURN_CHOICES } from '../../composer/ComposerSendButton';
import { useComputerApiUrls } from '../../computer/useComputerApiUrl';
import { ComputerSettings } from '../../computer/ComputerSettings';
import { computerServicePreferenceAtom } from '../../computer/computerServiceSettings';
import { ConnectedAccountsTile } from '../../connections/ConnectionsSettings';

/** The mode a tap on Send or Enter sends with while an agent replies; a hold picks another. */
function MidTurnSendTile() {
  const { t } = useTranslation();
  const [mode, setMode] = useSetting(settingsAtom, 'midTurnSend');
  const label = t('composer.midTurn.settingTitle');

  return (
    <SettingTile
      focusId="midTurnSend"
      title={label}
      description={t('composer.midTurn.settingDescription')}
      after={
        <ChoiceButton
          label={label}
          value={mode}
          choices={MID_TURN_CHOICES.map((choice) => ({
            value: choice.mode,
            label: t(choice.label),
          }))}
          onChoose={setMode}
        />
      }
    />
  );
}

/**
 * MindRoom › Agents & servers: replying and message defaults for agents, connected accounts,
 * and the MindRoom server this device uses for agents' computers.
 */
export function MindroomSettingsPage({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const { urls, discovered } = useComputerApiUrls();
  const setPreference = useSetAtom(computerServicePreferenceAtom);
  const [saveFailed, setSaveFailed] = useState(false);
  // A server found from the agents is in use but not saved, and secret requests accept only a saved
  // one. Only a single found server is offered: a saved one serves every room's agents.
  const found = discovered && urls.length === 1 ? urls[0] : undefined;

  return (
    <SettingsPageFrame
      title={t('featureUi.settings.menu.pages.agentsServers')}
      requestClose={requestClose}
    >
      <SettingsSection title={t('featureUi.settings.sections.replying')}>
        <MidTurnSendTile />
      </SettingsSection>
      <SettingsSection title={t('settings.general.messages.sectionTitle')}>
        <SettingSwitchTile
          focusId="showToolCalls"
          setting="showToolCalls"
          title={t('mindroomUi.messages.showToolCalls')}
          description={t('mindroomUi.messages.showToolCallsDescription')}
        />
        <SettingSwitchTile
          focusId="showUsageDetails"
          setting="showUsageDetails"
          title={t('mindroomUi.subagents.showUsageDetails')}
          description={t('mindroomUi.subagents.showUsageDetailsDescription')}
        />
      </SettingsSection>
      <SettingsSection title={t('featureUi.settings.sections.connectionsComputers')}>
        {!isBundledApp() && <ConnectedAccountsTile />}
        <SettingTile
          focusId="computerServerInUse"
          title={t('featureUi.settings.computers.inUse')}
          description={
            urls.length > 0 ? urls.join(', ') : t('featureUi.settings.computers.inUseNone')
          }
          after={
            found !== undefined && (
              <Button
                onClick={() => setSaveFailed(!setPreference(found))}
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
          {found !== undefined && saveFailed && (
            <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
              {t('settings.general.computers.saveFailed')}
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
