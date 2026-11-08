// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Descendant } from 'slate';
import { CustomEditor, useEditor } from './Editor';
import { BlockType } from './types';
import { createMentionElement } from './utils';

vi.mock('./Editor.css', () =>
  Object.fromEntries(
    [
      'BlockQuote',
      'CodeBlock',
      'Editor',
      'EditorOptions',
      'EditorPlaceholder',
      'EditorTextarea',
      'EditorTextareaScroll',
      'Emoticon',
      'InlineChip',
      'InlineChipHighlight',
      'InlineChipSelected',
      'InlineCode',
      'Spoiler',
    ].map((name) => [name, name])
  )
);
vi.mock('folds', () => ({
  Box: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Scroll: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const textBox = (props: { ariaLabel?: string; initialValue?: Descendant[] }) => {
  function Harness() {
    const editor = useEditor();
    return (
      <CustomEditor
        editor={editor}
        editableName="RoomInput"
        placeholder="Send a message..."
        {...props}
      />
    );
  }
  container = document.createElement('div');
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(<Harness />);
  });
  return container.querySelector('[contenteditable="true"]')!;
};

describe('CustomEditor', () => {
  it('names the text box for code apart from its accessible name, the placeholder', () => {
    const editable = textBox({});
    expect(editable.getAttribute('data-editable-name')).toBe('RoomInput');
    expect(editable.getAttribute('aria-label')).toBe('Send a message...');
  });

  it('takes an explicit accessible name over the placeholder', () => {
    expect(textBox({ ariaLabel: 'Reply' }).getAttribute('aria-label')).toBe('Reply');
  });

  it('shows the direction controls of a mention label as code points, as the message sends it', () => {
    // A message being edited keeps the label its HTML gave the mention.
    const mention = createMentionElement('@ops\u202enimda:example.org', '@ops\u202enimda', false);
    textBox({
      initialValue: [
        { type: BlockType.Paragraph, children: [{ text: '' }, mention, { text: '' }] },
      ],
    });
    // Slate keeps a zero-width character (U+FEFF) after an inline element's label.
    const chip = container!.querySelector('[data-editor-inline="mention"]');
    expect(chip?.textContent?.replace(/\uFEFF/g, '')).toBe('@ops<U+202E>nimda');
  });
});
