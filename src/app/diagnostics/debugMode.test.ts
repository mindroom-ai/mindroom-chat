// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEBUG_MODE_KEY,
  getDebugModeEnabled,
  setDebugModeEnabled,
  subscribeDebugMode,
} from './debugMode';
import { FLIGHT_RECORDER_ABNORMAL_KEY, FLIGHT_RECORDER_CURRENT_KEY } from './flightRecorder';

const mocks = vi.hoisted(() => ({
  installFlightRecorder: vi.fn(),
  stopFlightRecorder: vi.fn(),
  initializeDeepTraceRecorder: vi.fn(),
  setDeepTraceEnabled: vi.fn(),
  clearDeepTrace: vi.fn(),
  startMemorySampler: vi.fn(),
}));

/** The deep trace work runs after the switch answers, one change after another. */
const traceWorkDone = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

vi.mock('./flightRecorder', () => ({
  FLIGHT_RECORDER_CURRENT_KEY: 'mindroom.flight.current.v1',
  FLIGHT_RECORDER_ABNORMAL_KEY: 'mindroom.flight.abnormal.v1',
  installFlightRecorder: mocks.installFlightRecorder,
}));

vi.mock('./memorySampler', () => ({ startMemorySampler: mocks.startMemorySampler }));

vi.mock('./deepTrace', () => ({
  initializeDeepTraceRecorder: mocks.initializeDeepTraceRecorder,
  setDeepTraceEnabled: mocks.setDeepTraceEnabled,
  clearDeepTrace: mocks.clearDeepTrace,
}));

describe('debug mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.installFlightRecorder.mockReturnValue(mocks.stopFlightRecorder);
    mocks.setDeepTraceEnabled.mockResolvedValue(true);
    mocks.clearDeepTrace.mockResolvedValue(undefined);
  });

  it('is off until turned on, and on starts both recorders at once', async () => {
    expect(getDebugModeEnabled()).toBe(false);

    await expect(setDebugModeEnabled(true)).resolves.toBe(true);

    expect(getDebugModeEnabled()).toBe(true);
    expect(mocks.installFlightRecorder).toHaveBeenCalledOnce();
    await traceWorkDone();
    expect(mocks.initializeDeepTraceRecorder).toHaveBeenCalledOnce();
    expect(mocks.startMemorySampler).toHaveBeenCalledOnce();
  });

  it('on turns the deep trace on too, so attached logs hold it', async () => {
    await setDebugModeEnabled(true);
    await traceWorkDone();

    expect(mocks.setDeepTraceEnabled).toHaveBeenCalledWith(true);
  });

  it('stays on when the deep trace cannot start', async () => {
    mocks.setDeepTraceEnabled.mockRejectedValue(new Error('IndexedDB lost'));

    await expect(setDebugModeEnabled(true)).resolves.toBe(true);

    expect(getDebugModeEnabled()).toBe(true);
  });

  it('tells its subscribers about each change', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDebugMode(listener);

    await setDebugModeEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);
    await setDebugModeEnabled(false);
    expect(listener).toHaveBeenCalledTimes(2);
    // Another tab's change arrives as a storage event.
    window.dispatchEvent(new StorageEvent('storage', { key: DEBUG_MODE_KEY }));
    expect(listener).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    await setDebugModeEnabled(true);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('with recorders that always run (the iOS app), off keeps the flight recorder and its keys', async () => {
    window.localStorage.setItem(FLIGHT_RECORDER_CURRENT_KEY, '{}');
    window.localStorage.setItem(FLIGHT_RECORDER_ABNORMAL_KEY, '{}');
    await setDebugModeEnabled(true, { keepRecorders: true });
    // The app started its flight recorder already; debug mode does not start a second one.
    expect(mocks.installFlightRecorder).not.toHaveBeenCalled();

    await expect(setDebugModeEnabled(false, { keepRecorders: true })).resolves.toBe(true);

    expect(window.localStorage.getItem(DEBUG_MODE_KEY)).toBeNull();
    expect(mocks.stopFlightRecorder).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBe('{}');
    expect(window.localStorage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBe('{}');
    await traceWorkDone();
    // The deep trace goes off with debug mode, and what it recorded with it.
    expect(mocks.setDeepTraceEnabled).toHaveBeenLastCalledWith(false);
    expect(mocks.clearDeepTrace).toHaveBeenCalledOnce();
  });

  it('off stops the recorders and deletes what they recorded', async () => {
    await setDebugModeEnabled(true);
    window.localStorage.setItem(FLIGHT_RECORDER_CURRENT_KEY, '{}');
    window.localStorage.setItem(FLIGHT_RECORDER_ABNORMAL_KEY, '{}');

    await expect(setDebugModeEnabled(false)).resolves.toBe(true);

    expect(window.localStorage.getItem(DEBUG_MODE_KEY)).toBeNull();
    await traceWorkDone();
    expect(mocks.setDeepTraceEnabled).toHaveBeenCalledWith(false);
    expect(mocks.stopFlightRecorder).toHaveBeenCalledOnce();
    expect(mocks.clearDeepTrace).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBeNull();
    expect(window.localStorage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBeNull();
  });

  it("off still drops the flight recorder's session when the trace store fails to clear", async () => {
    await setDebugModeEnabled(true);
    window.localStorage.setItem(FLIGHT_RECORDER_CURRENT_KEY, '{}');
    mocks.clearDeepTrace.mockRejectedValue(new Error('IndexedDB lost'));

    await expect(setDebugModeEnabled(false)).resolves.toBe(true);

    expect(window.localStorage.getItem(DEBUG_MODE_KEY)).toBeNull();
    expect(window.localStorage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBeNull();
  });

  it('answers at once while a clear hangs, and starts the next On only after it', async () => {
    let releaseClear!: () => void;
    mocks.clearDeepTrace.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseClear = resolve;
        })
    );
    await setDebugModeEnabled(true);
    await traceWorkDone();
    mocks.setDeepTraceEnabled.mockClear();

    await expect(setDebugModeEnabled(false)).resolves.toBe(true);
    await expect(setDebugModeEnabled(true)).resolves.toBe(true);
    await traceWorkDone();
    expect(getDebugModeEnabled()).toBe(true);
    expect(mocks.setDeepTraceEnabled.mock.calls).toEqual([[false]]);

    releaseClear();
    await traceWorkDone();
    expect(mocks.setDeepTraceEnabled.mock.calls).toEqual([[false], [true]]);
  });

  it('starts nothing when the choice cannot be saved', async () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new Error('quota');
      }),
    } as unknown as Storage;

    await expect(setDebugModeEnabled(true, { storage })).resolves.toBe(false);

    expect(mocks.installFlightRecorder).not.toHaveBeenCalled();
    expect(mocks.initializeDeepTraceRecorder).not.toHaveBeenCalled();
    expect(mocks.setDeepTraceEnabled).not.toHaveBeenCalled();
  });
});
