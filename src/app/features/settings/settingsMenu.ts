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

/** Settings dialog menu entries, in display order. */
export const getSettingsMenuItems = (
  showLocalMindroom: boolean,
  t: TFunction
): SettingsMenuItem[] => [
  {
    page: SettingsPages.GeneralPage,
    name: t('settings.nav.general'),
    icon: Icons.Setting,
  },
  { page: SettingsPages.AccountPage, name: t('settings.nav.account'), icon: Icons.User },
  {
    page: SettingsPages.NotificationPage,
    name: t('settings.nav.notifications'),
    icon: Icons.Bell,
  },
  {
    page: SettingsPages.DevicesPage,
    name: t('settings.nav.devices'),
    icon: Icons.Monitor,
  },
  {
    page: SettingsPages.EmojisStickersPage,
    name: t('settings.nav.emojisStickers'),
    icon: Icons.Smile,
  },
  ...getMindroomSettingsMenuItems(showLocalMindroom, t),
  {
    page: SettingsPages.DeveloperToolsPage,
    name: t('settings.nav.developerTools'),
    icon: Icons.Terminal,
  },
  { page: SettingsPages.AboutPage, name: t('settings.nav.about'), icon: Icons.Info },
];

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
