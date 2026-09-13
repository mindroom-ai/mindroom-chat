import { describe, expect, it } from 'vitest';
import {
  buildThreadCacheCoverage,
  hasThreadCacheBackwardGap,
  hasThreadCacheKnownBackwardStart,
  hasUsableThreadCacheSnapshot,
  isCompleteThreadCacheCoverage,
  shouldBackfillThreadRelationsFromCoverage,
  shouldShowThreadLoadOlderFromCoverage,
} from './threadCacheCoverage';

describe('threadCacheCoverage', () => {
  it('treats a string backward token as an older-message gap', () => {
    const coverage = buildThreadCacheCoverage({
      eventCount: 3,
      backwardToken: 'tok',
      relationSnapshotComplete: true,
      snapshotComplete: false,
      tailLoaded: true,
    });

    expect(hasThreadCacheBackwardGap(coverage)).toBe(true);
    expect(hasThreadCacheKnownBackwardStart(coverage)).toBe(false);
    expect(shouldShowThreadLoadOlderFromCoverage({ coverage, sdkHasBackwardToken: false })).toBe(
      true
    );
  });

  it('treats an explicit null backward token as known room history start', () => {
    const coverage = buildThreadCacheCoverage({
      eventCount: 3,
      backwardToken: null,
      hasMoreBackward: false,
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    });

    expect(hasThreadCacheBackwardGap(coverage)).toBe(false);
    expect(hasThreadCacheKnownBackwardStart(coverage)).toBe(true);
    expect(
      isCompleteThreadCacheCoverage({
        coverage,
        hasLocalSnapshot: true,
      })
    ).toBe(true);
  });

  it('does not accept complete metadata without a usable local snapshot', () => {
    const coverage = buildThreadCacheCoverage({
      eventCount: 0,
      backwardToken: null,
      hasMoreBackward: false,
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    });

    expect(hasUsableThreadCacheSnapshot({ eventCount: 0, rootPresent: false })).toBe(false);
    expect(
      isCompleteThreadCacheCoverage({
        coverage,
        hasLocalSnapshot: false,
      })
    ).toBe(false);
  });

  it('requests relation backfill for incomplete relation or snapshot coverage', () => {
    const coverage = buildThreadCacheCoverage({
      eventCount: 2,
      backwardToken: null,
      hasMoreBackward: false,
      relationSnapshotComplete: false,
      snapshotComplete: true,
      tailLoaded: true,
    });

    expect(
      shouldBackfillThreadRelationsFromCoverage({
        coverage,
        hasLocalSnapshot: true,
      })
    ).toBe(true);
  });

  it('lets the SDK backward token show the load-older affordance even when cache coverage is closed', () => {
    const coverage = buildThreadCacheCoverage({
      eventCount: 2,
      backwardToken: null,
      hasMoreBackward: false,
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    });

    expect(shouldShowThreadLoadOlderFromCoverage({ coverage, sdkHasBackwardToken: true })).toBe(
      true
    );
  });
});
