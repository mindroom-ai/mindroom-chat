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
import { searchSettings } from '../settings/settingsSearchIndex';

const WEB: SettingsContext = {
  native: false,
  nativeIOS: false,
  diagnostics: false,
  localMindroom: true,
  serverAdmin: false,
  useSystemTheme: true,
  developerTools: false,
  errorReporting: false,
  railButtons: { threads: true, canvases: true, explore: true },
  nativeUpdate: false,
  macApp: false,
  hasPlugins: false,
  desktopAccess: false,
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
    expect(resolveSettingsPageId('connections')).toBe('mindroom');
    expect(resolveSettingsPageId('computers')).toBe('mindroom');
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
    expect(webPages).toContain('mindroom');
    expect(appPages).toContain('mindroom');
    expect(webPages.indexOf('archived-rooms')).toBe(webPages.indexOf('chats') + 1);
    expect(webPages).toContain('mindroom.local-mindroom');
    expect(appPages).not.toContain('mindroom.local-mindroom');
    // The Apple Watch only in the iOS app.
    expect(appPages).toContain('apple-watch');
    expect(webPages).not.toContain('apple-watch');
    expect(
      getShownSettingsPages({ ...app, nativeIOS: false }).map((page) => page.id)
    ).not.toContain('apple-watch');
    // The server's accounts only for its administrators.
    expect(webPages).not.toContain('server-accounts');
    expect(getShownSettingsPages({ ...WEB, serverAdmin: true }).map((page) => page.id)).toContain(
      'server-accounts'
    );
    // Plugins only when deployment config leaves at least one bundled plugin enabled.
    expect(webPages).not.toContain('plugins');
    const withPlugins = getShownSettingsPages({ ...WEB, hasPlugins: true }).map((page) => page.id);
    expect(withPlugins).toContain('plugins');
    expect(withPlugins.indexOf('plugins')).toBe(withPlugins.indexOf('sidebar') + 1);
    expect(withPlugins.indexOf('language')).toBe(withPlugins.indexOf('plugins') + 1);

    const webSettings = getShownSettings(WEB).map((setting) => setting.id);
    const appSettings = getShownSettings(app).map((setting) => setting.id);
    expect(webSettings).toContain('connectedAccounts');
    expect(appSettings).not.toContain('connectedAccounts');
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
    // Debug mode everywhere, the iOS app included; the diagnostics wherever they record.
    expect(webSettings).toContain('debugMode');
    expect(webSettings).not.toContain('diagnosticsExport');
    expect(getShownSettings({ ...WEB, diagnostics: true }).map((s) => s.id)).toEqual(
      expect.arrayContaining(['debugMode', 'diagnosticsExport', 'deepTrace'])
    );
    expect(getShownSettings({ ...app, diagnostics: true }).map((s) => s.id)).toEqual(
      expect.arrayContaining(['debugMode', 'diagnosticsExport', 'deepTrace'])
    );
  });

  it('lists the interface tour on About, where Settings search finds it by "tour" and "tutorial"', () => {
    const found = (query: string) =>
      searchSettings(query, getShownSettings(WEB), (key, values) => translateFromEn(key, values));
    const [tour, ...others] = found('tour');
    expect(tour?.setting).toMatchObject({ id: 'tour', page: 'about', scope: 'device' });
    expect(tour?.label).toBe('See how threads work');
    expect(tour?.location).toEqual(['About', 'Tour']);
    expect(others).toEqual([]);
    expect(found('tutorial').map(({ setting }) => setting.id)).toEqual(['tour']);
  });

  it('lists the Mac app on About only in a browser on a Mac, where search finds it by "mac"', () => {
    const found = (context: SettingsContext, query: string) =>
      searchSettings(query, getShownSettings(context), (key, values) =>
        translateFromEn(key, values)
      ).map(({ setting }) => setting.id);
    expect(getShownSettings(WEB).map((setting) => setting.id)).not.toContain('macApp');
    expect(found({ ...WEB, macApp: true }, 'mac')).toContain('macApp');
    expect(found({ ...WEB, macApp: true }, 'homebrew')).toEqual(['macApp']);
  });

  it('lists This Mac only when desktopAccess is true, where search finds access and revoke', () => {
    const found = (context: SettingsContext, query: string) =>
      searchSettings(query, getShownSettings(context), (key, values) =>
        translateFromEn(key, values)
      ).map(({ setting }) => setting.id);
    expect(getShownSettingsPages(WEB).map((page) => page.id)).not.toContain('thisMac');
    const desktopPages = getShownSettingsPages({ ...WEB, desktopAccess: true });
    expect(desktopPages.find((page) => page.id === 'thisMac')?.group).toBe('mindroom');
    const desktopPageIds = desktopPages.map((page) => page.id);
    expect(desktopPageIds.indexOf('thisMac')).toBe(desktopPageIds.indexOf('mindroom') + 1);
    expect(desktopPageIds.indexOf('mindroom.local-mindroom')).toBe(
      desktopPageIds.indexOf('thisMac') + 1
    );
    expect(resolveSettingsPageId('mac')).toBe('thisMac');
    expect(resolveSettingsPageId('computer access')).toBe('thisMac');
    expect(getShownSettings(WEB).map((setting) => setting.id)).not.toEqual(
      expect.arrayContaining(['thisMacAccess', 'thisMacRevokeAll'])
    );
    expect(found({ ...WEB, desktopAccess: true }, 'computer access')).toEqual(
      expect.arrayContaining(['thisMacAccess', 'thisMacRevokeAll'])
    );
    expect(found({ ...WEB, desktopAccess: true }, 'revoke')).toContain('thisMacRevokeAll');
  });

  it('lists App updates on About only when nativeUpdate is true, where search finds it', () => {
    const found = (context: SettingsContext, query: string) =>
      searchSettings(query, getShownSettings(context), (key, values) =>
        translateFromEn(key, values)
      ).map(({ setting }) => setting.id);
    expect(getShownSettings(WEB).map((setting) => setting.id)).not.toContain('appUpdates');
    expect(found({ ...WEB, nativeUpdate: true }, 'updates')).toContain('appUpdates');
    expect(found({ ...WEB, nativeUpdate: true }, 'upgrade')).toEqual(['appUpdates']);
  });

  it('lists Media compression on Chats as an account setting and finds it by media search keywords', () => {
    const found = (query: string) =>
      searchSettings(query, getShownSettings(WEB), (key, values) => translateFromEn(key, values));
    const [match] = found('media compression');
    expect(match?.setting).toMatchObject({
      id: 'mediaCompression',
      page: 'chats',
      scope: 'account',
    });
    expect(match?.label).toBe('Media compression');
    expect(match?.location).toEqual(['Chats', 'Editor']);

    for (const query of [
      'screenshots',
      'screen recordings',
      'images',
      'videos',
      'compression',
      'upload size',
    ]) {
      expect(
        found(query).map(({ setting }) => setting.id),
        query
      ).toContain('mediaCompression');
    }
  });

  it('lists Compress large files (.zip) on Chats as an account setting and finds it by search keywords', () => {
    const found = (query: string) =>
      searchSettings(query, getShownSettings(WEB), (key, values) => translateFromEn(key, values));
    const [match] = found('compress large files');
    expect(match?.setting).toMatchObject({
      id: 'autoZipLargeFiles',
      page: 'chats',
      scope: 'account',
    });
    expect(match?.label).toBe('Compress large files (.zip)');
    expect(match?.location).toEqual(['Chats', 'Editor']);

    for (const query of ['zip', 'archive', 'json', 'csv', 'log', 'large files', 'upload size']) {
      expect(
        found(query).map(({ setting }) => setting.id),
        query
      ).toContain('autoZipLargeFiles');
    }
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
      'cacheBudget',
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
