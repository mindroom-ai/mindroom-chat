import { describe, expect, it } from 'vitest';
import { ImagePack } from '../../emoji/custom/ImagePack';
import { emojis } from '../../emoji/emoji';
import { getEmoticonSuggestions, readEmoticonQuery } from './emoticonSuggestions';

const pack = (name: string, images: Record<string, { url: string; body?: string }>) =>
  new ImagePack(name, { pack: { display_name: name }, images }, { roomId: '!r:x', stateKey: name });

describe('readEmoticonQuery', () => {
  it('reads two or more shortcode characters, without the closing colon', () => {
    expect(readEmoticonQuery('smi')).toBe('smi');
    expect(readEmoticonQuery('Party-Parrot:')).toBe('party-parrot');
    expect(readEmoticonQuery('+1')).toBe('+1');
  });

  it('ignores text that cannot start a shortcode', () => {
    expect(readEmoticonQuery('')).toBeUndefined();
    expect(readEmoticonQuery('D')).toBeUndefined();
    expect(readEmoticonQuery(')')).toBeUndefined();
    expect(readEmoticonQuery('-)')).toBeUndefined();
    expect(readEmoticonQuery('a:b')).toBeUndefined();
  });
});

describe('getEmoticonSuggestions', () => {
  it('puts the exact shortcode first, then shortcodes that start with the query', () => {
    const [first, ...rest] = getEmoticonSuggestions('smile', [], emojis, 0);
    expect(first).toMatchObject({ kind: 'unicode', shortcode: 'smile' });
    expect(rest.length).toBeGreaterThan(0);
  });

  it('lists custom emoji before Unicode emoji that match as well', () => {
    const packs = [
      pack('Party', { parrot: { url: 'mxc://x/parrot' }, party: { url: 'mxc://x/p' } }),
    ];
    const suggestions = getEmoticonSuggestions('part', packs, emojis, 0);
    expect(suggestions[0]).toMatchObject({
      kind: 'custom',
      shortcode: 'party',
      key: 'mxc://x/p',
      packName: 'Party',
    });
    expect(suggestions.some((item) => item.kind === 'unicode')).toBe(true);
  });

  it('finds custom emoji by their description too', () => {
    const packs = [pack('Cats', { c1: { url: 'mxc://x/c1', body: 'Grumpy cat' } })];
    expect(getEmoticonSuggestions('grumpy', packs, emojis, 0)).toEqual([
      expect.objectContaining({ kind: 'custom', shortcode: 'c1' }),
    ]);
  });

  it('shows an image that two packs share once', () => {
    const image = { url: 'mxc://x/same' };
    const packs = [pack('A', { blobcat: image }), pack('B', { blobcat: image })];
    const custom = getEmoticonSuggestions('blobcat', packs, emojis, 0).filter(
      (item) => item.kind === 'custom'
    );
    expect(custom).toHaveLength(1);
  });

  it('gives person emoji the chosen skin tone', () => {
    const [wave] = getEmoticonSuggestions('wave', [], emojis, 2);
    expect(wave).toMatchObject({ kind: 'unicode', key: '👋🏼' });
  });

  it('shows the shortcode that matched', () => {
    const [plusOne] = getEmoticonSuggestions('+1', [], emojis, 0);
    expect(plusOne).toMatchObject({ key: '👍', shortcode: '+1' });
  });

  it('stops at the limit', () => {
    expect(getEmoticonSuggestions('face', [], emojis, 0, 5)).toHaveLength(5);
  });
});
