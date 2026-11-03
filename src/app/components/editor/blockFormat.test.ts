import { createEditor, Descendant, Editor, Transforms } from 'slate';
import { describe, expect, it } from 'vitest';
import { getActiveBlockFormat, toggleBlockFormat } from './blockFormat';
import { BlockType } from './types';

const line = (text: string, type: string = BlockType.Paragraph) =>
  ({ type, children: [{ text }] } as Descendant);

// An editor holding `children`, with the selection from the start of block `from` to the end of
// block `to` (top-level indexes; nested lines are selected through their container).
const editorWith = (children: Descendant[], from = 0, to = from): Editor => {
  const editor = createEditor();
  editor.children = children;
  Transforms.select(editor, {
    anchor: Editor.start(editor, [from]),
    focus: Editor.end(editor, [to]),
  });
  return editor;
};

describe('toggleBlockFormat', () => {
  it('wraps the selected paragraphs in one quote and unwraps them again', () => {
    const editor = editorWith([line('one'), line('two'), line('three')], 0, 1);
    toggleBlockFormat(editor, BlockType.BlockQuote);
    expect(editor.children).toEqual([
      {
        type: BlockType.BlockQuote,
        children: [line('one', BlockType.QuoteLine), line('two', BlockType.QuoteLine)],
      },
      line('three'),
    ]);
    expect(getActiveBlockFormat(editor)).toBe(BlockType.BlockQuote);

    toggleBlockFormat(editor, BlockType.BlockQuote);
    expect(editor.children).toEqual([line('one'), line('two'), line('three')]);
    expect(getActiveBlockFormat(editor)).toBeUndefined();
  });

  it('turns a list into a code block with one code line per item', () => {
    const editor = editorWith([
      {
        type: BlockType.UnorderedList,
        children: [line('a', BlockType.ListItem), line('b', BlockType.ListItem)],
      } as Descendant,
    ]);
    expect(getActiveBlockFormat(editor)).toBe(BlockType.UnorderedList);
    toggleBlockFormat(editor, BlockType.CodeBlock);
    expect(editor.children).toEqual([
      {
        type: BlockType.CodeBlock,
        children: [line('a', BlockType.CodeLine), line('b', BlockType.CodeLine)],
      },
    ]);
  });

  it('makes a line a level 1 heading and back into a paragraph without its level', () => {
    const editor = editorWith([line('Title'), line('Body')]);
    toggleBlockFormat(editor, BlockType.Heading);
    expect(editor.children[0]).toEqual({
      type: BlockType.Heading,
      level: 1,
      children: [{ text: 'Title' }],
    });
    expect(getActiveBlockFormat(editor)).toBe(BlockType.Heading);
    toggleBlockFormat(editor, BlockType.Heading);
    expect(editor.children).toEqual([line('Title'), line('Body')]);
  });

  it('reports no format for a mixed selection and numbers both lines when asked', () => {
    const editor = editorWith([line('Title', BlockType.Heading), line('Body')], 0, 1);
    expect(getActiveBlockFormat(editor)).toBeUndefined();
    toggleBlockFormat(editor, BlockType.OrderedList);
    expect(editor.children).toEqual([
      {
        type: BlockType.OrderedList,
        children: [line('Title', BlockType.ListItem), line('Body', BlockType.ListItem)],
      },
    ]);
  });
});
