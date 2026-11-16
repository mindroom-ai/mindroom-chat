import { describe, expect, it } from 'vitest';
import { Icons } from 'folds';
import { DEFAULT_SETTINGS, type Settings } from '../preferences/settings';
import { SETTINGS, getShownSettings, type SettingsContext } from '../preferences/settingsRegistry';
import type { SettingsTranslate } from '../settings/settingsSearchIndex';
import {
  COMMAND_PALETTE_SETTING_SWITCHES,
  getCommandPaletteSettingRows,
} from './commandPaletteSettings';

// The key itself, so a row shows which text it took.
const t: SettingsTranslate = (key) => key;

const CONTEXT: SettingsContext = {
  native: false,
  nativeIOS: false,
  localMindroom: true,
  serverAdmin: false,
  useSystemTheme: true,
  developerTools: false,
  errorReporting: true,
  railButtons: { threads: true, explore: true, createSpace: true, search: true },
};

const rows = (stored: Partial<Settings> = {}, context: SettingsContext = CONTEXT) =>
  getCommandPaletteSettingRows(getShownSettings(context), { ...DEFAULT_SETTINGS, ...stored }, t);

const rowOf = (id: string, stored?: Partial<Settings>) => {
  const row = rows(stored).find(({ setting }) => setting.id === id);
  if (!row) throw new Error(`no row for ${id}`);
  return row;
};

describe('getCommandPaletteSettingRows', () => {
  it('maps only settings of the registry to switches', () => {
    const ids = SETTINGS.map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining(Object.keys(COMMAND_PALETTE_SETTING_SWITCHES)));
  });

  it('shows the state of a switch and keeps the palette open when it flips', () => {
    const markdown = rowOf('markdown', { isMarkdown: true });
    expect(markdown.item).toMatchObject({ id: 'setting:markdown', state: 'on', keepOpen: true });
    expect(markdown.switch).toStrictEqual({ key: 'isMarkdown' });
    expect(rowOf('markdown', { isMarkdown: false }).item.state).toBe('off');
  });

  it('shows the state an inverted switch shows: Disable Media Auto Load is off while media loads', () => {
    const media = rowOf('mediaAutoLoad', { mediaAutoLoad: true });
    expect(media.item.state).toBe('off');
    expect(media.switch).toStrictEqual({ key: 'mediaAutoLoad', inverted: true });
    expect(rowOf('mediaAutoLoad', { mediaAutoLoad: false }).item.state).toBe('on');
  });

  it('gives a setting without a plain switch no state, so it opens Settings', () => {
    const zoom = rowOf('pageZoom');
    expect(zoom.item).not.toHaveProperty('state');
    expect(zoom.item).not.toHaveProperty('keepOpen');
    expect(zoom).not.toHaveProperty('switch');
  });

  it('leaves out the settings the pages and the tour offer, with the system theme on or off', () => {
    const covered = [
      'systemTheme',
      'theme',
      'lightTheme',
      'darkTheme',
      'messageLayout',
      'language',
      'tour',
    ];
    const ids = [
      ...rows({}, { ...CONTEXT, useSystemTheme: true }),
      ...rows({}, { ...CONTEXT, useSystemTheme: false }),
    ].map(({ setting }) => setting.id);
    covered.forEach((id) => expect(ids).not.toContain(id));
  });

  it('offers only the settings Settings shows now', () => {
    expect(rows().map(({ setting }) => setting.id)).not.toContain('accessToken');
    const withTools = rows({}, { ...CONTEXT, developerTools: true });
    expect(withTools.map(({ setting }) => setting.id)).toContain('accessToken');
  });

  it('says where a setting is, and finds it by its search words and description', () => {
    expect(rowOf('pageZoom').item).toStrictEqual({
      id: 'setting:pageZoom',
      kind: 'action',
      title: 'settings.general.appearance.pageZoom',
      description: 'settings.general.appearance.sectionTitle › featureUi.settings.sections.display',
      keywords: ['featureUi.settings.keywords.zoom'],
      tag: 'settings.title',
      icon: Icons.Setting,
      sortRank: 0,
    });
    expect(rowOf('enterForNewline').item.keywords).toStrictEqual([
      'featureUi.settings.keywords.composer',
      'settings.general.editor.enterForNewlineDescription',
    ]);
  });

  it('tags every row as a setting, at rank 0', () => {
    const all = rows();
    expect(all.length).toBeGreaterThan(30);
    all.forEach(({ item }) => {
      expect(item.tag).toBe('settings.title');
      expect(item.sortRank).toBe(0);
    });
  });
});
