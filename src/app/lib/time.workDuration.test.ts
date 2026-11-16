import { describe, expect, it } from 'vitest';
import { formatWorkDuration } from './time';

describe('formatWorkDuration', () => {
  it.each([
    [45_000, '45s'],
    [133_000, '2m 13s'],
    [3_840_000, '1h 4m'],
    [400, '0s'],
  ])('formats %d ms as %s in English', (ms, label) => {
    expect(formatWorkDuration(ms, 'en')).toBe(label);
  });
});
