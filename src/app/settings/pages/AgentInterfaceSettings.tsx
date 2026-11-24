import { useRef, useState } from 'react';
import { Box, color, Switch, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { SequenceCard } from '../../ui/SequenceCard';
import { SettingTile } from '../../ui/SettingTile';
import { RAIL_BUTTON_SETTING, type RailButton, useOfferedRailButtons } from '../railButtons';
import { getCommandPaletteShortcutLabel } from '../../shortcuts/paletteShortcut';
import { formatShortcut } from '../../shortcuts/shortcuts';
import { useAccountSettings, useSetAccountSettings } from '../../matrix/hooks/useAccountSettings';
import type { BooleanAccountSetting } from '../../preferences/accountSettings';
import { SIDEBAR_SWITCH_SETTINGS } from '../../preferences/settingsRegistry';

type AgentInterfaceSettingsProps = {
  className?: string;
};

type AccountSettingSwitchProps = {
  focusId: string;
  setting: BooleanAccountSetting;
  title: string;
  description: string;
};

function AccountSettingSwitch({ focusId, setting, title, description }: AccountSettingSwitchProps) {
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
 * Settings › Sidebar: switches for each icon rail button the deployment offers, split into
 * Navigation and MindRoom sections and backed by `io.mindroom.settings` account data. Each
 * description says where the button's page stays reachable while it is hidden.
 */
export function AgentInterfaceSettings({ className }: AgentInterfaceSettingsProps) {
  const { t } = useTranslation();
  const offered = useOfferedRailButtons();
  const shortcut = getCommandPaletteShortcutLabel();
  const helpShortcut = formatShortcut('help');
  const sections: Array<{ title: string; switches: Array<[RailButton, string, string]> }> = [
    {
      title: t('featureUi.settings.sidebar.navigation'),
      switches: [
        [
          'threads',
          t('featureUi.settings.sidebar.threads'),
          t('featureUi.settings.sidebar.threadsDescription'),
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
          'help',
          t('featureUi.settings.sidebar.help'),
          t('featureUi.settings.sidebar.helpDescription', { shortcut, helpShortcut }),
        ],
      ],
    },
    {
      title: t('featureUi.settings.menu.groups.mindroom'),
      switches: [
        [
          'canvases',
          t('settings.general.interface.showCanvasesInSidebar'),
          t('featureUi.settings.sidebar.canvasesDescription'),
        ],
        [
          'usage',
          t('featureUi.settings.sidebar.usage'),
          t('featureUi.settings.sidebar.usageDescription'),
        ],
        [
          'localMindroom',
          t('featureUi.settings.sidebar.localMindroom'),
          t('featureUi.settings.sidebar.localMindroomDescription'),
        ],
      ],
    },
  ];

  return (
    <>
      {sections
        .map(({ title, switches }) => ({
          title,
          switches: switches.filter(([button]) => offered[button]),
        }))
        .filter(({ switches }) => switches.length > 0)
        .map(({ title, switches }) => (
          <Box key={title} direction="Column" gap="100">
            <Text size="L400" data-settings-heading="">
              {title}
            </Text>
            <SequenceCard
              className={className}
              variant="SurfaceVariant"
              direction="Column"
              gap="400"
            >
              {switches.map(([button, label, description]) => (
                <AccountSettingSwitch
                  key={button}
                  focusId={SIDEBAR_SWITCH_SETTINGS[button]}
                  setting={RAIL_BUTTON_SETTING[button]}
                  title={label}
                  description={description}
                />
              ))}
            </SequenceCard>
          </Box>
        ))}
    </>
  );
}
