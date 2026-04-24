import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import {
  buildNativeSsoRedirectUrl,
  getAppPathFromNativeSsoUrl,
  isIOSStandaloneWebApp,
  isNativeIOS,
  openNativeSsoBrowser,
} from './nativeSso';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
    getPlatform: vi.fn(),
  },
}));

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn(),
  },
}));

describe('nativeSso', () => {
  const originalWindow = globalThis.window;

  const setWindow = (navigatorOverrides: Record<string, unknown>, standalone = false) => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        matchMedia: vi.fn(() => ({ matches: standalone })),
        navigator: {
          maxTouchPoints: 0,
          platform: 'MacIntel',
          standalone: false,
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4)',
          ...navigatorOverrides,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Capacitor.isNativePlatform).mockReset();
    vi.mocked(Capacitor.getPlatform).mockReset();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('builds native redirect url from web redirect url', () => {
    expect(buildNativeSsoRedirectUrl('https://mindroom.chat/login/mindroom.chat')).toBe(
      'mindroom://auth/login/mindroom.chat'
    );
  });

  it('extracts app path from native callback url', () => {
    expect(
      getAppPathFromNativeSsoUrl('mindroom://auth/login/mindroom.chat?loginToken=abc123')
    ).toBe('/login/mindroom.chat?loginToken=abc123');
  });

  it('extracts app path from hostless native callback url', () => {
    expect(
      getAppPathFromNativeSsoUrl('mindroom:/auth/login/mindroom.chat?loginToken=abc123')
    ).toBe('/login/mindroom.chat?loginToken=abc123');
  });

  it('extracts app path from triple-slash hostless native callback url', () => {
    expect(
      getAppPathFromNativeSsoUrl('mindroom:///auth/login/mindroom.chat?loginToken=abc123')
    ).toBe('/login/mindroom.chat?loginToken=abc123');
  });

  it('extracts app path from compact hostless native callback url', () => {
    expect(
      getAppPathFromNativeSsoUrl('mindroom:auth/login/mindroom.chat?loginToken=abc123')
    ).toBe('/login/mindroom.chat?loginToken=abc123');
  });

  it('normalizes extra slashes in native callback path', () => {
    expect(
      getAppPathFromNativeSsoUrl('mindroom://auth//login//mindroom.chat?loginToken=abc123')
    ).toBe('/login/mindroom.chat?loginToken=abc123');
  });

  it('ignores non-native callback urls', () => {
    expect(getAppPathFromNativeSsoUrl('https://mindroom.chat/login/mindroom.chat')).toBeUndefined();
  });

  it('ignores native callback urls with unsupported host', () => {
    expect(getAppPathFromNativeSsoUrl('mindroom://wrong/login/mindroom.chat')).toBeUndefined();
  });

  it('detects native iOS platform', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');

    expect(isNativeIOS()).toBe(true);
  });

  it('detects iOS standalone web apps from display mode and navigator.standalone', () => {
    setWindow(
      {
        maxTouchPoints: 5,
        platform: 'iPhone',
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      },
      true
    );
    expect(isIOSStandaloneWebApp()).toBe(true);

    setWindow({
      maxTouchPoints: 5,
      platform: 'iPhone',
      standalone: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    });
    expect(isIOSStandaloneWebApp()).toBe(true);
  });

  it('ignores desktop standalone mode and native iOS wrappers', () => {
    setWindow({}, true);
    expect(isIOSStandaloneWebApp()).toBe(false);

    setWindow({
      maxTouchPoints: 5,
      platform: 'iPhone',
      standalone: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    });
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    expect(isIOSStandaloneWebApp()).toBe(false);
  });

  it('opens the native SSO browser in fullscreen mode', async () => {
    vi.mocked(Browser.open).mockResolvedValue();

    await openNativeSsoBrowser('https://mindroom.chat/_matrix/client/v3/login/sso/redirect');

    expect(vi.mocked(Browser.open)).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
      presentationStyle: 'fullscreen',
    });
  });
});
