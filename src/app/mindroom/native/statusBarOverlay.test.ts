import { StatusBar } from '@capacitor/status-bar';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isNativeIOS } from './nativeSso';

vi.mock('@capacitor/status-bar', () => ({
  StatusBar: {
    setOverlaysWebView: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./nativeSso', () => ({
  isNativeIOS: vi.fn(),
}));

const loadStatusBarOverlay = async () => {
  vi.resetModules();
  return import('./statusBarOverlay');
};

describe('statusBarOverlay', () => {
  beforeEach(() => {
    vi.mocked(isNativeIOS).mockReset();
    vi.mocked(StatusBar.setOverlaysWebView).mockReset();
    vi.mocked(StatusBar.setOverlaysWebView).mockResolvedValue(undefined);
  });

  it('does nothing outside the native iOS wrapper', async () => {
    vi.mocked(isNativeIOS).mockReturnValue(false);
    const { acquireSplashOverlay, releaseSplashOverlay } = await loadStatusBarOverlay();

    acquireSplashOverlay();
    releaseSplashOverlay();

    expect(StatusBar.setOverlaysWebView).not.toHaveBeenCalled();
  });

  it('toggles the overlay for a balanced acquire and release', async () => {
    vi.mocked(isNativeIOS).mockReturnValue(true);
    const { acquireSplashOverlay, releaseSplashOverlay } = await loadStatusBarOverlay();

    acquireSplashOverlay();
    releaseSplashOverlay();

    expect(StatusBar.setOverlaysWebView).toHaveBeenNthCalledWith(1, { overlay: true });
    expect(StatusBar.setOverlaysWebView).toHaveBeenNthCalledWith(2, { overlay: false });
  });

  it('only toggles the plugin at the outermost nested acquire and release', async () => {
    vi.mocked(isNativeIOS).mockReturnValue(true);
    const { acquireSplashOverlay, releaseSplashOverlay } = await loadStatusBarOverlay();

    acquireSplashOverlay();
    acquireSplashOverlay();
    releaseSplashOverlay();

    expect(StatusBar.setOverlaysWebView).toHaveBeenCalledTimes(1);
    expect(StatusBar.setOverlaysWebView).toHaveBeenLastCalledWith({ overlay: true });

    releaseSplashOverlay();

    expect(StatusBar.setOverlaysWebView).toHaveBeenCalledTimes(2);
    expect(StatusBar.setOverlaysWebView).toHaveBeenLastCalledWith({ overlay: false });
  });

  it('treats release without acquire as a no-op', async () => {
    vi.mocked(isNativeIOS).mockReturnValue(true);
    const { releaseSplashOverlay } = await loadStatusBarOverlay();

    releaseSplashOverlay();

    expect(StatusBar.setOverlaysWebView).not.toHaveBeenCalled();
  });

  it('swallows rejected plugin promises', async () => {
    vi.mocked(isNativeIOS).mockReturnValue(true);
    vi.mocked(StatusBar.setOverlaysWebView).mockRejectedValue(new Error('plugin unavailable'));
    const { acquireSplashOverlay, releaseSplashOverlay } = await loadStatusBarOverlay();

    expect(() => acquireSplashOverlay()).not.toThrow();
    expect(() => releaseSplashOverlay()).not.toThrow();
  });
});
