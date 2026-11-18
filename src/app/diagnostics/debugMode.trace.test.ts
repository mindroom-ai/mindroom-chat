// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDebugModeEnabled } from './debugMode';
import {
  getDeepTraceRuntimeStatus,
  readDeepTraceSnapshot,
  recordDeepTraceEvent,
  setDeepTraceEnabled,
} from './deepTrace';

const clearGate = vi.hoisted(() => ({
  hold: false,
  release: () => undefined as void,
  done: Promise.resolve(),
}));

// The real deep trace on fake IndexedDB, with a clear that can be held before it starts.
vi.mock('./deepTrace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./deepTrace')>();
  return {
    ...actual,
    clearDeepTrace: () => {
      if (!clearGate.hold) return actual.clearDeepTrace();
      const held = new Promise<void>((resolve) => {
        clearGate.release = resolve;
      });
      clearGate.done = held.then(() => actual.clearDeepTrace());
      return clearGate.done;
    },
  };
});

vi.mock('./flightRecorder', () => ({
  FLIGHT_RECORDER_CURRENT_KEY: 'mindroom.flight.current.v1',
  FLIGHT_RECORDER_ABNORMAL_KEY: 'mindroom.flight.abnormal.v1',
  installFlightRecorder: () => () => undefined,
}));

vi.mock('./memorySampler', () => ({ startMemorySampler: vi.fn() }));

describe('debug mode and its deep trace', () => {
  afterEach(async () => {
    clearGate.hold = false;
    await setDeepTraceEnabled(false);
    window.localStorage.clear();
  });

  it("keeps the new session's trace when On follows an Off whose clear is still running", async () => {
    await setDebugModeEnabled(true);
    await vi.waitFor(() => expect(getDeepTraceRuntimeStatus()).toBe('recording'));

    clearGate.hold = true;
    await setDebugModeEnabled(false);
    await setDebugModeEnabled(true);
    clearGate.release();
    await clearGate.done;
    await vi.waitFor(() => expect(getDeepTraceRuntimeStatus()).toBe('recording'));
    recordDeepTraceEvent('memory.sample', { reason_interval: true, rooms: 4 });

    // Read from the trace's IndexedDB store.
    const { events } = await readDeepTraceSnapshot();
    const sample = events.find((event) => event.name === 'memory.sample');
    expect(sample?.data).toEqual({ reason_interval: true, rooms: 4 });
    // The new session's start marker, recorded as On took effect, survived the clear too.
    expect(events).toContainEqual(
      expect.objectContaining({ name: 'trace.session.start', sessionId: sample?.sessionId })
    );
  });
});
