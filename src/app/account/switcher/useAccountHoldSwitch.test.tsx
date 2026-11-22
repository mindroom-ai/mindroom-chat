// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredSession } from '../../matrix/session/sessions';
import type { AccountMenuAccount } from './AccountMenu';
import { ACCOUNT_HOLD_MS, ACCOUNT_HOLD_SLOP, useAccountHoldSwitch } from './useAccountHoldSwitch';

const session = (sessionId: string, userId: string, lastUsedAt: number): StoredSession => ({
  sessionId,
  baseUrl: 'https://matrix.example.org',
  userId,
  deviceId: `DEVICE_${sessionId}`,
  accessToken: `token-${sessionId}`,
  lastUsedAt,
});

const BOB: AccountMenuAccount = {
  session: session('bob', '@bob:matrix.org', 20),
  displayName: 'Bob',
};
const CAROL: AccountMenuAccount = {
  session: session('carol', '@carol:example.org', 10),
  displayName: 'Carol',
};

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  x: left,
  y: top,
  toJSON: () => ({}),
});

const pointerEvent = (
  type: string,
  init: {
    pointerId?: number;
    pointerType?: string;
    button?: number;
    clientX?: number;
    clientY?: number;
  } = {}
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'touch' });
  return event;
};

type HarnessProps = {
  enabled?: boolean;
  others?: AccountMenuAccount[];
  onSwitch: (s: StoredSession) => void;
  onClick: () => void;
};

