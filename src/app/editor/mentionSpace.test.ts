import { createEditor, Editor, Transforms } from 'slate';
import { describe, expect, it } from 'vitest';
import {
  createMentionElement,
  isAfterMentionSpace,
  moveCursor,
  replaceWithElement,
  withInlineElements,
} from './utils';
import { toPlainText } from './output';

/** An editor holding `text`, with `@name` (its last `@` word) picked as a mention of Ada. */
const pickMention = (text: string) => {
  const editor = withInlineElements(createEditor());
  editor.children = [{ type: 'paragraph', children: [{ text }] }];
  const start = text.lastIndexOf('@');
  const end = text.indexOf(' ', start) < 0 ? text.length : text.indexOf(' ', start);
  const range = { anchor: { path: [0, 0], offset: start }, focus: { path: [0, 0], offset: end } };
  replaceWithElement(editor, range, createMentionElement('@ada:x', 'Ada', false));
  moveCursor(editor, true);
  return editor;
};

describe('a picked mention', () => {
  it('brings one space, and a space typed after it adds none', () => {
    const editor = pickMention('hello @ad');
    expect(isAfterMentionSpace(editor)).toBe(true);
    // What the composer's beforeinput handler leaves out: the typed space.
    Editor.insertText(editor, 'and more');
    expect(toPlainText(editor.children, true)).toBe('hello Ada and more');
    expect(isAfterMentionSpace(editor)).toBe(false);
  });

  it('steps over a space that already follows it instead of doubling it', () => {
    const editor = pickMention('hello @ad world');
    expect(toPlainText(editor.children, true)).toBe('hello Ada world');
    expect(isAfterMentionSpace(editor)).toBe(true);
  });

  it('lets a space be typed anywhere else', () => {
    const editor = pickMention('hello @ad');
    Editor.insertText(editor, 'x');
    expect(isAfterMentionSpace(editor)).toBe(false);
    // Right after the pill, before its space.
    Transforms.move(editor, { distance: 2, reverse: true });
    expect(editor.selection?.focus.offset).toBe(0);
    expect(isAfterMentionSpace(editor)).toBe(false);
  });
});
