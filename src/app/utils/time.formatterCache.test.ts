import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatCompactRelativeTime,
  formatRelativeTime,
  hoursToMs,
  timeDayMonthYear,
  timeHourMinute,
} from './time';

type FormatterName = 'RelativeTimeFormat' | 'DateTimeFormat' | 'NumberFormat';
const originals = new Map<FormatterName, unknown>();

/** Counts how often `Intl[name]` is constructed until the test ends. */
const countConstructions = (name: FormatterName): { count: number } => {
  const counter = { count: 0 };
  const Original = Intl[name] as unknown as new (...args: unknown[]) => object;
  originals.set(name, Original);
  class Counting extends Original {
    constructor(...args: unknown[]) {
      super(...args);
      counter.count += 1;
    }
  }
  Object.defineProperty(Intl, name, { value: Counting, configurable: true, writable: true });
  return counter;
};

describe('time formatters', () => {
  afterEach(() => {
    originals.forEach((Original, name) =>
      Object.defineProperty(Intl, name, { value: Original, configurable: true, writable: true })
    );
    originals.clear();
    vi.useRealTimers();
  });

  it('builds each formatter once per language and options, not once per call', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T12:00:00.000Z'));
    const relative = countConstructions('RelativeTimeFormat');
    const dateTime = countConstructions('DateTimeFormat');
    const number = countConstructions('NumberFormat');
    const now = Date.now();

    // Languages no other test here uses, so nothing is cached yet.
    const rows = [now - hoursToMs(2), now - hoursToMs(3), now - hoursToMs(5)];
    expect(new Set(rows.map((ts) => formatRelativeTime(ts, 'fr'))).size).toBe(3);
    expect(relative.count).toBe(1);
    expect(rows.map((ts) => formatCompactRelativeTime(ts, 'sv')).length).toBe(3);
    expect(number.count).toBe(1);

    timeHourMinute(now, true, 'da');
    timeHourMinute(now - 60_000, true, 'da');
    timeDayMonthYear(now, 'da');
    timeDayMonthYear(now - hoursToMs(30), 'da');
    expect(dateTime.count).toBe(2);

    // Other options are another formatter.
    timeHourMinute(now, false, 'da');
    expect(dateTime.count).toBe(3);
  });

  it('formats the same as a formatter built for the call', () => {
    const ts = Date.UTC(2025, 0, 2, 9, 5);
    expect(timeHourMinute(ts, true, 'en-GB')).toBe(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(ts)
    );
    expect(timeDayMonthYear(ts, 'de')).toBe(
      new Intl.DateTimeFormat('de', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(ts)
    );
  });

  it('formats in the zone the device is in now, not the one a cached formatter was built in', () => {
    const zone = process.env.TZ;
    const ts = Date.UTC(2025, 0, 2, 9, 5);
    try {
      process.env.TZ = 'UTC';
      expect(timeHourMinute(ts, true, 'en-GB')).toBe('09:05');
      process.env.TZ = 'Asia/Tokyo';
      expect(timeHourMinute(ts, true, 'en-GB')).toBe('18:05');
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});
