import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daysToMs, formatRelativeTime, hoursToMs, minutesToMs, secondsToMs } from './time';

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns now for ages from 0ms through 4999ms', () => {
    const now = Date.now();

    expect(formatRelativeTime(now)).toBe('now');
    expect(formatRelativeTime(now - 4999)).toBe('now');
  });

  it('returns seconds at the 5 second boundary through 59 seconds', () => {
    const now = Date.now();

    expect(formatRelativeTime(now - 5000)).toBe('5s ago');
    expect(formatRelativeTime(now - secondsToMs(59))).toBe('59s ago');
  });

  it('returns minutes from 60 seconds through 59 minutes', () => {
    const now = Date.now();

    expect(formatRelativeTime(now - secondsToMs(60))).toBe('1m ago');
    expect(formatRelativeTime(now - minutesToMs(59))).toBe('59m ago');
  });

  it('returns hours from 1 hour through 23 hours', () => {
    const now = Date.now();

    expect(formatRelativeTime(now - hoursToMs(1))).toBe('1h ago');
    expect(formatRelativeTime(now - hoursToMs(23))).toBe('23h ago');
  });

  it('returns days at 1 day and beyond', () => {
    const now = Date.now();

    expect(formatRelativeTime(now - daysToMs(1))).toBe('1d ago');
    expect(formatRelativeTime(now - daysToMs(3))).toBe('3d ago');
  });

  it('clamps future timestamps to now', () => {
    expect(formatRelativeTime(Date.now() + secondsToMs(30))).toBe('now');
  });
});
