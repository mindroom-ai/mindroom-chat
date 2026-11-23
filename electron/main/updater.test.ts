import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startUpdater, UPDATE_CHECK_INTERVAL_MS, type AutoUpdaterLike } from './updater';

class FakeAutoUpdater extends EventEmitter implements AutoUpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checkForUpdates = vi.fn<AutoUpdaterLike['checkForUpdates']>(() => Promise.resolve(null));
  quitAndInstall = vi.fn<AutoUpdaterLike['quitAndInstall']>();
}

describe('startUpdater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enables autoDownload/autoInstallOnAppQuit, stages downloaded version, and notifies onChange', () => {
    const fake = new FakeAutoUpdater();
    const onChange = vi.fn();
    const handle = startUpdater(fake, onChange, { logError: vi.fn() });

    expect(fake.autoDownload).toBe(true);
    expect(fake.autoInstallOnAppQuit).toBe(true);
    expect(handle.readyVersion()).toBeUndefined();

    fake.emit('update-downloaded', { version: '   ' });
    expect(handle.readyVersion()).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();

    fake.emit('update-downloaded', { version: '2026.11.10' });
    expect(handle.readyVersion()).toBe('2026.11.10');
    expect(onChange).toHaveBeenCalledTimes(1);

    fake.emit('update-downloaded', { version: '2026.11.10' });
    expect(onChange).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('clears readyVersion on error after update-downloaded, notifies onChange, and lets the next check() retry', async () => {
    const fake = new FakeAutoUpdater();
    const logError = vi.fn();
    const seenVersions: Array<string | undefined> = [];
    const onChange = vi.fn(() => {
      seenVersions.push(handle.readyVersion());
    });
    const handle = startUpdater(fake, onChange, { logError });
    await vi.advanceTimersByTimeAsync(0);

    const err1 = new Error('network');
    fake.emit('error', err1);
    expect(logError).toHaveBeenCalledWith(err1);
    expect(handle.readyVersion()).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();

    fake.emit('update-downloaded', { version: '2026.11.10' });
    expect(handle.readyVersion()).toBe('2026.11.10');
    expect(onChange).toHaveBeenCalledTimes(1);

    const stagingErr = new Error('squirrel staging failed');
    fake.emit('error', stagingErr);
    expect(logError).toHaveBeenCalledWith(stagingErr);
    expect(handle.readyVersion()).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(seenVersions).toEqual(['2026.11.10', undefined]);

    // After staging error clears stagedVersion, check() retries cleanly instead of short-circuiting.
    const callsBeforeRetry = fake.checkForUpdates.mock.calls.length;
    fake.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: true });
    await expect(handle.check()).resolves.toBe('found');
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(callsBeforeRetry + 1);
    handle.stop();
  });

  it('returns none, found, and error from check(), deduplicates concurrent checks, and swallows downloadPromise rejection', async () => {
    const fake = new FakeAutoUpdater();
    let resolveCheck!: (
      val: { isUpdateAvailable?: boolean; downloadPromise?: Promise<unknown> } | null
    ) => void;
    fake.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve;
        })
    );
    const logError = vi.fn();
    const handle = startUpdater(fake, vi.fn(), { logError });

    // Initial check is in flight; concurrent check() shares the same call.
    const concurrent = handle.check();
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
    resolveCheck({ isUpdateAvailable: false });
    await expect(concurrent).resolves.toBe('none');

    // Found with a rejected downloadPromise causes no unhandled rejection.
    fake.checkForUpdates.mockResolvedValueOnce({
      isUpdateAvailable: true,
      downloadPromise: Promise.reject(new Error('dl fail')),
    });
    await expect(handle.check()).resolves.toBe('found');

    // Null result maps to 'none'.
    fake.checkForUpdates.mockResolvedValueOnce(null);
    await expect(handle.check()).resolves.toBe('none');

    // Error via rejection.
    fake.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    await expect(handle.check()).resolves.toBe('error');
    expect(logError).toHaveBeenCalledTimes(1);

    // Once staged, check() returns 'found' immediately without re-checking.
    fake.emit('update-downloaded', { version: '2026.11.10' });
    const before = fake.checkForUpdates.mock.calls.length;
    await expect(handle.check()).resolves.toBe('found');
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(before);
    handle.stop();
  });

  it('install() is a no-op until staged, then runs onBeforeInstall before quitAndInstall', () => {
    const fake = new FakeAutoUpdater();
    const order: string[] = [];
    fake.quitAndInstall.mockImplementation(() => order.push('quitAndInstall'));
    const handle = startUpdater(fake, vi.fn(), {
      onBeforeInstall: () => order.push('onBeforeInstall'),
      logError: vi.fn(),
    });

    handle.install();
    expect(order).toEqual([]);

    fake.emit('update-downloaded', { version: '2026.11.10' });
    handle.install();
    expect(order).toEqual(['onBeforeInstall', 'quitAndInstall']);
    handle.stop();
  });

  it('checks on the hourly interval and stop() clears timer and listeners', async () => {
    const fake = new FakeAutoUpdater();
    const onChange = vi.fn();
    const handle = startUpdater(fake, onChange, { logError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);

    handle.stop();
    expect(fake.listenerCount('update-downloaded')).toBe(0);
    expect(fake.listenerCount('error')).toBe(0);

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);
    fake.emit('update-downloaded', { version: '2026.11.11' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
