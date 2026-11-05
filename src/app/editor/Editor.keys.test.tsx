// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { Editor as SlateEditor, Transforms } from 'slate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomEditor, useEditor } from './Editor';
import { findShortcut, type ShortcutId } from '../shortcuts/shortcuts';
import { useShortcut } from '../shortcuts/useShortcut';

// Chrome on a Mac. Slate reads the user agent once, as it loads, and there moves by line on
// Option with the up or down arrow.
vi.hoisted(() => {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no isContentEditable, which Slate reads before it takes a key from its text box.
Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
  configurable: true,
  get(this: HTMLElement) {
    return this.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true';
  },
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let slate: SlateEditor | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  slate = undefined;
});

function Harness() {
  const editor = useEditor();
  slate = editor;
  useShortcut('nextRoom', () => true);
  return <CustomEditor editor={editor} placeholder="Send a message..." />;
}

const textBox = () => {
  container = document.createElement('div');
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(<Harness />);
  });
  return container.querySelector<HTMLElement>('[contenteditable="true"]')!;
};

/** The shortcut the app's window listener finds for Option and the down arrow in the text box. */
const pressOptionDown = (target: HTMLElement): ShortcutId | undefined => {
  let found: ShortcutId | undefined;
  const listen = (event: KeyboardEvent) => {
    found = findShortcut(event, {
      apple: true,
      composing: false,
      computer: false,
      overlay: 'none',
      registered: (id) => id === 'nextRoom',
    });
  };
  window.addEventListener('keydown', listen);
  act(() => {
    target.dispatchEvent(
      // Slate's hotkeys read the key code, as browsers set it.
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
        which: 40,
        altKey: true,
        bubbles: true,
        cancelable: true,
      } as KeyboardEventInit)
    );
  });
  window.removeEventListener('keydown', listen);
  return found;
};

describe('CustomEditor on Apple platforms', () => {
  it('leaves Option and the down arrow in an empty text box to the next room shortcut', () => {
    expect(pressOptionDown(textBox())).toBe('nextRoom');
  });

  it('keeps Option and the down arrow, which move by line, once the text box holds text', async () => {
    const editable = textBox();
    await act(async () =>
      Transforms.insertText(slate!, 'hello', { at: SlateEditor.start(slate!, []) })
    );
    expect(editable.textContent).toBe('hello');
    expect(pressOptionDown(editable)).toBeUndefined();
  });
});
