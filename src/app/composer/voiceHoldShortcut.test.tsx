// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import React, { useState } from 'react';
import { voiceAutoSendPendingAtom } from './roomInputDrafts';
import {
  UNCERTAIN_KEY_MS,
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

  it('sends nothing while left Alt is held, and works again once it is released', () => {
    const { log } = setup((l) => <Composer log={l} />);
    press('keydown', rightAlt);
    press('keyup', rightAlt);
    expect(log).toEqual(['start']);
    // The recording runs; left Alt then right Alt is no press of right Alt alone.
    press('keydown', { key: 'Alt', code: 'AltLeft', altKey: true });
    press('keydown', rightAlt);
    expect(press('keyup', rightAlt).defaultPrevented).toBe(false);
    press('keyup', { key: 'Alt', code: 'AltLeft' });
    expect(log).toEqual(['start']);
    press('keydown', rightAlt);
    press('keyup', rightAlt);
    expect(log).toEqual(['start', 'send']);
  });

  it('leaves right Alt alone while the setting is off', () => {
    const { log } = setup((l) => <Composer log={l} />, false);
    press('keydown', rightAlt);
    expect(press('keyup', rightAlt).defaultPrevented).toBe(false);
    press('keydown', rightAlt);
    wait(300);
    expect(press('keyup', rightAlt).defaultPrevented).toBe(false);
    expect(log).toEqual([]);
  });

  it('cancels a press under way when the setting goes off, and a running recording is not sent', () => {
    const { log, switchTo } = setup((l) => <Composer log={l} />);
    press('keydown', rightAlt);
    switchTo(false);
    wait(300);
    expect(press('keyup', rightAlt).defaultPrevented).toBe(false);
    expect(log).toEqual([]);

    switchTo(true);
    press('keydown', rightAlt);
    wait(300);
    switchTo(false);
    press('keyup', rightAlt);
    press('keydown', rightAlt);
    press('keyup', rightAlt);
    expect(log).toEqual(['start']);
  });

  it('counts left Alt held while the setting was off once it is back on', () => {
    const { log, switchTo } = setup((l) => <Composer log={l} />);
    press('keydown', rightAlt);
    press('keyup', rightAlt);
    switchTo(false);
    press('keydown', { key: 'Alt', code: 'AltLeft', altKey: true });
    switchTo(true);
    press('keydown', rightAlt);
    expect(press('keyup', rightAlt).defaultPrevented).toBe(false);
    expect(log).toEqual(['start']);
  });

  it('keeps left Alt held across a ⌘ release, and arms nothing while a mouse button is down', () => {
    const { log } = setup((l) => <Composer log={l} />);
    press('keydown', rightAlt);
    press('keyup', rightAlt);
    press('keydown', { key: 'Alt', code: 'AltLeft', altKey: true });
    press('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true, altKey: true });
    press('keyup', { key: 'Meta', code: 'MetaLeft', altKey: true });
    press('keydown', rightAlt);
    expect(press('keyup', rightAlt).defaultPrevented).toBe(false);
    press('keyup', { key: 'Alt', code: 'AltLeft' });

    const pointer = (type: string) =>
      act(() => {
        window.dispatchEvent(Object.assign(new MouseEvent(type), { pointerId: 1 }));
      });
    pointer('pointerdown');
    press('keydown', rightAlt);
    expect(press('keyup', rightAlt).defaultPrevented).toBe(false);
    pointer('pointerup');
    press('keydown', rightAlt);
    press('keyup', rightAlt);
    expect(log).toEqual(['start', 'send']);
  });

  it('sends nothing for right Alt while Caps Lock is held', () => {
    const { log } = setup((l) => <Composer log={l} />);
    press('keydown', rightAlt);
    press('keyup', rightAlt);
    expect(log).toEqual(['start']);

    press('keydown', { key: 'CapsLock', code: 'CapsLock' });
    press('keydown', rightAlt);
    expect(press('keyup', rightAlt).defaultPrevented).toBe(false);
    press('keyup', { key: 'CapsLock', code: 'CapsLock' });

    expect(log).toEqual(['start']);
    press('keydown', rightAlt);
    press('keyup', rightAlt);
    expect(log).toEqual(['start', 'send']);
  });

  describe('a key down when ⌘ came up', () => {
    const metaShiftLeft = () => {
      const view = setup((l) => <Composer log={l} />);
      press('keydown', rightAlt);
      press('keyup', rightAlt);
      press('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true });
      press('keydown', { key: 'Shift', code: 'ShiftLeft', metaKey: true, shiftKey: true });
      press('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true, shiftKey: true });
      press('keyup', { key: 'Meta', code: 'MetaLeft', shiftKey: true });
      press('keyup', { key: 'Shift', code: 'ShiftLeft' });
      return view;
    };
    const tap = () => {
      press('keydown', rightAlt);
      return press('keyup', rightAlt).defaultPrevented;
    };

    it('blocks right Alt while it may still be down, however many taps or other keys come', () => {
      const { log } = metaShiftLeft();
      expect(tap()).toBe(false);
      press('keydown', { key: 'b', code: 'KeyB' });
      press('keyup', { key: 'b', code: 'KeyB' });
      wait(1000);
      expect(tap()).toBe(false);
      expect(log).toEqual(['start']);
    });

    it('blocks until its keyup once it repeats', () => {
      const { log } = metaShiftLeft();
      wait(1400);
      press('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', repeat: true });
      wait(2000);
      expect(tap()).toBe(false);
      press('keyup', { key: 'ArrowLeft', code: 'ArrowLeft' });
      expect(tap()).toBe(true);
      expect(log).toEqual(['start', 'send']);
    });

    it('lapses after 1.5 s without a repeat', () => {
      const { log } = metaShiftLeft();
      wait(UNCERTAIN_KEY_MS);
      expect(tap()).toBe(true);
      expect(log).toEqual(['start', 'send']);
    });

    it('leaves a press begun while it blocked inert, even once it lapses', () => {
      const { log } = metaShiftLeft();
      press('keydown', rightAlt);
      wait(UNCERTAIN_KEY_MS + 500);
      expect(press('keyup', rightAlt).defaultPrevented).toBe(false);
      expect(log).toEqual(['start']);
    });
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
