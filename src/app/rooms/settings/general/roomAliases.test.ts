import { describe, expect, it } from 'vitest';
import {
  publishAlias,
  readPublished,
  setMainAlias,
  unpublishAlias,
  unsetMainAlias,
} from './roomAliases';

describe('published room addresses', () => {
  it('lists the main address first and each address once', () => {
    expect(readPublished({ alias: '#a:s', alt_aliases: ['#b:s', '#a:s', 3] })).toEqual([
      '#a:s',
      '#b:s',
    ]);
    expect(readPublished(undefined)).toEqual([]);
  });

  it('makes the first published address the main one', () => {
    expect(publishAlias({}, '#a:s')).toEqual({ alias: '#a:s' });
    expect(publishAlias({ alias: '#a:s' }, '#b:s')).toEqual({
      alias: '#a:s',
      alt_aliases: ['#b:s'],
    });
  });

  it('unpublishes the main address without promoting another', () => {
    expect(unpublishAlias({ alias: '#a:s', alt_aliases: ['#b:s'] }, '#a:s')).toEqual({
      alt_aliases: ['#b:s'],
    });
    expect(unpublishAlias({ alias: '#a:s', alt_aliases: ['#b:s'] }, '#b:s')).toEqual({
      alias: '#a:s',
    });
  });

  it('swaps the main address and keeps the old one published', () => {
    expect(setMainAlias({ alias: '#a:s', alt_aliases: ['#b:s'] }, '#b:s')).toEqual({
      alias: '#b:s',
      alt_aliases: ['#a:s'],
    });
    expect(unsetMainAlias({ alias: '#a:s', alt_aliases: ['#b:s'] })).toEqual({
      alt_aliases: ['#a:s', '#b:s'],
    });
  });
});
