import { describe, expect, it } from 'vitest';
import { type TFunction } from 'i18next';
import { ScreenSize } from '../../hooks/useScreenSize';
import { SettingsPages } from '../../features/settings/settingsPages';
import {
  getSettingsMenuItems,
  resolveSettingsInitialPage,
} from '../../features/settings/settingsMenu';
import { translateFromEn } from '../../test-utils/i18n';
import { LOCAL_MINDROOM_SETTINGS_PAGE } from './settingsPage';

const t = translateFromEn as unknown as TFunction;

describe('getSettingsMenuItems', () => {
  it('omits the Local MindRoom entry when disabled', () => {
    const items = getSettingsMenuItems(false, t);

    expect(items.some((item) => item.page === LOCAL_MINDROOM_SETTINGS_PAGE)).toBe(false);
  });

  it('keeps the Local MindRoom entry when enabled', () => {
    const items = getSettingsMenuItems(true, t);

    expect(items.find((item) => item.page === LOCAL_MINDROOM_SETTINGS_PAGE)).toMatchObject({
      name: 'Local MindRoom',
    });
  });

  it('translates the base entries through t()', () => {
    const items = getSettingsMenuItems(false, t);

    expect(items.map((item) => item.name)).toEqual([
      'Account',
      'Notifications',
      'Privacy & security',
      'Appearance',
      'Chats',
      'Sidebar',
      'Language & region',
      'Connected accounts',
      'Computers',
      'Archived Rooms',
      'Storage & offline',
      'Developer Tools',
      'About',
    ]);
  });

  it('leaves Connections out of the apps, which cannot open its window', () => {
    const items = getSettingsMenuItems(false, t, true);

    expect(items.some((item) => item.page === SettingsPages.ConnectionsPage)).toBe(false);
  });
});

describe('resolveSettingsInitialPage', () => {
  it('preserves an explicit page request', () => {
    expect(resolveSettingsInitialPage(SettingsPages.PrivacyPage, ScreenSize.Desktop, false)).toBe(
      SettingsPages.PrivacyPage
    );
  });

  it('opens the page that took over an earlier page id', () => {
    expect(resolveSettingsInitialPage('general', ScreenSize.Desktop, false)).toBe(
      SettingsPages.AppearancePage
    );
    expect(resolveSettingsInitialPage('devices', ScreenSize.Mobile, false)).toBe(
      SettingsPages.PrivacyPage
    );
  });

  it('falls back to the default page when Local MindRoom is requested but disabled', () => {
    expect(
      resolveSettingsInitialPage(LOCAL_MINDROOM_SETTINGS_PAGE, ScreenSize.Desktop, false)
    ).toBe(SettingsPages.AppearancePage);
  });

  it('keeps mobile settings closed when no initial page is requested', () => {
    expect(resolveSettingsInitialPage(undefined, ScreenSize.Mobile, false)).toBeUndefined();
  });
});
