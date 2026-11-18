// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createEditor, type Descendant } from 'slate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isEmptyEditor } from '../editor/utils';
import { holdsNoText } from './composeTextMessage';
import {
  type ComposerExpansionInputs,
  PRESS_SETTLE_MS,
  isComposerExpanded,
  useComposerFocus,
} from './composerExpansion';

const atRest: ComposerExpansionInputs = {
  phone: true,
  focused: false,
  pressing: false,
  empty: true,
  busy: false,
};

describe('isComposerExpanded', () => {
  it('always shows two rows off a phone', () => {
    expect(isComposerExpanded({ ...atRest, phone: false })).toBe(true);
  });

  it('shows one row on a phone at rest', () => {
    expect(isComposerExpanded(atRest)).toBe(false);
  });

  it.each([
    ['focus or an open menu', { focused: true }],
    ['text', { empty: false }],
    ['files, a reply, a recording, a board or suggestions', { busy: true }],
  ] as const)('expands on a phone with %s', (_name, change) => {
    expect(isComposerExpanded({ ...atRest, ...change })).toBe(true);
  });

  it('stays expanded through a press until it settles', () => {
    expect(isComposerExpanded({ ...atRest, pressing: true })).toBe(true);
  });
});

describe('isEmptyEditor as the layout reads it', () => {
  const editorWith = (text: string) => {
    const editor = createEditor();
    editor.children = [{ type: 'paragraph', children: [{ text }] }] as Descendant[];
    return editor;
  };

  it('is empty with one empty line only', () => {
    expect(isEmptyEditor(editorWith(''))).toBe(true);
    expect(isEmptyEditor(editorWith('a'))).toBe(false);
  });

  it('counts a command with nothing to send as shown text', () => {
    const editor = editorWith('/me ');
    expect(holdsNoText(editor)).toBe(true);
    expect(isEmptyEditor(editor)).toBe(false);
  });
});

function Probe({ menu = false }: { menu?: boolean }) {
  const { focused, pressing, setRoot, onPointerDown } = useComposerFocus(true);
  const [discard, setDiscard] = useState(true);
  return (
    <div data-testid="box" ref={setRoot} onPointerDown={onPointerDown}>
      <input data-testid="text" />
      <button type="button" data-testid="button" aria-expanded={menu}>
        b
      </button>
      {discard && (
        <button type="button" data-testid="discard" onClick={() => setDiscard(false)}>
          d
        </button>
      )}
      <output data-testid="state">{`${focused}|${pressing}`}</output>
    </div>
  );
}

const state = () => screen.getByTestId('state').textContent;

describe('useComposerFocus', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps focus while it moves between parts and drops it once it leaves', () => {
    vi.useFakeTimers();
    render(
      <>
        <Probe />
        <input data-testid="outside" />
      </>
    );
    act(() => screen.getByTestId('text').focus());
    expect(state()).toBe('true|false');

    act(() => {
      screen.getByTestId('button').focus();
      vi.runOnlyPendingTimers();
    });
    expect(state()).toBe('true|false');

    act(() => {
      screen.getByTestId('outside').focus();
      vi.runOnlyPendingTimers();
    });
    expect(state()).toBe('false|false');
  });

  it('drops focus when the focused control is removed', async () => {
    render(<Probe />);
    act(() => screen.getByTestId('discard').focus());
    expect(state()).toBe('true|false');
    act(() => screen.getByTestId('discard').click());
    // The observer reads after the removal, a task later.
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(screen.queryByTestId('discard')).toBeNull();
    expect(state()).toBe('false|false');
  });

  it('counts an open menu of a control as focus, without focus in the composer', async () => {
    const { rerender } = render(<Probe menu />);
    expect(state()).toBe('true|false');
    rerender(<Probe menu={false} />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(state()).toBe('false|false');
  });

  it('counts a press until it settles after the pointer lifts', () => {
    vi.useFakeTimers();
    render(<Probe />);
    fireEvent.pointerDown(screen.getByTestId('button'));
    expect(state()).toBe('false|true');

    act(() => {
      vi.advanceTimersByTime(PRESS_SETTLE_MS * 3);
    });
    // Still down: the press lasts as long as the finger does.
    expect(state()).toBe('false|true');

    fireEvent.pointerUp(window);
    act(() => {
      vi.advanceTimersByTime(PRESS_SETTLE_MS - 1);
    });
    expect(state()).toBe('false|true');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(state()).toBe('false|false');
  });

  it("ends a press only on its own pointer's release", () => {
    vi.useFakeTimers();
    render(<Probe />);
    const pointer = (type: string, target: EventTarget, pointerId: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      act(() => {
        target.dispatchEvent(event);
      });
    };
    pointer('pointerdown', screen.getByTestId('button'), 1);
    // A second finger lands and lifts: the first press still holds.
    pointer('pointerdown', screen.getByTestId('text'), 2);
    pointer('pointerup', window, 2);
    act(() => {
      vi.advanceTimersByTime(PRESS_SETTLE_MS * 2);
    });
    expect(state()).toBe('false|true');
    pointer('pointerup', window, 1);
    act(() => {
      vi.advanceTimersByTime(PRESS_SETTLE_MS);
    });
    expect(state()).toBe('false|false');
  });

  it('ends a press on pointercancel too', () => {
    vi.useFakeTimers();
    render(<Probe />);
    fireEvent.pointerDown(screen.getByTestId('button'));
    fireEvent.pointerCancel(window);
    act(() => {
      vi.advanceTimersByTime(PRESS_SETTLE_MS);
    });
    expect(state()).toBe('false|false');
  });
});
