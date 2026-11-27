// @vitest-environment jsdom
import { focusManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopShellEvent } from '../lib/desktopBridge';
import { watchDesktopQueryFocus, watchDesktopWindowHidden } from './desktopShellLifecycle';

const cleanups: Array<() => void> = [];

const track = <T extends () => void>(cleanup: T): T => {
  cleanups.push(cleanup);
  return cleanup;
};

const setVisibility = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  window.dispatchEvent(new Event('visibilitychange'));
};

const installDesktopBridge = (initialFocused = true) => {
  let focused = initialFocused;
  let shellListener: ((event: DesktopShellEvent) => void) | undefined;
  const unsubscribe = vi.fn(() => {
    shellListener = undefined;
  });
  const bridge: DesktopBridge = {
    onShellEvent: vi.fn((listener: (event: DesktopShellEvent) => void) => {
      shellListener = listener;
      return unsubscribe;
    }),
    setMediaSession: vi.fn(() => ({ ok: true as const, value: undefined })),
    startSignIn: vi.fn(async () => ({ ok: true as const, value: '' })),
    openSignIn: vi.fn(async () => ({ ok: true as const, value: undefined })),
    showMainWindow: vi.fn(async () => ({ ok: true as const, value: undefined })),
    setBadge: vi.fn(),
    isWindowFocused: () => focused,
    screenShare: false,
    appUrl: {
      addListener: vi.fn(async () => undefined),
      getLaunchUrl: vi.fn(async () => undefined),
    },
  };
  Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: bridge });
  const emit = (event: DesktopShellEvent): void => {
    if (event.type === 'window-focus') {
      focused = event.focused;
    }
    shellListener?.(event);
  };
  return { emit, unsubscribe };
};

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  Reflect.deleteProperty(document, 'visibilityState');
  Reflect.deleteProperty(window, 'mindroomDesktop');
  vi.restoreAllMocks();
});

describe('watchDesktopWindowHidden', () => {
  it('invokes callback only on window-hidden shell events and unsubscribes on cleanup', () => {
    const { emit, unsubscribe } = installDesktopBridge();
    const onHidden = vi.fn();
    const stop = watchDesktopWindowHidden(onHidden);

    emit({ type: 'fullscreen', value: true });
    emit({ type: 'zoom', action: 'in' });
    expect(onHidden).not.toHaveBeenCalled();

    emit({ type: 'window-hidden' });
    expect(onHidden).toHaveBeenCalledOnce();

    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('is a no-op outside the desktop app', () => {
    const onHidden = vi.fn();
    const stop = watchDesktopWindowHidden(onHidden);
    expect(() => stop()).not.toThrow();
    expect(onHidden).not.toHaveBeenCalled();
  });
});

describe('watchDesktopQueryFocus', () => {
  it('is a no-op outside the desktop app', () => {
    const setEventListener = vi.spyOn(focusManager, 'setEventListener');
    const setFocused = vi.spyOn(focusManager, 'setFocused');

    const stop = watchDesktopQueryFocus();
    expect(setEventListener).not.toHaveBeenCalled();
    expect(setFocused).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
    expect(setEventListener).not.toHaveBeenCalled();
    expect(setFocused).not.toHaveBeenCalled();
  });

  it('notifies subscribers and updates isFocused on window-focus transitions', () => {
    const { emit } = installDesktopBridge(true);
    const onFocus = vi.fn();
    track(focusManager.subscribe(onFocus));
    track(watchDesktopQueryFocus());

    expect(focusManager.isFocused()).toBe(true);
    expect(onFocus).not.toHaveBeenCalled();

    emit({ type: 'window-focus', focused: false });
    expect(focusManager.isFocused()).toBe(false);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenLastCalledWith(false);

    emit({ type: 'window-focus', focused: true });
    expect(focusManager.isFocused()).toBe(true);
    expect(onFocus).toHaveBeenCalledTimes(2);
    expect(onFocus).toHaveBeenLastCalledWith(true);
  });

  it('ignores duplicate window-focus: true events when already focused', () => {
    const { emit } = installDesktopBridge(true);
    const onFocus = vi.fn();
    track(focusManager.subscribe(onFocus));
    track(watchDesktopQueryFocus());

    emit({ type: 'window-focus', focused: true });
    emit({ type: 'window-focus', focused: true });

    expect(focusManager.isFocused()).toBe(true);
    expect(onFocus).not.toHaveBeenCalled();
  });

  it('deduplicates combined visibilitychange and window-focus transitions', () => {
    const { emit } = installDesktopBridge(true);
    const onFocus = vi.fn();
    track(focusManager.subscribe(onFocus));
    track(watchDesktopQueryFocus());

    setVisibility('hidden');
    expect(focusManager.isFocused()).toBe(false);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenLastCalledWith(false);

    emit({ type: 'window-focus', focused: false });
    emit({ type: 'window-focus', focused: true });
    expect(focusManager.isFocused()).toBe(false);
    expect(onFocus).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    emit({ type: 'window-focus', focused: true });
    expect(focusManager.isFocused()).toBe(true);
    expect(onFocus).toHaveBeenCalledTimes(2);
    expect(onFocus).toHaveBeenLastCalledWith(true);
  });

  it('starts unfocused without emitting true, then notifies true on focus', () => {
    const { emit } = installDesktopBridge(false);
    const onFocus = vi.fn();
    track(focusManager.subscribe(onFocus));
    track(watchDesktopQueryFocus());

    expect(focusManager.isFocused()).toBe(false);
    expect(onFocus).not.toHaveBeenCalledWith(true);

    onFocus.mockClear();
    emit({ type: 'window-focus', focused: true });
    expect(focusManager.isFocused()).toBe(true);
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onFocus).toHaveBeenCalledWith(true);
  });

  it('cleans up idempotently and restores default visibilitychange focus behavior', () => {
    const { emit, unsubscribe } = installDesktopBridge(true);
    const onFocus = vi.fn();
    track(focusManager.subscribe(onFocus));
    const stop = track(watchDesktopQueryFocus());

    emit({ type: 'window-focus', focused: false });
    expect(focusManager.isFocused()).toBe(false);

    const setEventListener = vi.spyOn(focusManager, 'setEventListener');
    const setFocused = vi.spyOn(focusManager, 'setFocused');
    stop();
    stop();

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(setEventListener).toHaveBeenCalledOnce();
    expect(setFocused).toHaveBeenCalledOnce();
    expect(setFocused).toHaveBeenCalledWith(undefined);
    expect(focusManager.isFocused()).toBe(true);

    onFocus.mockClear();
    emit({ type: 'window-focus', focused: false });
    expect(onFocus).not.toHaveBeenCalled();

    setVisibility('hidden');
    expect(focusManager.isFocused()).toBe(false);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenLastCalledWith(false);

    setVisibility('visible');
    expect(focusManager.isFocused()).toBe(true);
    expect(onFocus).toHaveBeenCalledTimes(2);
    expect(onFocus).toHaveBeenLastCalledWith(true);
  });
});
