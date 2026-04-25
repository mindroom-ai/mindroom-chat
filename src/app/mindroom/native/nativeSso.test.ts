import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import {
  buildNativeSsoRedirectUrl,
  getAppPathFromNativeSsoUrl,
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
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

  it('opens the native SSO browser in fullscreen mode', async () => {
    vi.mocked(Browser.open).mockResolvedValue();

    await openNativeSsoBrowser('https://mindroom.chat/_matrix/client/v3/login/sso/redirect');

    expect(vi.mocked(Browser.open)).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
      presentationStyle: 'fullscreen',
    });
  });
});
