// @vitest-environment jsdom
import { Capacitor } from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppUpdate } from '../config/appUpdate';
import { NATIVE_UPDATE_POLL_MS, watchNativeUpdate } from './nativeUpdate';

const plugin = vi.hoisted(() => ({ status: vi.fn(), install: vi.fn() }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
    isPluginAvailable: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => plugin),
}));
vi.mock('../config/appUpdate', () => ({ setAppUpdate: vi.fn() }));

const setAvailable = (available: boolean) => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(available);
  vi.mocked(Capacitor.getPlatform).mockReturnValue(available ? 'ios' : 'web');
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(available);
};

const shown = (visible: boolean) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visible ? 'visible' : 'hidden',
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('watchNativeUpdate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks nothing without the plugin: a browser, iOS, the Quick Capture window', async () => {
    setAvailable(false);
    watchNativeUpdate()();
    await vi.advanceTimersByTimeAsync(NATIVE_UPDATE_POLL_MS);
    expect(plugin.status).not.toHaveBeenCalled();
    expect(setAppUpdate).not.toHaveBeenCalled();
  });

  it('takes an update that was staged before the page started', async () => {
    setAvailable(true);
    plugin.status.mockResolvedValue({ version: '2026.11.10' });
    const stop = watchNativeUpdate();
    await settle();
    expect(setAppUpdate).toHaveBeenLastCalledWith({
      version: '2026.11.10',
      install: expect.any(Function),
    });
    await vi.mocked(setAppUpdate).mock.lastCall![0]!.install();
    expect(plugin.install).toHaveBeenCalledOnce();
    stop();
  });

  it('follows staging and withdrawal while shown, rests while hidden, and stops', async () => {
    setAvailable(true);
    plugin.status.mockResolvedValue({});
    const stop = watchNativeUpdate();
    await settle();
    expect(setAppUpdate).toHaveBeenLastCalledWith(undefined);
    plugin.status.mockResolvedValue({ version: '2026.11.10' });
    await vi.advanceTimersByTimeAsync(NATIVE_UPDATE_POLL_MS);
    expect(setAppUpdate).toHaveBeenLastCalledWith({
      version: '2026.11.10',
      install: expect.any(Function),
    });
    // A failed question changes nothing.
    plugin.status.mockRejectedValue(new Error('bridge'));
    await vi.advanceTimersByTimeAsync(NATIVE_UPDATE_POLL_MS);
    expect(setAppUpdate).toHaveBeenCalledTimes(2);
    shown(false);
    plugin.status.mockResolvedValue({ version: '' });
    await vi.advanceTimersByTimeAsync(3 * NATIVE_UPDATE_POLL_MS);
    expect(plugin.status).toHaveBeenCalledTimes(3);
    shown(true);
    await settle();
    expect(setAppUpdate).toHaveBeenLastCalledWith(undefined);
    stop();
    await vi.advanceTimersByTimeAsync(NATIVE_UPDATE_POLL_MS);
    shown(true);
    expect(plugin.status).toHaveBeenCalledTimes(4);
  });
});
