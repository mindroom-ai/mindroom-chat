import type { IEmoji } from './emoji';

// Skin tones need no emoji data, so the composer and the tone setting import them from here
// without loading Emojibase.

/**
 * A skin tone the picker applies to person emoji: 0 keeps the default yellow, 1 to 5 are the
 * Fitzpatrick modifiers U+1F3FB (light) to U+1F3FF (dark), in that order.
 */
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;

export const SKIN_TONES: readonly SkinTone[] = [0, 1, 2, 3, 4, 5];

/** The hexcode of a tone's modifier, as Emojibase writes it inside a variant's hexcode. */
const modifierHexcode = (tone: SkinTone): string => (0x1f3fa + tone).toString(16).toUpperCase();

const MODIFIER_HEXCODES = new Set(SKIN_TONES.slice(1).map(modifierHexcode));

/**
 * The variant of `emoji` in which every person has the tone. Emoji of several people also list
 * mixed variants (one tone per person); those are never picked. Emoji without skin tone variants,
 * and tone 0, give the emoji itself.
 */
export const withSkinTone = (emoji: IEmoji, tone: SkinTone): IEmoji => {
  if (tone === 0 || !emoji.skins) return emoji;
  const wanted = modifierHexcode(tone);
  const variant = emoji.skins.find((skin) => {
    const modifiers = skin.hexcode.split('-').filter((part) => MODIFIER_HEXCODES.has(part));
    return modifiers.length > 0 && modifiers.every((part) => part === wanted);
  });
  return variant ?? emoji;
};
