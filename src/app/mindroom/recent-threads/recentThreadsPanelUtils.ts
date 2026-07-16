import type { Room } from 'matrix-js-sdk';
import type { CrossRoomThreadIndexEntry } from '../cross-room-threads/crossRoomThreadIndex';
import { compareCrossRoomThreadEntries } from '../cross-room-threads/crossRoomThreadFilterPipeline';
import { type RecentThreadItem } from './recentThreads';

export const MAX_SIDEBAR_THREADS = 50;

export type VisibleRecentThreadItem = RecentThreadItem & {
  room: Room;
};

export const buildVisibleRecentThreadEntries = (
  getRoom: (roomId: string) => Room | null | undefined,
  recentThreads: RecentThreadItem[],
): VisibleRecentThreadItem[] =>
  recentThreads.reduce<VisibleRecentThreadItem[]>((entries, recentThread) => {
    const room = getRoom(recentThread.roomId);
    if (!room || room.getMyMembership() !== 'join') return entries;

    entries.push({
      ...recentThread,
      room,
    });
    return entries;
  }, []);

export const buildSidebarThreadEntries = (
  entries: Iterable<CrossRoomThreadIndexEntry>,
  pinnedThreadKeys: string[],
  limit = MAX_SIDEBAR_THREADS,
): CrossRoomThreadIndexEntry[] => {
  const pinnedRanks = new Map(
    pinnedThreadKeys.map((threadKey, index) => [threadKey, index] as const),
  );

  return Array.from(entries)
    .filter((entry) => entry.isInvolved || pinnedRanks.has(entry.key))
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
