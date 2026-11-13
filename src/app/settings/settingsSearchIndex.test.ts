import { createInstance, type ParseKeys } from 'i18next';
import { describe, expect, it } from 'vitest';
import nl from '../i18n/locales/nl.json';
import nlAdditions from '../i18n/locales/additions/nl.json';
import { mergeLocaleTrees } from '../i18n/englishResources';
import { translateFromEn } from '../../test/utils/i18n';
import { SETTINGS, getShownSettings, type SettingsContext } from '../preferences/settingsRegistry';
import { searchSettings, type SettingsTranslate } from './settingsSearchIndex';

const english: SettingsTranslate = (key, values) => translateFromEn(key, values);
const VALUES = {
  userId: '@alice:example.org',
  username: 'alice',
  sendKey: 'Ctrl',
  shortcut: 'Ctrl+K',
};
const WEB: SettingsContext = {
  native: false,
  nativeIOS: false,
  localMindroom: true,
  serverAdmin: false,
  useSystemTheme: true,
  developerTools: false,
  errorReporting: false,
  railButtons: { threads: true, explore: true, createSpace: true, search: true },
};

const ids = (query: string, translate = english) =>
  searchSettings(query, getShownSettings(WEB), translate, VALUES).map(({ setting }) => setting.id);

describe('settings search', () => {
  it('ranks a label that starts with the query first, and shows where the setting lives', () => {
    const [first] = searchSettings('24-hour', SETTINGS, english, VALUES);
    expect(first?.setting.id).toBe('hour24Clock');
    expect(first?.location).toEqual(['Language & region', 'Date & Time']);
  });

  it('puts label matches above keyword matches, above description and page matches', () => {
    const results = ids('theme');
    // "System Theme" starts with a word, "Light Theme:" holds it; keywords and pages come after.
    expect(results.slice(0, 3)).toEqual(['systemTheme', 'lightTheme', 'darkTheme']);
    expect(ids('dark mode')).toEqual(expect.arrayContaining(['systemTheme', 'darkTheme']));
    expect(ids('dark mode')).not.toContain('hour24Clock');
  });

  it('needs every word of the query and ignores case and accents', () => {
    expect(ids('READ RECEIPTS')).toEqual(['hideActivity']);
    expect(ids('réceipts')).toEqual(['hideActivity']);
    expect(ids('receipts zzz')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });

  it('fills in the placeholders of a label, as its page does', () => {
    const [mention] = searchSettings('mention user', SETTINGS, english, VALUES);
    expect(mention?.label).toBe('Mention User ID ("@alice:example.org")');
  });

  it('marks a setting in an Advanced fold, and leaves out settings that are not offered', () => {
    const [spacing] = searchSettings('message spacing', getShownSettings(WEB), english, VALUES);
    expect(spacing?.setting.id).toBe('messageSpacing');
    expect(spacing?.location).toEqual(['Appearance', 'Display', 'Advanced']);
    // The token tile shows only with the developer tools on; their switch is found instead.
    expect(ids('access token')).not.toContain('accessToken');
    expect(ids('access token')).toContain('developerTools');
  });

  it('matches labels and keywords in the active language', async () => {
    const instance = createInstance();
    await instance.init({
      lng: 'nl',
      resources: { nl: { translation: mergeLocaleTrees(nl, nlAdditions) } },
      interpolation: { escapeValue: false },
    });
    const dutch: SettingsTranslate = (key: ParseKeys, values) => instance.t(key, values);

    const [clock] = searchSettings('24-uurs', getShownSettings(WEB), dutch, VALUES);
    expect(clock?.setting.id).toBe('hour24Clock');
    expect(clock?.label).toBe('24-uursnotatie');
    expect(clock?.location[0]).toBe('Taal & regio');
    // A Dutch keyword ("donkere modus") finds the theme; the English one does not.
    expect(ids('donkere modus', dutch)).toContain('darkTheme');
    expect(ids('dark mode', dutch)).toEqual([]);
  });
});
