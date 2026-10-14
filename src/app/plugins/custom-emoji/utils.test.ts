import { describe, expect, it } from 'vitest';
import { addEmoticonToPackContent } from './utils';
import { ImageUsage } from './types';

const image = { url: 'mxc://example.org/new', info: { w: 32, h: 32 } };

describe('addEmoticonToPackContent', () => {
  it('starts a pack when the user has none', () => {
    expect(addEmoticonToPackContent(undefined, 'party', image)).toEqual({
      content: { images: { party: image } },
      shortcode: 'party',
    });
  });

  it('keeps the pack meta and existing images, renaming a taken shortcode', () => {
    const existing = { url: 'mxc://example.org/old' };
    const result = addEmoticonToPackContent(
      { pack: { display_name: 'Mine' }, images: { party: existing } },
      'party',
      image
    );

    expect(result).toEqual({
      content: { pack: { display_name: 'Mine' }, images: { party: existing, party1: image } },
      shortcode: 'party1',
    });
  });

  it('marks the image as an emoji in a sticker-only pack', () => {
    const result = addEmoticonToPackContent(
      { pack: { usage: [ImageUsage.Sticker] } },
      'party',
      image
    );

    expect(result.content.images?.party).toEqual({ ...image, usage: [ImageUsage.Emoticon] });
  });
});
