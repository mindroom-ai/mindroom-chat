import { Icons, IconSrc } from 'folds';
import { ScreenSize } from '../../hooks/useScreenSize';
import { SettingsPages } from './settingsPages';
import { MINDROOM_APP_NAME } from '../../mindroom/branding/branding';

export type SettingsMenuItem = {
  page: SettingsPages;
  name: string;
  icon: IconSrc;
};

const baseSettingsMenuItems: SettingsMenuItem[] = [
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
  {
    page: SettingsPages.LocalMindroomPage,
    name: `Local ${MINDROOM_APP_NAME}`,
    icon: Icons.Link,
  },
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
  baseSettingsMenuItems.filter(
    (item) => showLocalMindRoom || item.page !== SettingsPages.LocalMindroomPage
  );

export const resolveSettingsInitialPage = (
  initialPage: SettingsPages | undefined,
  screenSize: ScreenSize,
  showLocalMindRoom: boolean
): SettingsPages | undefined => {
  if (initialPage !== undefined) {
    if (!showLocalMindRoom && initialPage === SettingsPages.LocalMindroomPage) {
      return SettingsPages.GeneralPage;
    }

    return initialPage;
  }

  return screenSize === ScreenSize.Mobile ? undefined : SettingsPages.GeneralPage;
};
