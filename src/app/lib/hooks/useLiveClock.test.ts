// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeRelativeTimeClock, useLiveClock } from './useLiveClock';

describe('useLiveClock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: 10_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads a fresh timestamp immediately when flipping active from false to true and shares one timer', () => {
    const seen: number[] = [];
    function Probe({ active }: { active: boolean }) {
      seen.push(useLiveClock(active));
      return null;
    }

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(Probe, { active: false }));
    });
    expect(seen).toEqual([10_000]);
    expect(vi.getTimerCount()).toBe(0);

    vi.setSystemTime(25_000);
    seen.length = 0;
    act(() => {
      renderer?.update(React.createElement(Probe, { active: true }));
    });
    // Every render while active sees the fresh timestamp immediately (never 10_000).
    expect(seen.every((value) => value === 25_000)).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(seen.at(-1)).toBe(27_000);

    act(() => {
      renderer?.update(React.createElement(Probe, { active: false }));
    });
    expect(vi.getTimerCount()).toBe(0);
    act(() => renderer?.unmount());
  });

  it('pauses shared clock intervals while document.hidden and syncs immediately when visible', () => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    const listener = vi.fn();
    const unsubscribe = subscribeRelativeTimeClock(1_000, listener);
    try {
      vi.advanceTimersByTime(2_000);
      expect(listener).toHaveBeenCalledTimes(2);

      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(5_000);
      expect(listener).toHaveBeenCalledTimes(2);

      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      // Immediate sync tick on return to visible, then interval resumes.
      expect(listener).toHaveBeenCalledTimes(3);
      vi.advanceTimersByTime(1_000);
      expect(listener).toHaveBeenCalledTimes(4);
    } finally {
      unsubscribe();
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    }
  });
});
