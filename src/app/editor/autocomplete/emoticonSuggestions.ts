import { ImageUsage } from '../../emoji/custom/types';
import { type ImagePack, type PackImageReader } from '../../emoji/custom/ImagePack';
import type { IEmoji } from '../../emoji/emoji';
import { type SkinTone, withSkinTone } from '../../emoji/skinTone';

/** A Unicode emoji or a custom emoji from one of the account's packs, offered for `:query`. */
export type EmoticonSuggestion =
  | { kind: 'unicode'; key: string; shortcode: string; emoji: IEmoji }
  | {
      kind: 'custom';
      key: string;
      shortcode: string;
      image: PackImageReader;
      packName?: string;
      /** From the account's own pack, which has no room. */
      personal: boolean;
    };

/** The most suggestions the menu lists. */
const MAX_EMOTICON_SUGGESTIONS = 20;

// Shortcodes are letters, digits, `_`, `-` and `+` (as in `+1`). Two characters at least, so a
// colon in ordinary text (`:)`, `:D`, `10 :x`) opens no menu.
const QUERY_PATTERN = /^[\p{L}\p{N}_+-]{2,}$/u;

/**
 * The search text of a `:` query, lowercased and without the closing colon of a complete
 * `:shortcode:`; undefined when the text cannot be the start of a shortcode.
 */
export const readEmoticonQuery = (text: string): string | undefined => {
  const needle = (text.endsWith(':') ? text.slice(0, -1) : text).toLocaleLowerCase();
  return QUERY_PATTERN.test(needle) ? needle : undefined;
};

// Lower is better: the exact shortcode, a shortcode that starts with the query, a later word of
// a shortcode or the name, then the query anywhere.
const EXACT = 0;
const PREFIX = 1;
const WORD = 2;
const ANYWHERE = 3;

const words = (value: string): string[] => value.split(/[\s_:,-]+/).filter(Boolean);

/** How well `needle` matches an item with these shortcodes and names; undefined for no match. */
const rank = (needle: string, shortcodes: string[], names: string[]): number | undefined => {
  const codes = shortcodes.map((code) => code.toLocaleLowerCase());
  const labels = names.map((name) => name.toLocaleLowerCase());
  if (codes.includes(needle)) return EXACT;
  if (codes.some((code) => code.startsWith(needle))) return PREFIX;
  const all = [...codes, ...labels];
  if (all.some((value) => words(value).some((word) => word.startsWith(needle)))) return WORD;
  if (all.some((value) => value.includes(needle))) return ANYWHERE;
  return undefined;
};

type Ranked = { suggestion: EmoticonSuggestion; score: number };

/** The shortcode to show for a match: the first that starts with the query, else the main one. */
const shownShortcode = (needle: string, emoji: IEmoji): string =>
  emoji.shortcodes.find((code) => code.toLocaleLowerCase().startsWith(needle)) ?? emoji.shortcode;

/**
 * Emoji for the `:query` the user is typing: custom emoji of `packs` (the account's, its global
 * packs and those of the room and its spaces) and the Unicode emoji of `unicodeEmojis` in the
 * given skin tone. Better matches come first, custom emoji before Unicode ones that match as
 * well. The same image listed in two packs appears once.
 */
export const getEmoticonSuggestions = (
  needle: string,
  packs: ImagePack[],
  unicodeEmojis: readonly IEmoji[],
  tone: SkinTone,
  limit = MAX_EMOTICON_SUGGESTIONS
): EmoticonSuggestion[] => {
  const ranked: Ranked[] = [];
  const seenImages = new Set<string>();

  packs.forEach((pack) => {
    pack.getImages(ImageUsage.Emoticon).forEach((image) => {
      const key = `${image.url}\n${image.shortcode}`;
      if (seenImages.has(key)) return;
      const score = rank(needle, [image.shortcode], image.body ? [image.body] : []);
      if (score === undefined) return;
      seenImages.add(key);
      ranked.push({
        suggestion: {
          kind: 'custom',
          key: image.url,
          shortcode: image.shortcode,
          image,
          packName: pack.meta.name,
          personal: !pack.address,
        },
        // Custom emoji sort before Unicode ones of the same score.
        score: score * 2,
      });
    });
  });

  unicodeEmojis.forEach((emoji) => {
    const score = rank(needle, emoji.shortcodes, [emoji.label]);
    if (score === undefined) return;
    const toned = withSkinTone(emoji, tone);
    const shortcode = shownShortcode(needle, emoji);
    ranked.push({
      suggestion: { kind: 'unicode', key: toned.unicode, shortcode, emoji: toned },
      score: score * 2 + 1,
    });
  });

  // The sort is stable, so equal scores keep pack order, then Unicode order.
  return ranked
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ suggestion }) => suggestion);
};
