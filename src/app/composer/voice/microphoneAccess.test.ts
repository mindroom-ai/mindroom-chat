import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMicrophoneAccessErrorMessage } from './microphoneAccess';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(),
    isNativePlatform: vi.fn(),
  },
}));

const device = (userAgent: string, platform: string, maxTouchPoints: number) =>
  vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints });

afterEach(() => vi.unstubAllGlobals());

describe('getMicrophoneAccessErrorMessage', () => {
  it('gives iOS users actionable recovery instructions when access is denied', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    device('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5);

    expect(
      getMicrophoneAccessErrorMessage(new DOMException('denied', 'NotAllowedError'))
    ).toContain('Allow microphone access for MindRoom in iPhone settings');
  });

  it('sends Mac app users to the system settings, not to iPhone settings', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    device('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0);
    expect(getMicrophoneAccessErrorMessage({ name: 'NotAllowedError' })).toBe(
      'Microphone access is blocked. Allow microphone access for this site/app in your browser or system settings and try again.'
    );
  });

  it('maps standard media errors from another realm without relying on DOMException', () => {
    expect(
      getMicrophoneAccessErrorMessage({ name: 'NotFoundError', message: 'foreign realm error' })
    ).toBe('No microphone was found on this device.');
    expect(
      getMicrophoneAccessErrorMessage({ name: 'NotReadableError', message: 'foreign realm error' })
    ).toBe('Microphone is unavailable right now (it may be in use by another app).');
  });
});
