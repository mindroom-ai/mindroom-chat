import type { CrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import { compareCrossRoomThreadEntries } from '../../threads/cross-room/crossRoomThreadOrder';
import type { ThreadSignals } from '../../threads/cross-room/threadSignals';
import { isSnoozedAt } from '../../event-store/threads/threadSnooze';
import { isThreadWorking } from '../../event-store/threads/threadWorking';

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

export type SidebarThreadSectionId = 'working' | 'snoozed' | 'idle' | 'resolved';
export type SidebarThreadSection = {
  id: SidebarThreadSectionId;
  /** The section's rows, at most its cap. */
  entries: CrossRoomThreadIndexEntry[];
  /** How many threads the section holds, also those past its cap. */
  total: number;
};

const SECTION_ORDER: SidebarThreadSectionId[] = ['working', 'snoozed', 'idle', 'resolved'];

const sectionOf = (entry: CrossRoomThreadIndexEntry, now: number): SidebarThreadSectionId => {
  if (isThreadWorking(entry.threadRecord.status, entry.hasBackgroundJob === true)) return 'working';
  if (entry.isResolved) return 'resolved';
  if (isSnoozedAt(entry.snoozedUntilTs, now)) return 'snoozed';
  return 'idle';
};

/** Newest first by `tsOf`, ties in the usual cross-room order. */
const byTsDesc =
  (tsOf: (entry: CrossRoomThreadIndexEntry) => number): Compare =>
  (left, right) =>
    tsOf(right) - tsOf(left) || compareCrossRoomThreadEntries(left, right);

/**
 * The sidebar's THREADS in sections, each shown only when it holds a thread, a thread in the
 * first that fits: Working (an agent streams or the user's message is on its way), Resolved,
 * Snoozed at `now`, else Idle. Pinned threads lead their own section. Working keeps the order the
 * threads started in, so a streamed reply moves no row; Idle goes by the newest of when the last
 * run finished and the newest message (`signalsOf`) and the activity, so a run's end counts, not
 * its start, and an old run does not outrank a newer message; Snoozed by the end of the snooze;
 * Resolved by when it was resolved. Working and Idle share `limit`, Working first; Snoozed and
 * Resolved have caps of their own (`MAX_SIDEBAR_SNOOZED_THREADS`, `MAX_SIDEBAR_RESOLVED_THREADS`).
 * Each section counts all of its threads in `total`.
 */
export const buildSidebarThreadSections = (
  entries: Iterable<CrossRoomThreadIndexEntry>,
  pinnedThreadKeys: string[],
  directRoomIds: ReadonlySet<string>,
  now: number,
  signalsOf: (entry: CrossRoomThreadIndexEntry) => ThreadSignals | undefined,
  limit = MAX_SIDEBAR_THREADS
): SidebarThreadSection[] => {
  const grouped: Record<SidebarThreadSectionId, CrossRoomThreadIndexEntry[]> = {
    working: [],
    snoozed: [],
    idle: [],
    resolved: [],
  };
  for (const entry of entries) {
    if (!directRoomIds.has(entry.roomId)) grouped[sectionOf(entry, now)].push(entry);
  }

  const finishedTs = new Map(
    grouped.idle.map((entry) => {
      const signals = signalsOf(entry);
      const ts = Math.max(signals?.outcome?.ts ?? 0, signals?.newsTs ?? 0, entry.lastActivityTs);
      return [entry.key, ts] as const;
    })
  );
  const compares: Record<SidebarThreadSectionId, Compare> = {
    working: byTsDesc(
      (entry) => entry.rootTs ?? entry.threadRecord.cache.oldestTs ?? entry.lastActivityTs
    ),
    snoozed: (left, right) =>
      (left.snoozedUntilTs ?? 0) - (right.snoozedUntilTs ?? 0) ||
      compareCrossRoomThreadEntries(left, right),
    idle: byTsDesc((entry) => finishedTs.get(entry.key) ?? entry.lastActivityTs),
    resolved: byTsDesc((entry) => entry.resolvedTs ?? entry.lastActivityTs),
  };

  const take = (id: SidebarThreadSectionId, max: number): CrossRoomThreadIndexEntry[] =>
    grouped[id].sort(pinnedFirst(pinnedThreadKeys, compares[id])).slice(0, max);
  const working = take('working', Math.max(0, limit));
  const shown: Record<SidebarThreadSectionId, CrossRoomThreadIndexEntry[]> = {
    working,
    idle: take('idle', Math.max(0, limit) - working.length),
    snoozed: take('snoozed', MAX_SIDEBAR_SNOOZED_THREADS),
    resolved: take('resolved', MAX_SIDEBAR_RESOLVED_THREADS),
  };

  return SECTION_ORDER.flatMap((id) =>
    shown[id].length > 0 ? [{ id, entries: shown[id], total: grouped[id].length }] : []
  );
};
