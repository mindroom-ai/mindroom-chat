// Pages of the settings dialog. MindRoom extensions add their own page IDs
// (archived rooms, Local MindRoom) next to the core ones.

export const SettingsPages = {
  GeneralPage: 'general',
  AccountPage: 'account',
  NotificationPage: 'notifications',
  DevicesPage: 'devices',
  EmojisStickersPage: 'emojis-stickers',
  DeveloperToolsPage: 'developer-tools',
  AboutPage: 'about',
} as const;

export type CoreSettingsPage = (typeof SettingsPages)[keyof typeof SettingsPages];

export type SettingsPage = CoreSettingsPage | 'archived-rooms' | 'mindroom.local-mindroom';
