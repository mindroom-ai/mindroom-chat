/**
 * Element types of the composer's Slate document. A const object rather than an enum, so plain
 * string literals (`type: 'paragraph'` in saved drafts and tests) type-check as element types.
 */
export const BlockType = {
  Paragraph: 'paragraph',
  Heading: 'heading',
  CodeLine: 'code-line',
  CodeBlock: 'code-block',
  QuoteLine: 'quote-line',
  BlockQuote: 'block-quote',
  ListItem: 'list-item',
  OrderedList: 'ordered-list',
  UnorderedList: 'unordered-list',
  Mention: 'mention',
  Emoticon: 'emoticon',
  Link: 'link',
  PasteMarker: 'paste-marker',
} as const;

export type BlockType = (typeof BlockType)[keyof typeof BlockType];

/** Text marks; each is a boolean property on a Slate text leaf. */
export const MarkType = {
  Bold: 'bold',
  Code: 'code',
  Italic: 'italic',
  Spoiler: 'spoiler',
  StrikeThrough: 'strikeThrough',
  Underline: 'underline',
} as const;

export type MarkType = (typeof MarkType)[keyof typeof MarkType];

/** Heading levels the composer writes; `h4` to `h6` are read as level 3 (see input.ts). */
export type HeadingLevel = 1 | 2 | 3;
