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
  Command: 'command',
  PasteMarker: 'paste-marker',
} as const;

export type BlockType = (typeof BlockType)[keyof typeof BlockType];

/** Text marks; each is a boolean property on a Slate text leaf. */










