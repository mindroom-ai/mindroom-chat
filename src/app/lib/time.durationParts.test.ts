import { describe, expect, it } from 'vitest';
import { formatDurationParts } from './time';

describe('formatDurationParts', () => {
  it.each([
    [400, '0s', ''],
    [4_000, '4s', ''],
    [59_999, '59s', ''],
    [432_000, '7m', '\u00a012s'],
    [963_000, '16m', '\u00a003s'],
    [3_900_000, '1h\u00a005m', ''],
  ])('splits %d ms into %j and %j in English', (ms, short, tail) => {
    expect(formatDurationParts(ms, 'en')).toEqual({ short, tail });
  });

  it('rounds partial seconds down, so a running count never runs ahead', () => {
    expect(formatDurationParts(7_999, 'en')).toEqual({ short: '7s', tail: '' });
  });

  it('reads a negative duration as none', () => {
    expect(formatDurationParts(-2_000, 'en')).toEqual({ short: '0s', tail: '' });
  });
});
