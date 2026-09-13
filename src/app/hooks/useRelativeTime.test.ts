import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daysToMs, hoursToMs, minutesToMs, secondsToMs } from '../utils/time';
import { getRelativeTimeUpdateInterval, useRelativeTime } from './useRelativeTime';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));

type HarnessProps = {
  ts: number | undefined;
  onRender: (value: string) => void;
};

function Harness({ ts, onRender }: HarnessProps) {
  const value = useRelativeTime(ts);
  onRender(value);
  return null;
}

const renderHookHarness = (ts: number | undefined): {
  getSnapshot: () => string;
  renderer: ReactTestRenderer;
} => {
  let latestValue = '';
  let renderer: ReactTestRenderer | undefined;

  act(() => {
    renderer = create(
      React.createElement(Harness, {
        ts,
        onRender: (value) => {
          latestValue = value;
        },
      })
    );
  });

  return {
    getSnapshot: () => latestValue,
    renderer: renderer as ReactTestRenderer,
  };
};

describe('useRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T12:00:00.000Z'));
    vi.stubGlobal('window', globalThis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the expected intervals at the adaptive boundaries', () => {
    const now = Date.now();

    expect(getRelativeTimeUpdateInterval(now - secondsToMs(60) + 1, now)).toBe(secondsToMs(1));
    expect(getRelativeTimeUpdateInterval(now - secondsToMs(60), now)).toBe(secondsToMs(10));
    expect(getRelativeTimeUpdateInterval(now - hoursToMs(1) + 1, now)).toBe(secondsToMs(10));
    expect(getRelativeTimeUpdateInterval(now - hoursToMs(1), now)).toBe(minutesToMs(1));
    expect(getRelativeTimeUpdateInterval(now - daysToMs(1) + 1, now)).toBe(minutesToMs(1));
    expect(getRelativeTimeUpdateInterval(now - daysToMs(1), now)).toBe(minutesToMs(5));
  });

  it('re-schedules from 1 second to 10 seconds after crossing the 60 second boundary', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const ts = Date.now() - secondsToMs(59);

    const { getSnapshot, renderer } = renderHookHarness(ts);

    expect(getSnapshot()).toBe('59s ago');
    expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), secondsToMs(1));

    act(() => {
      vi.advanceTimersByTime(secondsToMs(1));
    });

    expect(getSnapshot()).toBe('1m ago');
    expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), secondsToMs(10));

    act(() => {
      renderer.unmount();
    });
  });

  it('re-schedules from 10 seconds to 1 minute after crossing the 1 hour boundary', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const ts = Date.now() - hoursToMs(1) + secondsToMs(1);

    const { getSnapshot, renderer } = renderHookHarness(ts);

    expect(getSnapshot()).toBe('59m ago');
    expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), secondsToMs(10));

    act(() => {
      vi.advanceTimersByTime(secondsToMs(10));
    });

    expect(getSnapshot()).toBe('1h ago');
    expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), minutesToMs(1));

    act(() => {
      renderer.unmount();
    });
  });

  it('re-schedules from 1 minute to 5 minutes after crossing the 1 day boundary', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const ts = Date.now() - daysToMs(1) + secondsToMs(1);

    const { getSnapshot, renderer } = renderHookHarness(ts);

    expect(getSnapshot()).toBe('23h ago');
    expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), minutesToMs(1));

    act(() => {
      vi.advanceTimersByTime(minutesToMs(1));
    });

    expect(getSnapshot()).toBe('1d ago');
    expect(setIntervalSpy).toHaveBeenLastCalledWith(expect.any(Function), minutesToMs(5));

    act(() => {
      renderer.unmount();
    });
  });

  it('shares one interval across hooks in the same update cadence bucket', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Harness, {
            ts: Date.now() - secondsToMs(10),
            onRender: () => undefined,
          }),
          React.createElement(Harness, {
            ts: Date.now() - secondsToMs(20),
            onRender: () => undefined,
          })
        )
      );
    });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), secondsToMs(1));

    act(() => {
      renderer?.unmount();
    });

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
