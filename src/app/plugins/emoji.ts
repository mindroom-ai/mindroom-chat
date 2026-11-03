import compactEmojis from 'emojibase-data/en/compact.json';
import emojibaseShortcodes from 'emojibase-data/en/shortcodes/emojibase.json';

// Unicode emoji from Emojibase (MIT): its compact English dataset for labels, tags and order,
// and its own shortcode preset for `:shortcodes:`.

/**
 * The sections of the emoji picker, in the order it shows them: the Unicode CLDR emoji groups
 * (Unicode Technical Standard #51, `emoji-test.txt`) in Unicode order, with "Smileys & Emotion"
 * and "People & Body" in one section.
 */
export enum EmojiGroupId {
  People = 'people',
  Nature = 'nature',
  Food = 'food',
  Travel = 'travel',
  Activity = 'activity',
  Object = 'object',
  Symbol = 'symbol',
  Flag = 'flag',
}

/** One Unicode emoji with what the picker and the shortcode search need. */
export type IEmoji = {
  /** The emoji itself. */
  unicode: string;
  /** Its code points in hexadecimal, joined by `-`, as Emojibase names emoji. */
  hexcode: string;
  /** The Unicode (CLDR) name, such as `grinning face`. */
  label: string;
  /** The main shortcode, without colons. */
  shortcode: string;
  shortcodes: string[];
  tags: string[];
  group: EmojiGroupId;
  /** The position in the Unicode emoji order. */
  order: number;
  /** The skin tone variants of a person emoji. */
  skins?: IEmoji[];
};

/** One picker section and its emoji, in Unicode order. */



};

type CompactEmojiData = {
  hexcode: string;
  label: string;
  unicode: string;
  group?: number;
  order?: number;
  tags?: string[];
  skins?: CompactEmojiData[];
};

// Emojibase group numbers. Group 2 holds the skin tone and hair components, which are not shown.
const EMOJIBASE_GROUPS: Record<number, EmojiGroupId> = {
  0: EmojiGroupId.People,
  1: EmojiGroupId.People,
  3: EmojiGroupId.Nature,
  4: EmojiGroupId.Food,
  5: EmojiGroupId.Travel,
  6: EmojiGroupId.Activity,
  7: EmojiGroupId.Object,
  8: EmojiGroupId.Symbol,
  9: EmojiGroupId.Flag,
};

const shortcodesByHexcode = emojibaseShortcodes as Record<string, string | string[]>;

const shortcodesOf = (data: CompactEmojiData): string[] => {
  const listed = shortcodesByHexcode[data.hexcode];
  if (Array.isArray(listed) && listed.length > 0) return listed;
  if (typeof listed === 'string' && listed !== '') return [listed];
  return [
    data.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, ''),
  ];
};

const toEmoji = (data: CompactEmojiData, group: EmojiGroupId): IEmoji => {
  const shortcodes = shortcodesOf(data);
  return {
    unicode: data.unicode,
    hexcode: data.hexcode,
    label: data.label,
    shortcode: shortcodes[0],
    shortcodes,
    tags: data.tags ?? [],
    group,
    order: data.order ?? 0,
    skins: data.skins?.map((skin) => toEmoji(skin, group)),
  };
};

/** Every emoji the picker offers, in Unicode order. */
export const emojis: IEmoji[] = (compactEmojis as unknown as CompactEmojiData[])
  .flatMap((data) => {
    const group = data.group === undefined ? undefined : EMOJIBASE_GROUPS[data.group];
    return group ? [toEmoji(data, group)] : [];
  })
  .sort((a, b) => a.order - b.order);

/** The emoji by picker section. */
export const emojiGroups: IEmojiGroup[] = Object.values(EmojiGroupId).map((id) => ({
  id,
  emojis: emojis.filter((emoji) => emoji.group === id),
}));

// Clients differ in whether they send the emoji presentation selector (U+FE0F), so look-ups
// ignore it.
const lookUpKey = (unicode: string): string => unicode.replace(/️/g, '');

const emojiByUnicode = new Map<string, IEmoji>();
emojis.forEach((emoji) => {
  emojiByUnicode.set(lookUpKey(emoji.unicode), emoji);
  emoji.skins?.forEach((skin) => emojiByUnicode.set(lookUpKey(skin.unicode), skin));
});

/** The emoji, or its skin tone variant, that `unicode` is. */
export const getEmojiByUnicode = (unicode: string): IEmoji | undefined =>
  emojiByUnicode.get(lookUpKey(unicode));

const emojiByShortcode = new Map<string, IEmoji>();
emojis.forEach((emoji) =>
  emoji.shortcodes.forEach((shortcode) => {
    if (!emojiByShortcode.has(shortcode)) emojiByShortcode.set(shortcode, emoji);
  })
);

/** The emoji with that shortcode (without colons). */
export const getEmojiByShortcode = (shortcode: string): IEmoji | undefined =>
  emojiByShortcode.get(shortcode);
