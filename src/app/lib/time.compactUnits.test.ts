import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCompactRelativeTime, hoursToMs, minutesToMs } from './time';

describe('compact ages', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('read as their own units in Japanese and Turkish', () => {
    const now = Date.now();
    const japanese = formatCompactRelativeTime(now - minutesToMs(17), 'ja');
    expect(japanese).not.toBe('17m');
    expect(japanese).toContain('分');
    const turkish = formatCompactRelativeTime(now - minutesToMs(17), 'tr');
    expect(turkish).not.toBe('17d');
    expect(turkish).toContain('dk');
    expect(formatCompactRelativeTime(now - hoursToMs(3), 'tr')).toContain('sa');
    // English keeps its narrow units.
    expect(formatCompactRelativeTime(now - minutesToMs(17), 'en')).toBe('17m');
  });
});
