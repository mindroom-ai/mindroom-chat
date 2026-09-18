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
    expect(storage.getItem(trace.DEEP_TRACE_ENABLED_KEY)).toBe('1');
    expect(trace.getDeepTraceRuntimeStatus()).toBe('unavailable');
    expect(statuses).toEqual(expect.arrayContaining(['starting', 'unavailable']));
    expect(await trace.readDeepTraceSnapshot()).toMatchObject({
      enabled: true,
      status: 'unavailable',
    });

    dispose();
    const restartedDispose = trace.initializeDeepTraceRecorder(storage);
    await vi.waitFor(() => expect(trace.getDeepTraceRuntimeStatus()).toBe('recording'));
    expect(storage.getItem(trace.DEEP_TRACE_ENABLED_KEY)).toBe('1');

    unsubscribe();
    await trace.setDeepTraceEnabled(false, storage);
    restartedDispose();
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
    expect(trace.getDeepTraceHealthSnapshot().lastFailure).toBeNull();
    expect(storage.getItem(trace.DEEP_TRACE_ENABLED_KEY)).toBe('1');
    expect(statuses).not.toContain('unavailable');

    unsubscribe();
    await trace.setDeepTraceEnabled(false, storage);
    dispose();
  });

  it('retains a sanitized flush failure through recorder reinitialization until clearing', async () => {
    const actual = await vi.importActual<typeof import('idb')>('idb');
    let database: Awaited<ReturnType<typeof actual.openDB>> | undefined;
    mocks.openDB.mockImplementation(async (...args: Parameters<typeof actual.openDB>) => {
      database = await actual.openDB(...args);
      return database;
    });
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);

    expect(await trace.setDeepTraceEnabled(true, storage)).toBe(true);
    database?.close();
    trace.recordDeepTraceEvent('test.closed_database', undefined, { flush: true });
    await vi.waitFor(() => expect(trace.getDeepTraceRuntimeStatus()).toBe('unavailable'));

    expect(trace.getDeepTraceHealthSnapshot().lastFailure).toMatchObject({
      stage: 'flush',
      errorName: 'InvalidStateError',
    });
    expect(trace.getDeepTraceHealthSnapshot().lastFailure).not.toHaveProperty('message');

    dispose();
    vi.resetModules();
    trace = await import('./deepTrace');
    const restartedDispose = trace.initializeDeepTraceRecorder(storage);
    await vi.waitFor(() => expect(trace.getDeepTraceRuntimeStatus()).toBe('recording'));
    expect(trace.getDeepTraceHealthSnapshot()).toMatchObject({
      status: 'recording',
      pendingEventCount: expect.any(Number),
      pendingBytes: expect.any(Number),
      flushing: expect.any(Boolean),
      lastFailure: {
        stage: 'flush',
        errorName: 'InvalidStateError',
      },
    });

    await trace.clearDeepTrace();
    expect(trace.getDeepTraceHealthSnapshot().lastFailure).toBeNull();

    await trace.setDeepTraceEnabled(false, storage);
    restartedDispose();
  });

  it('normalizes an untrusted persisted failure marker before exposing it', () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem(
      trace.DEEP_TRACE_FAILURE_KEY,
      JSON.stringify({
        at: 123,
        stage: 'activation',
        errorName: 'SecretProviderError',
        message: 'room=!secret:example.org',
      })
    );
    const dispose = trace.initializeDeepTraceRecorder(storage);

    expect(trace.getDeepTraceHealthSnapshot().lastFailure).toEqual({
      at: 123,
      stage: 'activation',
      errorName: 'UnknownError',
    });
    expect(JSON.stringify(trace.getDeepTraceHealthSnapshot())).not.toContain('secret');

    dispose();
  });
});
