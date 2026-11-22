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
  session: session('bob', '@bob:matrix.org', 30),
  displayName: 'Bob',
};
const CAROL: AccountMenuAccount = {
  session: session('carol', '@carol:example.org', 20),
  displayName: 'Carol',
};
const DAVE: AccountMenuAccount = {
  session: session('dave', '@dave:example.org', 10),
  displayName: 'Dave',
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
    isPrimary?: boolean;
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
  Object.defineProperty(event, 'isPrimary', { value: init.isPrimary ?? true });
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
          <div data-testid="quick-list" data-quick-account-list="">
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
        </div>
      )}
    </div>
  );
}

const layoutTriggerAndMenu = () => {
  const trigger = screen.getByTestId('trigger');
  trigger.getBoundingClientRect = () => rect(10, 400, 42, 42);
  const list = screen.queryByTestId('quick-list');
  if (list) {
    list.getBoundingClientRect = () => rect(56, 296, 228, 98);
  }
  const bobRow = screen.queryByTestId('row-bob');
  if (bobRow) {
    bobRow.getBoundingClientRect = () => rect(60, 300, 220, 44);
  }
  const carolRow = screen.queryByTestId('row-carol');
  if (carolRow) {
    carolRow.getBoundingClientRect = () => rect(60, 346, 220, 44);
  }
  return { trigger, list, bobRow, carolRow };
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

  it('opens on 220 ms hold, dismisses anchor tooltip via mouseleave, suppresses synthetic click, locks selection, and blocks touchmove scroll', () => {
    const onSwitch = vi.fn();
    const onClick = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={onClick} />);
    const trigger = screen.getByTestId('trigger');
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    trigger.setPointerCapture = setPointerCapture;
    trigger.releasePointerCapture = releasePointerCapture;
    const mouseLeaveSpy = vi.fn();
    trigger.addEventListener('mouseleave', mouseLeaveSpy);
    const setStyleSpy = vi.spyOn(document.documentElement.style, 'setProperty');
    const removeStyleSpy = vi.spyOn(document.documentElement.style, 'removeProperty');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 7, clientX: 25, clientY: 420 }));
    const ctxWhilePressing = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    trigger.dispatchEvent(ctxWhilePressing);
    expect(ctxWhilePressing.defaultPrevented).toBe(true);

    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });

    expect(screen.getByTestId('quick-menu')).toBeTruthy();
    expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();
    expect(trigger.getAttribute('data-quick-switch-open')).toBe('true');
    expect(mouseLeaveSpy).toHaveBeenCalledTimes(1);
    expect((mouseLeaveSpy.mock.calls[0]?.[0] as MouseEvent | undefined)?.bubbles).toBe(false);
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(document.documentElement.style.getPropertyValue('user-select')).toBe('none');
    expect(setStyleSpy).toHaveBeenCalledWith('-webkit-touch-callout', 'none');

    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
    window.dispatchEvent(touchMove);
    expect(touchMove.defaultPrevented).toBe(true);

    fireEvent(window, pointerEvent('pointerup', { pointerId: 7, clientX: 25, clientY: 420 }));
    expect(screen.queryByTestId('quick-menu')).toBeNull();
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(document.documentElement.style.getPropertyValue('user-select')).toBe('');
    expect(removeStyleSpy).toHaveBeenCalledWith('-webkit-touch-callout');

    const touchMoveAfter = new Event('touchmove', { bubbles: true, cancelable: true });
    window.dispatchEvent(touchMoveAfter);
    expect(touchMoveAfter.defaultPrevented).toBe(false);

    fireEvent.click(trigger);
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
    setStyleSpy.mockRestore();
    removeStyleSpy.mockRestore();
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

  it('cancels without switching when releasing over the anchor without an intervening move', () => {
    const onSwitch = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    const { bobRow } = layoutTriggerAndMenu();

    // Move onto Bob so hoveredSessionId is 'bob'.
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 320 }));
    expect(bobRow?.getAttribute('data-highlighted')).toBe('true');

    // Release directly over the anchor dead zone (10..52, 400..442) with no intervening move.
    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 30, clientY: 420 }));
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('does not select or switch when releasing 20 px outside the menu horizontally', () => {
    const onSwitch = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    const { bobRow } = layoutTriggerAndMenu();

    // List container is x: 56..284 -> x=304 is 20 px outside to the right, x=36 is 20 px outside to the left.
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 304, clientY: 320 }));
    expect(bobRow?.getAttribute('data-highlighted')).toBeNull();

    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 36, clientY: 320 }));
    expect(bobRow?.getAttribute('data-highlighted')).toBeNull();

    // Move inside to highlight, then release 20 px outside horizontally.
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 320 }));
    expect(bobRow?.getAttribute('data-highlighted')).toBe('true');

    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 304, clientY: 320 }));
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('bridges the 2 px gap between rows within visible bounds and ignores rows clipped outside the scroll container', () => {
    const onSwitch = vi.fn();
    render(<Harness others={[BOB, CAROL, DAVE]} onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    const { bobRow, carolRow } = layoutTriggerAndMenu();
    // Place Dave completely below the visible scroll container (container bottom is 394).
    const daveRow = screen.getByTestId('row-dave');
    daveRow.getBoundingClientRect = () => rect(60, 400, 220, 44);

    // Point at y=393 (inside container, 1 px above bottom edge, within 4 px of Dave if unclipped):
    // Dave is completely clipped outside containerRect so it must NOT be selected.
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 393 }));
    expect(daveRow.getAttribute('data-highlighted')).toBeNull();
    expect(carolRow?.getAttribute('data-highlighted')).toBe('true');

    // Point directly over Dave's rect outside containerRect must not highlight anything.
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 410 }));
    expect(daveRow.getAttribute('data-highlighted')).toBeNull();
    expect(carolRow?.getAttribute('data-highlighted')).toBeNull();

    // Gap between Bob (300..344) and Carol (346..390) at y=344 picks Bob, y=346 picks Carol.
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 344 }));
    expect(bobRow?.getAttribute('data-highlighted')).toBe('true');

    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 346 }));
    expect(carolRow?.getAttribute('data-highlighted')).toBe('true');

    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 120, clientY: 346 }));
    expect(onSwitch).toHaveBeenCalledWith(CAROL.session);
  });

  it('suppresses the trailing avatar click after Escape cancel while pointer is still down', () => {
    const onSwitch = vi.fn();
    const onClick = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={onClick} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    expect(screen.getByTestId('quick-menu')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('quick-menu')).toBeNull();

    // Even if the user keeps holding for >400 ms before lifting on the avatar, the ending click is suppressed.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 25, clientY: 420 }));
    fireEvent.click(trigger);

    expect(onClick).not.toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('does not swallow an immediate keyboard Enter/Space activation or fresh tap after releasing off the avatar', () => {
    const onSwitch = vi.fn();
    const onClick = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={onClick} />);
    const trigger = screen.getByTestId('trigger');

    // 1. Hold -> release off avatar (no synthetic click) -> immediate keyboard Enter click.
    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    layoutTriggerAndMenu();
    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 500, clientY: 50 }));

    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);

    // 2. Hold -> release off avatar -> immediate Space click.
    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 2, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    layoutTriggerAndMenu();
    fireEvent(window, pointerEvent('pointerup', { pointerId: 2, clientX: 500, clientY: 50 }));

    fireEvent.keyDown(trigger, { key: ' ' });
    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(2);

    // 3. Hold -> release off avatar -> immediate fresh short tap.
    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 3, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    layoutTriggerAndMenu();
    fireEvent(window, pointerEvent('pointerup', { pointerId: 3, clientX: 500, clientY: 50 }));

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 4, clientX: 25, clientY: 420 }));
    fireEvent(window, pointerEvent('pointerup', { pointerId: 4, clientX: 25, clientY: 420 }));
    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('auto-scrolls an overflowing list when dragging near its edge so clipped accounts become reachable', () => {
    const onSwitch = vi.fn();
    let rafCallback: FrameRequestCallback | undefined;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });
    const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      rafCallback = undefined;
    });

    render(<Harness others={[BOB, CAROL, DAVE]} onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });

    const list = screen.getByTestId('quick-list');
    // Overflowing viewport: 80 px tall, 200 px scrollHeight, starts scrolled to bottom (scrollTop = 120).
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 80 });
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 200 });
    list.scrollTop = 120;
    list.getBoundingClientRect = () => rect(60, 200, 220, 80);

    // Row positions track `list.scrollTop`: Bob is at top (offset 0), Carol at 60, Dave at 120.
    const bobRow = screen.getByTestId('row-bob');
    const carolRow = screen.getByTestId('row-carol');
    const daveRow = screen.getByTestId('row-dave');
    bobRow.getBoundingClientRect = () => rect(60, 200 - list.scrollTop, 220, 44);
    carolRow.getBoundingClientRect = () => rect(60, 260 - list.scrollTop, 220, 44);
    daveRow.getBoundingClientRect = () => rect(60, 320 - list.scrollTop, 220, 44);

    // Initially Bob (top=80, bottom=124) is clipped above container (top=200).
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 204 }));
    expect(bobRow.getAttribute('data-highlighted')).toBeNull();
    expect(rafCallback).toBeDefined();

    // Advance animation frames while holding inside the top 24 px edge zone.
    let now = 100;
    for (let i = 0; i < 25 && rafCallback; i += 1) {
      const cb = rafCallback;
      rafCallback = undefined;
      now += 16;
      act(() => {
        cb(now);
      });
    }

    expect(list.scrollTop).toBe(0);
    expect(bobRow.getAttribute('data-highlighted')).toBe('true');

    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 120, clientY: 204 }));
    expect(onSwitch).toHaveBeenCalledWith(BOB.session);

    rafSpy.mockRestore();
    cancelRafSpy.mockRestore();
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
        fireEvent(
          window,
          pointerEvent('pointerdown', { pointerId: 2, isPrimary: false, clientX: 80, clientY: 80 })
        );
      }

      expect(screen.queryByTestId('quick-menu')).toBeNull();
      expect(document.documentElement.style.getPropertyValue('user-select')).toBe('');
      expect(document.documentElement.style.getPropertyValue('-webkit-touch-callout')).toBe('');
      expect(onSwitch).not.toHaveBeenCalled();
    }
  );

  it('ignores non-primary mouse buttons and non-primary touch pointers as hold starters', () => {
    const onSwitch = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');

    fireEvent(
      trigger,
      pointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 2 })
    );
    expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();

    fireEvent(
      trigger,
      pointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: false })
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
