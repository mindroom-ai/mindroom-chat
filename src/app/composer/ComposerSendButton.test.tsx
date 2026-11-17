// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Provider, createStore } from 'jotai';
import { conversationCoveredAtom } from '../navigation/conversationCover';
import { LONG_PRESS_MS } from '../lib/hooks/useLongPress';
import type { MidTurnMode } from '../preferences/midTurnModes';
import { ComposerSendButton } from './ComposerSendButton';

// The menu's real focus trap runs. jsdom lays nothing out, and the trap holds only controls that
// take up room on the page.
const rects = () => [new DOMRect(0, 0, 40, 40)] as unknown as DOMRectList;

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
    const store = createStore();
    render(
      <Provider store={store}>
        <p>Outside the menu</p>
        <textarea aria-label="Message" />
        <ComposerSendButton
          label="Send message"
          agentReplying={agentReplying}
          hasText={() => hasText}
          empty={false}
          defaultMode={defaultMode}
          onSend={onSend}
        />
      </Provider>
    );
    return { onSend, store, button: screen.getByRole('button', { name: 'Send message' }) };
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

  const mouse = { pointerType: 'mouse' };
  /** A mouse comes to rest on `element`, as a browser tells it: pointer, then mouse events. */
  const enter = (element: HTMLElement, pointer = mouse) => {
    fireEvent.pointerEnter(element, pointer);
    if (pointer.pointerType === 'mouse') fireEvent.mouseEnter(element);
  };
  const leave = (element: HTMLElement, pointer = mouse) => {
    fireEvent.pointerLeave(element, pointer);
    if (pointer.pointerType === 'mouse') fireEvent.mouseLeave(element);
  };
  const wait = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  /** Rests the mouse on the button until the menu opens. */
  const rest = (button: HTMLElement) => {
    enter(button);
    wait(300);
    expect(screen.queryByRole('menu')).not.toBeNull();
  };

  it('opens the modes for a mouse resting on it, not one passing over it', () => {
    const { onSend, button } = setup(true);
    enter(button);
    wait(299);
    expect(screen.queryByRole('menu')).toBeNull();
    wait(1);
    expect(screen.queryByRole('menu')).not.toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Steer' }));
    expect(onSend.mock.calls).toEqual([['steer']]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens nothing for a mouse that moves on before the delay', () => {
    const { button } = setup(true);
    enter(button);
    wait(200);
    leave(button);
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens nothing for a finger or a pen coming onto it', () => {
    const { button } = setup(true);
    enter(button, { pointerType: 'touch' });
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
    leave(button, { pointerType: 'touch' });
    enter(button, { pointerType: 'pen' });
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens nothing for a resting mouse while no agent replies, or without text', () => {
    const first = setup(false);
    enter(first.button);
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
    cleanup();

    const second = setup(true, 'auto', false);
    enter(second.button);
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes shortly after the mouse leaves, and stays while it crosses to the menu', () => {
    const { button } = setup(true);
    rest(button);
    leave(button);
    wait(100);
    const menu = screen.getByRole('menu');
    enter(menu);
    wait(1000);
    expect(screen.queryByRole('menu')).not.toBeNull();

    leave(menu);
    wait(100);
    enter(button);
    wait(1000);
    expect(screen.queryByRole('menu')).not.toBeNull();

    leave(button);
    wait(199);
    expect(screen.queryByRole('menu')).not.toBeNull();
    wait(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('stays open after the mouse leaves while focus is in the menu', () => {
    const { button } = setup(true);
    rest(button);
    screen.getByRole('menuitem', { name: 'Queue' }).focus();
    leave(button);
    wait(1000);
    expect(screen.queryByRole('menu')).not.toBeNull();
  });

  it('sends once with the default mode on a click while a resting mouse opened the menu', () => {
    const { onSend, button } = setup(true, 'queue');
    rest(button);
    fireEvent.pointerDown(button, { ...press, ...mouse });
    fireEvent.mouseDown(button);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.pointerUp(button, { ...press, ...mouse });
    fireEvent.mouseUp(button);
    fireEvent.click(button);
    expect(onSend.mock.calls).toEqual([[]]);
    // The mouse still rests on the button, which does not open the menu again.
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens nothing on a resting mouse that presses before the delay, and holds as before', () => {
    const { onSend, button } = setup(true);
    enter(button);
    wait(100);
    fireEvent.pointerDown(button, { ...press, ...mouse });
    wait(LONG_PRESS_MS - 1);
    expect(screen.queryByRole('menu')).toBeNull();
    wait(1);
    expect(screen.queryByRole('menu')).not.toBeNull();
    fireEvent.pointerUp(button, { ...press, ...mouse });
    fireEvent.mouseUp(button);
    fireEvent.click(button);
    expect(onSend).not.toHaveBeenCalled();
    // A menu a hold opened stays as the mouse goes.
    leave(button);
    wait(1000);
    expect(screen.queryByRole('menu')).not.toBeNull();
  });

  it('leaves the text box its focus and its arrow keys under a menu a resting mouse opened', () => {
    const { button } = setup(true);
    const text = screen.getByRole('textbox', { name: 'Message' });
    text.focus();
    rest(button);
    expect(document.activeElement).toBe(text);
    fireEvent.keyDown(text, { key: 'ArrowDown', keyCode: 40, which: 40 });
    fireEvent.keyDown(text, { key: 'ArrowUp', keyCode: 38, which: 38 });
    expect(document.activeElement).toBe(text);

    // Once focus is in the menu, the arrows move through it.
    screen.getByRole('menuitem', { name: 'Steer' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', keyCode: 40, which: 40 });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Queue' }));
  });

  it("hides the button's tooltip under the menu", () => {
    const { button } = setup(true);
    enter(button);
    wait(250);
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    wait(50);
    expect(screen.queryByRole('menu')).not.toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes a menu a resting mouse opened as the conversation hides', () => {
    const { store, button } = setup(true);
    rest(button);
    act(() => {
      store.set(conversationCoveredAtom, true);
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('cancels a pending rest when the conversation hides, so showing again opens nothing', () => {
    const { store, button } = setup(true);
    enter(button);
    wait(100);
    act(() => {
      store.set(conversationCoveredAtom, true);
    });
    wait(100);
    act(() => {
      store.set(conversationCoveredAtom, false);
    });
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
    // A new rest opens it again.
    leave(button);
    rest(button);
  });

  /** The button alone, rendered again with other props. */
  const renderAlone = () => {
    const props = {
      label: 'Send message',
      agentReplying: true,
      hasText: () => true,
      empty: false,
      defaultMode: 'auto' as const,
      onSend: vi.fn(),
    };
    const view = render(<ComposerSendButton {...props} />);
    const replying = (agentReplying: boolean) =>
      view.rerender(<ComposerSendButton {...props} agentReplying={agentReplying} />);
    const emptied = (empty: boolean) =>
      view.rerender(<ComposerSendButton {...props} empty={empty} />);
    return { replying, emptied, button: screen.getByRole('button', { name: 'Send message' }) };
  };

  it('cancels a pending rest when the reply ends, so a new reply opens nothing', () => {
    const { replying, button } = renderAlone();
    enter(button);
    wait(100);
    replying(false);
    wait(100);
    replying(true);
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes a menu a resting mouse opened when the reply ends', () => {
    const { replying, button } = renderAlone();
    rest(button);
    replying(false);
    expect(screen.queryByRole('menu')).toBeNull();
    replying(true);
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps a menu a mouse hold dismissed with Escape closed, through the wait and the lift', () => {
    const { onSend, button } = setup(true);
    const down = { ...press, ...mouse, buttons: 1 };
    enter(button);
    fireEvent.pointerDown(button, down);
    wait(LONG_PRESS_MS);
    expect(screen.queryByRole('menu')).not.toBeNull();
    // The menu's full-window layer covers the button, which the pointer leaves.
    leave(button);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', keyCode: 27 });
    expect(screen.queryByRole('menu')).toBeNull();
    // With the layer gone, the pointer, still down, is over the button again.
    fireEvent.pointerEnter(button, down);
    fireEvent.mouseEnter(button, { buttons: 1 });
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.pointerUp(button, { ...press, ...mouse });
    fireEvent.mouseUp(button);
    fireEvent.click(button);
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('closes a menu a resting mouse opened as the composer empties, and drops a pending rest', () => {
    const { emptied, button } = renderAlone();
    rest(button);
    // A send, a cut or a voice message empties the editor, however late.
    emptied(true);
    expect(screen.queryByRole('menu')).toBeNull();
    emptied(false);
    leave(button);
    enter(button);
    wait(100);
    emptied(true);
    emptied(false);
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  /** Holds the mouse on the button until the menu opens, and lets go without moving. */
  const mouseHold = (button: HTMLElement) => {
    enter(button);
    fireEvent.pointerDown(button, { ...press, ...mouse, buttons: 1 });
    wait(LONG_PRESS_MS);
    expect(screen.queryByRole('menu')).not.toBeNull();
    // The menu's full-window layer comes over the button, which the browser tells as a leave.
    leave(button);
    fireEvent.pointerUp(document.body, { ...press, ...mouse });
    fireEvent.mouseUp(document.body);
    fireEvent.click(document.body);
  };
  const escape = () =>
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', keyCode: 27 });

  it('keeps a menu a mouse hold opened closed after Escape, until the mouse leaves and comes back', () => {
    const { onSend, button } = setup(true);
    mouseHold(button);
    escape();
    expect(screen.queryByRole('menu')).toBeNull();
    // The layer is gone, and the browser tells the button the resting mouse is on it again.
    enter(button);
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
    // The mouse goes and comes back: a rest again.
    leave(button);
    enter(button);
    wait(299);
    expect(screen.queryByRole('menu')).toBeNull();
    wait(1);
    expect(screen.queryByRole('menu')).not.toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("goes by where the mouse moved under a hold's layer when the menu closes", () => {
    const { button } = setup(true);
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 40, 40));
    // Moved off the button under the layer, then dismissed: coming onto it is a rest.
    mouseHold(button);
    fireEvent.pointerMove(document.body, { ...mouse, clientX: 200, clientY: 200 });
    escape();
    enter(button);
    wait(300);
    expect(screen.queryByRole('menu')).not.toBeNull();
    escape();
    leave(button);

    // Moved off and back onto it under the layer, then dismissed: still on it, so nothing.
    mouseHold(button);
    fireEvent.pointerMove(document.body, { ...mouse, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(document.body, { ...mouse, clientX: 20, clientY: 20 });
    escape();
    enter(button);
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps a menu closed with the mouse on the button closed, until the mouse leaves and comes back', () => {
    const { button } = setup(true);
    rest(button);
    escape();
    expect(screen.queryByRole('menu')).toBeNull();
    enter(button);
    wait(1000);
    expect(screen.queryByRole('menu')).toBeNull();
    leave(button);
    rest(button);

    // A pick with the mouse on the menu leaves nothing behind: coming back onto the button rests.
    leave(button);
    enter(screen.getByRole('menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Queue' }));
    rest(button);
  });
});
