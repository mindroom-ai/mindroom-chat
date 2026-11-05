import { MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { ImagePack } from './custom/ImagePack';
import { emojis, getEmojiByUnicode } from './emoji';
import { resolveRecentEmoji } from './recent-emoji-list';

/** A client whose `io.element.recent_emoji` account data holds these entries. */
const clientWithRecent = (recentEmoji: Array<[string, number]>) =>
  ({
    getAccountData: () =>
      new MatrixEvent({ type: 'io.element.recent_emoji', content: { recent_emoji: recentEmoji } }),
  } as unknown as MatrixClient);

const pack = new ImagePack(
  '@alice:example.org',
  { images: { 'party-parrot': { url: 'mxc://example.org/parrot' } } },
  undefined
);
const parrot = pack.images.collection.get('party-parrot');
const unicodeEmoji = (unicode: string) => emojis.find((emoji) => emoji.unicode === unicode);

describe('resolveRecentEmoji', () => {
  it('lists Unicode emoji, most used first', () => {
    const recent = resolveRecentEmoji(
      clientWithRecent([
        ['😀', 1],
        ['😂', 3],
      ]),
      getEmojiByUnicode
    );

    expect(recent).toEqual([unicodeEmoji('😂'), unicodeEmoji('😀')]);
  });

  it('finds a custom emoji by its mxc URL in the packs', () => {
    const recent = resolveRecentEmoji(
      clientWithRecent([
        ['😀', 1],
        ['mxc://example.org/parrot', 2],
      ]),
      getEmojiByUnicode,
      [pack]
    );

    expect(recent).toEqual([parrot, unicodeEmoji('😀')]);
    expect(recent[0]).toBe(parrot);
  });

  it('drops a custom emoji no pack has', () => {
    expect(
      resolveRecentEmoji(clientWithRecent([['mxc://example.org/gone', 5]]), getEmojiByUnicode, [
        pack,
      ])
    ).toEqual([]);
  });

  it('applies the limit after dropping what no pack has', () => {
    const recent = resolveRecentEmoji(
      clientWithRecent([
        ['mxc://example.org/gone', 9],
        ['mxc://example.org/parrot', 5],
        ['😀', 1],
      ]),
      getEmojiByUnicode,
      [pack],
      2
    );

    expect(recent).toEqual([parrot, unicodeEmoji('😀')]);
  });
});
