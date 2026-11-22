// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdModalSheet } from '../../lib/portalOverlay';
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
    /** The buttons still down, as a real mouse reports them; jsdom's default is none. */
    buttons?: number;
    ctrlKey?: boolean;
    clientX?: number;
    clientY?: number;
  } = {}
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    buttons: init.buttons ?? 0,
    ctrlKey: init.ctrlKey ?? false,
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

/** The avatar and its quick menu, which opens at the end of the body as `PopOut` puts it there. */
function Harness({ enabled = true, others = [BOB, CAROL], onSwitch, onClick }: HarnessProps) {
  const hold = useAccountHoldSwitch({ enabled, others, onSwitch });
  return (
    <div>
      <button type="button" data-testid="trigger" onClick={onClick} {...hold.triggerProps}>
        Avatar
      </button>
      {hold.holdAnchor &&
        createPortal(
          <div ref={hold.menuRef} data-testid="quick-menu" role="none" data-quick-account-menu="">
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
          </div>,
          document.body
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

/** Holds the avatar until the quick menu opens. */
const holdOpen = (trigger: HTMLElement, pointerId = 1) => {
  fireEvent(trigger, pointerEvent('pointerdown', { pointerId, clientX: 25, clientY: 420 }));
  act(() => {
    vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
  });
};

/** The window listeners added since the call that nothing has removed yet. */
const watchWindowListeners = () => {
  const added = vi.spyOn(window, 'addEventListener');
  const removed = vi.spyOn(window, 'removeEventListener');
  return () =>
    added.mock.calls
      .filter(
        ([type, listener]) =>
          !removed.mock.calls.some(([goneType, gone]) => goneType === type && gone === listener)
      )
      .map(([type]) => type);
};

/** A dialog that opens over everything already in the page, as Settings does from its shortcut. */
const openCoveringDialog = (): HTMLElement => {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.innerHTML = '<button type="button">Close</button>';
  document.body.append(dialog);
  return dialog;
};

/** Closes the modal sheet a test opened with `holdModalSheet`. */
let closeModalSheet: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  closeModalSheet?.();
  closeModalSheet = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.querySelectorAll('body > [role="dialog"]').forEach((dialog) => dialog.remove());
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

    fireEvent.click(trigger, { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(trigger, { detail: 1 });
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

  it('selects no row beside the rows, in the side padding or scrollbar gutter of the list', () => {
    const onSwitch = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');
    holdOpen(trigger);
    // The list spans x 56..284 and its rows 60..280: 4 px on each side belong to no row.
    const { bobRow, carolRow } = layoutTriggerAndMenu();
    const highlighted = () =>
      [bobRow, carolRow].filter((row) => row?.getAttribute('data-highlighted') === 'true').length;
    const moveTo = (clientX: number, clientY: number) =>
      fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX, clientY }));

    moveTo(60, 320);
    expect(bobRow?.getAttribute('data-highlighted')).toBe('true');
    moveTo(280, 320);
    expect(bobRow?.getAttribute('data-highlighted')).toBe('true');
    // Level with Bob's row, inside the list, beside the row.
    moveTo(58, 320);
    expect(highlighted()).toBe(0);
    moveTo(282, 320);
    expect(highlighted()).toBe(0);
    // Level with the gap between the rows: its padding reaches no further sideways either.
    moveTo(282, 345);
    expect(highlighted()).toBe(0);

    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 282, clientY: 320 }));
    expect(screen.queryByTestId('quick-menu')).toBeNull();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('gives the pointer to the row it is on, not to a clipped neighbour whose gap padding reaches it', () => {
    const onSwitch = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');
    holdOpen(trigger);
    trigger.getBoundingClientRect = () => rect(10, 400, 42, 42);
    // The list shows y 100..198. Bob is scrolled out but for his last pixel (100..101); Carol
    // shows whole (103..147).
    screen.getByTestId('quick-list').getBoundingClientRect = () => rect(56, 100, 228, 98);
    const bobRow = screen.getByTestId('row-bob');
    const carolRow = screen.getByTestId('row-carol');
    bobRow.getBoundingClientRect = () => rect(60, 57, 220, 44);
    carolRow.getBoundingClientRect = () => rect(60, 103, 220, 44);
    const highlighted = () =>
      [bobRow, carolRow]
        .filter((row) => row.getAttribute('data-highlighted') === 'true')
        .map((row) => row.getAttribute('data-quick-account-session-id'));
    const moveTo = (clientY: number) =>
      fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY }));

    // On Carol, 1 px in: hers, though Bob's visible pixel is nearer than her middle.
    moveTo(104);
    expect(highlighted()).toEqual(['carol']);
    moveTo(103);
    expect(highlighted()).toEqual(['carol']);
    // On Bob's visible pixel: his.
    moveTo(101);
    expect(highlighted()).toEqual(['bob']);
    // In the gap, as near to one as to the other: one row, the earlier.
    moveTo(102);
    expect(highlighted()).toEqual(['bob']);
    // Below Carol the padding still reaches 4 px and no further.
    moveTo(151);
    expect(highlighted()).toEqual(['carol']);
    moveTo(152);
    expect(highlighted()).toEqual([]);

    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 120, clientY: 104 }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith(CAROL.session);
  });

  it('moves the highlight when the list scrolls under a pointer that stays where it is', () => {
    const onSwitch = vi.fn();
    render(<Harness others={[BOB, CAROL, DAVE]} onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');
    holdOpen(trigger);
    trigger.getBoundingClientRect = () => rect(10, 400, 42, 42);

    // The list shows 120 px of three 44 px rows, 2 px apart; the rows move with its scrollTop.
    const list = screen.getByTestId('quick-list');
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 120 });
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 136 });
    list.scrollTop = 0;
    list.getBoundingClientRect = () => rect(60, 200, 220, 120);
    const rows = ['bob', 'carol', 'dave'].map((id) => screen.getByTestId(`row-${id}`));
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => rect(60, 200 + index * 46 - list.scrollTop, 220, 44);
    });
    const [, carolRow, daveRow] = rows;
    const removeListListener = vi.spyOn(list, 'removeEventListener');

    // The pointer rests in the middle of the list, clear of the edges that scroll it.
    fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 290 }));
    expect(carolRow?.getAttribute('data-highlighted')).toBe('true');

    // A wheel scrolls the list by 16 px: Dave is under the pointer now, and no pointer event says so.
    list.scrollTop = 16;
    fireEvent.scroll(list);
    expect(carolRow?.getAttribute('data-highlighted')).toBeNull();
    expect(daveRow?.getAttribute('data-highlighted')).toBe('true');

    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 120, clientY: 290 }));
    expect(onSwitch).toHaveBeenCalledWith(DAVE.session);
    expect(removeListListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it.each(['pointerup', 'focusin', 'pointermove'] as const)(
    'cancels without switching when a dialog has opened over the menu, seen at %s',
    (seenAt) => {
      const onSwitch = vi.fn();
      const onClick = vi.fn();
      render(<Harness onSwitch={onSwitch} onClick={onClick} />);
      const trigger = screen.getByTestId('trigger');
      holdOpen(trigger);
      const { bobRow } = layoutTriggerAndMenu();
      fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 320 }));
      expect(bobRow?.getAttribute('data-highlighted')).toBe('true');

      const dialog = openCoveringDialog();
      // The row is still under the pointer; only the dialog over it is new.
      expect(screen.getByTestId('quick-menu')).toBeTruthy();
      if (seenAt === 'focusin') {
        fireEvent.focusIn(dialog.querySelector('button') as HTMLElement);
      } else if (seenAt === 'pointermove') {
        fireEvent(
          window,
          pointerEvent('pointermove', { pointerId: 1, clientX: 121, clientY: 321 })
        );
      }
      if (seenAt !== 'pointerup') expect(screen.queryByTestId('quick-menu')).toBeNull();

      // The pointer lifts where Bob's row was; pointer capture sends its click to the avatar.
      fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 120, clientY: 320 }));
      fireEvent.click(trigger, { detail: 1 });

      expect(screen.queryByTestId('quick-menu')).toBeNull();
      expect(onSwitch).not.toHaveBeenCalled();
      expect(onClick).not.toHaveBeenCalled();
      expect(document.documentElement.style.getPropertyValue('user-select')).toBe('');
    }
  );

  it.each([
    { opens: 'dialog', seenAt: 'the hold time running out' },
    { opens: 'dialog', seenAt: 'focusin' },
    { opens: 'modal sheet', seenAt: 'the hold time running out' },
  ] as const)(
    'opens no menu when a $opens opens during the hold, seen at $seenAt',
    ({ opens, seenAt }) => {
      const onSwitch = vi.fn();
      const onClick = vi.fn();
      render(<Harness onSwitch={onSwitch} onClick={onClick} />);
      const trigger = screen.getByTestId('trigger');
      const setPointerCapture = vi.fn();
      trigger.setPointerCapture = setPointerCapture;

      fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
      act(() => {
        vi.advanceTimersByTime(ACCOUNT_HOLD_MS - 100);
      });
      const dialog = opens === 'dialog' ? openCoveringDialog() : undefined;
      if (opens === 'modal sheet') closeModalSheet = holdModalSheet();
      expect(trigger.getAttribute('data-quick-switch-pressing')).toBe('true');
      if (seenAt === 'focusin') {
        fireEvent.focusIn(dialog?.querySelector('button') as HTMLElement);
        expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();
      }
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(screen.queryByTestId('quick-menu')).toBeNull();
      expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();
      expect(setPointerCapture).not.toHaveBeenCalled();
      expect(document.documentElement.style.getPropertyValue('user-select')).toBe('');

      // The release switches nothing, and no menu opened, so a click is the user's own.
      fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 120, clientY: 320 }));
      expect(onSwitch).not.toHaveBeenCalled();
      fireEvent.click(trigger, { detail: 1 });
      expect(onClick).toHaveBeenCalledTimes(1);
    }
  );

  it('does not switch when a mouse lifts its primary button first and another button last', () => {
    const onSwitch = vi.fn();
    const onClick = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={onClick} />);
    const trigger = screen.getByTestId('trigger');
    const mouse = (type: string, init: Parameters<typeof pointerEvent>[1]) =>
      pointerEvent(type, { pointerId: 1, pointerType: 'mouse', ...init });

    // Left down, and the hold opens the menu.
    fireEvent(trigger, mouse('pointerdown', { buttons: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    const { bobRow } = layoutTriggerAndMenu();
    fireEvent(window, mouse('pointermove', { buttons: 1, clientX: 120, clientY: 320 }));
    expect(bobRow?.getAttribute('data-highlighted')).toBe('true');

    // Right down as well: a mouse reports a further button as a move, and the menu stays.
    fireEvent(window, mouse('pointermove', { button: 2, buttons: 3, clientX: 120, clientY: 320 }));
    expect(screen.getByTestId('quick-menu')).toBeTruthy();

    // Left up, right still down: again a move, and the menu closes without a switch. The left
    // button's click goes to the avatar, which captured the pointer, and opens nothing.
    fireEvent(window, mouse('pointermove', { button: 0, buttons: 2, clientX: 120, clientY: 320 }));
    expect(screen.queryByTestId('quick-menu')).toBeNull();
    fireEvent.click(trigger, { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();

    // Over Carol's row, then right up: the only pointerup of the chord.
    fireEvent(window, mouse('pointermove', { buttons: 2, clientX: 120, clientY: 365 }));
    fireEvent(window, mouse('pointerup', { button: 2, buttons: 0, clientX: 120, clientY: 365 }));
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('does not switch on a mouse pointerup of another button than the primary', () => {
    const onSwitch = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');
    const mouse = (type: string, init: Parameters<typeof pointerEvent>[1]) =>
      pointerEvent(type, { pointerId: 1, pointerType: 'mouse', ...init });

    fireEvent(trigger, mouse('pointerdown', { buttons: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    const { bobRow } = layoutTriggerAndMenu();
    fireEvent(window, mouse('pointermove', { buttons: 1, clientX: 120, clientY: 320 }));
    expect(bobRow?.getAttribute('data-highlighted')).toBe('true');

    // No move reported the left button lifting; the release that arrives is the right button's.
    fireEvent(window, mouse('pointerup', { button: 2, buttons: 0, clientX: 120, clientY: 320 }));
    expect(screen.queryByTestId('quick-menu')).toBeNull();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('switches on a mouse release of the primary button, and ends a pending hold whose button lifted unseen', () => {
    const onSwitch = vi.fn();
    render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');
    const mouse = (type: string, init: Parameters<typeof pointerEvent>[1]) =>
      pointerEvent(type, { pointerId: 1, pointerType: 'mouse', ...init });

    // The button lifted outside the window during the wait; the mouse comes back with none down.
    fireEvent(trigger, mouse('pointerdown', { buttons: 1, clientX: 25, clientY: 420 }));
    fireEvent(window, mouse('pointermove', { buttons: 0, clientX: 26, clientY: 420 }));
    expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    expect(screen.queryByTestId('quick-menu')).toBeNull();

    // An ordinary hold, drag and release of the left button switches.
    fireEvent(trigger, mouse('pointerdown', { buttons: 1, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    layoutTriggerAndMenu();
    fireEvent(window, mouse('pointermove', { buttons: 1, clientX: 120, clientY: 320 }));
    fireEvent(window, mouse('pointerup', { button: 0, buttons: 0, clientX: 120, clientY: 320 }));
    expect(onSwitch).toHaveBeenCalledWith(BOB.session);
  });

  it.each(['before', 'after'] as const)(
    'opens and switches beside a dialog that was open before the press, %s the avatar in the page',
    (position) => {
      const onSwitch = vi.fn();
      // After the avatar is where a phone's members sheet is, below the top bar.
      const early = position === 'before' ? openCoveringDialog() : undefined;
      render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
      const trigger = screen.getByTestId('trigger');
      const sheet = early ?? openCoveringDialog();
      expect(
        Boolean(trigger.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING)
      ).toBe(position === 'after');

      // Focus moves during the wait, to the pressed avatar and within the open sheet.
      fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
      fireEvent.focusIn(trigger);
      fireEvent.focusIn(sheet.querySelector('button') as HTMLElement);
      act(() => {
        vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
      });
      expect(screen.getByTestId('quick-menu')).toBeTruthy();

      // The menu opened after the sheet and over it: the sheet does not cover it either.
      const { bobRow } = layoutTriggerAndMenu();
      fireEvent.focusIn(sheet.querySelector('button') as HTMLElement);
      fireEvent(window, pointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 320 }));
      expect(bobRow?.getAttribute('data-highlighted')).toBe('true');

      fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 120, clientY: 320 }));
      expect(onSwitch).toHaveBeenCalledTimes(1);
      expect(onSwitch).toHaveBeenCalledWith(BOB.session);
    }
  );

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
    fireEvent.click(trigger, { detail: 1 });

    expect(onClick).not.toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('lets Enter through after Escape while the mouse is still held, and still swallows the click of its lift', () => {
    const onClick = vi.fn();
    render(<Harness onSwitch={vi.fn()} onClick={onClick} />);
    const trigger = screen.getByTestId('trigger');
    holdOpen(trigger);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('quick-menu')).toBeNull();

    // Enter on the focused avatar, the mouse button still down: its click opens the account menu.
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(trigger, { detail: 0 });
    expect(onClick).toHaveBeenCalledTimes(1);

    // The mouse lifts on the avatar: its click would close that menu again, and is swallowed.
    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 25, clientY: 420 }));
    fireEvent.click(trigger, { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);

    // Only that one click: the next is the user's own.
    fireEvent.click(trigger, { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('never swallows a click without a pointer (assistive technology), after a release or after Escape', () => {
    const onClick = vi.fn();
    render(<Harness onSwitch={vi.fn()} onClick={onClick} />);
    const trigger = screen.getByTestId('trigger');

    // Hold, release off the avatar (no click follows), then a click no key press announced.
    holdOpen(trigger, 1);
    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 500, clientY: 50 }));
    fireEvent.click(trigger, { detail: 0 });
    expect(onClick).toHaveBeenCalledTimes(1);

    // Hold, Escape, and the same click while the pointer is still down.
    holdOpen(trigger, 2);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(trigger, { detail: 0 });
    expect(onClick).toHaveBeenCalledTimes(2);

    // It did not use up the suppression of the held pointer's own click.
    fireEvent(window, pointerEvent('pointerup', { pointerId: 2, clientX: 25, clientY: 420 }));
    fireEvent.click(trigger, { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  describe.each(['open', 'after Escape'] as const)(
    'when the window loses focus with the pointer still down (%s)',
    (state) => {
      /** Holds until the menu opens, then leaves the window; no listener may stay behind. */
      const holdAndLeave = (trigger: HTMLElement) => {
        const leftListening = watchWindowListeners();
        holdOpen(trigger);
        if (state === 'after Escape') fireEvent.keyDown(window, { key: 'Escape' });
        expect(leftListening()).not.toEqual([]);

        fireEvent.blur(window);
        expect(screen.queryByTestId('quick-menu')).toBeNull();
        expect(leftListening()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
      };

      it('lets a click without a pointer and a new tap through after the pointer lifted elsewhere', () => {
        const onClick = vi.fn();
        render(<Harness onSwitch={vi.fn()} onClick={onClick} />);
        const trigger = screen.getByTestId('trigger');
        holdAndLeave(trigger);

        // The pointer lifted in another window: no pointerup ever reached this one. Back here,
        // an activation without a pointer works at once.
        fireEvent.click(trigger, { detail: 0 });
        expect(onClick).toHaveBeenCalledTimes(1);

        // And so does a tap, whose press comes before its click.
        fireEvent(
          trigger,
          pointerEvent('pointerdown', { pointerId: 2, clientX: 25, clientY: 420 })
        );
        fireEvent(window, pointerEvent('pointerup', { pointerId: 2, clientX: 25, clientY: 420 }));
        fireEvent.click(trigger, { detail: 1 });
        expect(onClick).toHaveBeenCalledTimes(2);
      });

      it('swallows the click of a pointer that comes back still down and lifts on the avatar', () => {
        const onClick = vi.fn();
        render(<Harness onSwitch={vi.fn()} onClick={onClick} />);
        const trigger = screen.getByTestId('trigger');
        holdAndLeave(trigger);

        // However long it stayed away: a click with no press before it is the held pointer's.
        act(() => {
          vi.advanceTimersByTime(5000);
        });
        fireEvent.click(trigger, { detail: 1 });
        expect(onClick).not.toHaveBeenCalled();

        // Only that one.
        fireEvent.click(trigger, { detail: 1 });
        expect(onClick).toHaveBeenCalledTimes(1);
      });

      it('lets a context menu opened from the keyboard through (Shift+F10), with no press before it', () => {
        const onClick = vi.fn();
        render(<Harness onSwitch={vi.fn()} onClick={onClick} />);
        const trigger = screen.getByTestId('trigger');
        holdAndLeave(trigger);

        const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        trigger.dispatchEvent(contextMenu);
        expect(contextMenu.defaultPrevented).toBe(false);

        // The suppression is still there for what it is for: the held pointer's click.
        fireEvent.click(trigger, { detail: 1 });
        expect(onClick).not.toHaveBeenCalled();
      });
    }
  );

  it('suppresses nothing when the window loses focus before the menu opened', () => {
    const onClick = vi.fn();
    render(<Harness onSwitch={vi.fn()} onClick={onClick} />);
    const trigger = screen.getByTestId('trigger');
    const leftListening = watchWindowListeners();

    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
    fireEvent.blur(window);
    expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();
    expect(leftListening()).toEqual([]);

    fireEvent.click(trigger, { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('removes its window listeners once the suppression of a lifted pointer runs out', () => {
    render(<Harness onSwitch={vi.fn()} onClick={vi.fn()} />);
    const trigger = screen.getByTestId('trigger');
    const leftListening = watchWindowListeners();
    holdOpen(trigger);
    fireEvent(window, pointerEvent('pointerup', { pointerId: 1, clientX: 500, clientY: 50 }));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(leftListening()).toEqual([]);
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
    fireEvent.click(trigger, { detail: 0 });
    expect(onClick).toHaveBeenCalledTimes(1);

    // 2. Hold -> release off avatar -> immediate Space click.
    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 2, clientX: 25, clientY: 420 }));
    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
    });
    layoutTriggerAndMenu();
    fireEvent(window, pointerEvent('pointerup', { pointerId: 2, clientX: 500, clientY: 50 }));

    fireEvent.keyDown(trigger, { key: ' ' });
    fireEvent.click(trigger, { detail: 0 });
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
    fireEvent.click(trigger, { detail: 1 });
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

  it('leaves a Control press of the primary mouse button to the context menu of a Mac', () => {
    const onClick = vi.fn();
    render(<Harness onSwitch={vi.fn()} onClick={onClick} />);
    const trigger = screen.getByTestId('trigger');
    const leftListening = watchWindowListeners();

    fireEvent(
      trigger,
      pointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', buttons: 1, ctrlKey: true })
    );
    expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();
    expect(leftListening()).toEqual([]);

    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    trigger.dispatchEvent(contextMenu);
    expect(contextMenu.defaultPrevented).toBe(false);

    act(() => {
      vi.advanceTimersByTime(ACCOUNT_HOLD_MS + 100);
    });
    expect(screen.queryByTestId('quick-menu')).toBeNull();

    // Control with a touch is no context menu press: the hold starts as always.
    fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 2, ctrlKey: true }));
    expect(trigger.getAttribute('data-quick-switch-pressing')).toBe('true');
  });

  it.each(['pending', 'open'] as const)(
    'cancels a %s hold on a second pointer that lands on a control keeping its presses to itself',
    (state) => {
      const onSwitch = vi.fn();
      render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
      const trigger = screen.getByTestId('trigger');
      // As a sidebar row that can be dragged does.
      const row = document.createElement('button');
      row.addEventListener('pointerdown', (event) => event.stopPropagation());
      document.body.append(row);

      try {
        fireEvent(
          trigger,
          pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 })
        );
        if (state === 'open') {
          act(() => {
            vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
          });
          expect(screen.getByTestId('quick-menu')).toBeTruthy();
        }

        fireEvent(row, pointerEvent('pointerdown', { pointerId: 2, isPrimary: false }));
        expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();
        expect(screen.queryByTestId('quick-menu')).toBeNull();

        act(() => {
          vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
        });
        expect(screen.queryByTestId('quick-menu')).toBeNull();
        expect(onSwitch).not.toHaveBeenCalled();
      } finally {
        row.remove();
      }
    }
  );

  describe('a touch that ends with a touchend or touchcancel alone, with no pointer event', () => {
    /** The finger at `at` leaves the screen, with `fingersLeft` others still on it. */
    const touchEnd = (
      type: 'touchend' | 'touchcancel',
      at: { clientX: number; clientY: number },
      fingersLeft = 0
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: Array.from({ length: fingersLeft }) });
      Object.defineProperty(event, 'changedTouches', { value: [at] });
      fireEvent(window, event);
    };
    // With `layoutTriggerAndMenu`: Bob's row, Carol's row, the avatar, and beside the list.
    const ON_BOB = { clientX: 120, clientY: 320 };
    const ON_CAROL = { clientX: 120, clientY: 365 };
    const ON_AVATAR = { clientX: 30, clientY: 420 };
    const OUTSIDE = { clientX: 304, clientY: 320 };
    const runPendingTimers = () =>
      act(() => {
        vi.advanceTimersByTime(0);
      });
    const scrollIsLocked = () => {
      const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
      window.dispatchEvent(touchMove);
      return touchMove.defaultPrevented;
    };

    it.each([
      {
        type: 'touchend',
        where: "a row, the highlighted row's neighbour",
        at: ON_CAROL,
        to: CAROL,
      },
      { type: 'touchend', where: 'the avatar', at: ON_AVATAR, to: undefined },
      { type: 'touchend', where: 'neither the list nor the avatar', at: OUTSIDE, to: undefined },
      { type: 'touchcancel', where: 'a row', at: ON_CAROL, to: undefined },
    ] as const)(
      'ends the gesture as a pointer event would have: $type over $where',
      ({ type, at, to }) => {
        const onSwitch = vi.fn();
        const onClick = vi.fn();
        render(<Harness onSwitch={onSwitch} onClick={onClick} />);
        const trigger = screen.getByTestId('trigger');
        const leftListening = watchWindowListeners();
        holdOpen(trigger);
        const { bobRow } = layoutTriggerAndMenu();
        // The last move the page heard of was over Bob; the finger lifts elsewhere.
        fireEvent(window, pointerEvent('pointermove', { pointerId: 1, ...ON_BOB }));
        expect(bobRow?.getAttribute('data-highlighted')).toBe('true');
        expect(document.documentElement.style.getPropertyValue('user-select')).toBe('none');
        expect(scrollIsLocked()).toBe(true);

        // Another finger still down: the touch goes on.
        touchEnd(type, at, 1);
        runPendingTimers();
        expect(screen.getByTestId('quick-menu')).toBeTruthy();

        // The last finger lifts, and no pointerup or pointercancel follows.
        touchEnd(type, at);
        expect(screen.getByTestId('quick-menu')).toBeTruthy();
        expect(onSwitch).not.toHaveBeenCalled();
        runPendingTimers();
        expect(screen.queryByTestId('quick-menu')).toBeNull();
        if (to) {
          expect(onSwitch).toHaveBeenCalledTimes(1);
          expect(onSwitch).toHaveBeenCalledWith(to.session);
        } else {
          expect(onSwitch).not.toHaveBeenCalled();
        }
        expect(document.documentElement.style.getPropertyValue('user-select')).toBe('');
        expect(document.documentElement.style.getPropertyValue('-webkit-touch-callout')).toBe('');
        expect(scrollIsLocked()).toBe(false);

        // The click of that lift is swallowed like any other, for a short while only.
        fireEvent.click(trigger, { detail: 1 });
        expect(onClick).not.toHaveBeenCalled();
        act(() => {
          vi.advanceTimersByTime(400);
        });
        expect(leftListening()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        expect(onSwitch).toHaveBeenCalledTimes(to ? 1 : 0);
      }
    );

    it('does not switch through a dialog that opened over the menu', () => {
      const onSwitch = vi.fn();
      render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
      holdOpen(screen.getByTestId('trigger'));
      layoutTriggerAndMenu();
      openCoveringDialog();

      touchEnd('touchend', ON_BOB);
      runPendingTimers();
      expect(screen.queryByTestId('quick-menu')).toBeNull();
      expect(onSwitch).not.toHaveBeenCalled();
    });

    it('swallows the click of the lift when it comes before the gesture has ended', () => {
      const onSwitch = vi.fn();
      const onClick = vi.fn();
      render(<Harness onSwitch={onSwitch} onClick={onClick} />);
      const trigger = screen.getByTestId('trigger');
      holdOpen(trigger);
      layoutTriggerAndMenu();

      // The finger lifts on the avatar and its click follows at once, before any timer runs.
      touchEnd('touchend', ON_AVATAR);
      fireEvent.click(trigger, { detail: 1 });
      expect(onClick).not.toHaveBeenCalled();
      expect(screen.getByTestId('quick-menu')).toBeTruthy();

      runPendingTimers();
      expect(screen.queryByTestId('quick-menu')).toBeNull();
      expect(onClick).not.toHaveBeenCalled();
      expect(onSwitch).not.toHaveBeenCalled();

      // A click without a pointer still passes while the menu is open.
      holdOpen(trigger, 2);
      fireEvent.click(trigger, { detail: 0 });
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('switches once where a pointerup comes too, before or after the touchend', () => {
      const onSwitch = vi.fn();
      render(<Harness onSwitch={onSwitch} onClick={vi.fn()} />);
      const trigger = screen.getByTestId('trigger');

      // The pointerup first, as browsers order them: the touchend finds nothing left to end.
      holdOpen(trigger, 1);
      layoutTriggerAndMenu();
      fireEvent(window, pointerEvent('pointerup', { pointerId: 1, ...ON_BOB }));
      touchEnd('touchend', ON_BOB);
      runPendingTimers();
      expect(onSwitch).toHaveBeenCalledTimes(1);
      expect(onSwitch).toHaveBeenLastCalledWith(BOB.session);
      act(() => {
        vi.advanceTimersByTime(400);
      });

      // The touchend first: the pointerup switches, and nothing is left to run.
      holdOpen(trigger, 2);
      layoutTriggerAndMenu();
      touchEnd('touchend', ON_CAROL);
      fireEvent(window, pointerEvent('pointerup', { pointerId: 2, ...ON_CAROL }));
      expect(onSwitch).toHaveBeenCalledTimes(2);
      expect(onSwitch).toHaveBeenLastCalledWith(CAROL.session);
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(vi.getTimerCount()).toBe(0);
      expect(onSwitch).toHaveBeenCalledTimes(2);
    });

    it('ends a pending hold too, and leaves its tap to open the account menu', () => {
      const onClick = vi.fn();
      render(<Harness onSwitch={vi.fn()} onClick={onClick} />);
      const trigger = screen.getByTestId('trigger');

      // A short tap: its click passes, whether it comes before the gesture has ended or after.
      fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 1, clientX: 25, clientY: 420 }));
      touchEnd('touchend', ON_AVATAR);
      fireEvent.click(trigger, { detail: 1 });
      expect(onClick).toHaveBeenCalledTimes(1);
      runPendingTimers();
      expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();

      fireEvent(trigger, pointerEvent('pointerdown', { pointerId: 2, clientX: 25, clientY: 420 }));
      touchEnd('touchend', ON_AVATAR);
      runPendingTimers();
      expect(trigger.getAttribute('data-quick-switch-pressing')).toBeNull();
      fireEvent.click(trigger, { detail: 1 });
      expect(onClick).toHaveBeenCalledTimes(2);

      act(() => {
        vi.advanceTimersByTime(ACCOUNT_HOLD_MS);
      });
      expect(screen.queryByTestId('quick-menu')).toBeNull();
    });
  });

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
