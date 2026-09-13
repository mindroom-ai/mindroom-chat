import { describe, expect, it } from 'vitest';
import {
  compareCachedPaginationAnchors,
  getCachedPaginationToken,
  mergeCachedPaginationTokens,
} from './eventCacheTokenUtils';

describe('mergeCachedPaginationTokens', () => {
  it('adds a token mapping for a known earliest event', () => {
    expect(mergeCachedPaginationTokens(undefined, '$event', 'token')).toEqual({
      $event: 'token',
    });
  });

  it('preserves existing mappings when adding a new one', () => {
    expect(mergeCachedPaginationTokens({ $old: 'old-token' }, '$event', null)).toEqual({
      $old: 'old-token',
      $event: null,
    });
  });

  it('returns the current map when no token update is provided', () => {
    expect(mergeCachedPaginationTokens({ $old: 'old-token' }, '$event', undefined)).toEqual({
      $old: 'old-token',
    });
  });

  it('overwrites a stale string token with null when server reports no more pages', () => {
    expect(mergeCachedPaginationTokens({ $event: 'stale-token' }, '$event', null)).toEqual({
      $event: null,
    });
  });
});

describe('getCachedPaginationToken', () => {
  it('returns the stored token for an event', () => {
    expect(getCachedPaginationToken({ $event: 'token' }, '$event')).toBe('token');
  });

  it('returns null for explicitly cleared tokens (no more pages)', () => {
    expect(getCachedPaginationToken({ $event: null }, '$event')).toBeNull();
  });

  it('returns undefined for unknown events (no cache data)', () => {
    expect(getCachedPaginationToken({ $event: 'token' }, '$other')).toBeUndefined();
    expect(getCachedPaginationToken(undefined, '$event')).toBeUndefined();
  });
});

describe('compareCachedPaginationAnchors', () => {
  it('orders anchors by timestamp before event id', () => {
    expect(
      compareCachedPaginationAnchors(
        { eventId: '$b', ts: 200 },
        { eventId: '$a', ts: 100 }
      )
    ).toBeGreaterThan(0);
    expect(
      compareCachedPaginationAnchors(
        { eventId: '$b', ts: 200 },
        { eventId: '$c', ts: 200 }
      )
    ).toBeLessThan(0);
  });

  it('handles missing anchors deterministically', () => {
    expect(compareCachedPaginationAnchors(undefined, { eventId: '$a', ts: 100 })).toBeLessThan(0);
    expect(compareCachedPaginationAnchors({ eventId: '$a', ts: 100 }, undefined)).toBeGreaterThan(0);
    expect(compareCachedPaginationAnchors(undefined, undefined)).toBe(0);
  });
});
