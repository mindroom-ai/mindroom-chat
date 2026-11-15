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
  it('makes a row per choice, in the given order, with only a title to search', () => {
    expect(rows()).toStrictEqual([
      { id: 'theme:light-theme', kind: 'action', title: 'Light', current: false, sortRank: 2 },
      { id: 'theme:dark-theme', kind: 'action', title: 'Dark', current: true, sortRank: 1 },
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
