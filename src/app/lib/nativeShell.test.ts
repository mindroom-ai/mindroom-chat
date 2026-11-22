// @vitest-environment jsdom
import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopShellEvent } from './desktopBridge';
import {
  desktopBridge,
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

const makeBridge = (): {
  bridge: DesktopBridge;
  emit: (event: DesktopShellEvent) => void;
} => {
  let listener: ((event: DesktopShellEvent) => void) | undefined;
  return {
    bridge: {
      onShellEvent: (next) => {
        listener = next;
        return () => {
          if (listener === next) listener = undefined;
        };
      },
    },
    emit: (event) => listener?.(event),
  };
};

describe('nativeShell', () => {
  afterEach(() => {
    delete window.mindroomDesktop;
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

  it('treats the Electron bridge as a bundled desktop app while Capacitor reports web', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    const { bridge } = makeBridge();
    window.mindroomDesktop = bridge;

    expect(desktopBridge()).toBe(bridge);
    expect(isDesktopApp()).toBe(true);
    expect(isBundledApp()).toBe(true);
    expect(isCapacitorApp()).toBe(false);
  });

  it('marks the document shell and tracks fullscreen events in the desktop app', () => {
    markDesktopShell();
    expect(document.documentElement.dataset.shell).toBeUndefined();
    expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(false);

    const { bridge, emit } = makeBridge();
    window.mindroomDesktop = bridge;

    markDesktopShell();
    expect(document.documentElement.dataset.shell).toBe('desktop');
    expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(false);

    emit({ type: 'fullscreen', value: true });
    expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(true);

    emit({ type: 'fullscreen', value: false });
    expect(document.documentElement.hasAttribute('data-fullscreen')).toBe(false);
  });
});
