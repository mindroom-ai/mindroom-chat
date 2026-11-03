// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomEditor, useEditor } from './Editor';

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

const textBox = (props: { ariaLabel?: string }) => {
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
});
