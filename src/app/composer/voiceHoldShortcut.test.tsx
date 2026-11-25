// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import React, { useState } from 'react';
import { voiceAutoSendPendingAtom } from './roomInputDrafts';
import { resolveVoiceComposer, useVoiceComposer, useVoiceHoldShortcut } from './voiceHoldShortcut';

const overlay = vi.hoisted((): { open: 'none' | 'help' | 'other' } => ({ open: 'none' }));
vi.mock('../shortcuts/shortcutDom', () => ({ openOverlay: () => overlay.open }));

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
    offersFailed: () => false,
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
  overlay.open = 'none';
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
  it('takes the focused composer, else the thread, else the room', () => {
    const roomRoot = shownRoot();
    const composer = (thread: boolean, active: boolean, root = shownRoot()) =>
      renderHook(() =>
        useVoiceComposer({
          root: () => root,
          thread,
          active: () => active,
          offersFailed: () => false,
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

  it("sends the account's recording, which every composer shows, from the focused one, else the thread", () => {
    const roomRoot = shownRoot();
    const sent: string[] = [];
    const composer = (name: string, thread: boolean, offersFailed = false, root = shownRoot()) =>
      renderHook(() =>
        useVoiceComposer({
          root: () => root,
          thread,
          active: () => true,
          offersFailed: () => offersFailed,
          phase: () => 'recording',
          hasContent: () => false,
          start: () => false,
          send: () => sent.push(name),
          focus: () => undefined,
        })
      );
    const room = composer('room', false, false, roomRoot);
    const thread = composer('thread', true);

    resolveVoiceComposer(roomRoot)?.send();
    resolveVoiceComposer(document.body)?.send();
    expect(sent).toEqual(['room', 'thread']);

    // A recording whose send failed waits in one composer: only that one acts.
    const failed = composer('failed', false, true);
    resolveVoiceComposer(roomRoot)?.send();
    expect(sent).toEqual(['room', 'thread', 'failed']);

    [room, thread, failed].forEach((view) => view.unmount());
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
          offersFailed: () => false,
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

  it('picks the composer whose conversation container holds focus, else prefers the thread', () => {
    const roomContainer = document.createElement('div');
    const roomTimeline = document.createElement('button');
    roomContainer.append(roomTimeline);
    document.body.append(roomContainer);
    const roomRoot = shownRoot(roomContainer);

    const threadContainer = document.createElement('div');
    const threadTimeline = document.createElement('button');
    threadContainer.append(threadTimeline);
    document.body.append(threadContainer);
    const threadRoot = shownRoot(threadContainer);

    const composer = (thread: boolean, root: HTMLElement, container: HTMLElement) =>
      renderHook(() =>
        useVoiceComposer({
          root: () => root,
          container: () => container,
          thread,
          active: () => false,
          offersFailed: () => false,
          phase: () => 'none',
          hasContent: () => false,
          start: () => false,
          send: () => undefined,
          focus: () => undefined,
        })
      );
    const room = composer(false, roomRoot, roomContainer);
    const thread = composer(true, threadRoot, threadContainer);

    const roomTarget = resolveVoiceComposer(roomRoot);
    const threadTarget = resolveVoiceComposer(threadRoot);
    expect(roomTarget).toBeDefined();
    expect(roomTarget).not.toBe(threadTarget);
    expect(resolveVoiceComposer(roomTimeline)).toBe(roomTarget);
    expect(resolveVoiceComposer(threadTimeline)).toBe(threadTarget);
    expect(resolveVoiceComposer(document.body)).toBe(threadTarget);

    [room, thread].forEach((view) => view.unmount());
  });

  it('blocks fallback to the room when a disabled fork draft owns focus or no composer is focused', () => {
    const roomContainer = document.createElement('div');
    const roomTimeline = document.createElement('button');
    roomContainer.append(roomTimeline);
    document.body.append(roomContainer);
    const roomRoot = shownRoot(roomContainer);

    const forkContainer = document.createElement('div');
    const forkTimeline = document.createElement('button');
    forkContainer.append(forkTimeline);
    document.body.append(forkContainer);
    const forkRoot = shownRoot(forkContainer);

    const room = renderHook(() =>
      useVoiceComposer({
        root: () => roomRoot,
        container: () => roomContainer,
        thread: false,
        active: () => false,
        offersFailed: () => false,
        phase: () => 'none',
        hasContent: () => false,
        start: () => false,
        send: () => undefined,
        focus: () => undefined,
      })
    );
    const fork = renderHook(() =>
      useVoiceComposer({
        root: () => forkRoot,
        container: () => forkContainer,
        thread: true,
        disabled: true,
      })
    );

    const roomTarget = resolveVoiceComposer(roomRoot);
    expect(roomTarget).toBeDefined();
    expect(resolveVoiceComposer(roomTimeline)).toBe(roomTarget);
    expect(resolveVoiceComposer(forkRoot)).toBeUndefined();
    expect(resolveVoiceComposer(forkTimeline)).toBeUndefined();
    expect(resolveVoiceComposer(document.body)).toBeUndefined();

    [room, fork].forEach((view) => view.unmount());
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

  it('does nothing in a composer that went out of sight since the key went down', () => {
    // Under a side panel that fills the room, or behind a phone's drawer: its box is inert.
    const hide = () => act(() => document.body.setAttribute('inert', ''));
    const { log } = setup((l) => <Composer log={l} />);
    try {
      // Before the delayed start of push-to-talk: nothing starts, and the release starts nothing.
      hold();
      hide();
      wait(300);
      press('keyup', space);
      expect(log).toEqual([]);
      act(() => document.body.removeAttribute('inert'));

      // With a recording running: the release sends nothing, and the recording goes on.
      hold();
      press('keyup', space);
      expect(log).toEqual(['start']);
      hold();
      hide();
      press('keyup', space);
      expect(log).toEqual(['start']);
    } finally {
      document.body.removeAttribute('inert');
    }
  });

  it('starts nothing for held modifiers, other chords with Space, or a pending send', () => {
    const { store, log } = setup((l) => <Composer log={l} />);
    // Right Option, or Control and Shift, held past 300 ms, then an arrow: the app's navigation.
    press('keydown', { key: 'Alt', code: 'AltRight', altKey: true });
    press('keydown', { key: 'Alt', code: 'AltRight', altKey: true, repeat: true });
    wait(400);
    press('keydown', { key: 'ArrowUp', code: 'ArrowUp', altKey: true });
    press('keyup', { key: 'ArrowUp', code: 'ArrowUp', altKey: true });
    press('keyup', { key: 'Alt', code: 'AltRight' });
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
    // A blur sends nothing, but the Space still down stays the app's.
    hold();
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(press('keydown', { ...voiceKey, repeat: true }).defaultPrevented).toBe(true);
    expect(press('keyup', space).defaultPrevented).toBe(true);
    expect(log).toEqual(['start']);
    expect(press('keydown', space).defaultPrevented).toBe(false);
  });

  it('keeps the Space key when ⌥ changes its character, and lets a plain Space through after', () => {
    const { log } = setup((l) => <Composer log={l} />);
    hold();
    press('keydown', { key: 'Alt', code: 'AltLeft', ctrlKey: true, shiftKey: true, altKey: true });
    const nbsp = { key: '\u00a0', code: 'Space', altKey: true };
    expect(press('keydown', { ...nbsp, repeat: true }).defaultPrevented).toBe(true);
    expect(press('keyup', nbsp).defaultPrevented).toBe(true);
    expect(log).toEqual([]);
    expect(press('keydown', space).defaultPrevented).toBe(false);
    expect(press('keyup', space).defaultPrevented).toBe(false);
  });

  it('sends nothing when ⌘ comes mid-press and eats the Space keyup, and a later Space types', () => {
    const { log } = setup((l) => <Composer log={l} />);
    hold();
    const meta = { key: 'Meta', code: 'MetaLeft', ctrlKey: true, shiftKey: true };
    press('keydown', { ...meta, metaKey: true });
    wait(300);
    // macOS sends no keyup for Space under ⌘.
    press('keyup', meta);
    press('keyup', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true });
    press('keyup', { key: 'Control', code: 'ControlLeft' });
    expect(log).toEqual([]);
    expect(press('keydown', space).defaultPrevented).toBe(false);
    expect(press('keyup', space).defaultPrevented).toBe(false);
  });

  it('arms only on the Space key itself, whose keyup then ends the press', () => {
    const { log } = setup((l) => <Composer log={l} />);
    for (const code of ['', 'NumpadSpace']) {
      const other = { key: ' ', code, ctrlKey: true, shiftKey: true };
      expect(press('keydown', other).defaultPrevented).toBe(false);
      press('keyup', { ...other, ctrlKey: false, shiftKey: false });
      wait(300);
    }
    expect(log).toEqual([]);
  });

  it('leaves the keys to an input method composing, and to an open dialog', () => {
    const { log } = setup((l) => <Composer log={l} />);
    act(() => {
      window.dispatchEvent(new CompositionEvent('compositionstart'));
    });
    expect(press('keydown', voiceKey).defaultPrevented).toBe(false);
    wait(300);
    expect(press('keyup', space).defaultPrevented).toBe(false);
    act(() => {
      window.dispatchEvent(new CompositionEvent('compositionend'));
    });
    wait(100);
    overlay.open = 'other';
    expect(press('keydown', voiceKey).defaultPrevented).toBe(false);
    wait(300);
    expect(press('keyup', space).defaultPrevented).toBe(false);
    expect(log).toEqual([]);
    overlay.open = 'none';
    hold();
    press('keyup', space);
    expect(log).toEqual(['start']);
  });
});
