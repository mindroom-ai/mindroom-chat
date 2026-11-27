/* eslint-disable no-console */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCacheHealth,
  isCacheWritable,
  reportCacheWriteError,
  resetCacheHealthForTesting,
  subscribeCacheReadOnly,
} from './cacheHealth';
import { getCacheProbeSnapshot, resetCacheProbe } from './cacheProbe';

// ISSUE-207 P1.5 (finding F4, AC11): write failures are counted and
// surfaced; a quota error degrades the session to cache-read-only.
describe('cacheHealth (ISSUE-207 P1.5)', () => {
  beforeEach(() => {
    resetCacheHealthForTesting();
    resetCacheProbe();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetCacheHealthForTesting();
    vi.restoreAllMocks();
  });

  it('counts every failure and logs only the first per scope', () => {
    reportCacheWriteError('threadEventCache.save', new Error('boom'));
    reportCacheWriteError('threadEventCache.save', new Error('boom again'));
    reportCacheWriteError('roomEventCache.save', new Error('other scope'));

    expect(getCacheProbeSnapshot().writeErrors).toBe(3);
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(isCacheWritable()).toBe(true);
    expect(getCacheHealth()).toEqual({ state: 'healthy' });
  });

  it('degrades to read-only on QuotaExceededError with a one-time error log', () => {
    const quotaError = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });

    reportCacheWriteError('threadEventCache.save', quotaError);

    expect(isCacheWritable()).toBe(false);
    expect(getCacheHealth()).toEqual({
      state: 'read-only',
      reason: 'QuotaExceededError in threadEventCache.save',
    });
    expect(console.error).toHaveBeenCalledTimes(1);

    // A second quota error does not re-log or change the recorded reason.
    reportCacheWriteError('roomEventCache.save', quotaError);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(getCacheHealth().reason).toBe('QuotaExceededError in threadEventCache.save');
  });

  it('stays healthy on non-quota failures', () => {
    reportCacheWriteError('threadEventCache.save', new Error('transient'));
    expect(isCacheWritable()).toBe(true);
  });

  // Review follow-up: wrapped/re-thrown storage errors may carry only the
  // legacy DOMException code or a quota mention in the message.
  it('detects legacy code-22 and wrapped quota-message errors', () => {
    reportCacheWriteError('threadEventCache.save', Object.assign(new Error('db'), { code: 22 }));
    expect(isCacheWritable()).toBe(false);

    resetCacheHealthForTesting();
    reportCacheWriteError(
      'roomEventCache.save',
      new Error('IDB put failed: exceeded storage quota for origin')
    );
    expect(isCacheWritable()).toBe(false);
  });

  it('degrades to read-only on VersionError and notifies subscribers once', () => {
    const onReadOnly = vi.fn();
    const unsubscribe = subscribeCacheReadOnly(onReadOnly);
    const versionError = Object.assign(new Error('newer db'), { name: 'VersionError' });

    reportCacheWriteError('gap.mark', versionError);
    reportCacheWriteError('roomEventCache.save', versionError);

    expect(isCacheWritable()).toBe(false);
    expect(getCacheHealth()).toEqual({ state: 'read-only', reason: 'VersionError in gap.mark' });
    expect(onReadOnly).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
