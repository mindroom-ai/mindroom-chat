import { useState } from 'react';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Box, Button, Text, color } from 'folds';
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
  // Servers found from the agents are in use for computers but not saved, and secret requests
  // accept only a saved origin. Offer each found server so the user can pick one even when rooms'
  // agents publish several; saving one sets this device's server for every room.
  const foundUrls = discovered ? urls : [];
  const singleFound = foundUrls.length === 1 ? foundUrls[0] : undefined;
  const multipleFound = foundUrls.length > 1;
  let description = t('featureUi.settings.computers.inUseNone');
  if (multipleFound) description = t('featureUi.settings.computers.foundNotSaved');
  else if (urls.length > 0) description = urls.join(', ');

  const saveServerButton = (url: string) => (
    <Button
      onClick={() => setSaveFailed(!setPreference(url))}
      variant="Secondary"
      fill="Soft"
      size="300"
      radii="300"
    >
      <Text size="B300">
        {t('featureUi.settings.computers.useServer', { host: new URL(url).host })}
      </Text>
    </Button>
  );

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
          description={description}
          after={singleFound !== undefined && saveServerButton(singleFound)}
        >
          {singleFound !== undefined && (
            <Text priority="300" size="T200">
              {t('featureUi.settings.computers.foundNotSaved')}
            </Text>
          )}
          {multipleFound && (
            <Box direction="Column" gap="300">
              {foundUrls.map((url) => (
                <SettingTile key={url} description={url} after={saveServerButton(url)} />
              ))}
            </Box>
          )}
          {foundUrls.length > 0 && saveFailed && (
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
