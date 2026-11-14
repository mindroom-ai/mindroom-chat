import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSnoozeNow } from './useSnoozeNow';

const START = Date.UTC(2026, 10, 13, 10);

const renderNow = (untilTsList: number[]) => {
  const seen: number[] = [];
  const Probe = () => {
    seen.push(useSnoozeNow(untilTsList));
    return null;
  };
  act(() => {
    create(React.createElement(Probe));
  });
  return () => seen[seen.length - 1]!;
};

describe('useSnoozeNow', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => vi.useRealTimers());

  it('renews now when the earliest snooze ends', () => {
    const until = START + 60_000;
    const current = renderNow([until + 1000, until, undefined as unknown as number]);
    expect(current()).toBe(START);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(current()).toBeGreaterThanOrEqual(until);
  });

  it('does not fire early for a snooze 40 days ahead', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const current = renderNow([START + 40 * 24 * 3600 * 1000]);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(current()).toBe(START);
    const delays = setTimeoutSpy.mock.calls.map((call) => Number(call[1] ?? 0));
    expect(Math.max(...delays)).toBeLessThanOrEqual(2 ** 31 - 1);
  });
});
