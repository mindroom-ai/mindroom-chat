import { createWholeWordRegex } from '../lib/regex';

/**
 * A case-insensitive pattern for search highlights, such as the words a server search matched,
 * or undefined when none of them has any text. It matches whole words only, as the server does,
 * so a short highlight is not marked inside a longer word.
 */
export const makeHighlightRegex = (highlights: string[]): RegExp | undefined => {
  const words = highlights.map((highlight) => highlight.trim()).filter((word) => word !== '');
  return words.length > 0 ? createWholeWordRegex(words) : undefined;
};

/** Where the first whole-word match of any of `highlights` starts in `text`, or -1. */
export const findFirstHighlight = (text: string, highlights: string[]): number =>
  makeHighlightRegex(highlights)?.exec(text)?.index ?? -1;