function Harness({ enabled = true, others = [BOB, CAROL], onSwitch, onClick }: HarnessProps) {
  const hold = useAccountHoldSwitch({ enabled, others, onSwitch });
  return (
    <div>
      <button type="button" data-testid="trigger" onClick={onClick} {...hold.triggerProps}>
        Avatar
      </button>
      {hold.holdAnchor && (
        <div ref={hold.menuRef} data-testid="quick-menu">
          {others.map((account) => (
            <div
              key={account.session.sessionId}
              data-testid={`row-${account.session.sessionId}`}
              data-quick-account-session-id={account.session.sessionId}
              data-highlighted={
                hold.hoveredSessionId === account.session.sessionId ? 'true' : undefined
              }
            >
              {account.displayName}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const layoutTriggerAndMenu = () => {
  const trigger = screen.getByTestId('trigger');
  trigger.getBoundingClientRect = () => rect(10, 400, 42, 42);
  const bobRow = screen.queryByTestId('row-bob');
  if (bobRow) {
    bobRow.getBoundingClientRect = () => rect(60, 300, 220, 44);
  }
  const carolRow = screen.queryByTestId('row-carol');
  if (carolRow) {
    carolRow.getBoundingClientRect = () => rect(60, 346, 220, 44);
  }
  return { trigger, bobRow, carolRow };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.style.removeProperty('user-select');
  document.documentElement.style.removeProperty('-webkit-user-select');
  document.documentElement.style.removeProperty('-webkit-touch-callout');
});

describe('useAccountHoldSwitch', () => {
  it('does not open the quick menu or suppress click on a short tap', () => {
    const onSwitch = vi.fn();
    const onClick = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={onClick} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    expect(trigger.getAttribute('data-quick-switch-pressing')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS - 50);
    });
    expect(screen.queryByTestId('quick-menu')).toBeNull();

    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 25, clientY: 420 }));
    fireEvent.click(trigger);

    expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();
    expect(screen.queryByTestId('quick-menu')).toBeNull();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('cancels the hold if pointer drifts past ACCOUNT_HOLD_SLOP before the timer fires', () => {
    const onSwitch = vi.fn();
    const onClick = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={onClick} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    expect(trigger.getAttribute('data-quick-switch-pressing')).toBe('true');

    fireEvent(
      window,
      pointerEvent('pointermove', {
        pointerId: 1,
        clientX: 25 + ACCOUNT_HOLD_SLOP + 2,
        clientY: 420,
      })
    );
    expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS + 100);
    });
    expect(screen.queryByTestId('quick-menu')).toBeNull();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('opens on 220 ms hold, suppresses synthetic click, locks selection, and blocks touchmove scroll', () => {
    const onSwitch = vi.fn();
    const onClick = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={onClick} />);
    const trigger = screen.getByTestId('trigger');
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    trigger.setPointerCapture = setPointerCapture;
    trigger.releasePointerCapture = releasePointerCapture;
    const setStyleSpy = vi.spyOn(document.documentElement.style, 'setProperty');
    const removeStyleSpy = vi.spyOn(document.documentElement.style, 'removeProperty');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 7, clientX: 25, clientY: 420 }));
    // Context menu is suppressed while pressing.
    const ctxWhilePressing = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    trigger.dispatchEvent(ctxWhilePressing);
    expect(ctxWhilePressing.defaultPrevented).toBe(true);

    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });

    expect(screen.getByTestId('quick-menu')).toBeTruthy();
    expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();
    expect(trigger.getAttribute('data-quick-switch-open')).toBe('true');
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(document.documentElement.style.getPropertyValue('user-select')).toBe('none');
    expect(setStyleSpy).toHaveBeenCalledWith('-webkit-touch-callout', 'none');

    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
    window.dispatchEvent(touchMove);
    expect(touchMove.defaultPrevented).toBe(true);

    // Releasing without selecting closes and suppresses the immediate synthetic click.
    fireEvent(window, pointerEvent('pointerup', { pointerId: 7, clientX: 25, clientY: 420 }));
    expect(screen.queryByTestId('quick-menu')).toBeNull();
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(document.documentElement.style.getPropertyValue('user-select')).toBe('');
    expect(removeStyleSpy).toHaveBeenCalledWith('-webkit-touch-callout');
    setStyleSpy.mockRestore();
    removeStyleSpy.mockRestore();

    const touchMoveAfter = new Event('touchmove', { bubbles: true, cancelable: true });
    window.dispatchEvent(touchMoveAfter);
    expect(touchMoveAfter.defaultPrevented).toBe(false);

    fireEvent.click(trigger);
    expect(onClick).not.toHaveBeenCalled();

    // A later normal tap works again.
    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('highlights a row on drag and calls onSwitch on release', () => {
    const onSwitch = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    const { bobRow, carolRow } = layoutTriggerAndMenu();

    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 320 }));
    expect(bobRow?.getAttribute('data-highlighted')).toBe('true');
    expect(carolRow?.getAttribute('data-highlighted')).toBeNull();

    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 365 }));
    expect(bobRow?.getAttribute('data-highlighted')).toBeNull();
    expect(carolRow?.getAttribute('data-highlighted')).toBe('true');

    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 120, clientY: 365 }));
    expect(screen.queryByTestId('quick-menu')).toBeNull();
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith(CAROL.session);
  });

  it('cancels without switching when dragging back over the anchor dead zone', () => {
    const onSwitch = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    const { bobRow } = layoutTriggerAndMenu();

    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 320 }));
    expect(bobRow?.getAttribute('data-highlighted')).toBe('true');

    // Drag back inside anchor rect (10..52, 400..442).
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 30, clientY: 420 }));
    expect(bobRow?.getAttribute('data-highlighted')).toBeNull();

    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 30, clientY: 420 }));
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('cancels without switching when releasing outside any row', () => {
    const onSwitch = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    layoutTriggerAndMenu();

    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 500, clientY: 50 }));
    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 500, clientY: 50 }));
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('applies generous ±32 px horizontal tolerance and resolves overlapping vertical borders by closest center', () => {
    const onSwitch = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    const { bobRow, carolRow } = layoutTriggerAndMenu();

    // Row left is 60, right is 280 -> 30 px to the left (x=30) is within ±32 px forgiveness.
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 30, clientY: 320 }));
    expect(bobRow?.getAttribute('data-highlighted')).toBe('true');

    // 30 px to the right (x=310) is also within ±32 px forgiveness.
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 310, clientY: 365 }));
    expect(carolRow?.getAttribute('data-highlighted')).toBe('true');

    // Beyond ±32 px (x=315) does not match.
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 315, clientY: 365 }));
    expect(carolRow?.getAttribute('data-highlighted')).toBeNull();

    // Border between bob (300..344, center 322) and carol (346..390, center 368):
    // Both ±4 px vertical paddings cover y=344 and y=346.
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 344 }));
    expect(bobRow?.getAttribute('data-highlighted')).toBe('true');

    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 346 }));
    expect(carolRow?.getAttribute('data-highlighted')).toBe('true');

    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 120, clientY: 346 }));
    expect(onSwitch).toHaveBeenCalledWith(CAROL.session);
  });

  it.each(['Escape', 'pointercancel', 'blur', 'secondTouch'] as const)(
    'cancels cleanly and restores document selection on %s',
    (reason) => {
      const onSwitch = vi.fn();
      render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
      const trigger = screen.getByTestId('trigger');

      fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
      act(() => {
        vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
      });
      layoutTriggerAndMenu();
      fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 320 }));
      expect(document.documentElement.style.getPropertyValue('user-select')).toBe('none');

      if (reason === 'Escape') {
        fireEvent.keyDown(window, { key: 'Escape' });
      } else if (reason === 'pointercancel') {
        fireEvent(window, pointerEvent('pointercancel', { pointerId: 1 }));
      } else if (reason === 'blur') {
        fireEvent.blur(window);
      } else {
        fireEvent(window, pointerEvent('pointerdown', { pointerId: 2, clientX: 80, clientY: 80 }));
      }

      expect(screen.queryByTestId('quick-menu')).toBeNull();
      expect(document.documentElement.style.getPropertyValue('user-select')).toBe('');
      expect(document.documentElement.style.getPropertyValue('-webkit-touch-callout')).toBe('');
      expect(onSwitch).not.toHaveBeenCalled();
    }
  );

  it('ignores non-primary mouse buttons', () => {
    const onSwitch = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(
      trigger,
      pointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 2 })
    );
    expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS + 100);
    });
    expect(screen.queryByTestId('quick-menu')).toBeNull();
  });

  it('never opens when enabled is false and closes if disabled while open', () => {
    const onSwitch = vi.fn();
    const { rerender } = render(<Harness enabled={false} onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS + 100);
    });
    expect(screen.queryByTestId('quick-menu')).toBeNull();

    // Enable, open, then disable while open -> closes and restores selection styles.
    rerender(<Harness enabled onSwitch={onSwitch} onClick={vi.fn()} />);
    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 2, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    expect(screen.getByTestId('quick-menu')).toBeTruthy();

    rerender(<Harness enabled={false} onSwitch={onSwitch} onClick={vi.fn()} />);
    expect(screen.queryByTestId('quick-menu')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('user-select')).toBe('');
  });

  it('restores document selection styles cleanly on unmount while open', () => {
    const { unmount } = render(<Harness onSwitch={vi.fn()} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    expect(document.documentElement.style.getPropertyValue('user-select')).toBe('none');

    unmount();
    expect(document.documentElement.style.getPropertyValue('user-select')).toBe('');
    expect(document.documentElement.style.getPropertyValue('-webkit-touch-callout')).toBe('');
  });
});
