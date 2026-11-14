// Shared patterns for message text. None of them uses a lookbehind over a repeated broad class:
// JavaScriptCore rescans such a lookbehind at every position, which froze long messages.

const escapeForRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A regular expression that matches any of `words` literally. */
export const createRegexFromWords = (words: string[], flags = 'g'): RegExp =>
  new RegExp(words.map(escapeForRegex).join('|'), flags);

// One emoji, written with UTF-16 code units so it also works in a RegExp without the `u` flag:
// a pictograph from the supplementary planes or the BMP symbol blocks, optionally followed by a
// skin tone or emoji presentation selector, joined with ZWJ into sequences; a flag (two regional
// indicators); or a keycap.
const PICTOGRAPH =
  '(?:\\uD83C[\\uDC04-\\uDDE5\\uDE00-\\uDFFA]|\\uD83D[\\uDC00-\\uDFFF]|\\uD83E[\\uDC00-\\uDEFF]|' +
  '[\\u00A9\\u00AE\\u203C\\u2049\\u2122\\u2139\\u2194-\\u21AA\\u231A-\\u23FF\\u24C2' +
  '\\u25AA-\\u27BF\\u2934\\u2935\\u2B05-\\u2B55\\u3030\\u303D\\u3297\\u3299])';
const EMOJI_MODIFIER = '(?:\\uD83C[\\uDFFB-\\uDFFF]|\\uFE0F\\u20E3?)';
const EMOJI_SEQUENCE = `${PICTOGRAPH}${EMOJI_MODIFIER}?(?:\\u200D${PICTOGRAPH}${EMOJI_MODIFIER}?)*`;
const FLAG = '(?:\\uD83C[\\uDDE6-\\uDDFF]){2}';
const KEYCAP = '[0-9#*]\\uFE0F?\\u20E3';

export const EMOJI_PATTERN = `(?:${FLAG}|${KEYCAP}|${EMOJI_SEQUENCE})`;
export const VARIATION_SELECTOR_PATTERN = '\\uFE0F';

/** A custom emoji shortcode such as `:party-parrot:`; it cannot contain spaces or colons. */
const SHORTCODE_PATTERN = ':[^\\s:]+:';

const JUMBO_TOKEN = `(?:${EMOJI_PATTERN}${VARIATION_SELECTOR_PATTERN}?|${SHORTCODE_PATTERN})`;

/** A body of one to ten emoji or shortcodes and nothing else, which renders large. */
export const JUMBO_EMOJI_REG = new RegExp(`^\\s*${JUMBO_TOKEN}(?:\\s*${JUMBO_TOKEN}){0,9}\\s*$`);

const URL_SCHEMES = ['https', 'http', 'ftp', 'mailto', 'magnet'];
const WHITESPACE = /\s/;

/**
 * Answers, for any position of `text`, whether it lies inside a URL: after a `scheme://` with no
 * whitespace in between. Positions may be asked in any order; each answer is constant time.
 */
export const createInsideUrlTest = (text: string): ((index: number) => boolean) => {
  // lastSchemeEnd[i]: the end of the last `scheme://` ending at or before i, or -1.
  // lastSpace[i]: the last whitespace position before i, or -1.
  const lastSchemeEnd = new Int32Array(text.length + 1).fill(-1);
  const lastSpace = new Int32Array(text.length + 1).fill(-1);

  const schemeEnds = new Set<number>();
  for (let at = text.indexOf('://'); at >= 0; at = text.indexOf('://', at + 1)) {
    const before = text.slice(Math.max(0, at - 6), at);
    if (URL_SCHEMES.some((scheme) => before.endsWith(scheme))) schemeEnds.add(at + 3);
  }

  let schemeEnd = -1;
  let space = -1;
  for (let index = 0; index <= text.length; index += 1) {
    if (index > 0 && WHITESPACE.test(text.charAt(index - 1))) space = index - 1;
    if (schemeEnds.has(index)) schemeEnd = index;
    lastSchemeEnd[index] = schemeEnd;
    lastSpace[index] = space;
  }

  return (index: number) => {
    const end = lastSchemeEnd[index];
    const space = lastSpace[index];
    // Positions outside the text read as undefined.
    return end !== undefined && space !== undefined && end >= 0 && space < end;
  };
};
