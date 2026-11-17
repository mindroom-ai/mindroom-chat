// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS } from '../lib/hooks/useLongPress';
import type { MidTurnMode } from '../preferences/settings';
import { ComposerSendButton } from './ComposerSendButton';

// The menu's real focus trap runs. jsdom lays nothing out, and the trap holds only controls that
// take up room on the page.
const rects = () => [new DOMRect(0, 0, 40, 40)] as unknown as DOMRectList;

// jsdom has no pointer events.
class TestPointerEvent extends MouseEvent {
  readonly isPrimary: boolean;

  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.isPrimary = init.isPrimary ?? false;
    this.pointerId = init.pointerId ?? 1;
  }
}

const press = { isPrimary: true, button: 0, clientX: 10, clientY: 10 };

describe('the Send button', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(rects);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const setup = (agentReplying: boolean, defaultMode: MidTurnMode = 'auto', hasText = true) => {
    const onSend = vi.fn();
    render(
      <>
        <p>Outside the menu</p>
        <ComposerSendButton
          label="Send message"
          agentReplying={agentReplying}
          hasText={() => hasText}
          defaultMode={defaultMode}
          onSend={onSend}
        />
      </>
    );
    return { onSend, button: screen.getByRole('button', { name: 'Send message' }) };
  };
  /** Holds the button down for a long press and lets go, which clicks it. */
  const hold = (button: HTMLElement) => {
    fireEvent.pointerDown(button, press);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    fireEvent.pointerUp(button, press);
    fireEvent.click(button);
  };

  it('sends with the default mode on a tap, while an agent replies too', () => {
    const { onSend, button } = setup(true);
    fireEvent.pointerDown(button, press);
    fireEvent.pointerUp(button, press);
    fireEvent.click(button);
    expect(onSend).toHaveBeenCalledWith();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the modes on a hold while an agent replies, and sends with the one picked', () => {
    const { onSend, button } = setup(true);
    hold(button);
    expect(onSend).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'SteerStop the reply and carry on with this message',
      'QueueSend after the reply finishes',
      'Auto (default)Let the agent decide',
    ]);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Queue' }));
    expect(onSend.mock.calls).toEqual([['queue']]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('marks the mode a tap sends with', () => {
    const { button } = setup(true, 'queue');
    hold(button);
    expect(screen.getByRole('menuitem', { name: 'Queue (default)' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Steer' })).toBeTruthy();
  });

  it("keeps the menu open through a finger's lift, until a press outside it", () => {
    const { onSend, button } = setup(true);
    const finger = { ...press, pointerType: 'touch' };
    fireEvent.pointerDown(button, finger);
    fireEvent.touchStart(button, { touches: [{ clientX: 10, clientY: 10 }] });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    fireEvent.pointerUp(button, finger);
    fireEvent.touchEnd(button, { touches: [] });
    // The mouse events and the click a browser makes of the lift.
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    fireEvent.click(button);
    expect(screen.queryByRole('menu')).not.toBeNull();
    expect(onSend).not.toHaveBeenCalled();

    const queue = screen.getByRole('menuitem', { name: 'Queue' });
    fireEvent.pointerDown(queue, finger);
    fireEvent.click(queue);
    expect(onSend.mock.calls).toEqual([['queue']]);

    hold(button);
    expect(screen.queryByRole('menu')).not.toBeNull();
    const outside = screen.getByText('Outside the menu');
    fireEvent.pointerDown(outside, press);
    fireEvent.mouseDown(outside);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onSend.mock.calls).toEqual([['queue']]);
  });

  it('sends nothing when Escape closes the menu before the hold is released', () => {
    const { onSend, button } = setup(true);
    fireEvent.pointerDown(button, press);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(screen.queryByRole('menu')).not.toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.pointerUp(button, press);
    fireEvent.mouseUp(button);
    fireEvent.click(button);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends with the row the keys pick once the hold is released', () => {
    const { onSend, button } = setup(true);
    hold(button);
    screen.getByRole('menuitem', { name: 'Steer' }).focus();
    // The trap reads the key's code, as is-hotkey does.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', keyCode: 40, which: 40 });
    const row = document.activeElement as HTMLElement;
    expect(row).toBe(screen.getByRole('menuitem', { name: 'Queue' }));
    // Enter on a button makes its click.
    fireEvent.keyDown(row, { key: 'Enter', keyCode: 13, which: 13 });
    fireEvent.click(row);
    expect(onSend.mock.calls).toEqual([['queue']]);
  });

  it('sends on a hold, as on a tap, without text to send while an agent replies', () => {
    const { onSend, button } = setup(true, 'auto', false);
    hold(button);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onSend.mock.calls).toEqual([[]]);
  });

  it('sends on a hold, as on a tap, while no agent replies', () => {
    const { onSend, button } = setup(false);
    hold(button);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onSend.mock.calls).toEqual([[]]);
    expect(button.getAttribute('aria-haspopup')).toBeNull();
  });
});
