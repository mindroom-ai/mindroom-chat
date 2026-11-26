import { Box, color, Switch, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { SequenceCard } from '../../ui/SequenceCard';
import { SettingTile } from '../../ui/SettingTile';
import { type RailButton, useOfferedRailButtons, useRailButtonToggle } from '../railButtons';
import { getCommandPaletteShortcutLabel } from '../../shortcuts/paletteShortcut';
import { formatShortcut } from '../../shortcuts/shortcuts';
import { SIDEBAR_SWITCH_SETTINGS } from '../../preferences/settingsRegistry';

type AgentInterfaceSettingsProps = {
  className?: string;
};

type AccountSettingSwitchProps = {
  focusId: string;
  button: RailButton;
  title: string;
  description: string;
};

function AccountSettingSwitch({ focusId, button, title, description }: AccountSettingSwitchProps) {
  const { t } = useTranslation();
  const { checked, saveFailed, setChecked } = useRailButtonToggle(button);

  return (
    <SettingTile
      focusId={focusId}
      title={title}
      description={description}
      after={<Switch variant="Primary" value={checked} onChange={setChecked} />}
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
  const sections: Array<{
    id: 'navigation' | 'mindroom';
    title: string;
    switches: Array<[RailButton, string, string]>;
  }> = [
    {
      id: 'navigation',
      title: t('featureUi.settings.sidebar.navigation'),
      switches: [
        [
          'direct',
          t('featureUi.settings.sidebar.direct'),
          t('featureUi.settings.sidebar.directDescription'),
        ],
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
      id: 'mindroom',
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
        .map(({ id, title, switches }) => ({
          id,
          title,
          switches: switches.filter(([button]) => offered[button]),
        }))
        .filter(({ switches }) => switches.length > 0)
        .map(({ id, title, switches }) => (
          <Box key={id} direction="Column" gap="100">
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
                  button={button}
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
