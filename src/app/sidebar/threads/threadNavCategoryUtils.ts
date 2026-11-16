import type { CrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import { compareCrossRoomThreadEntries } from '../../threads/cross-room/crossRoomThreadOrder';
import type { ThreadSignals } from '../../threads/cross-room/threadSignals';
import { isSnoozedAt } from '../../event-store/threads/threadSnooze';

export const MAX_SIDEBAR_THREADS = 50;
export const MAX_SIDEBAR_RESOLVED_THREADS = 20;

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
  entries: CrossRoomThreadIndexEntry[];
};

const SECTION_ORDER: SidebarThreadSectionId[] = ['working', 'snoozed', 'idle', 'resolved'];

const sectionOf = (entry: CrossRoomThreadIndexEntry, now: number): SidebarThreadSectionId => {
  const { isStreaming, hasPendingSend } = entry.threadRecord.status;
  if (isStreaming || hasPendingSend === true) return 'working';
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
 * Resolved by when it was resolved, at most `MAX_SIDEBAR_RESOLVED_THREADS`. Working, Idle and
 * Snoozed share `limit`, in that order.
 */
export const buildSidebarThreadSections = (
  entries: Iterable<CrossRoomThreadIndexEntry>,
  pinnedThreadKeys: string[],
  directRoomIds: ReadonlySet<string>,
  now: number,
  signalsOf: (entry: CrossRoomThreadIndexEntry) => ThreadSignals | undefined,
  limit = MAX_SIDEBAR_THREADS
): SidebarThreadSection[] => {
  const grouped = new Map<SidebarThreadSectionId, CrossRoomThreadIndexEntry[]>();
  for (const entry of entries) {
    if (directRoomIds.has(entry.roomId)) continue;
    const id = sectionOf(entry, now);
    grouped.set(id, [...(grouped.get(id) ?? []), entry]);
  }

  const finishedTs = new Map(
    (grouped.get('idle') ?? []).map((entry) => {
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

  let remaining = Math.max(0, limit);
  const take = (id: SidebarThreadSectionId, max: number): CrossRoomThreadIndexEntry[] =>
    (grouped.get(id) ?? []).sort(pinnedFirst(pinnedThreadKeys, compares[id])).slice(0, max);
  const shown = new Map<SidebarThreadSectionId, CrossRoomThreadIndexEntry[]>();
  for (const id of ['working', 'idle', 'snoozed'] as const) {
    const list = take(id, remaining);
    remaining -= list.length;
    shown.set(id, list);
  }
  shown.set('resolved', take('resolved', MAX_SIDEBAR_RESOLVED_THREADS));

  return SECTION_ORDER.flatMap((id) => {
    const list = shown.get(id) ?? [];
    return list.length > 0 ? [{ id, entries: list }] : [];
  });
};
