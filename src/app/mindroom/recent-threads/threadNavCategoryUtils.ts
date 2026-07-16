import type { CrossRoomThreadIndexEntry } from '../cross-room-threads/crossRoomThreadIndex';
import { compareCrossRoomThreadEntries } from '../cross-room-threads/crossRoomThreadFilterPipeline';

export const MAX_SIDEBAR_THREADS = 50;
const THREAD_NAV_SCROLL_TOP_STATE_KEY = 'threadNavScrollTop';

export const createThreadNavLocationState = (scrollTop: number) => ({
  [THREAD_NAV_SCROLL_TOP_STATE_KEY]: scrollTop,
});

export const getThreadNavScrollTop = (state: unknown): number | undefined => {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;

  const scrollTop = (state as Record<string, unknown>)[THREAD_NAV_SCROLL_TOP_STATE_KEY];
  return typeof scrollTop === 'number' && Number.isFinite(scrollTop) && scrollTop >= 0
    ? scrollTop
    : undefined;
};

export const buildSidebarThreadEntries = (
  entries: Iterable<CrossRoomThreadIndexEntry>,
  pinnedThreadKeys: string[],
  directRoomIds: ReadonlySet<string> = new Set(),
  limit = MAX_SIDEBAR_THREADS
): CrossRoomThreadIndexEntry[] => {
  const pinnedRanks = new Map(
    pinnedThreadKeys.map((threadKey, index) => [threadKey, index] as const)
  );

  return Array.from(entries)
    .filter((entry) => !entry.isResolved && !directRoomIds.has(entry.roomId))
    .sort((left, right) => {
      const leftPinnedRank = pinnedRanks.get(left.key);
      const rightPinnedRank = pinnedRanks.get(right.key);

      if (leftPinnedRank !== undefined && rightPinnedRank !== undefined) {
        return leftPinnedRank - rightPinnedRank;
      }
      if (leftPinnedRank !== undefined) return -1;
      if (rightPinnedRank !== undefined) return 1;

      return compareCrossRoomThreadEntries(left, right);
    })
    .slice(0, Math.max(0, limit));
};
