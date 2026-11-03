import type { BaseEditor } from 'slate';
import type { HistoryEditor } from 'slate-history';
import type { ReactEditor } from 'slate-react';
import type { BlockType, HeadingLevel } from './types';

export type FormattedText = {
  text: string;
















  /** User ID, room ID, room alias, or `@room`. */
  id: string;
  /** Text shown in the composer and in the plain-text body. */
  name: string;
  /** Whether the mention is the current user or `@room`. */
  highlight: boolean;
  eventId?: string;
  viaServers?: string[];





  /** Unicode emoji, or the mxc URI of a custom emoji. */
  key: string;








};

/** Atomic badge for a long paste that was moved into a text attachment. */
export type PasteMarkerElement = {
  type: BlockType.PasteMarker;
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
  type: BlockType.Paragraph;
  children: InlineContent[];
};




  children: InlineContent[];
};















































export type CustomElement = BlockElement | InlineElement;

export type SlateEditor = BaseEditor & ReactEditor & HistoryEditor;

declare module 'slate' {
  interface CustomTypes {
    Editor: SlateEditor;
    Element: CustomElement;
    Text: FormattedText;
  }
}
