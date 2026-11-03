import { BasePoint, BaseRange, Descendant, Editor, Element, Range, Text, Transforms } from 'slate';
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
  BlockType.Command,
  BlockType.PasteMarker,
]);

const VOID_TYPES: ReadonlySet<string> = new Set([
  BlockType.Mention,
  BlockType.Emoticon,
  BlockType.Command,
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
  editor.children.length === 0 ||
  (editor.children.length === 1 && isEmptyBlock(editor.children[0]));

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

/** Replaces `range` with `element` and places the caret after it. */
export const replaceWithElement = (editor: Editor, range: BaseRange, element: CustomElement) => {


















  const [leaf] = Editor.leaf(editor, cursor);
  if (!Text.isText(leaf)) return undefined;
  const before = leaf.text.slice(0, cursor.offset);
  const start = before.search(/\S+$/);
  if (start < 0) return undefined;
  const anchor: BasePoint = { path: cursor.path, offset: start };
  return { anchor, focus: cursor };
};

/** The command a message starts with, when the first node is a command element. */
export const getBeginCommand = (editor: Editor): string | undefined => {
  const firstBlock = editor.children[0];
  if (!Element.isElement(firstBlock)) return undefined;
  const firstInline = firstBlock.children.find(
    (child) => !(Text.isText(child) && child.text === '')
  );
  if (Element.isElement(firstInline) && firstInline.type === BlockType.Command) {
    return firstInline.command;
  }
  return undefined;
};

/** Strips the leading `/command` from text produced by a command message. */
export const trimCommand = (command: string, value: string): string => {
  const pattern = new RegExp(`^(\\s|<br/>)*/${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  return value.replace(pattern, '').trimStart();
};

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
