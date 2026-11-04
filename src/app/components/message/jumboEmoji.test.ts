import { describe, expect, it } from 'vitest';
import { isJumboEmojiBody } from './jumboEmoji';

const emoticon = (code: string) =>
  `<img data-mx-emoticon src="mxc://example.org/${code}" alt=":${code}:" title=":${code}:">`;

describe('isJumboEmojiBody', () => {
  it.each(['🎉', ' 👍️ 😀 ', '🇳🇱', Array(10).fill('🚀').join('')])('is large for %j', (body) => {
    expect(isJumboEmojiBody(body)).toBe(true);
  });

  it.each(['ok 🎉', '🎉!', Array(11).fill('🚀').join(' '), ''])('stays normal for %j', (body) => {
    expect(isJumboEmojiBody(body)).toBe(false);
  });

  it('counts a shortcode only when the HTML body draws it as a custom emoji', () => {
    expect(isJumboEmojiBody(':party:')).toBe(false);
    expect(isJumboEmojiBody(':party:', '<p>:party:</p>')).toBe(false);
    expect(isJumboEmojiBody(':party: 🎉', `${emoticon('party')} 🎉`)).toBe(true);
  });
});
