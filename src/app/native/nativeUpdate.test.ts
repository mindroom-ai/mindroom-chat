// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppUpdate } from '../config/appUpdate';
import type { DesktopUpdateBridge } from '../lib/desktopBridge';
import { isNativeUpdateAvailable, NATIVE_UPDATE_POLL_MS, watchNativeUpdate } from './nativeUpdate';

vi.mock('../config/appUpdate', () => ({ setAppUpdate: vi.fn() }));

const shown = (visible: boolean) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visible ? 'visible' : 'hidden',
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

const settle = () => vi.advanceTimersByTimeAsync(0);

const setDesktopUpdate = (update?: DesktopUpdateBridge) => {
  Object.defineProperty(window, 'mindroomDesktop', {
    configurable: true,
    value: update ? { update } : {},
  });
};

describe('watchNativeUpdate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'mindroomDesktop');
    vi.useRealTimers();
  });

  it('asks nothing without the desktop update bridge: a browser, iOS, or Quick Capture window', async () => {
    expect(isNativeUpdateAvailable()).toBe(false);
    watchNativeUpdate()();
    await vi.advanceTimersByTimeAsync(NATIVE_UPDATE_POLL_MS);
    expect(setAppUpdate).not.toHaveBeenCalled();

    setDesktopUpdate(undefined);
    expect(isNativeUpdateAvailable()).toBe(false);
    watchNativeUpdate()();
    await settle();
    expect(setAppUpdate).not.toHaveBeenCalled();
  });

  it('takes an update that was staged before the page started', async () => {
    const desktopUpdate: DesktopUpdateBridge = {
      status: vi.fn().mockResolvedValue({ version: '2026.11.10' }),
      install: vi.fn().mockResolvedValue(undefined),
    };
    setDesktopUpdate(desktopUpdate);
    expect(isNativeUpdateAvailable()).toBe(true);
    const stop = watchNativeUpdate();
    await settle();
    expect(setAppUpdate).toHaveBeenLastCalledWith({
      version: '2026.11.10',
      install: expect.any(Function),
    });
    await vi.mocked(setAppUpdate).mock.lastCall![0]!.install();
    expect(desktopUpdate.install).toHaveBeenCalledOnce();
    stop();
  });

  it('follows staging and withdrawal while shown, rests while hidden, and stops', async () => {
    const status = vi.fn().mockResolvedValue({});
    const install = vi.fn().mockResolvedValue(undefined);
    setDesktopUpdate({ status, install });
    const stop = watchNativeUpdate();
    await settle();
    expect(setAppUpdate).toHaveBeenLastCalledWith(undefined);
    status.mockResolvedValue({ version: '2026.11.10' });
    await vi.advanceTimersByTimeAsync(NATIVE_UPDATE_POLL_MS);
    expect(setAppUpdate).toHaveBeenLastCalledWith({
      version: '2026.11.10',
      install: expect.any(Function),
    });
    // A failed question changes nothing.
    status.mockRejectedValue(new Error('bridge'));
    await vi.advanceTimersByTimeAsync(NATIVE_UPDATE_POLL_MS);
    expect(setAppUpdate).toHaveBeenCalledTimes(2);
    shown(false);
    status.mockResolvedValue({ version: '' });
    await vi.advanceTimersByTimeAsync(3 * NATIVE_UPDATE_POLL_MS);
    expect(status).toHaveBeenCalledTimes(3);
    shown(true);
    await settle();
    expect(setAppUpdate).toHaveBeenLastCalledWith(undefined);
    stop();
    await vi.advanceTimersByTimeAsync(NATIVE_UPDATE_POLL_MS);
    shown(true);
    expect(status).toHaveBeenCalledTimes(4);
  });
});
