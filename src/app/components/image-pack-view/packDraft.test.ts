import { describe, expect, it } from 'vitest';
import {
  addPackImages,
  changePackImage,
  changePackMeta,
  freeShortcode,
  isValidShortcode,
  optionToUsage,
  removePackImages,
  usageToOption,
} from './packDraft';

const pack = {
  pack: { display_name: 'Team', usage: ['emoticon' as const], 'org.example.extra': 1 },
  images: {
    one: { url: 'mxc://x/1', body: 'One' },
    two: { url: 'mxc://x/2', usage: ['sticker' as const], info: { w: 64, h: 64 } },
    three: { url: 'mxc://x/3' },
  },
};

describe('usage options', () => {
  it('reads a usage list as one option and back', () => {
    expect(usageToOption(['emoticon'])).toBe('emoticon');
    expect(usageToOption(['sticker'])).toBe('sticker');
    expect(usageToOption(['emoticon', 'sticker'])).toBe('both');
    expect(usageToOption(undefined)).toBe('both');
    expect(optionToUsage('both')).toEqual(['emoticon', 'sticker']);
  });
});

describe('shortcodes', () => {
  it('accepts anything without whitespace or colons', () => {
    expect(isValidShortcode('party-parrot')).toBe(true);
    expect(isValidShortcode('+1')).toBe(true);
    expect(isValidShortcode('')).toBe(false);
    expect(isValidShortcode('two words')).toBe(false);
    expect(isValidShortcode('a:b')).toBe(false);
  });

  it('finds a free shortcode by adding a number', () => {
    expect(freeShortcode(new Set(['cat']), 'dog')).toBe('dog');
    expect(freeShortcode(new Set(['cat', 'cat-2']), 'cat')).toBe('cat-3');
  });
});

describe('addPackImages', () => {
  it('adds uploads after the existing images without replacing one', () => {
    const next = addPackImages(pack, [
      { shortcode: 'one', image: { url: 'mxc://x/new' } },
      { shortcode: 'four', image: { url: 'mxc://x/4' } },
    ]);
    expect(Object.keys(next.images ?? {})).toEqual(['one', 'two', 'three', 'one-2', 'four']);
    expect(next.images?.one.url).toBe('mxc://x/1');
    expect(next.pack).toBe(pack.pack);
  });
});

describe('changePackImage', () => {
  it('renames an image in place and keeps its other fields', () => {
    const next = changePackImage(pack, 'two', { shortcode: 'deux', body: 'Two', usage: undefined });
    expect(Object.keys(next?.images ?? {})).toEqual(['one', 'deux', 'three']);
    expect(next?.images?.deux).toEqual({ url: 'mxc://x/2', body: 'Two', info: { w: 64, h: 64 } });
  });

  it('sets an image of its own usage and drops an empty body', () => {
    const next = changePackImage(pack, 'one', { shortcode: 'one', body: ' ', usage: 'sticker' });
    expect(next?.images?.one).toEqual({ url: 'mxc://x/1', usage: ['sticker'] });
  });

  it('refuses a shortcode another image has', () => {
    expect(
      changePackImage(pack, 'one', { shortcode: 'three', body: '', usage: undefined })
    ).toBeUndefined();
  });
});

describe('removePackImages', () => {
  it('leaves the other images in order', () => {
    const next = removePackImages(pack, new Set(['two']));
    expect(Object.keys(next.images ?? {})).toEqual(['one', 'three']);
  });
});

describe('changePackMeta', () => {
  it('sets name, attribution and avatar and keeps the usage and unknown fields', () => {
    const next = changePackMeta(pack, {
      name: ' Launch ',
      attribution: 'By us',
      avatarUrl: 'mxc://x/a',
    });
    expect(next.pack).toEqual({
      display_name: 'Launch',
      usage: ['emoticon'],
      'org.example.extra': 1,
      avatar_url: 'mxc://x/a',
      attribution: 'By us',
    });
    expect(next.images).toBe(pack.images);
  });

  it('removes fields that were cleared', () => {
    const next = changePackMeta(pack, { name: '', attribution: '', avatarUrl: undefined });
    expect(next.pack).toEqual({ usage: ['emoticon'], 'org.example.extra': 1 });
  });
});
