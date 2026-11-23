// @vitest-environment jsdom
import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopShellEvent } from './desktopBridge';
import {
  desktopBridge,
  externalOpenProps,
  isBundledApp,
  isCapacitorApp,
  isDesktopApp,
  markDesktopShell,
} from './nativeShell';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
  },
}));

const setDesktopBridge = (bridge: DesktopBridge | undefined): void => {
  if (bridge === undefined) {
    Reflect.deleteProperty(window, 'mindroomDesktop');
  } else {
    Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: bridge });
  }
};

const makeBridge = (): {
  bridge: DesktopBridge;
  onShellEvent: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  emit: (event: DesktopShellEvent) => void;
} => {
  let listener: ((event: DesktopShellEvent) => void) | undefined;
  const unsubscribe = vi.fn(() => {
    listener = undefined;
  });
  const onShellEvent = vi.fn((next: (event: DesktopShellEvent) => void) => {
    listener = next;
    return unsubscribe;
  });
  return {
    bridge: {
      onShellEvent,
      setMediaSession: vi.fn(() => ({ ok: true as const, value: undefined })),
      startSignIn: vi.fn(async () => ({
        ok: true as const,
        value: 'http://127.0.0.1:4321/auth/rand/login',
      })),
      openSignIn: vi.fn(async () => ({ ok: true as const, value: undefined })),
      showMainWindow: vi.fn(async () => ({ ok: true as const, value: undefined })),
      setBadge: vi.fn(),
      screenShare: false,
      appUrl: {
        addListener: vi.fn(async () => ({ remove: vi.fn() })),
        getLaunchUrl: vi.fn(async () => undefined),
      },
    },
    onShellEvent,
    unsubscribe,
    emit: (event) => listener?.(event),
  };
};

describe('nativeShell', () => {
  afterEach(() => {
    setDesktopBridge(undefined);
    delete document.documentElement.dataset.shell;
    document.documentElement.removeAttribute('data-fullscreen');
    vi.mocked(Capacitor.isNativePlatform).mockReset();
  });

  it('follows Capacitor when the desktop bridge is absent', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    expect(desktopBridge()).toBeUndefined();
    expect(isDesktopApp()).toBe(false);
    expect(isCapacitorApp()).toBe(false);
    expect(isBundledApp()).toBe(false);

    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    expect(isDesktopApp()).toBe(false);
    expect(isCapacitorApp()).toBe(true);
    expect(isBundledApp()).toBe(true);
  });

  it('propagates Capacitor detection errors from isCapacitorApp', () => {
    vi.mocked(Capacitor.isNativePlatform).mockImplementation(() => {
      throw new Error('capacitor failed');
    });

    expect(() => isCapacitorApp()).toThrow('capacitor failed');
  });

  it('treats the Electron bridge as a bundled desktop app while Capacitor reports web', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    const { bridge } = makeBridge();
    setDesktopBridge(bridge);

    expect(desktopBridge()).toBe(bridge);
    expect(isDesktopApp()).toBe(true);
    expect(isBundledApp()).toBe(true);
    expect(isCapacitorApp()).toBe(false);
  });

  it('marks the document shell, tracks fullscreen events, and stays idempotent', () => {
    markDesktopShell();
    expect(document.documentElement.dataset.shell).toBeUndefined();
    expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(false);

    const first = makeBridge();
    setDesktopBridge(first.bridge);

    markDesktopShell();
    markDesktopShell();
    expect(first.onShellEvent).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.shell).toBe('desktop');
    expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(false);

    first.emit({ type: 'fullscreen', value: true });
    expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(true);

    first.emit({ type: 'fullscreen', value: false });
    expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(false);

    const second = makeBridge();
    setDesktopBridge(second.bridge);
    markDesktopShell();
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(second.onShellEvent).toHaveBeenCalledTimes(1);
  });

  it('returns data-open-external props only inside the Electron desktop app', () => {
    expect(externalOpenProps('https://example.org')).toEqual({});
    setDesktopBridge(makeBridge().bridge);
    expect(externalOpenProps('https://example.org')).toEqual({
      'data-open-external': 'https://example.org',
    });
  });
});
