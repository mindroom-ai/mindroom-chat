// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '../lib/desktopBridge';
import { browserSharesScreens } from './callSupport';

const makeBridge = (screenShare: boolean): DesktopBridge => ({
  onShellEvent: vi.fn(() => () => undefined),
  setMediaSession: vi.fn(() => ({ ok: true as const, value: undefined })),
  startSignIn: vi.fn(async () => ({ ok: true as const, value: '' })),
  openSignIn: vi.fn(async () => ({ ok: true as const, value: undefined })),
  showMainWindow: vi.fn(async () => ({ ok: true as const, value: undefined })),
  screenShare,
  appUrl: {
    addListener: vi.fn(async () => undefined),
    getLaunchUrl: vi.fn(async () => undefined),
  },
});

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

const setGetDisplayMedia = (fn: (() => Promise<MediaStream>) | undefined): void => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: fn ? { getDisplayMedia: fn } : {},
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'mindroomDesktop');
  if (originalMediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, 'mediaDevices');
  }
  vi.restoreAllMocks();
});

describe('browserSharesScreens', () => {
  it('follows navigator.mediaDevices.getDisplayMedia when no desktop bridge is present', () => {
    setGetDisplayMedia(vi.fn());
    expect(browserSharesScreens()).toBe(true);

    setGetDisplayMedia(undefined);
    expect(browserSharesScreens()).toBe(false);
  });

  it('returns true when desktop bridge screenShare is true and getDisplayMedia exists', () => {
    setGetDisplayMedia(vi.fn());
    Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: makeBridge(true) });
    expect(browserSharesScreens()).toBe(true);

    setGetDisplayMedia(undefined);
    expect(browserSharesScreens()).toBe(false);
  });

  it('returns false when desktop bridge screenShare is false even if getDisplayMedia exists', () => {
    setGetDisplayMedia(vi.fn());
    Object.defineProperty(window, 'mindroomDesktop', { configurable: true, value: makeBridge(false) });
    expect(browserSharesScreens()).toBe(false);
  });
});
