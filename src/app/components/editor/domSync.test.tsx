// @vitest-environment jsdom
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { Node, Transforms, createEditor } from 'slate';
import { Editable, ReactEditor, RenderElementProps, Slate, withReact } from 'slate-react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlockType } from './types';
import {
  findDesyncedLeaves,
  hasTextOutsideLeaves,
  repairDesyncedLeaves,
  useDomSyncGuard,
} from './domSync';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderMention = ({ attributes, children, element }: RenderElementProps) =>
  element.type === BlockType.Mention ? (
    <span {...attributes} contentEditable={false}>
      @{element.name}
      {children}
    </span>
  ) : (
    <p {...attributes}>{children}</p>
  );

const Guard = () => {
  useDomSyncGuard();
  return null;
};

type SetupOptions = {
  placeholder?: string;
  withMention?: boolean;
  guard?: boolean;
  initialText?: string;
};

const setup = (opts: SetupOptions = {}) => {
  const editor = withReact(createEditor());
  editor.isInline = (element) => element.type === BlockType.Mention;
  editor.isVoid = (element) => element.type === BlockType.Mention;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const initialValue = opts.withMention
    ? [
        {
          type: BlockType.Paragraph,
          children: [
            { text: 'hi ' },
            {
              type: BlockType.Mention,
              id: '@a:x',
              name: 'alice',
              highlight: false,
              children: [{ text: '' }],
            },
            { text: '' },
          ],
        },
      ]
    : [{ type: BlockType.Paragraph, children: [{ text: opts.initialText ?? '' }] }];
  act(() => {
    root.render(
      <Slate editor={editor} initialValue={initialValue as never}>
        <Editable placeholder={opts.placeholder} renderElement={renderMention} />
        {opts.guard && <Guard />}
      </Slate>
    );
  });
  const editable = ReactEditor.toDOMNode(editor, editor);
  return { editor, editable, root, container };
};

const injectNativeText = (editable: HTMLElement, text: string) => {
  // Mimic the browser inserting text into the first leaf without Slate knowing.
  const leaf = editable.querySelector('[data-slate-node="text"]') as HTMLElement;
  const zeroWidth = leaf.querySelector('[data-slate-zero-width]') as HTMLElement | null;
  if (zeroWidth) zeroWidth.textContent = `\uFEFF${text}`;
  else leaf.querySelector('[data-slate-string]')!.textContent += text;
};

