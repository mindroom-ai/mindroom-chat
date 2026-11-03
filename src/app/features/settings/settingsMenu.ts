import { Icons, type IconSrc } from 'folds';
import type { TFunction } from 'i18next';
import type { ScreenSize } from '../../hooks/useScreenSize';
import {
  getMindroomSettingsMenuItems,
  resolveMindroomSettingsInitialPage,
} from '../../mindroom/settings/settingsMenuExtensions';
import { SettingsPages, type SettingsPage } from './settingsPages';

export type SettingsMenuItem = {
  page: SettingsPage;
  name: string;
  icon: IconSrc;
};

// Core pages above the MindRoom entries, then the ones below them.
const CORE_ENTRIES_ABOVE = [
  [SettingsPages.GeneralPage, 'settings.nav.general', Icons.Setting],
  [SettingsPages.AccountPage, 'settings.nav.account', Icons.User],
  [SettingsPages.NotificationPage, 'settings.nav.notifications', Icons.Bell],
  [SettingsPages.DevicesPage, 'settings.nav.devices', Icons.Monitor],
  [SettingsPages.EmojisStickersPage, 'settings.nav.emojisStickers', Icons.Smile],
] as const;
const CORE_ENTRIES_BELOW = [
  [SettingsPages.DeveloperToolsPage, 'settings.nav.developerTools', Icons.Terminal],
  [SettingsPages.AboutPage, 'settings.nav.about', Icons.Info],
] as const;

type CoreMenuEntry = (typeof CORE_ENTRIES_ABOVE | typeof CORE_ENTRIES_BELOW)[number];

/** Settings dialog menu entries, in display order. */
export const getSettingsMenuItems = (
  showLocalMindroom: boolean,
  t: TFunction
): SettingsMenuItem[] => {
  const translate = ([page, labelKey, icon]: CoreMenuEntry): SettingsMenuItem => ({
    page,
    icon,
    name: t(labelKey),
  });
  return CORE_ENTRIES_ABOVE.map(translate).concat(
    getMindroomSettingsMenuItems(showLocalMindroom, t),
    CORE_ENTRIES_BELOW.map(translate)
  );
};

/**
 * The page the dialog opens on. Without a request, desktop opens General and
 * mobile shows the menu; a request for a page that is not offered falls back.
 */
export const resolveSettingsInitialPage = (
  initialPage: SettingsPage | undefined,
  screenSize: ScreenSize,
  showLocalMindroom: boolean
): SettingsPage | undefined =>
  resolveMindroomSettingsInitialPage(initialPage, screenSize, showLocalMindroom);
