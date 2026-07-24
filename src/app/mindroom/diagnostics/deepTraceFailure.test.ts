// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openDB: vi.fn(),
}));

vi.mock('idb', async () => {
  const actual = await vi.importActual<typeof import('idb')>('idb');
  return {
    ...actual,
    openDB: mocks.openDB,
  };
});

describe('deep diagnostic trace storage failure', () => {
  let trace: typeof import('./deepTrace');

  beforeEach(async () => {
    vi.resetModules();
    const actual = await vi.importActual<typeof import('idb')>('idb');
    mocks.openDB.mockReset().mockImplementation(actual.openDB);
    trace = await import('./deepTrace');
  });

  it('fails enable closed and recovers from a transient IndexedDB open failure', async () => {
    mocks.openDB.mockRejectedValueOnce(new Error('IndexedDB open blocked'));
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);
    const statuses: string[] = [];
    const unsubscribe = trace.subscribeDeepTraceStatus((status) => statuses.push(status));

    expect(await trace.setDeepTraceEnabled(true, storage)).toBe(false);
    expect(storage.getItem(trace.DEEP_TRACE_ENABLED_KEY)).toBeNull();
    expect(trace.getDeepTraceRuntimeStatus()).toBe('unavailable');
    expect(statuses).toEqual(expect.arrayContaining(['starting', 'unavailable']));

    const openAttempts = mocks.openDB.mock.calls.length;
    expect(await trace.setDeepTraceEnabled(false, storage)).toBe(true);
    await Promise.resolve();
    expect(trace.getDeepTraceRuntimeStatus()).toBe('disabled');
    expect(statuses.at(-1)).toBe('disabled');
    expect(mocks.openDB).toHaveBeenCalledTimes(openAttempts);

    expect(await trace.setDeepTraceEnabled(true, storage)).toBe(true);
    expect(storage.getItem(trace.DEEP_TRACE_ENABLED_KEY)).toBe('1');
    expect(trace.getDeepTraceRuntimeStatus()).toBe('recording');

    unsubscribe();
    await trace.setDeepTraceEnabled(false, storage);
    dispose();
  });

  it('ignores an old open failure after disable and re-enable', async () => {
    let rejectOpen: ((reason: Error) => void) | undefined;
    const delayedOpen = new Promise<never>((_resolve, reject) => {
      rejectOpen = reject;
    });
    mocks.openDB.mockReturnValueOnce(delayedOpen);
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);
    const statuses: string[] = [];
    const unsubscribe = trace.subscribeDeepTraceStatus((status) => statuses.push(status));

    const firstEnable = trace.setDeepTraceEnabled(true, storage);
    await vi.waitFor(() => expect(mocks.openDB).toHaveBeenCalledTimes(1));
    const disable = trace.setDeepTraceEnabled(false, storage);
    const secondEnable = trace.setDeepTraceEnabled(true, storage);
    rejectOpen?.(new Error('Old IndexedDB open failed'));

    expect(await firstEnable).toBe(false);
    expect(await disable).toBe(true);
    expect(await secondEnable).toBe(true);
    expect(trace.getDeepTraceRuntimeStatus()).toBe('recording');
    expect(storage.getItem(trace.DEEP_TRACE_ENABLED_KEY)).toBe('1');
    expect(statuses).not.toContain('unavailable');

    unsubscribe();
    await trace.setDeepTraceEnabled(false, storage);
    dispose();
  });
});
