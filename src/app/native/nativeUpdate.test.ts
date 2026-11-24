// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppUpdate } from '../config/appUpdate';
import type { DesktopShellEvent, DesktopUpdateBridge } from '../lib/desktopBridge';
import {
  checkNativeUpdate,
  isNativeUpdateAvailable,
  NATIVE_UPDATE_POLL_MS,
  watchNativeUpdate,
} from './nativeUpdate';

vi.mock('../config/appUpdate', () => ({ setAppUpdate: vi.fn() }));

const shown = (visible: boolean) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visible ? 'visible' : 'hidden',
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

const settle = () => vi.advanceTimersByTimeAsync(0);

const setDesktopUpdate = (
  update?: DesktopUpdateBridge,
  onShellEvent?: (listener: (event: DesktopShellEvent) => void) => () => void
) => {
  Object.defineProperty(window, 'mindroomDesktop', {
    configurable: true,
    value: { ...(update ? { update } : {}), ...(onShellEvent ? { onShellEvent } : {}) },
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
      check: vi.fn().mockResolvedValue({ outcome: 'found', version: '2026.11.10' }),
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
    const check = vi.fn().mockResolvedValue({ outcome: 'none' as const });
    const install = vi.fn().mockResolvedValue(undefined);
    setDesktopUpdate({ status, check, install });
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

  it('refreshes immediately on update-status shell events and unsubscribes on stop', async () => {
    let listener: ((event: DesktopShellEvent) => void) | undefined;
    const unsubscribe = vi.fn(() => {
      listener = undefined;
    });
    const status = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ version: '2026.11.12' });
    setDesktopUpdate(
      { status, check: vi.fn(), install: vi.fn().mockResolvedValue(undefined) },
      (next) => {
        listener = next;
        return unsubscribe;
      }
    );
    const stop = watchNativeUpdate();
    await settle();
    expect(status).toHaveBeenCalledTimes(1);

    listener?.({ type: 'window-hidden' });
    await settle();
    expect(status).toHaveBeenCalledTimes(1);

    listener?.({ type: 'update-status' });
    await settle();
    expect(status).toHaveBeenCalledTimes(2);
    expect(setAppUpdate).toHaveBeenLastCalledWith({
      version: '2026.11.12',
      install: expect.any(Function),
    });

    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('checkNativeUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'mindroomDesktop');
  });

  it('returns error without touching appUpdate when no bridge exists', async () => {
    await expect(checkNativeUpdate()).resolves.toEqual({ outcome: 'error' });
    expect(setAppUpdate).not.toHaveBeenCalled();
  });

  it('syncs staged versions on none/found outcomes and leaves state alone on errors', async () => {
    const check = vi.fn();
    const install = vi.fn().mockResolvedValue(undefined);
    setDesktopUpdate({ status: vi.fn(), check, install });

    check.mockResolvedValueOnce({ outcome: 'none' });
    await expect(checkNativeUpdate()).resolves.toEqual({ outcome: 'none' });
    expect(setAppUpdate).toHaveBeenLastCalledWith(undefined);

    check.mockResolvedValueOnce({ outcome: 'found' });
    await expect(checkNativeUpdate()).resolves.toEqual({ outcome: 'found' });
    expect(setAppUpdate).toHaveBeenLastCalledWith(undefined);

    check.mockResolvedValueOnce({ outcome: 'found', version: '2026.11.15' });
    await expect(checkNativeUpdate()).resolves.toEqual({ outcome: 'found', version: '2026.11.15' });
    expect(setAppUpdate).toHaveBeenLastCalledWith({
      version: '2026.11.15',
      install: expect.any(Function),
    });
    await vi.mocked(setAppUpdate).mock.lastCall![0]!.install();
    expect(install).toHaveBeenCalledOnce();

    const callsBeforeError = vi.mocked(setAppUpdate).mock.calls.length;
    check.mockResolvedValueOnce({ outcome: 'error' });
    await expect(checkNativeUpdate()).resolves.toEqual({ outcome: 'error' });
    check.mockRejectedValueOnce(new Error('ipc failed'));
    await expect(checkNativeUpdate()).resolves.toEqual({ outcome: 'error' });
    expect(setAppUpdate).toHaveBeenCalledTimes(callsBeforeError);
  });
});
