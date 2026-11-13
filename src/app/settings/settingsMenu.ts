import { Icons, type IconSrc } from 'folds';
import type { TFunction } from 'i18next';
import { ScreenSize } from '../lib/hooks/useScreenSize';
import {
  DEFAULT_SETTINGS_PAGE,
  getShownSettingsPages,
  isSettingsPageShown,
  resolveSettingsPageId,
  type SettingsGroupId,
  type SettingsPageId,
} from '../preferences/settingsRegistry';
import type { SettingsPage } from '../navigation/settingsPages';

export type SettingsMenuItem = {
  page: SettingsPageId;
  group: SettingsGroupId;
  name: string;
  icon: IconSrc;
};

const PAGE_ICONS: Record<SettingsPageId, IconSrc> = {
  account: Icons.User,
  notifications: Icons.Bell,
  privacy: Icons.ShieldLock,
  appearance: Icons.Sun,
  chats: Icons.Message,
  sidebar: Icons.Category,
  language: Icons.Globe,
  connections: Icons.Link,
  computers: Icons.Monitor,
  'mindroom.local-mindroom': Icons.Server,
  'archived-rooms': Icons.Inbox,
  'server-accounts': Icons.ShieldUser,
  storage: Icons.Download,
  'developer-tools': Icons.Terminal,
  about: Icons.Info,
};

/**
 * The menu entries in display order, grouped by `group`; `native` is the iOS or Android app and
 * `serverAdmin` an administrator of the homeserver.
 */
export const getSettingsMenuItems = (
  showLocalMindroom: boolean,
  t: TFunction,
  native = false,
  serverAdmin = false
): SettingsMenuItem[] =>
  getShownSettingsPages({ native, localMindroom: showLocalMindroom, serverAdmin }).map((page) => ({
    page: page.id,
    group: page.group,
    name: t(page.labelKey),
    icon: PAGE_ICONS[page.id],
  }));

/**
 * The page the dialog opens on. A request names a page by its id or an earlier one; one for a
 * page that is not offered opens the default page. Without a request, desktop opens the default
 * page and phones show the menu.
 */
export const resolveSettingsInitialPage = (
  initialPage: SettingsPage | undefined,
  screenSize: ScreenSize,
  showLocalMindroom: boolean,
  native = false,
  serverAdmin = false
): SettingsPageId | undefined => {
  if (initialPage === undefined) {
    return screenSize === ScreenSize.Mobile ? undefined : DEFAULT_SETTINGS_PAGE;
  }
  const page = resolveSettingsPageId(initialPage);
  const shown =
    page !== undefined &&
    isSettingsPageShown(page, { native, localMindroom: showLocalMindroom, serverAdmin });
  return shown ? page : DEFAULT_SETTINGS_PAGE;
};
