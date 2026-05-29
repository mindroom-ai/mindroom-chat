import type { ThreadCacheCoverage } from './types';

type BuildThreadCacheCoverageOptions = {
  eventCount: number;
  oldestTs?: number;
  newestTs?: number;
  backwardToken?: string | null;
  hasMoreBackward?: boolean;
  snapshotComplete?: boolean;
  relationSnapshotComplete?: boolean;
  tailLoaded?: boolean;
  expectedReplyCount?: number;
};

export const buildThreadCacheCoverage = ({
  eventCount,
  oldestTs,
  newestTs,
  backwardToken,
  hasMoreBackward,
  snapshotComplete,
  relationSnapshotComplete,
  tailLoaded,
  expectedReplyCount,
}: BuildThreadCacheCoverageOptions): ThreadCacheCoverage => ({
  eventCount,
  oldestTs,
  newestTs,
  backwardToken,
  hasMoreBackward: hasMoreBackward ?? (typeof backwardToken === 'string' ? true : undefined),
  snapshotComplete,
  relationSnapshotComplete: relationSnapshotComplete === true,
  tailLoaded: tailLoaded === true,
  expectedReplyCount,
});

export const hasThreadCacheBackwardGap = (coverage: ThreadCacheCoverage): boolean =>
  coverage.hasMoreBackward === true || typeof coverage.backwardToken === 'string';

export const hasThreadCacheKnownBackwardStart = (coverage: ThreadCacheCoverage): boolean =>
  coverage.hasMoreBackward === false || coverage.backwardToken === null;

export const hasUsableThreadCacheSnapshot = ({
  eventCount,
  rootPresent,
}: {
  eventCount: number;
  rootPresent: boolean;
}): boolean => eventCount > 0 || rootPresent;

export const isCompleteThreadCacheCoverage = ({
  coverage,
  hasLocalSnapshot,
}: {
  coverage: ThreadCacheCoverage;
  hasLocalSnapshot: boolean;
}): boolean =>
  hasLocalSnapshot &&
  coverage.snapshotComplete === true &&
  coverage.relationSnapshotComplete &&
  coverage.tailLoaded &&
  hasThreadCacheKnownBackwardStart(coverage);

export const shouldBackfillThreadRelationsFromCoverage = ({
  coverage,
  hasLocalSnapshot,
}: {
  coverage: ThreadCacheCoverage;
  hasLocalSnapshot: boolean;
}): boolean =>
  hasLocalSnapshot && (coverage.snapshotComplete !== true || coverage.relationSnapshotComplete !== true);

export const shouldShowThreadLoadOlderFromCoverage = ({
  coverage,
  sdkHasBackwardToken,
}: {
  coverage: ThreadCacheCoverage;
  sdkHasBackwardToken: boolean;
}): boolean => sdkHasBackwardToken || hasThreadCacheBackwardGap(coverage);
