// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS, LONG_PRESS_SLOP, SELECTION_HOLD_MS } from './useLongPress';
import { usePointerLongPress } from './usePointerLongPress';

function Button({
  onLongPress,
  onClick,
  canStart = () => true,
}: {
  onLongPress: (element: HTMLElement) => void;
  onClick: () => void;
  canStart?: () => boolean;
}) {
  const handlers = usePointerLongPress(onLongPress, canStart);
  return (
    <button type="button" onClick={onClick} {...handlers}>
      Send
    </button>
  );
}

// jsdom has no pointer events.
class TestPointerEvent extends MouseEvent {
  readonly isPrimary: boolean;

  readonly pointerId: number;

  readonly pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.isPrimary = init.isPrimary ?? false;
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? '';
  }
}

type PointerType = 'mouse' | 'touch' | 'pen';
const pointer = (pointerType: PointerType, x = 40, y = 60) => ({
  pointerType,
  isPrimary: true,
  button: 0,
  clientX: x,
  clientY: y,
});

describe('usePointerLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', TestPointerEvent);
  });
  afterEach(() => {
    cleanup();
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const setup = (canStart?: () => boolean) => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const view = render(<Button onLongPress={onLongPress} onClick={onClick} canStart={canStart} />);
    return {
      onLongPress,
      onClick,
      button: within(view.container).getByRole('button'),
      unmount: view.unmount,
    };
  };
  const wait = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  const { style: pageStyle } = document.documentElement;
  const drift = pointer('touch', 40 + LONG_PRESS_SLOP + 1);

  it.each([
    { type: 'mouse', end: 'pointerUp' },
    { type: 'touch', end: 'pointerUp' },
    { type: 'pen', end: 'pointerCancel' },
  ] as const)(
    'fires for $type after the delay, releases selection on $end, and drops the click',
    ({ type, end }) => {
      const { onLongPress, onClick, button } = setup();
      fireEvent.pointerDown(button, pointer(type));
      wait(LONG_PRESS_MS - 1);
      expect(onLongPress).not.toHaveBeenCalled();
      wait(1);
      expect(onLongPress).toHaveBeenCalledWith(button);
      // The menu covers the button, so the release arrives elsewhere.
      fireEvent.pointerLeave(button, pointer(type));
      fireEvent.pointerUp(document.body, { ...pointer(type), pointerId: 2 });
      expect(pageStyle.userSelect).toBe('none');
      fireEvent[end](document.body, pointer(type));
      expect(pageStyle.userSelect).toBe('');
      fireEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
      // Only that one click: the next tap clicks again.
      fireEvent.pointerDown(button, pointer(type));
      fireEvent.pointerUp(button, pointer(type));
      fireEvent.click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    }
  );

  it("drops a fired press's lift page-wide, until the next press or a key after the lift", () => {
    const { button } = setup();
    const heard = vi.fn();
    // A focus trap listens on the document, as menus do.
    document.addEventListener('mousedown', heard, true);
    fireEvent.pointerDown(button, pointer('touch'));
    wait(LONG_PRESS_MS);
    fireEvent.pointerUp(button, pointer('touch'));
    expect(fireEvent.mouseDown(document.body)).toBe(false);
    expect(heard).not.toHaveBeenCalled();
    // A new press is heard again.
    fireEvent.pointerDown(document.body, pointer('mouse'));
    fireEvent.mouseDown(document.body);
    expect(heard).toHaveBeenCalledTimes(1);

    // A key while the pointer is still down drops on; one after the lift ends the dropping.
    fireEvent.pointerDown(button, pointer('touch'));
    wait(LONG_PRESS_MS);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.pointerUp(button, pointer('touch'));
    fireEvent.mouseDown(document.body);
    expect(heard).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.mouseDown(document.body);
    expect(heard).toHaveBeenCalledTimes(2);
    document.removeEventListener('mousedown', heard, true);
  });

  it.each(['pointerUp', 'pointerCancel', 'pointerMove', 'pointerLeave'] as const)(
    'ends on %s before touching page style or swallowing a click',
    (end) => {
      const { onLongPress, onClick, button } = setup();
      const set = vi.spyOn(pageStyle, 'setProperty');
      const remove = vi.spyOn(pageStyle, 'removeProperty');
      fireEvent.pointerDown(button, pointer('touch'));
      wait(SELECTION_HOLD_MS - 1);
      fireEvent[end](button, end === 'pointerMove' ? drift : pointer('touch'));
      fireEvent.click(button);
      wait(LONG_PRESS_MS);
      expect(set).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(onLongPress).not.toHaveBeenCalled();
      expect(onClick).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['pointerUp', 'pointerCancel', 'pointerMove', 'pointerLeave', 'unmount'] as const)(
    'blocks selection after the rest and releases it before the press fires on %s',
    (end) => {
      const { onLongPress, button, unmount } = setup();
      // jsdom may not store the WebKit-only properties. Spy without replacing CSSOM behavior.
      const set = vi.spyOn(pageStyle, 'setProperty');
      const remove = vi.spyOn(pageStyle, 'removeProperty');
      const webkit = ['-webkit-user-select', '-webkit-touch-callout'];
      fireEvent.pointerDown(button, pointer('touch'));
      fireEvent.pointerMove(button, pointer('touch', 40 + LONG_PRESS_SLOP / 2));
      wait(SELECTION_HOLD_MS);
      expect(pageStyle.userSelect).toBe('none');
      for (const property of webkit) expect(set).toHaveBeenCalledWith(property, 'none');
      if (end === 'unmount') unmount();
      else fireEvent[end](button, end === 'pointerMove' ? drift : pointer('touch'));
      expect(pageStyle.userSelect).toBe('');
      for (const property of webkit) expect(remove).toHaveBeenCalledWith(property);
      wait(LONG_PRESS_MS);
      expect(onLongPress).not.toHaveBeenCalled();
    }
  );

  it('clears a range when the press fires but keeps a caret', () => {
    const { button } = setup();
    const selection = window.getSelection();
    selection?.selectAllChildren(button);
    fireEvent.pointerDown(button, pointer('touch'));
    wait(LONG_PRESS_MS - 1);
    expect(selection?.toString()).toBe('Send');
    wait(1);
    expect(selection?.rangeCount).toBe(0);
    fireEvent.pointerUp(button, pointer('touch'));

    selection?.collapse(button.firstChild, 2);
    fireEvent.pointerDown(button, pointer('touch'));
    wait(LONG_PRESS_MS);
    expect(selection?.rangeCount).toBe(1);
    expect(selection?.anchorOffset).toBe(2);
  });

  it.each(['unmount', 'next press'] as const)('releases a fired hold on %s without a lift', (end) => {
    const { button, unmount } = setup();
    fireEvent.pointerDown(button, pointer('touch'));
    wait(LONG_PRESS_MS);
    expect(pageStyle.userSelect).toBe('none');
    if (end === 'unmount') unmount();
    else fireEvent.pointerDown(document.body, pointer('mouse'));
    expect(pageStyle.userSelect).toBe('');
  });

  it('starts no press when it may not, nor for a secondary button', () => {
    const { onLongPress, onClick, button } = setup(() => false);
    fireEvent.pointerDown(button, pointer('mouse'));
    wait(LONG_PRESS_MS);
    fireEvent.click(button);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);

    const other = setup();
    fireEvent.pointerDown(other.button, { ...pointer('mouse'), button: 2 });
    wait(LONG_PRESS_MS);
    expect(other.onLongPress).not.toHaveBeenCalled();
  });

  it("keeps a resting finger's context menu closed", () => {
    const { button } = setup();
    expect(fireEvent.contextMenu(button)).toBe(true);
    fireEvent.pointerDown(button, pointer('touch'));
    // fireEvent answers false when a handler prevented the default.
    expect(fireEvent.contextMenu(button)).toBe(false);
  });
});
