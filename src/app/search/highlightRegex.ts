import { createRegexFromWords } from '../lib/regex';

/**
 * A case-insensitive pattern for search highlights, such as the words a server search matched,
 * or undefined when none of them has any text.
 */
export const makeHighlightRegex = (highlights: string[]): RegExp | undefined => {
  const words = highlights.map((highlight) => highlight.trim()).filter((word) => word !== '');
  return words.length > 0 ? createRegexFromWords(words, 'gi') : undefined;
};
