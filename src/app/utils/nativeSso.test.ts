import { describe, expect, it } from 'vitest';
import { buildNativeSsoRedirectUrl, getAppPathFromNativeSsoUrl } from './nativeSso';

describe('nativeSso', () => {
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

  it('ignores non-native callback urls', () => {
    expect(getAppPathFromNativeSsoUrl('https://mindroom.chat/login/mindroom.chat')).toBeUndefined();
  });
});
