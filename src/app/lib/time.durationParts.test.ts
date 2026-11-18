import { describe, expect, it } from 'vitest';
import { formatDurationParts, formatWorkDuration } from './time';

describe('formatDurationParts', () => {
  it.each([
    [400, '0s', ''],
    [4_000, '4s', ''],
    [59_400, '59s', ''],
    [425_000, '7m', '\u00a05s'],
    [432_000, '7m', '\u00a012s'],
    [963_000, '16m', '\u00a03s'],
    [3_840_000, '1h\u00a04m', ''],
  ])('splits %d ms into %j and %j in English', (ms, short, tail) => {
    expect(formatDurationParts(ms, 'en')).toEqual({ short, tail });
  });

  it.each([4_000, 425_000, 432_000, 3_840_000, 7_600, 59_600])(
    'reads %d ms as the work duration of a tool call does',
    (ms) => {
      const { short, tail } = formatDurationParts(ms, 'en');
      const joined = `${short}${tail}`.replace(/\s+/gu, ' ');
      expect(joined).toBe(formatWorkDuration(ms, 'en').replace(/\s+/gu, ' '));
    }
  );

  it('reads a negative duration as none', () => {
    expect(formatDurationParts(-2_000, 'en')).toEqual({ short: '0s', tail: '' });
  });
});
