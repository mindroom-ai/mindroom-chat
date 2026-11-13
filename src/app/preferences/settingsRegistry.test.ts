import { describe, expect, it } from 'vitest';
import { translateFromEn } from '../../test/utils/i18n';
import {
  SETTINGS,
  SETTINGS_GROUPS,
  SETTINGS_PAGES,
  SETTING_SCOPE_LABEL_KEYS,
  getShownSettingsPages,
  getShownSettings,
  isSettingsPageRequest,
  resolveSettingsPageId,
  type SettingsContext,
} from './settingsRegistry';
import { ROAMING_SETTINGS } from './roamingSettings';

const WEB: SettingsContext = {
  native: false,
  nativeIOS: false,
  localMindroom: true,
  serverAdmin: false,
  useSystemTheme: true,
  developerTools: false,
  errorReporting: false,
  railButtons: { threads: true, canvases: true, explore: true },
};

const translated = (key: string | undefined) => !!key && translateFromEn(key) !== key;

describe('settings registry', () => {
  it('names every page, group and setting once', () => {
    const pageIds = SETTINGS_PAGES.map((page) => page.id);
    const settingIds = SETTINGS.map((setting) => setting.id);
    expect(new Set(pageIds).size).toBe(pageIds.length);
    expect(new Set(settingIds).size).toBe(settingIds.length);
    expect(SETTINGS_PAGES.every((page) => SETTINGS_GROUPS.some((g) => g.id === page.group))).toBe(
      true
    );
    expect(SETTINGS.every((setting) => pageIds.includes(setting.page))).toBe(true);
  });

  it('has English text for every label, description, keyword list and scope', () => {
    const keys = [
      ...SETTINGS_GROUPS.map((group) => group.labelKey),
      ...SETTINGS_PAGES.map((page) => page.labelKey),
      ...Object.values(SETTING_SCOPE_LABEL_KEYS),
      ...SETTINGS.flatMap((setting) => [
        setting.labelKey,
        ...('group' in setting ? [setting.group] : []),
        ...('descriptionKey' in setting ? [setting.descriptionKey] : []),
        ...('keywordsKey' in setting ? [setting.keywordsKey] : []),
      ]),
    ];
    expect(keys.filter((key) => !translated(key))).toEqual([]);
  });

  it('resolves the earlier page ids to the pages that took over their settings', () => {
    expect(resolveSettingsPageId('general')).toBe('appearance');
    expect(resolveSettingsPageId('devices')).toBe('privacy');
    expect(resolveSettingsPageId('emojis-stickers')).toBe('chats');
    expect(resolveSettingsPageId('developer')).toBe('developer-tools');
    expect(resolveSettingsPageId('local-mindroom')).toBe('mindroom.local-mindroom');
    ['account', 'notifications', 'developer-tools', 'about', 'archived-rooms'].forEach((id) =>
      expect(resolveSettingsPageId(id)).toBe(id)
    );
  });

  it("accepts every section the agents' open_settings sends, and nothing else", () => {
    const backendSections = [
      'general',
      'account',
      'notifications',
      'devices',
      'emojis-stickers',
      'developer',
      'about',
    ];
    expect(backendSections.every(isSettingsPageRequest)).toBe(true);
    expect(isSettingsPageRequest('https://evil.example')).toBe(false);
    expect(isSettingsPageRequest('toString')).toBe(false);
    expect(isSettingsPageRequest(undefined)).toBe(false);
  });

  it('leaves out the pages and settings this account or app lacks', () => {
    const app = { ...WEB, native: true, nativeIOS: true, localMindroom: false };
    const webPages = getShownSettingsPages(WEB).map((page) => page.id);
    const appPages = getShownSettingsPages(app).map((page) => page.id);
    expect(webPages).toContain('connections');
    expect(webPages).toContain('mindroom.local-mindroom');
    expect(appPages).not.toContain('connections');
    expect(appPages).not.toContain('mindroom.local-mindroom');
    // The server's accounts only for its administrators.
    expect(webPages).not.toContain('server-accounts');
    expect(getShownSettingsPages({ ...WEB, serverAdmin: true }).map((page) => page.id)).toContain(
      'server-accounts'
    );

    const webSettings = getShownSettings(WEB).map((setting) => setting.id);
    const appSettings = getShownSettings(app).map((setting) => setting.id);
    expect(webSettings).not.toContain('pushNotifications');
    expect(appSettings).toContain('pushNotifications');
    expect(webSettings).toContain('sidebarThreads');
    expect(webSettings).not.toContain('sidebarSearch');
    expect(webSettings).toEqual(expect.arrayContaining(['lightTheme', 'darkTheme']));
    expect(webSettings).not.toContain('theme');
    expect(webSettings).not.toContain('accessToken');
    // Error reports only where the deployment names a collector.
    expect(webSettings).not.toContain('errorReports');
    expect(getShownSettings({ ...WEB, errorReporting: true }).map((s) => s.id)).toContain(
      'errorReports'
    );
  });

  it('labels the roaming settings with the account and keeps every other app setting on the device', () => {
    const scopeOf = (id: string) => SETTINGS.find((setting) => setting.id === id)?.scope;
    Object.keys(ROAMING_SETTINGS).forEach((id) => expect(scopeOf(id), id).toBe('account'));
    // 🔒 Never roamed: per screen, per hardware or permission, read before sign-in, debugging
    // aids, opt-ins that send more to a server, and endpoints.
    const deviceOnly = [
      'systemTheme',
      'theme',
      'lightTheme',
      'darkTheme',
      'pageZoom',
      'messageLayout',
      'messageSpacing',
      'mediaAutoLoad',
      'encUrlPreview',
      'desktopNotifications',
      'notificationSound',
      'pushNotifications',
      'language',
      'computerServer',
      'prefetchScope',
      'developerTools',
      'showHiddenEvents',
      'errorReports',
    ];
    deviceOnly.forEach((id) => {
      expect(scopeOf(id), id).toBe('device');
      expect(Object.keys(ROAMING_SETTINGS), id).not.toContain(id);
    });
    const storedKeys: string[] = Object.values(ROAMING_SETTINGS);
    ['useSystemTheme', 'themeId', 'pageZoom', 'encUrlPreview', 'sendErrorReports'].forEach((key) =>
      expect(storedKeys, key).not.toContain(key)
    );
  });
});
