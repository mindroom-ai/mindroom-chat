// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('idb', () => ({
  openDB: vi.fn().mockRejectedValue(new Error('IndexedDB open blocked')),
}));

import {
  DEEP_TRACE_ENABLED_KEY,
  getDeepTraceRuntimeStatus,
  initializeDeepTraceRecorder,
  setDeepTraceEnabled,
  subscribeDeepTraceStatus,
} from './deepTrace';

describe('deep diagnostic trace storage failure', () => {
  it('fails enable closed when IndexedDB exists but cannot be opened', async () => {
    const storage = window.localStorage;
    storage.clear();
    const dispose = initializeDeepTraceRecorder(storage);
    const statuses: string[] = [];
    const unsubscribe = subscribeDeepTraceStatus((status) => statuses.push(status));

    expect(await setDeepTraceEnabled(true, storage)).toBe(false);
    expect(storage.getItem(DEEP_TRACE_ENABLED_KEY)).toBeNull();
    expect(getDeepTraceRuntimeStatus()).toBe('unavailable');
    expect(statuses).toEqual(expect.arrayContaining(['starting', 'unavailable']));

    unsubscribe();
    dispose();
  });
});
