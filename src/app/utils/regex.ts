// Shared patterns for message text. None of them uses a lookbehind over a repeated broad class:
// JavaScriptCore rescans such a lookbehind at every position, which froze long messages.

const escapeForRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const sanitizeForRegex = escapeForRegex;

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
export const SHORTCODE_PATTERN = ':[^\\s:]+:';

const JUMBO_TOKEN = `(?:${EMOJI_PATTERN}${VARIATION_SELECTOR_PATTERN}?|${SHORTCODE_PATTERN})`;

/** A body of one to ten emoji or shortcodes and nothing else, which renders large. */
export const JUMBO_EMOJI_REG = new RegExp(`^\\s*${JUMBO_TOKEN}(?:\\s*${JUMBO_TOKEN}){0,9}\\s*$`);

// The URL body stops at whitespace and angle brackets. Its last character may not be punctuation
// that usually ends a sentence or closes a bracket around the link, so "(https://a.b/c)." links
// https://a.b/c. Greedy matching then backing off keeps this linear in the length of the run.
const URL_TRAILING_EXCLUDED = `\\s<>.,:;!?'")\\]}/(`;
export const URL_REG = new RegExp(
  `(?:https?|ftp|mailto|magnet):\\/\\/[^\\s<>]*[^${URL_TRAILING_EXCLUDED}]`,
  'g'
);

export const URL_NEG_LB = '(?:https?|ftp|mailto|magnet):\\/\\/';

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
    if (index > 0 && WHITESPACE.test(text[index - 1])) space = index - 1;
    if (schemeEnds.has(index)) schemeEnd = index;
    lastSchemeEnd[index] = schemeEnd;
    lastSpace[index] = space;
  }

  return (index: number) => {
    if (index < 0 || index > text.length) return false;
    const end = lastSchemeEnd[index];
    return end >= 0 && lastSpace[index] < end;
  };
};

/**
 * The first match of `regex` in `text` that does not start inside a URL, or null. A match inside
 * a URL skips the rest of that URL, so no position of it is tried again.
 */
export const execOutsideUrl = (regex: RegExp, text: string): RegExpExecArray | null => {
  const flags =
    regex.flags.includes('g') || regex.flags.includes('y') ? regex.flags : `${regex.flags}g`;
  const search = new RegExp(regex.source, flags.replace('y', 'g'));
  const insideUrl = createInsideUrlTest(text);

  search.lastIndex = 0;
  while (search.lastIndex <= text.length) {
    const match = search.exec(text);
    if (!match) return null;
    if (!insideUrl(match.index)) return match;

    // Skip to the first whitespace after the match start: the URL ends there.
    let next = match.index;
    while (next < text.length && !WHITESPACE.test(text[next])) next += 1;
    search.lastIndex = Math.max(next + 1, match.index + 1);
  }
  return null;
};

export const HTTP_URL_PATTERN = '^https?:\\/\\/';
