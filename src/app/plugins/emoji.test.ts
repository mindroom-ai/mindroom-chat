import { describe, expect, it } from 'vitest';
import { getEmojiByShortcode, getEmojiByUnicode, withSkinTone } from './emoji';
import { readSkinTone } from '../state/emojiSkinTone';

const byUnicode = (unicode: string) => {
  const emoji = getEmojiByUnicode(unicode);
  if (!emoji) throw new Error(`no emoji ${unicode}`);
  return emoji;
};

describe('withSkinTone', () => {
  it('keeps the default emoji for tone 0', () => {
    const wave = byUnicode('👋');
    expect(withSkinTone(wave, 0)).toBe(wave);
  });

  it('picks the variant with the chosen modifier', () => {
    expect(withSkinTone(byUnicode('👋'), 1).unicode).toBe('👋🏻');
    expect(withSkinTone(byUnicode('👋'), 5).unicode).toBe('👋🏿');
  });

  it('gives everyone in a group emoji the same tone, never a mixed variant', () => {
    expect(withSkinTone(byUnicode('🤝'), 3).unicode).toBe('🤝🏽');
    const couple = withSkinTone(byUnicode('🧑‍🤝‍🧑'), 2);
    expect(couple.unicode).toBe('🧑🏼‍🤝‍🧑🏼');
  });

  it('leaves emoji without skin tones alone', () => {
    const grinning = byUnicode('😀');
    expect(withSkinTone(grinning, 4)).toBe(grinning);
  });
});

describe('emoji look-ups', () => {
  it('finds an emoji by any of its shortcodes', () => {
    expect(getEmojiByShortcode('thumbsup')?.unicode).toBe('👍');
  });
});

describe('readSkinTone', () => {
  it('accepts the six tones and falls back to the default for anything else', () => {
    expect(readSkinTone(3)).toBe(3);
    expect(readSkinTone(0)).toBe(0);
    expect(readSkinTone(9)).toBe(0);
    expect(readSkinTone('2')).toBe(0);
    expect(readSkinTone(null)).toBe(0);
  });
});
