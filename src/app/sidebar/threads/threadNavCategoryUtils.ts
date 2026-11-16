import type { CrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import { compareCrossRoomThreadEntries } from '../../threads/cross-room/crossRoomThreadOrder';
import type { ThreadSignals } from '../../threads/cross-room/threadSignals';
import { isSnoozedAt } from '../../event-store/threads/threadSnooze';
import { isThreadWorking } from '../../event-store/threads/threadWorking';
import {
  groupThreadSections,
  THREAD_SECTION_ORDER,
  type ThreadSectionId,
} from '../../threads/threadSections';

export const MAX_SIDEBAR_THREADS = 50;
export const MAX_SIDEBAR_RESOLVED_THREADS = 20;
export const MAX_SIDEBAR_SNOOZED_THREADS = 20;

type Compare = (left: CrossRoomThreadIndexEntry, right: CrossRoomThreadIndexEntry) => number;

/** Pinned threads first, by pin rank, then the rest by `compare`. */
const pinnedFirst = (pinnedThreadKeys: string[], compare: Compare): Compare => {
  const pinnedRanks = new Map(
    pinnedThreadKeys.map((threadKey, index) => [threadKey, index] as const)
  );
  return (left, right) => {
    const leftPinnedRank = pinnedRanks.get(left.key);
    const rightPinnedRank = pinnedRanks.get(right.key);

    if (leftPinnedRank !== undefined && rightPinnedRank !== undefined) {
      return leftPinnedRank - rightPinnedRank;
    }
    if (leftPinnedRank !== undefined) return -1;
    if (rightPinnedRank !== undefined) return 1;

    return compare(left, right);
  };
};

export const buildSidebarThreadEntries = (
  entries: Iterable<CrossRoomThreadIndexEntry>,
  pinnedThreadKeys: string[],
  directRoomIds: ReadonlySet<string> = new Set(),
  limit = MAX_SIDEBAR_THREADS,
  now = Date.now()
): CrossRoomThreadIndexEntry[] =>
  Array.from(entries)
    .filter(
      (entry) =>
        !entry.isResolved &&
        !isSnoozedAt(entry.snoozedUntilTs, now) &&
        !directRoomIds.has(entry.roomId)
    )
    .sort(pinnedFirst(pinnedThreadKeys, compareCrossRoomThreadEntries))
    .slice(0, Math.max(0, limit));

export type SidebarThreadSectionId = ThreadSectionId;
export type SidebarThreadSection = {
  id: SidebarThreadSectionId;
  /** The section's rows, at most its cap. */
  entries: CrossRoomThreadIndexEntry[];
  /** How many threads the section holds, also those past its cap. */
  total: number;
};

/**
 * The sidebar's THREADS in sections (`groupThreadSections`), each shown only when it holds a
 * thread: Working (`isThreadWorking`), Resolved, Snoozed at `now`, else Idle. Pinned threads lead
 * their own section. Working keeps the order the threads started in, so a streamed reply moves no
 * row; Idle goes by the newest of when the last run finished and the newest message (`signalsOf`)
 * and the activity, so a run's end counts, not its start, and an old run does not outrank a newer
 * message; Snoozed by the end of the snooze; Resolved by when it was resolved. Working and Idle
 * share `limit`, Working first; Snoozed and Resolved have caps of their own
 * (`MAX_SIDEBAR_SNOOZED_THREADS`, `MAX_SIDEBAR_RESOLVED_THREADS`). Each section counts all of its
 * threads in `total`.
 */
export const buildSidebarThreadSections = (
  entries: Iterable<CrossRoomThreadIndexEntry>,
  pinnedThreadKeys: string[],
  directRoomIds: ReadonlySet<string>,
  now: number,
  signalsOf: (entry: CrossRoomThreadIndexEntry) => ThreadSignals | undefined,
  limit = MAX_SIDEBAR_THREADS
): SidebarThreadSection[] => {
  const pinnedRanks = new Map(
    pinnedThreadKeys.map((threadKey, index) => [threadKey, index] as const)
  );
  const grouped = groupThreadSections(
    Array.from(entries).filter((entry) => !directRoomIds.has(entry.roomId)),
    {
      isWorking: (entry) =>
        isThreadWorking(entry.threadRecord.status, entry.hasBackgroundJob === true),
      isResolved: (entry) => entry.isResolved,
      snoozedUntilTs: (entry) => entry.snoozedUntilTs,
      startedTs: (entry) =>
        entry.rootTs ?? entry.threadRecord.cache.oldestTs ?? entry.lastActivityTs,
      finishedTs: (entry) => {
        const signals = signalsOf(entry);
        return Math.max(signals?.outcome?.ts ?? 0, signals?.newsTs ?? 0, entry.lastActivityTs);
      },
      resolvedTs: (entry) => entry.resolvedTs ?? entry.lastActivityTs,
      compare: compareCrossRoomThreadEntries,
      pinRank: (entry) => pinnedRanks.get(entry.key),
    },
    now
  );

  const working = grouped.working.slice(0, Math.max(0, limit));
  const shown: Record<SidebarThreadSectionId, CrossRoomThreadIndexEntry[]> = {
    working,
    idle: grouped.idle.slice(0, Math.max(0, limit) - working.length),
    snoozed: grouped.snoozed.slice(0, MAX_SIDEBAR_SNOOZED_THREADS),
    resolved: grouped.resolved.slice(0, MAX_SIDEBAR_RESOLVED_THREADS),
  };

  return THREAD_SECTION_ORDER.flatMap((id) =>
    shown[id].length > 0 ? [{ id, entries: shown[id], total: grouped[id].length }] : []
  );
};
