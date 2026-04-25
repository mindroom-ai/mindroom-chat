import { Icons, IconSrc } from 'folds';
import { ScreenSize } from '../../hooks/useScreenSize';
import { SettingsPage, SettingsPages } from './settingsPages';
import { getLocalMindroomSettingsMenuItems } from '../../mindroom/local-mindroom/settingsMenu';
import { resolveLocalMindroomInitialSettingsPage } from '../../mindroom/local-mindroom/settingsPage';

export type SettingsMenuItem = {
  page: SettingsPage;
  name: string;
  icon: IconSrc;
};

const getBaseSettingsMenuItems = (showLocalMindRoom: boolean): SettingsMenuItem[] => [
  {
    page: SettingsPages.GeneralPage,
    name: 'General',
    icon: Icons.Setting,
  },
  {
    page: SettingsPages.AccountPage,
    name: 'Account',
    icon: Icons.User,
  },
  {
    page: SettingsPages.NotificationPage,
    name: 'Notifications',
    icon: Icons.Bell,
  },
  {
    page: SettingsPages.DevicesPage,
    name: 'Devices',
    icon: Icons.Monitor,
  },
  {
    page: SettingsPages.EmojisStickersPage,
    name: 'Emojis & Stickers',
    icon: Icons.Smile,
  },
  ...getLocalMindroomSettingsMenuItems(showLocalMindRoom),
  {
    page: SettingsPages.DeveloperToolsPage,
    name: 'Developer Tools',
    icon: Icons.Terminal,
  },
  {
    page: SettingsPages.AboutPage,
    name: 'About',
    icon: Icons.Info,
  },
];

export const getSettingsMenuItems = (showLocalMindRoom: boolean): SettingsMenuItem[] =>
  getBaseSettingsMenuItems(showLocalMindRoom);

export const resolveSettingsInitialPage = (
  initialPage: SettingsPage | undefined,
  screenSize: ScreenSize,
  showLocalMindRoom: boolean
): SettingsPage | undefined => {
  const resolvedInitialPage = resolveLocalMindroomInitialSettingsPage(
    initialPage,
    showLocalMindRoom
  );
  if (resolvedInitialPage !== undefined) return resolvedInitialPage;

  return screenSize === ScreenSize.Mobile ? undefined : SettingsPages.GeneralPage;
};
