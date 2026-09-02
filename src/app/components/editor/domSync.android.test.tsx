// @vitest-environment jsdom
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { Node, createEditor } from 'slate';
import { Editable, ReactEditor, Slate, withReact } from 'slate-react';
import { afterEach, expect, it, vi } from 'vitest';
import { BlockType } from './types';
import { useDomSyncGuard } from './domSync';

vi.mock('slate-dom', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  IS_ANDROID: true,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Guard = () => {
  useDomSyncGuard();
  return null;
};

let root: Root | undefined;
let container: HTMLElement | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
});

it('stays out of the way on Android where slate-react reconciles DOM mutations itself', async () => {
  const editor = withReact(createEditor());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Slate
        editor={editor}
        initialValue={[{ type: BlockType.Paragraph, children: [{ text: '' }] }] as never}
      >
        <Editable />
        <Guard />
      </Slate>
    );
  });
  const editable = ReactEditor.toDOMNode(editor, editor);
  const zeroWidth = editable.querySelector('[data-slate-zero-width]')!;
  zeroWidth.textContent = '\uFEFFhello';
  await act(async () => {
    editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
  expect(Node.string(editor)).toBe('');
});
