import { Icons } from 'folds';
import { describe, expect, it } from 'vitest';
import { commandPaletteSearchConfig, searchCommandPaletteSection } from './commandPaletteSearch';
import type { CommandPaletteActionItem } from './commandPaletteTypes';
import { getCommandPalettePageRows, tagCommandPalettePageRows } from './commandPalettePages';

const rows = () =>
  getCommandPalettePageRows('theme', [
    { value: 'light-theme', title: 'Light', current: false },
    { value: 'dark-theme', title: 'Dark', current: true },
  ]);

describe('getCommandPalettePageRows', () => {
  it("makes a row per choice, in the given order, with only a title to search and the page's icon", () => {
    const row = { kind: 'action', icon: Icons.Sun };
    expect(rows()).toStrictEqual([
      { ...row, id: 'theme:light-theme', title: 'Light', current: false, sortRank: 2 },
      { ...row, id: 'theme:dark-theme', title: 'Dark', current: true, sortRank: 1 },
    ]);
  });

  it('gives a title in its own language that language', () => {
    expect(
      getCommandPalettePageRows('language', [
        { value: 'nl', title: 'Nederlands', current: false, lang: 'nl' },
      ])
    ).toStrictEqual([
      {
        id: 'language:nl',
        kind: 'action',
        title: 'Nederlands',
        icon: Icons.Globe,
        current: false,
        sortRank: 1,
        lang: 'nl',
      },
    ]);
  });
});

describe('tagCommandPalettePageRows', () => {
  it('tags every row with the page title', () => {
    expect(tagCommandPalettePageRows('Theme', rows())).toStrictEqual(
      rows().map((row) => ({ ...row, tag: 'Theme' }))
    );
  });

  it('keeps the tagged rows out of a search for the page title', () => {
    const pageRow: CommandPaletteActionItem = {
      id: 'page-theme',
      kind: 'action',
      title: 'Theme',
      page: 'theme',
    };
    const found = searchCommandPaletteSection({
      items: [pageRow, ...tagCommandPalettePageRows('Theme', rows())],
      query: 'theme',
      config: commandPaletteSearchConfig.actions,
    });
    expect(found).toStrictEqual([pageRow]);
  });
});
