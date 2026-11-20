// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import React, { useState } from 'react';
import { voiceAutoSendPendingAtom } from './roomInputDrafts';
import {
  resolveVoiceComposer,
  useVoiceComposer,
  useVoiceHoldShortcut,
} from './voiceHoldShortcut';

type Log = string[];

/** A composer root on the page; jsdom lays nothing out, so it gets a box of its own. */
const shownRoot = (parent: HTMLElement = document.body): HTMLElement => {
  const root = document.createElement('div');
  root.getClientRects = () => [new DOMRect(0, 0, 100, 40)] as unknown as DOMRectList;
  parent.append(root);
  return root;
};

/** A composer whose actions close over its render, as RoomInput's do. */
function Composer({ log, thread = false }: { log: Log; thread?: boolean }) {
  const [open, setOpen] = useState(false);
  const [root] = useState(() => shownRoot());
  useVoiceComposer({
    root: () => root,
    thread,
    active: () => open,
    phase: () => (open ? 'recording' : 'none'),
    hasContent: () => false,
    start: () => {
      if (open) return false;
      log.push(thread ? 'thread start' : 'start');
      setOpen(true);
      return true;
    },
    send: () => log.push(thread ? 'thread send' : 'send'),
    focus: () => log.push('focus'),
  });
  return null;
}

function Listener({ enabled = true }: { enabled?: boolean }) {
  useVoiceHoldShortcut(enabled);
  return null;
}

const press = (type: 'keydown' | 'keyup', init: KeyboardEventInit) => {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};
const space = { key: ' ', code: 'Space' };
const voiceKey = { ...space, ctrlKey: true, shiftKey: true };
/** Control, then Shift, then Space goes down; the keydown of Space is the app's. */
const hold = () => {
  press('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true });
  press('keydown', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true });
  expect(press('keydown', voiceKey).defaultPrevented).toBe(true);
};
const pointer = (type: string) =>
  act(() => {
    window.dispatchEvent(Object.assign(new MouseEvent(type), { pointerId: 1 }));
  });
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const setup = (children: (log: Log) => React.ReactNode, enabled = true) => {
  const store = createStore();
  const log: Log = [];
  const tree = (on: boolean) => (
    <Provider store={store}>
      <Listener enabled={on} />
      {children(log)}
    </Provider>
  );
  const view = render(tree(enabled));
  const switchTo = (on: boolean) => view.rerender(tree(on));
  return { store, log, view, switchTo };
};

describe('resolveVoiceComposer', () => {
  it('takes the open recorder, else the focused composer, else the thread, else the room', () => {
    const roomRoot = shownRoot();
    const composer = (thread: boolean, active: boolean, root = shownRoot()) =>
      renderHook(() =>
        useVoiceComposer({
          root: () => root,
          thread,
          active: () => active,
          phase: () => 'none',
          hasContent: () => false,
          start: () => false,
          send: () => undefined,
          focus: () => undefined,
        })
      );
    const room = composer(false, false, roomRoot);
    const thread = composer(true, false);
    const fork = renderHook(() => useVoiceComposer(undefined));
    const threadTarget = resolveVoiceComposer(document.body);
    const roomTarget = resolveVoiceComposer(roomRoot);
    expect(roomTarget).not.toBe(threadTarget);
    room.rerender();
    // The same target for the whole life of the composer.
    expect(resolveVoiceComposer(roomRoot)).toBe(roomTarget);
    thread.unmount();
    expect(resolveVoiceComposer(document.body)).toBe(roomTarget);
    room.unmount();
    expect(resolveVoiceComposer(document.body)).toBeUndefined();
    fork.unmount();
  });

  it('skips a composer under an inert page or side panel, and one not rendered', () => {
    const inert = document.createElement('div');
    inert.setAttribute('inert', '');
    document.body.append(inert);
    const unrendered = document.createElement('div');
    document.body.append(unrendered);
    const views = [shownRoot(inert), unrendered].map((root) =>
      renderHook(() =>
        useVoiceComposer({
          root: () => root,
          thread: false,
          active: () => true,
          phase: () => 'recording',
          hasContent: () => false,
          start: () => false,
          send: () => undefined,
          focus: () => undefined,
        })
      )
    );
    expect(resolveVoiceComposer(document.body)).toBeUndefined();
    views.forEach((view) => view.unmount());
  });
});

