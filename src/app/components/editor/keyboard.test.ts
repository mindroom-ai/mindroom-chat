import { KeyboardEvent } from 'react';
import { createEditor } from 'slate';
import { describe, expect, it } from 'vitest';
import { toggleKeyboardShortcut } from './keyboard';
import { BlockType } from './types';

const modNumberEvent = (key: string) =>
  ({
    key,
    altKey: false,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
  } as KeyboardEvent<Element>);

describe('toggleKeyboardShortcut', () => {
  it.each(['1', '2', '3'])('leaves the browser mod+%s shortcut unhandled', (key) => {
    const editor = createEditor();
    editor.children = [
      {
        type: BlockType.Paragraph,
        children: [{ text: 'Composer text' }],
      },
    ];
    editor.selection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 0 },
    };

    expect(toggleKeyboardShortcut(editor, modNumberEvent(key))).toBe(false);
    expect(editor.children).toEqual([
      {
        type: BlockType.Paragraph,
        children: [{ text: 'Composer text' }],
      },
    ]);
  });
});
