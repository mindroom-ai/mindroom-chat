// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import React from 'react';
import type { VoiceHoldTarget, VoiceTargetPhase } from '../shortcuts/voiceHold';
import { voiceAutoSendPendingAtom } from './roomInputDrafts';
import {
  type VoiceComposer,
  resolveVoiceComposer,
  useVoiceComposer,
  useVoiceHoldShortcut,
} from './voiceHoldShortcut';

type Fake = VoiceHoldTarget & {
  calls: string[];
  state: { active: boolean; phase: VoiceTargetPhase };
};

const fakeTarget = (active = false): Fake => {
  const calls: string[] = [];
  const state = { active, phase: (active ? 'recording' : 'none') as VoiceTargetPhase };
  return {
    calls,
    state,
    active: () => state.active,
    phase: () => state.phase,
    hasContent: () => false,
    start: () => {
      calls.push('start');
      state.active = true;
      state.phase = 'recording';
      return true;
    },
    send: () => calls.push('send'),
    focus: () => calls.push('focus'),
  };
};

const mountComposer = (target: Fake, thread: boolean, root?: HTMLElement) =>
  renderHook(() => {
    const composer: VoiceComposer = { root: () => root ?? null, thread, target };
    useVoiceComposer(composer);
  });

const press = (type: 'keydown' | 'keyup', init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
  });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('resolveVoiceComposer', () => {
  it('takes the open recorder, else the focused composer, else the thread, else the room', () => {
    const room = fakeTarget();
    const roomRoot = document.createElement('div');
    roomRoot.append(document.createElement('textarea'));
    document.body.append(roomRoot);
    const thread = fakeTarget();
    const views = [mountComposer(room, false, roomRoot), mountComposer(thread, true)];

    expect(resolveVoiceComposer(document.body)).toBe(thread);
    expect(resolveVoiceComposer(roomRoot.firstElementChild)).toBe(room);
    thread.state.active = true;
    expect(resolveVoiceComposer(roomRoot.firstElementChild)).toBe(thread);

    views[1]?.unmount();
    expect(resolveVoiceComposer(document.body)).toBe(room);
    views[0]?.unmount();
    expect(resolveVoiceComposer(document.body)).toBeUndefined();
  });

  it('skips a composer that records no voice (a fork draft)', () => {
    const view = renderHook(() => useVoiceComposer(undefined));
    expect(resolveVoiceComposer(document.body)).toBeUndefined();
    view.unmount();
  });
});

describe('useVoiceHoldShortcut', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => {
    const store = createStore();
    const target = fakeTarget();
    const composer = mountComposer(target, false);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const listener = renderHook(() => useVoiceHoldShortcut(), { wrapper });
    const done = () => {
      listener.unmount();
      composer.unmount();
    };
    return { store, target, done };
  };

  it('records while right Alt is held and sends on release, cancelling only that release', () => {
    const { target, done } = setup();
    press('keydown', { key: 'Alt', code: 'AltRight', altKey: true });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(target.calls).toEqual(['start']);
    const release = new KeyboardEvent('keyup', { key: 'Alt', code: 'AltRight', cancelable: true });
    act(() => {
      window.dispatchEvent(release);
    });
    expect(release.defaultPrevented).toBe(true);
    expect(target.calls).toEqual(['start', 'send']);
    done();
  });

  it('starts nothing for ⌥ typing, left Alt, AltGr with Ctrl, or while a voice send is pending', () => {
    const { store, target, done } = setup();
    press('keydown', { key: 'Alt', code: 'AltRight', altKey: true });
    press('keydown', { key: '–', code: 'Minus', altKey: true });
    press('keyup', { key: 'Alt', code: 'AltRight' });
    press('keydown', { key: 'Alt', code: 'AltLeft', altKey: true });
    press('keyup', { key: 'Alt', code: 'AltLeft' });
    press('keydown', { key: 'AltGraph', code: 'AltRight', ctrlKey: true, altKey: true });
    press('keyup', { key: 'AltGraph', code: 'AltRight' });
    store.set(voiceAutoSendPendingAtom, true);
    press('keydown', { key: 'Alt', code: 'AltRight', altKey: true });
    const release = new KeyboardEvent('keyup', { key: 'Alt', code: 'AltRight', cancelable: true });
    act(() => {
      window.dispatchEvent(release);
    });
    expect(release.defaultPrevented).toBe(false);
    expect(target.calls).toEqual([]);
    done();
  });

  it('starts a hands-free recording on a tap of AltGraph, and a click during the hold latches', () => {
    const { target, done } = setup();
    press('keydown', { key: 'AltGraph', code: 'AltRight' });
    press('keyup', { key: 'AltGraph', code: 'AltRight' });
    expect(target.calls).toEqual(['start']);
    target.state.active = false;
    press('keydown', { key: 'Alt', code: 'AltRight', altKey: true });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerdown'));
    });
    press('keyup', { key: 'Alt', code: 'AltRight' });
    expect(target.calls).toEqual(['start', 'start']);
    done();
  });
});