describe('useVoiceHoldShortcut', () => {
  it('sends on release a recording that push-to-talk started and the composer rerendered with', () => {
    const { log } = setup((l) => <Composer log={l} />);
    hold();
    expect(press('keydown', { ...voiceKey, repeat: true }).defaultPrevented).toBe(true);
    wait(300);
    expect(log).toEqual(['start']);
    expect(press('keyup', space).defaultPrevented).toBe(true);
    expect(log).toEqual(['start', 'send']);
    // The modifiers' own keyups come after; the press is over.
    press('keyup', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true });
    press('keyup', { key: 'Control', code: 'ControlLeft' });
    expect(log).toEqual(['start', 'send']);
  });

  it('ends a press on the first of its keys to come up, and still takes its Space', () => {
    const { log } = setup((l) => <Composer log={l} />);
    hold();
    press('keyup', { key: 'Control', code: 'ControlLeft', shiftKey: true });
    expect(log).toEqual(['start']);
    // Space still down: its repeats and keyup are the app's, and start nothing.
    const repeat = press('keydown', { key: ' ', code: 'Space', shiftKey: true, repeat: true });
    expect(repeat.defaultPrevented).toBe(true);
    press('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, shiftKey: true });
    expect(press('keydown', { ...voiceKey, repeat: true }).defaultPrevented).toBe(true);
    wait(300);
    expect(press('keyup', { ...space, shiftKey: true }).defaultPrevented).toBe(true);
    expect(log).toEqual(['start']);
    // With the modifiers still down, the next Space is a press of its own: a tap that sends.
    hold();
    press('keyup', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true });
    expect(log).toEqual(['start', 'send']);
    // A plain Space types as ever.
    expect(press('keydown', space).defaultPrevented).toBe(false);
    expect(press('keyup', space).defaultPrevented).toBe(false);
  });

  it('does nothing in a composer that went away, and never moves to another one', () => {
    const { store, log, view } = setup((l) => <Composer log={l} />);
    hold();
    view.rerender(
      <Provider store={store}>
        <Listener />
        <Composer key="other" log={log} thread />
      </Provider>
    );
    wait(300);
    press('keyup', space);
    expect(log).toEqual([]);
  });

  it('starts nothing for held modifiers, other chords with Space, or a pending send', () => {
    const { store, log } = setup((l) => <Composer log={l} />);
    // Option or Control and Shift held a while, then an arrow: the app's navigation.
    press('keydown', { key: 'Alt', code: 'AltLeft', altKey: true });
    press('keydown', { key: 'Alt', code: 'AltLeft', altKey: true, repeat: true });
    wait(1000);
    press('keydown', { key: 'ArrowUp', code: 'ArrowUp', altKey: true });
    press('keyup', { key: 'Alt', code: 'AltLeft' });
    press('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    press('keydown', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true });
    wait(1000);
    press('keyup', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true });
    press('keyup', { key: 'Control', code: 'ControlLeft' });
    for (const chord of [
      { ctrlKey: true },
      { shiftKey: true },
      { ctrlKey: true, shiftKey: true, altKey: true },
      { ctrlKey: true, shiftKey: true, metaKey: true },
    ]) {
      expect(press('keydown', { ...space, ...chord }).defaultPrevented).toBe(false);
      wait(300);
      expect(press('keyup', space).defaultPrevented).toBe(false);
    }
    store.set(voiceAutoSendPendingAtom, true);
    expect(press('keydown', voiceKey).defaultPrevented).toBe(false);
    expect(press('keyup', space).defaultPrevented).toBe(false);
    expect(log).toEqual([]);
  });

  it('leaves the keys alone while the setting is off', () => {
    const { log } = setup((l) => <Composer log={l} />, false);
    expect(press('keydown', voiceKey).defaultPrevented).toBe(false);
    expect(press('keyup', space).defaultPrevented).toBe(false);
    press('keydown', voiceKey);
    wait(300);
    expect(press('keyup', space).defaultPrevented).toBe(false);
    expect(log).toEqual([]);
  });

  it('cancels a press under way when the setting goes off, and a running recording is not sent', () => {
    const { log, switchTo } = setup((l) => <Composer log={l} />);
    hold();
    switchTo(false);
    wait(300);
    press('keyup', space);
    expect(log).toEqual([]);

    switchTo(true);
    hold();
    wait(300);
    switchTo(false);
    press('keyup', space);
    expect(press('keydown', voiceKey).defaultPrevented).toBe(false);
    press('keyup', space);
    expect(log).toEqual(['start']);
  });

  it('arms nothing while a mouse button is down', () => {
    const { log } = setup((l) => <Composer log={l} />);
    pointer('pointerdown');
    expect(press('keydown', voiceKey).defaultPrevented).toBe(false);
    expect(press('keyup', space).defaultPrevented).toBe(false);
    pointer('pointerup');
    hold();
    press('keyup', space);
    expect(log).toEqual(['start']);
  });

  it('latches on another key or a click during push-to-talk, and forgets the press on a blur', () => {
    const { log } = setup((l) => <Composer log={l} />);
    hold();
    wait(300);
    const other = press('keydown', { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true });
    expect(other.defaultPrevented).toBe(false);
    press('keyup', space);
    expect(log).toEqual(['start']);
    hold();
    pointer('pointerdown');
    expect(press('keyup', space).defaultPrevented).toBe(true);
    pointer('pointerup');
    expect(log).toEqual(['start']);
    hold();
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(press('keyup', space).defaultPrevented).toBe(false);
    expect(log).toEqual(['start']);
  });
});
