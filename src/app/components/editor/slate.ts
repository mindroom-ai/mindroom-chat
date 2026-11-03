import type { BaseEditor } from 'slate';
import type { HistoryEditor } from 'slate-history';
import type { ReactEditor } from 'slate-react';
import type { BlockType, HeadingLevel, MarkType } from './types';

/** A run of text. Each mark in `MarkType` is a boolean property; a missing mark is off. */
export type FormattedText = { text: string } & { [mark in MarkType]?: boolean };

export type LinkElement = {
  type: typeof BlockType.Link;
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

export type CommandElement = {
  type: typeof BlockType.Command;
  command: string;
  children: FormattedText[];
};

export type EmoticonElement = {
  type: typeof BlockType.Emoticon;
  /** Unicode emoji, or the mxc URI of a custom emoji. */
  key: string;
  /** Shortcode without colons; the alt text of a custom emoji. */
  shortcode: string;
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

/** Inline elements that are atoms: one unit in the composer, never edited character by character. */
export type AtomElement = MentionElement | CommandElement | EmoticonElement | PasteMarkerElement;

export type InlineElement = LinkElement | AtomElement;

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

/** Blocks that hold one line of text with marks, links and atoms. */
type RichLineElement = ParagraphElement | HeadingElement | QuoteLineElement | ListItemElement;

type ListElement = OrderedListElement | UnorderedListElement;

/** Blocks that hold other blocks. */
type ContainerElement = BlockQuoteElement | CodeBlockElement | ListElement;

export type BlockElement = RichLineElement | CodeLineElement | ContainerElement;

export type CustomElement = BlockElement | InlineElement;

export type SlateEditor = BaseEditor & ReactEditor & HistoryEditor;

declare module 'slate' {
  interface CustomTypes {
    Editor: SlateEditor;
    Element: CustomElement;
    Text: FormattedText;
  }
}
