// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveClock } from './useLiveClock';

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
});
