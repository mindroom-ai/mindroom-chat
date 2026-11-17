// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS } from '../lib/hooks/useLongPress';
import type { MidTurnMode } from '../preferences/settings';
import { ComposerSendButton } from './ComposerSendButton';

// jsdom lays nothing out, so the trap would find no control to hold.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

// jsdom has no pointer events.
class TestPointerEvent extends MouseEvent {
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.isPrimary = init.isPrimary ?? false;
  }
}

const press = { isPrimary: true, button: 0, clientX: 10, clientY: 10 };

describe('the Send button', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', TestPointerEvent);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const setup = (agentReplying: boolean, defaultMode: MidTurnMode = 'auto') => {
    const onSend = vi.fn();
    render(
      <ComposerSendButton
        label="Send message"
        agentReplying={agentReplying}
        defaultMode={defaultMode}
        onSend={onSend}
      />
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

  it('sends on a hold, as on a tap, while no agent replies', () => {
    const { onSend, button } = setup(false);
    hold(button);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onSend.mock.calls).toEqual([[]]);
    expect(button.getAttribute('aria-haspopup')).toBeNull();
  });
});