describe('editor DOM/model desync repair', () => {
  let cleanup: Array<{ root: Root; container: HTMLElement }> = [];
  beforeEach(() => {
    cleanup = [];
  });
  afterEach(() => {
    cleanup.forEach(({ root, container }) => {
      act(() => root.unmount());
      container.remove();
    });
  });

  it('reports nothing for an empty editor showing its placeholder', async () => {
    const ctx = setup({ placeholder: 'Send a message...' });
    cleanup.push(ctx);
    // slate-react mounts the placeholder after a zero-delay timeout.
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(ctx.editable.querySelector('[data-slate-placeholder]')?.textContent).toBe(
      'Send a message...'
    );
    expect(findDesyncedLeaves(ctx.editor, ctx.editable)).toEqual([]);
  });

  it('ignores void inline elements whose visible label is not model text', () => {
    const ctx = setup({ withMention: true });
    cleanup.push(ctx);
    expect(Node.string(ctx.editor)).toBe('hi ');
    expect(findDesyncedLeaves(ctx.editor, ctx.editable)).toEqual([]);
  });

  it('detects text the browser inserted natively behind the model', () => {
    const ctx = setup({ placeholder: 'Send a message...' });
    cleanup.push(ctx);
    injectNativeText(ctx.editable, 'hello dictated');
    expect(findDesyncedLeaves(ctx.editor, ctx.editable)).toEqual([
      { path: [0, 0], domText: 'hello dictated' },
    ]);
  });

  it('pulls natively inserted text into the model and puts the caret after it', async () => {
    const ctx = setup();
    cleanup.push(ctx);
    injectNativeText(ctx.editable, 'hello dictated');
    let repaired = 0;
    // Slate flushes onChange in a microtask, so the re-render needs an async act.
    await act(async () => {
      repaired = repairDesyncedLeaves(ctx.editor, findDesyncedLeaves(ctx.editor, ctx.editable));
    });
    expect(repaired).toBe(1);
    expect(Node.string(ctx.editor)).toBe('hello dictated');
    expect(ctx.editor.selection).toEqual({
      anchor: { path: [0, 0], offset: 14 },
      focus: { path: [0, 0], offset: 14 },
    });
    expect(findDesyncedLeaves(ctx.editor, ctx.editable)).toEqual([]);
  });

  it('preserves existing model text when repairing an appended native insertion', async () => {
    const ctx = setup();
    cleanup.push(ctx);
    await act(async () => {
      Transforms.insertText(ctx.editor, 'abc ', { at: { path: [0, 0], offset: 0 } });
    });
    expect(ctx.editable.textContent).toBe('abc ');
    injectNativeText(ctx.editable, 'hello dictated');
    await act(async () => {
      repairDesyncedLeaves(ctx.editor, findDesyncedLeaves(ctx.editor, ctx.editable));
    });
    expect(Node.string(ctx.editor)).toBe('abc hello dictated');
  });

  const dispatchInput = async (editable: HTMLElement, init: InputEventInit) => {
    await act(async () => {
      editable.dispatchEvent(new InputEvent('input', { bubbles: true, ...init }));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  };

  it('repairs the model after a native input event the editor did not handle', async () => {
    const ctx = setup({ guard: true });
    cleanup.push(ctx);
    injectNativeText(ctx.editable, 'hello dictated');
    await dispatchInput(ctx.editable, { inputType: 'insertFromPaste' });
    expect(Node.string(ctx.editor)).toBe('hello dictated');
  });

  it('leaves in-progress IME compositions alone', async () => {
    const ctx = setup({ guard: true });
    cleanup.push(ctx);
    injectNativeText(ctx.editable, 'かな');
    await dispatchInput(ctx.editable, { inputType: 'insertCompositionText', isComposing: true });
    expect(Node.string(ctx.editor)).toBe('');
  });

  it('ignores the trailing newline slate-react renders for soft-break leaves', async () => {
    const ctx = setup({ initialText: 'hello\n' });
    cleanup.push(ctx);
    expect(ctx.editable.textContent).toBe('hello\n\n');
    expect(findDesyncedLeaves(ctx.editor, ctx.editable)).toEqual([]);
    await act(async () => {
      repairDesyncedLeaves(ctx.editor, findDesyncedLeaves(ctx.editor, ctx.editable));
    });
    expect(Node.string(ctx.editor)).toBe('hello\n');
  });

  it('detects text injected into the empty leaf that follows a void inline', () => {
    const ctx = setup({ withMention: true });
    cleanup.push(ctx);
    const leaves = ctx.editable.querySelectorAll('[data-slate-node="text"]');
    const trailing = leaves[leaves.length - 1].querySelector('[data-slate-zero-width]')!;
    trailing.textContent = '\uFEFF after';
    expect(findDesyncedLeaves(ctx.editor, ctx.editable)).toEqual([
      { path: [0, 2], domText: ' after' },
    ]);
  });

  it('keeps the caret where the browser left it after a mid-leaf repair', async () => {
    const ctx = setup({ initialText: 'abc def' });
    cleanup.push(ctx);
    const textNode = ctx.editable.querySelector('[data-slate-string]')!.firstChild as Text;
    textNode.insertData(4, 'X');
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, 5);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    await act(async () => {
      repairDesyncedLeaves(ctx.editor, findDesyncedLeaves(ctx.editor, ctx.editable));
    });
    expect(Node.string(ctx.editor)).toBe('abc Xdef');
    expect(ctx.editor.selection).toEqual({
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 5 },
    });
  });

  it('reads a native <br> inside a leaf as a newline', () => {
    const ctx = setup({ initialText: 'a' });
    cleanup.push(ctx);
    const stringSpan = ctx.editable.querySelector('[data-slate-string]')!;
    stringSpan.appendChild(document.createElement('br'));
    stringSpan.appendChild(document.createTextNode('b'));
    expect(findDesyncedLeaves(ctx.editor, ctx.editable)).toEqual([
      { path: [0, 0], domText: 'a\nb' },
    ]);
  });

  it('reports text the browser placed outside any Slate text leaf', () => {
    const ctx = setup();
    cleanup.push(ctx);
    expect(hasTextOutsideLeaves(ctx.editable)).toBe(false);
    const block = ctx.editable.querySelector('[data-slate-node="element"]')!;
    block.appendChild(document.createTextNode('stray'));
    expect(hasTextOutsideLeaves(ctx.editable)).toBe(true);
  });
});
