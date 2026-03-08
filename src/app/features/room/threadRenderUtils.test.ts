import { describe, expect, it } from 'vitest';
import { getThreadInitialRenderMode } from './threadRenderUtils';

describe('getThreadInitialRenderMode', () => {
  it('uses the live render path outside thread view', () => {
    expect(
      getThreadInitialRenderMode({
        threadId: undefined,
        initialCacheHydrated: false,
        fallbackEventCount: 0,
      })
    ).toBe('live');
  });

  it('shows a loading state until the initial thread cache lookup completes', () => {
    expect(
      getThreadInitialRenderMode({
        threadId: '$thread',
        initialCacheHydrated: false,
        fallbackEventCount: 0,
      })
    ).toBe('loading');
  });

  it('renders cached thread events ahead of provisional live events during initial hydration', () => {
    expect(
      getThreadInitialRenderMode({
        threadId: '$thread',
        initialCacheHydrated: false,
        fallbackEventCount: 3,
      })
    ).toBe('cached');
  });

  it('switches back to the live render path after cache hydration finishes', () => {
    expect(
      getThreadInitialRenderMode({
        threadId: '$thread',
        initialCacheHydrated: true,
        fallbackEventCount: 0,
      })
    ).toBe('live');
  });
});
