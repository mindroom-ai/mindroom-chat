import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { Icons, Line, Text, color, config, type RectCords } from 'folds';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { settingsModalAtom } from '../../navigation/settingsModal';
import { SettingsPages } from '../../navigation/settingsPages';
import { MarkRoomsReadMenuItem } from '../../notifications/MarkRoomsReadMenuItem';
import {
  RAIL_BUTTON_ORDER,
  type RailButton,
  useOfferedRailButtons,
  useRailButtonToggle,
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

function RailVisibilitySwitch({ button, label }: { button: RailButton; label: string }) {
  const { t } = useTranslation();
  const { checked, saveFailed, setChecked } = useRailButtonToggle(button);

  return (
    <>
      <MenuSwitchEntry label={label} checked={checked} onToggle={() => setChecked(!checked)} />
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
  nextSettingsRequestId,
}: {
  target: RailMenuTarget;
  onClose: () => void;
  nextSettingsRequestId: () => string;
}) {
  const { t } = useTranslation();
  const offered = useOfferedRailButtons();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const phone = useScreenSizeContext() === ScreenSize.Mobile;

  const buttons = RAIL_BUTTON_ORDER.filter(
    (button) => offered[button] && !(phone && button === 'search')
  );

  const openSidebarSettings = () => {
    onClose();
    setSettingsModal({
      initialPage: SettingsPages.SidebarPage,
      requestId: nextSettingsRequestId(),
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
  const settingsRequestSeq = useRef(0);
  const close = useCallback(() => setMenu(undefined), []);
  const nextSettingsRequestId = useCallback(() => {
    settingsRequestSeq.current += 1;
    return `sidebar-settings-${settingsRequestSeq.current}`;
  }, []);
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
          <RailVisibilityMenuContent
            target={menu.target}
            onClose={close}
            nextSettingsRequestId={nextSettingsRequestId}
          />
        </SidebarContextMenu>
      )}
    </RailVisibilityMenuContext>
  );
}
