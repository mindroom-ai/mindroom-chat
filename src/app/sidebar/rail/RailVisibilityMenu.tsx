import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { Icons, Line, Text, color, config, type RectCords } from 'folds';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { useAccountSettings, useSetAccountSettings } from '../../matrix/hooks/useAccountSettings';
import { settingsModalAtom } from '../../navigation/settingsModal';
import { SettingsPages } from '../../navigation/settingsPages';
import { MarkRoomsReadMenuItem } from '../../notifications/MarkRoomsReadMenuItem';
import type { AccountSettings } from '../../preferences/accountSettings';
import {
  RAIL_BUTTON_SETTING,
  type RailButton,
  useOfferedRailButtons,
} from '../../settings/railButtons';
import { MenuEntry, MenuGroup, MenuSwitchEntry } from '../../ui/MenuEntry';
import { useDirectRoomIds } from '../direct/useDirectRooms';
import { SidebarContextMenu } from './SidebarContextMenu';
import {
  RailVisibilityMenuContext,
  type RailMenuTarget,
  type RailVisibilityMenuContextValue,
} from './railVisibilityMenuContext';

type RailMenuState = {
  anchor: RectCords;
  target: RailMenuTarget;
};

const RAIL_BUTTON_ORDER: readonly RailButton[] = [
  'direct',
  'threads',
  'canvases',
  'usage',
  'explore',
  'createSpace',
  'search',
  'localMindroom',
  'help',
];

const RAIL_BUTTON_LABEL_KEY = {
  direct: 'nav.directMessages',
  threads: 'nav.threads',
  canvases: 'nav.canvases',
  usage: 'nav.usage',
  explore: 'nav.exploreCommunity',
  createSpace: 'nav.createSpace',
  search: 'sharedUi.searchInput.search',
  localMindroom: 'mindroomUi.sidebar.mindroomTab.localMindroom',
  help: 'tour.help.button',
} as const satisfies Record<RailButton, string>;

let sidebarSettingsRequestSeq = 0;

function DirectMarkReadSection({ onClose }: { onClose: () => void }) {
  const roomIds = useDirectRoomIds();
  return (
    <>
      <MenuGroup>
        <MarkRoomsReadMenuItem roomIds={roomIds} onClose={onClose} />
      </MenuGroup>
      <Line variant="Surface" size="300" />
    </>
  );
}

function RailVisibilitySwitch({
  button,
  label,
  stored,
  setAccountSettings,
}: {
  button: RailButton;
  label: string;
  stored: boolean;
  setAccountSettings: (patch: Partial<AccountSettings>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<boolean>();
  const [saveFailed, setSaveFailed] = useState(false);
  const requestGeneration = useRef(0);
  const checked = pending ?? stored;

  const handleToggle = () => {
    const next = !checked;
    requestGeneration.current += 1;
    const generation = requestGeneration.current;
    setPending(next);
    setSaveFailed(false);
    setAccountSettings({ [RAIL_BUTTON_SETTING[button]]: next })
      .catch(() => {
        if (requestGeneration.current === generation) setSaveFailed(true);
      })
      .finally(() => {
        if (requestGeneration.current === generation) setPending(undefined);
      });
  };

  return (
    <>
      <MenuSwitchEntry label={label} checked={checked} onToggle={handleToggle} />
      {saveFailed && (
        <Text
          size="T200"
          role="alert"
          style={{ color: color.Critical.Main, paddingInline: config.space.S200 }}
        >
          {t('settings.general.interface.saveFailed')}
        </Text>
      )}
    </>
  );
}

/** Menu body mounted only while open so closed-rail renders add no store subscriptions. */
function RailVisibilityMenuContent({
  target,
  onClose,
}: {
  target: RailMenuTarget;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const offered = useOfferedRailButtons();
  const settings = useAccountSettings();
  const setAccountSettings = useSetAccountSettings();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const phone = useScreenSizeContext() === ScreenSize.Mobile;

  const buttons = RAIL_BUTTON_ORDER.filter(
    (button) => offered[button] && !(phone && button === 'search')
  );

  const openSidebarSettings = () => {
    onClose();
    sidebarSettingsRequestSeq += 1;
    setSettingsModal({
      initialPage: SettingsPages.SidebarPage,
      requestId: `sidebar-settings-${sidebarSettingsRequestSeq}`,
    });
  };

  return (
    <>
      {target === 'direct' && <DirectMarkReadSection onClose={onClose} />}
      <MenuGroup label={t('mindroomUi.sidebar.visibilityMenu.showInSidebar')}>
        {buttons.map((button) => (
          <RailVisibilitySwitch
            key={button}
            button={button}
            label={t(RAIL_BUTTON_LABEL_KEY[button])}
            stored={settings[RAIL_BUTTON_SETTING[button]]}
            setAccountSettings={setAccountSettings}
          />
        ))}
      </MenuGroup>
      <Line variant="Surface" size="300" />
      <MenuGroup>
        <MenuEntry
          icon={Icons.Setting}
          label={t('mindroomUi.sidebar.visibilityMenu.sidebarSettings')}
          onSelect={openSidebarSettings}
        />
      </MenuGroup>
    </>
  );
}

/**
 * Hosts the shared right-click / long-press sidebar customization menu for the icon rail.
 * Keeping the state above individual buttons lets the menu stay open even after toggling off the
 * button that opened it.
 */
export function RailVisibilityMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<RailMenuState>();
  const close = useCallback(() => setMenu(undefined), []);
  const openMenu = useCallback((target: RailMenuTarget, anchor: RectCords, toggle = false) => {
    setMenu((current) => (toggle && current?.target === target ? undefined : { anchor, target }));
  }, []);
  const value = useMemo<RailVisibilityMenuContextValue>(
    () => ({ openTarget: menu?.target, openMenu }),
    [menu?.target, openMenu]
  );

  return (
    <RailVisibilityMenuContext value={value}>
      {children}
      {menu && (
        <SidebarContextMenu
          key={`${menu.target}:${menu.anchor.x}:${menu.anchor.y}`}
          anchor={menu.anchor}
          onClose={close}
          width={220}
        >
          <RailVisibilityMenuContent target={menu.target} onClose={close} />
        </SidebarContextMenu>
      )}
    </RailVisibilityMenuContext>
  );
}
