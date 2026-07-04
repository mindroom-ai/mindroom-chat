import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGINATION_LIMIT,
  MAX_PAGINATION_LIMIT,
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

  // CINNY-207 P1.6 (finding F11): the setting had no maximum, so arbitrarily
  // large stored values drove the unbounded eager-preload loop.
  it('clamps values above the maximum', () => {
    expect(sanitizePaginationLimit(10001)).toBe(MAX_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(1_000_000)).toBe(MAX_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(Number.MAX_SAFE_INTEGER)).toBe(MAX_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(MAX_PAGINATION_LIMIT)).toBe(MAX_PAGINATION_LIMIT);
  });

  it('truncates decimals and passes through valid integers', () => {
    expect(sanitizePaginationLimit(300.9)).toBe(300);
    expect(sanitizePaginationLimit(50.5)).toBe(MIN_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(49.9)).toBe(MIN_PAGINATION_LIMIT);
    expect(sanitizePaginationLimit(100)).toBe(100);
    expect(sanitizePaginationLimit(1000)).toBe(1000);
  });
});
