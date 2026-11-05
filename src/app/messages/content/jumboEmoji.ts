import { JUMBO_EMOJI_REG } from '../../lib/regex';

const SHORTCODE = /:[^\s:]+:/;

/**
 * Whether a text message is only emoji, one to ten of them, so it shows them large. A `:name:`
 * counts as a custom emoji only when the HTML body draws custom emoji as images; in a plain body
 * it is just text.
 */
export const isJumboEmojiBody = (body: string, customBody?: string): boolean => {
  if (!JUMBO_EMOJI_REG.test(body)) return false;
  if (!SHORTCODE.test(body)) return true;
  return customBody?.includes('data-mx-emoticon') ?? false;
};
