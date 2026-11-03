import type { BaseEditor } from 'slate';
import type { HistoryEditor } from 'slate-history';
import type { ReactEditor } from 'slate-react';
import type { BlockType, HeadingLevel } from './types';

export type FormattedText = {
  text: string;
  // Marks (MarkType in types.ts); a missing mark is off.










  href: string;
  children: FormattedText[];
};

export type MentionElement = {
  type: typeof BlockType.Mention;
  /** User ID, room ID, room alias, or `@room`. */
  id: string;
  /** Text shown in the composer and in the plain-text body. */
  name: string;
  /** Whether the mention is the current user or `@room`. */
  highlight: boolean;
  eventId?: string;
  viaServers?: string[];
  children: FormattedText[];
};

export type EmoticonElement = {
  type: typeof BlockType.Emoticon;
  /** Unicode emoji, or the mxc URI of a custom emoji. */
  key: string;
  /** Shortcode without colons; the alt text of a custom emoji. */





  type: typeof BlockType.Command;
  command: string;
  children: FormattedText[];
};

/** Atomic badge for a long paste that was moved into a text attachment. */
export type PasteMarkerElement = {
  type: typeof BlockType.PasteMarker;
  id: string;
  chars: number;
  fileName: string;
  /** The exact marker text sent in the message body. */
  marker: string;
  children: FormattedText[];
};

export type InlineElement =




  | PasteMarkerElement;

export type InlineContent = FormattedText | InlineElement;

export type ParagraphElement = {
  type: typeof BlockType.Paragraph;
  children: InlineContent[];
};

export type HeadingElement = {
  type: typeof BlockType.Heading;
  level: HeadingLevel;
  children: InlineContent[];
};

export type CodeLineElement = {
  type: typeof BlockType.CodeLine;
  children: FormattedText[];
};

export type CodeBlockElement = {
  type: typeof BlockType.CodeBlock;
  children: CodeLineElement[];
};

export type QuoteLineElement = {
  type: typeof BlockType.QuoteLine;
  children: InlineContent[];
};

export type BlockQuoteElement = {
  type: typeof BlockType.BlockQuote;
  children: QuoteLineElement[];
};

export type ListItemElement = {
  type: typeof BlockType.ListItem;
  children: InlineContent[];
};

export type OrderedListElement = {
  type: typeof BlockType.OrderedList;
  children: ListItemElement[];
};

export type UnorderedListElement = {
  type: typeof BlockType.UnorderedList;
  children: ListItemElement[];
};

export type BlockElement =







  | UnorderedListElement
  | ListItemElement;

export type CustomElement = BlockElement | InlineElement;

export type SlateEditor = BaseEditor & ReactEditor & HistoryEditor;

declare module 'slate' {
  interface CustomTypes {
    Editor: SlateEditor;
    Element: CustomElement;
    Text: FormattedText;
  }
}
