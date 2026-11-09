import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAuthSsoRedirectUrl, getDeviceDisplayName } from './authUi';

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
    getPlatform: vi.fn(),
  },
}));

describe('authUi', () => {
  it('uses web SSO redirects outside native apps', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');

    expect(getAuthSsoRedirectUrl('https://chat.example/login?addAccount=1')).toBe(
      'https://chat.example/login?addAccount=1'
    );
  });

  it('uses the native redirect scheme inside native Android', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');

    expect(getAuthSsoRedirectUrl('https://chat.example/login?addAccount=1')).toBe(
      'mindroom://auth/login?addAccount=1'
    );
  });

  it('uses the native iOS redirect scheme inside native iOS', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');

    expect(getAuthSsoRedirectUrl('https://chat.example/login?addAccount=1')).toBe(
      'mindroom://auth/login?addAccount=1'
    );
  });

  describe('getDeviceDisplayName', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const IPHONE_SAFARI =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1';
    const IPHONE_APP =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    const ANDROID_APP =
      'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36';
    const MAC_APP =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

    it.each([
      ['a browser, even on an iPhone', 'web', IPHONE_SAFARI, 'iPhone', 5, 'MindRoom Web'],
      ['the iOS app', 'ios', IPHONE_APP, 'iPhone', 5, 'MindRoom iOS'],
      ['the Android app', 'android', ANDROID_APP, 'Linux aarch64', 5, 'MindRoom Android'],
      ['the Mac app', 'ios', MAC_APP, 'MacIntel', 0, 'MindRoom macOS'],
    ])(
      'names a session of %s by its platform',
      (_, platform, userAgent, navPlatform, touch, name) => {
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(platform !== 'web');
        vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
        vi.stubGlobal('navigator', { userAgent, platform: navPlatform, maxTouchPoints: touch });

        expect(getDeviceDisplayName()).toBe(name);
      }
    );
  });
});
