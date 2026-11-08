import React, { useRef, useState } from 'react';
import { Box, color, Switch, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { SequenceCard } from '../../ui/SequenceCard';
import { SettingTile } from '../../ui/SettingTile';
import {
  RAIL_BUTTON_SETTING,
  type RailButton,
  useOfferedRailButtons,
} from '../railButtons';
import { getCommandPaletteShortcutLabel } from '../../command-palette/commandPaletteShortcut';
import {
  useAccountSettings,
  useSetAccountSettings,
} from '../../matrix/hooks/useAccountSettings';
import type { AccountSettings } from '../../preferences/accountSettings';
import { SIDEBAR_SWITCH_SETTINGS } from '../../preferences/settingsRegistry';

type AgentInterfaceSettingsProps = {
  className?: string;
};

type BooleanAccountSetting = keyof AccountSettings;

type AccountSettingSwitchProps = {
  focusId: string;
  setting: BooleanAccountSetting;
  title: string;
  description: string;
};

function AccountSettingSwitch({
  focusId,
  setting,
  title,
  description,
}: AccountSettingSwitchProps) {
  const { t } = useTranslation();
  const settings = useAccountSettings();
  const setAccountSettings = useSetAccountSettings();
  // setAccountData only resolves once the change echoes back over sync, so
  // show the requested value immediately and hand back to the store when the
  // write settles (echo arrived, or failed and the stored value still rules).
  const [pending, setPending] = useState<boolean>();
  // A failed write snaps the switch back to the stored value; explain why
  // instead of failing silently.
  const [saveFailed, setSaveFailed] = useState(false);
  const requestGeneration = useRef(0);

  const handleChange = (next: boolean) => {
    requestGeneration.current += 1;
    const generation = requestGeneration.current;
    setPending(next);
    setSaveFailed(false);
    setAccountSettings({ [setting]: next })
      .catch(() => {
        if (requestGeneration.current === generation) setSaveFailed(true);
      })
      .finally(() => {
        if (requestGeneration.current === generation) setPending(undefined);
      });
  };

  return (
    <SettingTile
      focusId={focusId}
      title={title}
      description={description}
      after={
        <Switch variant="Primary" value={pending ?? settings[setting]} onChange={handleChange} />
      }
    >
      {saveFailed && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {t('settings.general.interface.saveFailed')}
        </Text>
      )}
    </SettingTile>
  );
}

/**
 * The "Sidebar" group at the top of Settings → General: a switch for each icon rail button the
 * deployment offers, in rail order, backed by `io.mindroom.settings` account data. Each
 * description says where the button's page stays reachable while it is hidden.
 */
export function AgentInterfaceSettings({ className }: AgentInterfaceSettingsProps) {
  const { t } = useTranslation();
  const offered = useOfferedRailButtons();
  const shortcut = getCommandPaletteShortcutLabel();
  const switches: Array<[RailButton, string, string]> = [
    [
      'threads',
      t('featureUi.settings.sidebar.threads'),
      t('featureUi.settings.sidebar.threadsDescription'),
    ],
    [
      'canvases',
      t('settings.general.interface.showCanvasesInSidebar'),
      t('featureUi.settings.sidebar.canvasesDescription'),
    ],
    [
      'explore',
      t('featureUi.settings.sidebar.explore'),
      t('featureUi.settings.sidebar.exploreDescription'),
    ],
    [
      'createSpace',
      t('featureUi.settings.sidebar.createSpace'),
      t('featureUi.settings.sidebar.createSpaceDescription', { shortcut }),
    ],
    [
      'search',
      t('featureUi.settings.sidebar.search'),
      t('featureUi.settings.sidebar.searchDescription', { shortcut }),
    ],
    [
      'localMindroom',
      t('featureUi.settings.sidebar.localMindroom'),
      t('featureUi.settings.sidebar.localMindroomDescription'),
    ],
  ];

  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {t('featureUi.settings.sidebar.title')}
      </Text>
      <SequenceCard className={className} variant="SurfaceVariant" direction="Column" gap="400">
        {switches
          .filter(([button]) => offered[button])
          .map(([button, title, description]) => (
            <AccountSettingSwitch
              key={button}
              focusId={SIDEBAR_SWITCH_SETTINGS[button]}
              setting={RAIL_BUTTON_SETTING[button]}
              title={title}
              description={description}
            />
          ))}
      </SequenceCard>
    </Box>
  );
}
