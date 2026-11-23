// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopShellEvent } from '../lib/desktopBridge';
import { watchDesktopWindowHidden } from './desktopShellLifecycle';

afterEach(() => {
  Reflect.deleteProperty(window, 'mindroomDesktop');
  vi.restoreAllMocks();
});

describe('watchDesktopWindowHidden', () => {
  it('invokes callback only on window-hidden shell events and unsubscribes on cleanup', () => {
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
      screenShare: false,
      appUrl: {
        addListener: vi.fn(async () => undefined),
        getLaunchUrl: vi.fn(async () => undefined),
      },
    };
    Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: bridge });

    const onHidden = vi.fn();
    const stop = watchDesktopWindowHidden(onHidden);

    shellListener?.({ type: 'fullscreen', value: true });
    shellListener?.({ type: 'zoom', action: 'in' });
    expect(onHidden).not.toHaveBeenCalled();

    shellListener?.({ type: 'window-hidden' });
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
