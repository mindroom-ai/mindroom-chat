import { describe, expect, it } from 'vitest';
import {
  CURRENT_ROOM_DEEP_HISTORY_TARGET,
  DEFAULT_PREFETCH_SCOPE,
  resolvePrefetchConfig,
  ROOM_TAIL_PREFETCH_DEPTH,
  sanitizePrefetchDepth,
  sanitizePrefetchScope,
} from '../prefetchPolicy';

describe('sanitizePrefetchScope (ISSUE-207 P6.1 / D4)', () => {
  it('accepts every whitelisted literal', () => {
    expect(sanitizePrefetchScope('all-rooms')).toBe('all-rooms');
    expect(sanitizePrefetchScope('current-room-only')).toBe('current-room-only');
  });

  it('coerces unknown scopes to the default', () => {
    expect(sanitizePrefetchScope('other')).toBe(DEFAULT_PREFETCH_SCOPE);
    // v1's homeserver scope is retired: those users get focused rooms.
    expect(sanitizePrefetchScope('my-server')).toBe('current-room-only');
    expect(sanitizePrefetchScope('')).toBe(DEFAULT_PREFETCH_SCOPE);
  });

  it('coerces non-string values to the default', () => {
    expect(sanitizePrefetchScope(undefined)).toBe(DEFAULT_PREFETCH_SCOPE);
    expect(sanitizePrefetchScope(null)).toBe(DEFAULT_PREFETCH_SCOPE);
    expect(sanitizePrefetchScope(1)).toBe(DEFAULT_PREFETCH_SCOPE);
    expect(sanitizePrefetchScope({ scope: 'my-server' })).toBe(DEFAULT_PREFETCH_SCOPE);
    expect(sanitizePrefetchScope([])).toBe(DEFAULT_PREFETCH_SCOPE);
  });
});

describe('sanitizePrefetchDepth (ISSUE-207 P6.1 / D4)', () => {
  it('returns the default for non-numeric or infinite inputs', () => {
    expect(sanitizePrefetchDepth(undefined)).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
    expect(sanitizePrefetchDepth(null)).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
    expect(sanitizePrefetchDepth('500')).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
    expect(sanitizePrefetchDepth(Number.NaN)).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
    expect(sanitizePrefetchDepth(Number.POSITIVE_INFINITY)).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
    expect(sanitizePrefetchDepth(Number.NEGATIVE_INFINITY)).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
  });

  it('clamps to the [ROOM_TAIL_PREFETCH_DEPTH, CURRENT_ROOM_DEEP_HISTORY_TARGET] range', () => {
    expect(sanitizePrefetchDepth(0)).toBe(ROOM_TAIL_PREFETCH_DEPTH);
    expect(sanitizePrefetchDepth(15)).toBe(ROOM_TAIL_PREFETCH_DEPTH);
    expect(sanitizePrefetchDepth(ROOM_TAIL_PREFETCH_DEPTH - 1)).toBe(ROOM_TAIL_PREFETCH_DEPTH);
    expect(sanitizePrefetchDepth(-500)).toBe(ROOM_TAIL_PREFETCH_DEPTH);
    expect(sanitizePrefetchDepth(99999)).toBe(CURRENT_ROOM_DEEP_HISTORY_TARGET);
    expect(sanitizePrefetchDepth(CURRENT_ROOM_DEEP_HISTORY_TARGET + 1)).toBe(
      CURRENT_ROOM_DEEP_HISTORY_TARGET
    );
  });

  it('truncates non-integer inputs before clamping', () => {
    expect(sanitizePrefetchDepth(500.9)).toBe(500);
    expect(sanitizePrefetchDepth(2500.4)).toBe(2500);
  });

  it('passes valid mid-range integers through unchanged', () => {
    expect(sanitizePrefetchDepth(ROOM_TAIL_PREFETCH_DEPTH)).toBe(ROOM_TAIL_PREFETCH_DEPTH);
    expect(sanitizePrefetchDepth(1000)).toBe(1000);
    expect(sanitizePrefetchDepth(CURRENT_ROOM_DEEP_HISTORY_TARGET)).toBe(
      CURRENT_ROOM_DEEP_HISTORY_TARGET
    );
  });
});

describe('resolvePrefetchConfig (ISSUE-207 P6.1 / D4)', () => {
  it('builds a valid config from an empty settings snapshot', () => {
    expect(resolvePrefetchConfig({})).toEqual({
      scope: DEFAULT_PREFETCH_SCOPE,
    });
  });

  it('threads sanitized user values through', () => {
    expect(resolvePrefetchConfig({ prefetchScope: 'current-room-only' })).toEqual({
      scope: 'current-room-only',
    });
  });

  it('coerces garbage inputs via the underlying sanitizers', () => {
    expect(resolvePrefetchConfig({ prefetchScope: 'nope' })).toEqual({
      scope: DEFAULT_PREFETCH_SCOPE,
    });
  });
});
