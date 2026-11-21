import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { isNativeCallAvailable, nativeCallErrorCode } from './nativeCall';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => true),
    getPlatform: vi.fn(() => 'ios'),
    isPluginAvailable: vi.fn(() => true),
  },
  registerPlugin: vi.fn(() => ({})),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
});

describe('nativeCall', () => {
  it('is available only in the iOS shell with the plugin registered', () => {
    expect(isNativeCallAvailable()).toBe(true);
    expect(Capacitor.isPluginAvailable).toHaveBeenCalledWith('MindRoomCall');

    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    expect(isNativeCallAvailable()).toBe(false);

    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    expect(isNativeCallAvailable()).toBe(false);

    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    expect(isNativeCallAvailable()).toBe(false);
  });

  it('reads the code of a plugin rejection', () => {
    expect(nativeCallErrorCode({ code: 'NOT_CONNECTED' })).toBe('NOT_CONNECTED');
    expect(nativeCallErrorCode(new Error('x'))).toBeUndefined();
    expect(nativeCallErrorCode(undefined)).toBeUndefined();
  });
});
