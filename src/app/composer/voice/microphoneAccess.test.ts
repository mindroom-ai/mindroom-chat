import { Capacitor } from '@capacitor/core';
import { describe, expect, it, vi } from 'vitest';
import { getMicrophoneAccessErrorMessage } from './microphoneAccess';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(),
    isNativePlatform: vi.fn(),
  },
}));

describe('getMicrophoneAccessErrorMessage', () => {
  it('gives iOS users actionable recovery instructions when access is denied', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');

    expect(
      getMicrophoneAccessErrorMessage(new DOMException('denied', 'NotAllowedError'))
    ).toContain('Allow microphone access for MindRoom in iPhone settings');
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
