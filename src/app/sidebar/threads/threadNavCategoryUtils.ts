import type { CrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import { compareCrossRoomThreadEntries } from '../../threads/cross-room/crossRoomThreadOrder';

export const MAX_SIDEBAR_THREADS = 50;

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
