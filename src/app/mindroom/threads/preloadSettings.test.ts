import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGINATION_LIMIT,
  MIN_PAGINATION_LIMIT,
  sanitizePaginationLimit,
} from './preloadSettings';

describe('sanitizePaginationLimit', () => {
  it('returns DEFAULT for non-finite or non-number values', () => {
    expect(sanitizePaginationLimit(NaN)).toBe(DEFAULT_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(Infinity)).toBe(DEFAULT_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(-Infinity)).toBe(DEFAULT_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(undefined)).toBe(DEFAULT_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(null)).toBe(DEFAULT_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit('300')).toBe(DEFAULT_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(true)).toBe(DEFAULT_PAGINATION_LIMIT);
  });

  it('clamps values below the minimum', () => {
    expect(sanitizePaginationLimit(0)).toBe(MIN_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(10)).toBe(MIN_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(49)).toBe(MIN_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(-100)).toBe(MIN_PAGINATION_LIMIT);
  });

  it('truncates decimals and passes through valid integers', () => {
    expect(sanitizePaginationLimit(300.9)).toBe(300);
    expect(sanitizePaginationLimit(50.5)).toBe(MIN_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(49.9)).toBe(MIN_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(100)).toBe(100);
    expect(sanitizePaginationLimit(1000)).toBe(1000);
  });
});
