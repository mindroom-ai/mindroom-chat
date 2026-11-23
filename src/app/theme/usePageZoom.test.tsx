// @vitest-environment jsdom
import { Capacitor } from '@capacitor/core';
import { act, cleanup, renderHook } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopShellEvent } from '../lib/desktopBridge';
import { settingsAtom } from '../preferences/settings';
import { usePageZoom } from './usePageZoom';

const store = getDefaultStore();
const zoom = () => store.get(settingsAtom).pageZoom;
const setZoom = (pageZoom: number) =>
  store.set(settingsAtom, { ...store.get(settingsAtom), pageZoom });

/** A key pressed (Ctrl, as jsdom is no Apple platform) in a focused field inside a dialog. */
const pressInDialog = (key: string, repeat = false) => {
  const input = document.querySelector('input') as HTMLInputElement;
  input.focus();
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: true,
    repeat,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    input.dispatchEvent(event);
  });
  return event;
};

const installDesktopBridge = () => {
  let listener: ((event: DesktopShellEvent) => void) | undefined;
  const unsubscribe = vi.fn(() => {
    listener = undefined;
  });
  const bridge: DesktopBridge = {
    onShellEvent: vi.fn((next: (event: DesktopShellEvent) => void) => {
      listener = next;
      return unsubscribe;
    }),
    setMediaSession: vi.fn(() => ({ ok: true as const, value: undefined })),
    startSignIn: vi.fn(async () => ({ ok: true as const, value: '' })),
    openSignIn: vi.fn(async () => ({ ok: true as const, value: undefined })),
    showMainWindow: vi.fn(async () => ({ ok: true as const, value: undefined })),
    setBadge: vi.fn(),
    screenShare: false,
    appUrl: {
      addListener: vi.fn(async () => undefined),
      getLaunchUrl: vi.fn(async () => undefined),
    },
  };
  Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: bridge });
  return {
    emit: (event: DesktopShellEvent) => {
      act(() => {
        listener?.(event);
      });
    },
    unsubscribe,
  };
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'mindroomDesktop');
  vi.restoreAllMocks();
  setZoom(100);
  document.body.innerHTML = '';
});

// Rendered alone: no signed-in shell and its shortcut listener, as on the sign-in page.
describe('usePageZoom zoom keys', () => {
  const setup = (native: boolean, start: number) => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(native);
    document.body.innerHTML = '<div role="dialog"><input type="text" value="Hello" /></div>';
    setZoom(start);
    renderHook(() => usePageZoom());
  };

  it('steps the setting once per key event in the native apps, held keys too', () => {
    setup(true, 117);
    expect(pressInDialog('=').defaultPrevented).toBe(true);
    expect(zoom()).toBe(125);
    pressInDialog('=', true);
    expect(zoom()).toBe(150);
    pressInDialog('+', true);
    expect(zoom()).toBe(150);
    pressInDialog('-');
    pressInDialog('-', true);
    expect(zoom()).toBe(110);
    pressInDialog('0');
    expect(zoom()).toBe(100);
    expect(document.documentElement.style.fontSize).toBe('');
  });

  it('changes nothing from the Quick Capture window, which keeps its own size', () => {
    window.history.pushState({}, '', '/quick-capture/');
    try {
      setup(true, 110);
      expect(pressInDialog('=').defaultPrevented).toBe(false);
      expect(pressInDialog('-', true).defaultPrevented).toBe(false);
      expect(pressInDialog('0').defaultPrevented).toBe(false);
      expect(zoom()).toBe(110);
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('leaves the keys to the browser elsewhere', () => {
    setup(false, 110);
    expect(pressInDialog('=').defaultPrevented).toBe(false);
    expect(pressInDialog('-', true).defaultPrevented).toBe(false);
    expect(pressInDialog('0').defaultPrevented).toBe(false);
    expect(zoom()).toBe(110);
  });
});

describe('usePageZoom desktop shell events', () => {
  it('steps zoom on desktop zoom shell events and unsubscribes on unmount', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    const { emit, unsubscribe } = installDesktopBridge();
    setZoom(100);
    const { unmount } = renderHook(() => usePageZoom());

    emit({ type: 'zoom', action: 'in' });
    expect(zoom()).toBe(110);
    emit({ type: 'zoom', action: 'in' });
    expect(zoom()).toBe(125);
    emit({ type: 'zoom', action: 'out' });
    expect(zoom()).toBe(110);
    emit({ type: 'zoom', action: 'reset' });
    expect(zoom()).toBe(100);
    emit({ type: 'fullscreen', value: true });
    expect(zoom()).toBe(100);

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('ignores desktop zoom shell events on /quick-capture/', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    const { emit } = installDesktopBridge();
    window.history.pushState({}, '', '/quick-capture/');
    try {
      setZoom(110);
      renderHook(() => usePageZoom());
      emit({ type: 'zoom', action: 'in' });
      emit({ type: 'zoom', action: 'out' });
      emit({ type: 'zoom', action: 'reset' });
      expect(zoom()).toBe(110);
    } finally {
      window.history.pushState({}, '', '/');
    }
  });
});
