// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEBUG_MODE_KEY, getDebugModeEnabled, setDebugModeEnabled } from './debugMode';
import { FLIGHT_RECORDER_ABNORMAL_KEY, FLIGHT_RECORDER_CURRENT_KEY } from './flightRecorder';

const mocks = vi.hoisted(() => ({
  installFlightRecorder: vi.fn(),
  stopFlightRecorder: vi.fn(),
  initializeDeepTraceRecorder: vi.fn(),
  setDeepTraceEnabled: vi.fn(),
  clearDeepTrace: vi.fn(),
}));

vi.mock('./flightRecorder', () => ({
  FLIGHT_RECORDER_CURRENT_KEY: 'mindroom.flight.current.v1',
  FLIGHT_RECORDER_ABNORMAL_KEY: 'mindroom.flight.abnormal.v1',
  installFlightRecorder: mocks.installFlightRecorder,
}));

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
    expect(mocks.initializeDeepTraceRecorder).toHaveBeenCalledOnce();
  });

  it('off stops the recorders and deletes what they recorded', async () => {
    await setDebugModeEnabled(true);
    window.localStorage.setItem(FLIGHT_RECORDER_CURRENT_KEY, '{}');
    window.localStorage.setItem(FLIGHT_RECORDER_ABNORMAL_KEY, '{}');

    await expect(setDebugModeEnabled(false)).resolves.toBe(true);

    expect(window.localStorage.getItem(DEBUG_MODE_KEY)).toBeNull();
    expect(mocks.setDeepTraceEnabled).toHaveBeenCalledWith(false);
    expect(mocks.stopFlightRecorder).toHaveBeenCalledOnce();
    expect(mocks.clearDeepTrace).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(FLIGHT_RECORDER_CURRENT_KEY)).toBeNull();
    expect(window.localStorage.getItem(FLIGHT_RECORDER_ABNORMAL_KEY)).toBeNull();
  });

  it('starts nothing when the choice cannot be saved', async () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new Error('quota');
      }),
    } as unknown as Storage;

    await expect(setDebugModeEnabled(true, storage)).resolves.toBe(false);

    expect(mocks.installFlightRecorder).not.toHaveBeenCalled();
    expect(mocks.initializeDeepTraceRecorder).not.toHaveBeenCalled();
  });
});
