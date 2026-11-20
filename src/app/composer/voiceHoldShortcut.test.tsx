// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import React, { useState } from 'react';
import { voiceAutoSendPendingAtom } from './roomInputDrafts';
import { resolveVoiceComposer, useVoiceComposer, useVoiceHoldShortcut } from './voiceHoldShortcut';

type Log = string[];

/** A composer whose actions close over its render, as RoomInput's do. */
function Composer({ log, thread = false }: { log: Log; thread?: boolean }) {
  const [open, setOpen] = useState(false);
  useVoiceComposer({
    root: () => null,
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

function Listener() {
  useVoiceHoldShortcut();
  return null;
}

const press = (type: 'keydown' | 'keyup', init: KeyboardEventInit) => {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};
const rightAlt = { key: 'Alt', code: 'AltRight', altKey: true };
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

const setup = (children: (log: Log) => React.ReactNode) => {
  const store = createStore();
  const log: Log = [];
  const view = render(
    <Provider store={store}>
      <Listener />
      {children(log)}
    </Provider>
  );
  return { store, log, view };
};

describe('resolveVoiceComposer', () => {
  it('takes the open recorder, else the focused composer, else the thread, else the room', () => {
    const roomRoot = document.createElement('textarea');
    document.body.append(roomRoot);
    const composer = (thread: boolean, active: boolean, root?: HTMLElement) =>
      renderHook(() =>
        useVoiceComposer({
          root: () => root ?? null,
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
});

describe('useVoiceHoldShortcut', () => {
  it('sends on release a recording that push-to-talk started and the composer rerendered with', () => {
    const { log } = setup((l) => <Composer log={l} />);
    press('keydown', rightAlt);
    wait(300);
    expect(log).toEqual(['start']);
    const release = press('keyup', rightAlt);
    expect(release.defaultPrevented).toBe(true);
    expect(log).toEqual(['start', 'send']);
  });

  it('starts a hands-free recording on a tap of AltGraph; a second tap sends it', () => {
    const { log } = setup((l) => <Composer log={l} />);
    press('keydown', { key: 'AltGraph', code: 'AltRight' });
    press('keyup', { key: 'AltGraph', code: 'AltRight' });
    press('keydown', rightAlt);
    press('keyup', rightAlt);
    expect(log).toEqual(['start', 'send']);
  });

  it('does nothing in a composer that went away, and never moves to another one', () => {
    const { store, log, view } = setup((l) => <Composer log={l} />);
    press('keydown', rightAlt);
    view.rerender(
      <Provider store={store}>
        <Listener />
        <Composer key="other" log={log} thread />
      </Provider>
    );
    wait(300);
    press('keyup', rightAlt);
    expect(log).toEqual([]);
  });

  it('starts nothing for ⌥ typing in either order, left Alt, AltGr with Ctrl, or a pending send', () => {
    const { store, log } = setup((l) => <Composer log={l} />);
    press('keydown', rightAlt);
    press('keydown', { key: '–', code: 'Minus', altKey: true });
    press('keyup', rightAlt);
    // The other key first: right ⌥ comes while it is still down.
    press('keydown', { key: 'a', code: 'KeyA' });
    press('keydown', rightAlt);
    wait(300);
    press('keyup', rightAlt);
    press('keyup', { key: 'å', code: 'KeyA', altKey: true });
    press('keydown', { key: 'Alt', code: 'AltLeft', altKey: true });
    press('keyup', { key: 'Alt', code: 'AltLeft' });
    press('keydown', { key: 'AltGraph', code: 'AltRight', ctrlKey: true, altKey: true });
    press('keyup', { key: 'AltGraph', code: 'AltRight' });
    store.set(voiceAutoSendPendingAtom, true);
    press('keydown', rightAlt);
    expect(press('keyup', rightAlt).defaultPrevented).toBe(false);
    expect(log).toEqual([]);
  });

  it('forgets keys held when the window lost the focus, and latches on a click', () => {
    const { log } = setup((l) => <Composer log={l} />);
    press('keydown', { key: 'a', code: 'KeyA' });
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    press('keydown', rightAlt);
    wait(300);
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerdown'));
    });
    press('keyup', rightAlt);
    expect(log).toEqual(['start']);
  });
});
