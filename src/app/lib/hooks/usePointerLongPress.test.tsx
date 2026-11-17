// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS, LONG_PRESS_SLOP } from './useLongPress';
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

  readonly pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.isPrimary = init.isPrimary ?? false;
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const setup = (canStart?: () => boolean) => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const view = render(<Button onLongPress={onLongPress} onClick={onClick} canStart={canStart} />);
    return { onLongPress, onClick, button: within(view.container).getByRole('button') };
  };
  const wait = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it.each<PointerType>(['mouse', 'touch', 'pen'])(
    'fires for a %s after the delay, and the click that ends the hold does nothing',
    (type) => {
      const { onLongPress, onClick, button } = setup();
      fireEvent.pointerDown(button, pointer(type));
      wait(LONG_PRESS_MS - 1);
      expect(onLongPress).not.toHaveBeenCalled();
      wait(1);
      expect(onLongPress).toHaveBeenCalledWith(button);
      fireEvent.pointerUp(button, pointer(type));
      fireEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
      // Only that one click: the next tap clicks again.
      fireEvent.pointerDown(button, pointer(type));
      fireEvent.pointerUp(button, pointer(type));
      fireEvent.click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    }
  );

  it("drops the mouse events of a fired press's lift page-wide, until the next press or key", () => {
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

    fireEvent.pointerDown(button, pointer('touch'));
    wait(LONG_PRESS_MS);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.mouseDown(document.body);
    expect(heard).toHaveBeenCalledTimes(2);
    document.removeEventListener('mousedown', heard, true);
  });

  it('lets a short press click, and fires nothing later', () => {
    const { onLongPress, onClick, button } = setup();
    fireEvent.pointerDown(button, pointer('mouse'));
    wait(100);
    fireEvent.pointerUp(button, pointer('mouse'));
    fireEvent.click(button);
    wait(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ends the press on a move beyond the slop, a cancel or leaving the button', () => {
    const { onLongPress, onClick, button } = setup();
    fireEvent.pointerDown(button, pointer('touch'));
    fireEvent.pointerMove(button, pointer('touch', 40 + LONG_PRESS_SLOP / 2, 60));
    fireEvent.pointerMove(button, pointer('touch', 40 + LONG_PRESS_SLOP + 1, 60));
    wait(LONG_PRESS_MS);
    fireEvent.pointerDown(button, pointer('touch'));
    fireEvent.pointerCancel(button, pointer('touch'));
    wait(LONG_PRESS_MS);
    fireEvent.pointerDown(button, pointer('mouse'));
    fireEvent.pointerLeave(button, pointer('mouse'));
    wait(LONG_PRESS_MS);
    expect(onLongPress).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
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
