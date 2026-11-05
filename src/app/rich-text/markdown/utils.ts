import { createInsideUrlTest } from '../../lib/regex';

/** The characters that start or end inline Markdown, and the backslash that escapes them. */
const INLINE_MARKDOWN_CHARACTERS = '\\`*_~|$[]';
const ESCAPED_INLINE_MARKDOWN_REG = /\\([\\`*_~|$[\]])/g;

/**
 * Escapes inline Markdown so the parser shows `text` as written: `a_b` becomes `a\_b`. URLs are
 * left as they are, since the parser never formats inside them.
 */
export const escapeMarkdownInlineSequences = (text: string): string => {
  const insideUrl = createInsideUrlTest(text);
  let escaped = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    escaped +=
      INLINE_MARKDOWN_CHARACTERS.includes(character) && !insideUrl(index)
        ? `\\${character}`
        : character;
  }
  return escaped;
};

/** Undoes `escapeMarkdownInlineSequences`, outside URLs only. */
export const unescapeMarkdownInlineSequences = (text: string): string => {
  const insideUrl = createInsideUrlTest(text);
  return text.replace(
    ESCAPED_INLINE_MARKDOWN_REG,
    (sequence: string, character: string, offset: number) =>
      insideUrl(offset) ? sequence : character
  );
};
