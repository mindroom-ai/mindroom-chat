import { BaseRange, Descendant, Editor, Element, Range, Text, Transforms } from 'slate';
import { HistoryEditor } from 'slate-history';
import { BlockType } from './types';
import type {
  CustomElement,
  EmoticonElement,
  LinkElement,
  MentionElement,
  ParagraphElement,
} from './slate';

export const createParagraphElement = (text = ''): ParagraphElement => ({
  type: BlockType.Paragraph,
  children: [{ text }],
});

// Atoms (mentions, emoticons) hold one empty text child, as Slate requires of void elements.
const emptyChildren = () => [{ text: '' }];

/** A Unicode emoji, or a custom emoji by its mxc URI and shortcode. */
export const createEmoticonElement = (key: string, shortcode: string): EmoticonElement => ({
  type: BlockType.Emoticon,
  key,
  shortcode,
  children: emptyChildren(),
});

/** A mention pill; permalinks to an event carry its ID and the `via` servers to reach it. */
export const createMentionElement = (
  targetId: string,
  label: string,
  highlight: boolean,
  eventId?: string,
  via?: string[]
): MentionElement => ({
  type: BlockType.Mention,
  id: targetId,
  name: label,
  highlight,
  ...(eventId === undefined ? {} : { eventId }),
  ...(via === undefined ? {} : { viaServers: via }),
  children: emptyChildren(),
});

export const createLinkElement = (href: string, text: string): LinkElement => ({
  type: BlockType.Link,
  href,
  children: [{ text }],
});

const INLINE_TYPES: ReadonlySet<string> = new Set([
  BlockType.Link,
  BlockType.Mention,
  BlockType.Emoticon,
  BlockType.PasteMarker,
]);

const VOID_TYPES: ReadonlySet<string> = new Set([
  BlockType.Mention,
  BlockType.Emoticon,
  BlockType.PasteMarker,
]);

export const isInlineElement = (element: CustomElement): boolean => INLINE_TYPES.has(element.type);

export const isVoidElement = (element: CustomElement): boolean => VOID_TYPES.has(element.type);

/** Teaches an editor which elements are inline and which are atomic (void). */
export const withInlineElements = <T extends Editor>(editor: T): T => {
  const { isInline, isVoid, markableVoid } = editor;
  // eslint-disable-next-line no-param-reassign
  editor.isInline = (element) => isInlineElement(element) || isInline(element);
  // eslint-disable-next-line no-param-reassign
  editor.isVoid = (element) => isVoidElement(element) || isVoid(element);
  // eslint-disable-next-line no-param-reassign
  editor.markableVoid = (element) =>
    element.type === BlockType.Emoticon || element.type === BlockType.Mention
      ? true
      : markableVoid(element);
  return editor;
};

const isEmptyBlock = (node: Descendant): boolean =>
  Element.isElement(node) &&
  !INLINE_TYPES.has(node.type) &&
  node.children.every((child) => Text.isText(child) && child.text === '');

/** True when the composer holds nothing but one empty line. */
export const isEmptyEditor = (editor: Editor): boolean =>
  editor.children.length <= 1 && editor.children.every(isEmptyBlock);

/** Replaces the whole document with one empty paragraph and puts the caret in it. */
export const resetEditor = (editor: Editor) => {
  Editor.withoutNormalizing(editor, () => {
    for (let index = editor.children.length - 1; index >= 0; index -= 1) {
      Transforms.removeNodes(editor, { at: [index] });
    }
    Transforms.insertNodes(editor, createParagraphElement(), { at: [0] });
    Transforms.select(editor, Editor.start(editor, []));
  });
};

/** Forgets undo and redo steps, so a fresh composer cannot undo back into a sent message. */
export const resetEditorHistory = (editor: Editor) => {
  if (!HistoryEditor.isHistoryEditor(editor)) return;
  // eslint-disable-next-line no-param-reassign
  editor.history = { undos: [], redos: [] };
};

/**
 * Puts back the content of a failed submission. Anything typed since is kept after it,
 * so a retry never discards newer input.
 */
export const restoreEditorContent = (editor: Editor, content: Descendant[]) => {
  if (content.length === 0) return;
  const nodes = structuredClone(content);
  Editor.withoutNormalizing(editor, () => {
    if (isEmptyEditor(editor)) {
      for (let index = editor.children.length - 1; index >= 0; index -= 1) {
        Transforms.removeNodes(editor, { at: [index] });
      }
    }
    Transforms.insertNodes(editor, nodes, { at: [0], select: false });
  });
};

// Inserting a void element leaves the caret inside it; one offset forward is the text after it.
const stepOutOfAtom = (editor: Editor) => {
  const { selection } = editor;
  if (selection && Editor.void(editor, { at: selection })) {
    Transforms.move(editor, { unit: 'offset' });
  }
};

/** Replaces `range` with `element` and places the caret after it. */
export const replaceWithElement = (editor: Editor, range: BaseRange, element: CustomElement) => {
  Transforms.select(editor, range);
  Transforms.insertNodes(editor, element);
  stepOutOfAtom(editor);
};

/**
 * Leaves the caret where typing continues after an insertion: past an atom it sits in, and
 * after a space with `withSpace`.
 */
export const moveCursor = (editor: Editor, withSpace?: boolean) => {
  stepOutOfAtom(editor);
  if (withSpace) Editor.insertText(editor, ' ');
};

/** The run of non-space characters right before a collapsed caret, for autocomplete queries. */
export function getPrevWorldRange(editor: Editor): BaseRange | undefined {
  const { selection } = editor;
  if (!selection || Range.isExpanded(selection)) return undefined;
  const caret = selection.focus;
  const [leaf] = Editor.leaf(editor, caret);
  if (!Text.isText(leaf)) return undefined;
  const wordStart = leaf.text.slice(0, caret.offset).search(/\S+$/);
  if (wordStart < 0) return undefined;
  return { anchor: { path: caret.path, offset: wordStart }, focus: caret };
}

export type EditorMentions = {
  users: Set<string>;
  room: boolean;
};

/** Users and `@room` mentioned in the document, for the `m.mentions` property. */
export const getMentions = (editor: Editor, ownUserId?: string): EditorMentions => {
  const mentions: EditorMentions = { users: new Set(), room: false };
  const entries = Editor.nodes<MentionElement>(editor, {
    at: [],
    match: (node) => Element.isElement(node) && node.type === BlockType.Mention,
  });
  Array.from(entries).forEach(([mention]) => {
    if (mention.id === '@room') mentions.room = true;
    else if (mention.id.startsWith('@') && mention.id !== ownUserId) mentions.users.add(mention.id);
  });
  return mentions;
};
