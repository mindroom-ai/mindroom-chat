// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openDB: vi.fn(),
}));

vi.mock('idb', () => ({
  openDB: mocks.openDB,
}));

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: Error) => void;
};

const createDeferred = (): Deferred => {
  let resolve: (() => void) | undefined;
  let reject: ((reason: Error) => void) | undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {
    promise,
    resolve: () => resolve?.(),
    reject: (reason) => reject?.(reason),
  };
};

const createDatabase = (firstAppendDone: Promise<void>, onAppend: () => void) => {
  let appendCount = 0;
  return {
    transaction: (stores: string | string[]) => {
      const append = Array.isArray(stores);
      if (append) {
        appendCount += 1;
        onAppend();
      }
      return {
        objectStore: (store: string) =>
          store === 'events'
            ? {
                add: vi.fn().mockResolvedValue(1),
                openCursor: vi.fn().mockResolvedValue(undefined),
              }
            : {
                get: vi.fn().mockResolvedValue(undefined),
                put: vi.fn().mockResolvedValue(undefined),
              },
        done: append && appendCount === 1 ? firstAppendDone : Promise.resolve(),
      };
    },
    close: vi.fn(),
  };
};

describe('deep diagnostic trace activation durability races', () => {
  let trace: typeof import('./deepTrace');

  beforeEach(async () => {
    vi.resetModules();
    mocks.openDB.mockReset();
    trace = await import('./deepTrace');
  });

  const exerciseRetoggleDuringFirstAppend = async (settle: (deferred: Deferred) => void) => {
    const firstAppend = createDeferred();
    let appendCount = 0;
    const database = createDatabase(firstAppend.promise, () => {
      appendCount += 1;
    });
    mocks.openDB.mockResolvedValue(database);
    const storage = window.localStorage;
    storage.clear();
    const dispose = trace.initializeDeepTraceRecorder(storage);
    const statuses: string[] = [];
    const unsubscribe = trace.subscribeDeepTraceStatus((status) => statuses.push(status));

    const firstEnable = trace.setDeepTraceEnabled(true, storage);
    await vi.waitFor(() => expect(appendCount).toBe(1));
    const disable = trace.setDeepTraceEnabled(false, storage);
    const secondEnable = trace.setDeepTraceEnabled(true, storage);
    settle(firstAppend);

    expect(await firstEnable).toBe(false);
    expect(await disable).toBe(true);
    expect(await secondEnable).toBe(true);
    expect(trace.getDeepTraceRuntimeStatus()).toBe('recording');
    expect(storage.getItem(trace.DEEP_TRACE_ENABLED_KEY)).toBe('1');
    expect(statuses).not.toContain('unavailable');

    unsubscribe();
    await trace.setDeepTraceEnabled(false, storage);
    dispose();
  };

  it('restarts after an old first-event append succeeds', async () => {
    await exerciseRetoggleDuringFirstAppend((deferred) => deferred.resolve());
  });

  it('restarts after an old first-event append rejects', async () => {
    await exerciseRetoggleDuringFirstAppend((deferred) =>
      deferred.reject(new Error('Old first-event append failed'))
    );
  });
});
