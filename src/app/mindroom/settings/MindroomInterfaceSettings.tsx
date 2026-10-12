import React, { type MouseEventHandler, useRef, useState } from 'react';
import {
  Box,
  Button,
  color,
  config,
  Icon,
  Icons,
  PopOut,
  type RectCords,
  Switch,
  Text,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { useClientConfig } from '../../hooks/useClientConfig';
import { stopPropagation } from '../../utils/keyboard';
import {
  useMindroomAccountSettings,
  useSetMindroomAccountSettings,
} from './useMindroomAccountSettings';
import {
  LONG_MESSAGE_FOLDING_VALUES,
  type LongMessageFolding,
  type MindroomAccountSettings,
} from './mindroomAccountSettings';

type MindroomInterfaceSettingsProps = {
  className?: string;
};

type MindroomBooleanSetting = keyof Pick<
  MindroomAccountSettings,
  'simpleMode' | 'showCanvasesInSidebar'
>;

function usePendingAccountSetting<K extends keyof MindroomAccountSettings>(setting: K) {
  const settings = useMindroomAccountSettings();
  const setAccountSettings = useSetMindroomAccountSettings();
  // setAccountData only resolves once the change echoes back over sync, so
  // show the requested value immediately and hand back to the store when the
  // write settles (echo arrived, or failed and the stored value still rules).
  const [pending, setPending] = useState<MindroomAccountSettings[K]>();
  // A failed write snaps the control back to the stored value; explain why
  // instead of failing silently.
  const [saveFailed, setSaveFailed] = useState(false);
  const requestGeneration = useRef(0);

  const save = (next: MindroomAccountSettings[K]) => {
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

  return { value: pending ?? settings[setting], save, saveFailed };
}

function SaveFailedText() {
  const { t } = useTranslation();
  return (
    <Text size="T200" style={{ color: color.Critical.Main }}>
      {t('settings.general.interface.saveFailed')}
    </Text>
  );
}

type MindroomAccountSwitchProps = {
  setting: MindroomBooleanSetting;
  title: string;
  description: string;
};

function MindroomAccountSwitch({ setting, title, description }: MindroomAccountSwitchProps) {
  const { value, save, saveFailed } = usePendingAccountSetting(setting);

  return (
    <SettingTile
      title={title}
      description={description}
      after={<Switch variant="Primary" value={value} onChange={save} />}
    >
      {saveFailed && <SaveFailedText />}
    </SettingTile>
  );
}

const LONG_MESSAGE_FOLDING_LABEL_KEYS = {
  auto: 'settings.general.interface.longMessageFoldingAuto',
  on: 'settings.general.interface.longMessageFoldingOn',
  off: 'settings.general.interface.longMessageFoldingOff',
} as const satisfies Record<LongMessageFolding, string>;

function LongMessageFoldingSetting() {
  const { t } = useTranslation();
  const { value, save, saveFailed } = usePendingAccountSetting('longMessageFolding');
  const [menuCords, setMenuCords] = useState<RectCords>();

  const handleMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleSelect = (folding: LongMessageFolding) => {
    setMenuCords(undefined);
    if (folding !== value) save(folding);
  };

  return (
    <SettingTile
      title={t('settings.general.interface.longMessageFolding')}
      description={t('settings.general.interface.longMessageFoldingDescription')}
      after={
        <>
          <Button
            size="300"
            variant="Secondary"
            outlined
            fill="Soft"
            radii="300"
            after={<Icon size="300" src={Icons.ChevronBottom} />}
            aria-haspopup="menu"
            aria-expanded={menuCords !== undefined}
            onClick={handleMenu}
          >
            <Text size="T300">{t(LONG_MESSAGE_FOLDING_LABEL_KEYS[value])}</Text>
          </Button>
          <PopOut
            anchor={menuCords}
            offset={5}
            position="Bottom"
            align="End"
            content={
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  onDeactivate: () => setMenuCords(undefined),
                  clickOutsideDeactivates: true,
                  isKeyForward: (evt: KeyboardEvent) =>
                    evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
                  isKeyBackward: (evt: KeyboardEvent) =>
                    evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
                  escapeDeactivates: stopPropagation,
                }}
              >
                <Menu role="menu">
                  <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                    {LONG_MESSAGE_FOLDING_VALUES.map((folding) => (
                      <MenuItem
                        key={folding}
                        role="menuitemradio"
                        aria-checked={folding === value}
                        size="300"
                        variant={folding === value ? 'Primary' : 'Surface'}
                        radii="300"
                        onClick={() => handleSelect(folding)}
                      >
                        <Text size="T300">{t(LONG_MESSAGE_FOLDING_LABEL_KEYS[folding])}</Text>
                      </MenuItem>
                    ))}
                  </Box>
                </Menu>
              </FocusTrap>
            }
          />
        </>
      }
    >
      {saveFailed && <SaveFailedText />}
    </SettingTile>
  );
}

/**
 * The "Interface" group at the top of Settings → General. Its controls are
 * backed by `io.mindroom.settings` account data. This group must stay visible
 * while simple mode is ON — it is the way back out.
 */
export function MindroomInterfaceSettings({ className }: MindroomInterfaceSettingsProps) {
  const { t } = useTranslation();
  const canvasesEnabled = useClientConfig().mindroom?.canvas?.enabled === true;

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('settings.general.interface.sectionTitle')}</Text>
      <SequenceCard className={className} variant="SurfaceVariant" direction="Column" gap="400">
        <MindroomAccountSwitch
          setting="simpleMode"
          title={t('settings.general.interface.simpleMode')}
          description={t('settings.general.interface.simpleModeDescription')}
        />
        <LongMessageFoldingSetting />
        {canvasesEnabled && (
          <MindroomAccountSwitch
            setting="showCanvasesInSidebar"
            title={t('settings.general.interface.showCanvasesInSidebar')}
            description={t('settings.general.interface.showCanvasesInSidebarDescription')}
          />
        )}
      </SequenceCard>
    </Box>
  );
}
