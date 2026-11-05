import type { SettingsPageId, SettingsPageRequest } from '../preferences/settingsRegistry';

// The pages of the settings dialog; settingsRegistry.ts says what each holds and where it sits.
export const SettingsPages = {
  AccountPage: 'account',
  NotificationPage: 'notifications',
  PrivacyPage: 'privacy',
  AppearancePage: 'appearance',
  ChatsPage: 'chats',
  SidebarPage: 'sidebar',
  LanguagePage: 'language',
  ConnectionsPage: 'connections',
  ComputersPage: 'computers',
  LocalMindroomPage: 'mindroom.local-mindroom',
  ArchivedRoomsPage: 'archived-rooms',
  StoragePage: 'storage',
  DeveloperToolsPage: 'developer-tools',
  AboutPage: 'about',
} as const satisfies Record<string, SettingsPageId>;

/** A page to open the dialog on: its id, or an earlier id that now leads to it. */
export type SettingsPage = SettingsPageRequest;
