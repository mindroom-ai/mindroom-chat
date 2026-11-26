import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

import { isNativeAndroid, isNativeIOS } from '../native/nativeSso';
import { syncNativeStatusBarTheme } from './statusBarTheme';

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  SystemBars: {
    setStyle: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@capacitor/status-bar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/status-bar')>()),
  StatusBar: {
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
    setOverlaysWebView: vi.fn().mockResolvedValue(undefined),
    setStyle: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../native/nativeSso', () => ({
  isNativeAndroid: vi.fn(),
  isNativeIOS: vi.fn(),
}));

describe('syncNativeStatusBarTheme', () => {
  beforeEach(() => {
    vi.mocked(isNativeAndroid).mockReset().mockReturnValue(false);
    vi.mocked(isNativeIOS).mockReset().mockReturnValue(false);
    vi.clearAllMocks();
  });

  it.each([
    ['light', Style.Light],
    ['dark', Style.Dark],
  ] as const)(
    'uses %s theme status icons on iOS without changing native webview geometry',
    (scheme, style) => {
      vi.mocked(isNativeIOS).mockReturnValue(true);

      syncNativeStatusBarTheme(scheme);

      expect(SystemBars.setStyle).not.toHaveBeenCalled();
      expect(StatusBar.setOverlaysWebView).not.toHaveBeenCalled();
      expect(StatusBar.setStyle).toHaveBeenCalledWith({ style });
      expect(StatusBar.setBackgroundColor).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['light', SystemBarsStyle.Light, Style.Light, '#FFFFFF'],
    ['dark', SystemBarsStyle.Dark, Style.Dark, '#1A1A1A'],
  ] as const)(
    'syncs SystemBars and StatusBar %s theme on Android',
    (scheme, systemBarsStyle, statusBarStyle, color) => {
      vi.mocked(isNativeAndroid).mockReturnValue(true);

      syncNativeStatusBarTheme(scheme);

      expect(SystemBars.setStyle).toHaveBeenCalledWith({
        style: systemBarsStyle,
        bar: SystemBarType.StatusBar,
      });
      expect(StatusBar.setStyle).toHaveBeenCalledWith({ style: statusBarStyle });
      expect(StatusBar.setBackgroundColor).toHaveBeenCalledWith({ color });
      expect(StatusBar.setOverlaysWebView).not.toHaveBeenCalled();
    }
  );

  it('ignores Android setBackgroundColor rejections silently on edge-to-edge API 35+', async () => {
    vi.mocked(isNativeAndroid).mockReturnValue(true);
    vi.mocked(StatusBar.setBackgroundColor).mockRejectedValueOnce(new Error('unsupported'));

    expect(() => syncNativeStatusBarTheme('dark')).not.toThrow();
    await Promise.resolve();
    expect(SystemBars.setStyle).toHaveBeenCalledWith({
      style: SystemBarsStyle.Dark,
      bar: SystemBarType.StatusBar,
    });
  });

  it('does nothing outside the native iOS and Android wrappers', () => {
    syncNativeStatusBarTheme('light');

    expect(SystemBars.setStyle).not.toHaveBeenCalled();
    expect(StatusBar.setOverlaysWebView).not.toHaveBeenCalled();
    expect(StatusBar.setStyle).not.toHaveBeenCalled();
    expect(StatusBar.setBackgroundColor).not.toHaveBeenCalled();
  });
});
