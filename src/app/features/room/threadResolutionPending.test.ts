import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingThreadResolution,
  getPendingThreadResolution,
  getPendingThreadResolutionMap,
  resetPendingThreadResolutions,
  setPendingThreadResolution,
} from './threadResolutionPending';

beforeEach(() => {
  vi.useFakeTimers();
  resetPendingThreadResolutions();
});

afterEach(() => {
  resetPendingThreadResolutions();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('threadResolutionPending', () => {
  it('keeps optimistic resolution state until the timeout fallback expires', () => {
    setPendingThreadResolution('!room:example.org', '$root', true, 1000);

    expect(getPendingThreadResolution('!room:example.org', '$root')).toEqual({
      resolved: true,
    });

    vi.advanceTimersByTime(999);
    expect(getPendingThreadResolution('!room:example.org', '$root')).toEqual({
      resolved: true,
    });

    vi.advanceTimersByTime(1);
    expect(getPendingThreadResolution('!room:example.org', '$root')).toBeUndefined();
  });

  it('replaces existing optimistic state for the same thread and room', () => {
    setPendingThreadResolution('!room:example.org', '$root', true, 1000);
    setPendingThreadResolution('!room:example.org', '$root', false, 1000);

    expect(getPendingThreadResolutionMap('!room:example.org')).toEqual(
      new Map([
        [
          '$root',
          {
            resolved: false,
          },
        ],
      ])
    );
  });

  it('clears optimistic state immediately when sync confirmation arrives', () => {
    setPendingThreadResolution('!room:example.org', '$root', true, 1000);

    clearPendingThreadResolution('!room:example.org', '$root');

    expect(getPendingThreadResolutionMap('!room:example.org').size).toBe(0);
  });
});
