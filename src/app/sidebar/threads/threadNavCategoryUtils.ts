import type { CrossRoomThreadIndexEntry } from '../../threads/cross-room/crossRoomThreadIndex';
import { compareCrossRoomThreadEntries } from '../../threads/cross-room/crossRoomThreadOrder';
import type { ThreadSignals } from '../../threads/cross-room/threadSignals';
import {
  classifyThreadWorkflow,
  isQuietThread,
  threadQuietActivityTs,
  threadReturnTs,
} from '../../event-store/threads/threadWorkflow';
import { isSnoozedAt } from '../../event-store/threads/threadSnooze';

export const MAX_SIDEBAR_THREADS = 50;
export const MAX_SIDEBAR_RESOLVED_THREADS = 20;
export const MAX_SIDEBAR_LATER_THREADS = 20;
export const MAX_SIDEBAR_QUIET_THREADS = 20;

export const matchesSidebarThreadInvolvement = (
  entry: Pick<CrossRoomThreadIndexEntry, 'key' | 'isForUser'>,
  involvedOnly: boolean,
  pinnedKeys: ReadonlySet<string>
): boolean => !involvedOnly || entry.isForUser || pinnedKeys.has(entry.key);

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

export type SidebarThreadSectionId = 'working' | 'later' | 'idle' | 'quiet' | 'resolved';
export type SidebarThreadSection = {
  id: SidebarThreadSectionId;
  /** The section's rows, at most its cap. */
  entries: CrossRoomThreadIndexEntry[];
  /** How many threads the section holds, also those past its cap. */
  total: number;
};

const SECTION_ORDER: SidebarThreadSectionId[] = ['idle', 'working', 'later', 'quiet', 'resolved'];

const sectionOf = (
  entry: CrossRoomThreadIndexEntry,
  now: number
): Exclude<SidebarThreadSectionId, 'quiet'> => {
  const bucket = classifyThreadWorkflow(
    {
      ...entry.threadRecord.status,
      isResolved: entry.isResolved,
      snoozedUntilTs: entry.snoozedUntilTs,
    },
    now
  );
  const sections = {
    working: 'working',
    done: 'resolved',
    later: 'later',
    needsYou: 'idle',
  } as const;
  return sections[bucket];
};

/** Newest first by `tsOf`, ties in the usual cross-room order. */
const byTsDesc =
  (tsOf: (entry: CrossRoomThreadIndexEntry) => number): Compare =>
  (left, right) =>
    tsOf(right) - tsOf(left) || compareCrossRoomThreadEntries(left, right);

/**
 * The sidebar's THREADS display nonempty sections in order: Idle (Needs you), Working, Later,
 * Quiet, Resolved (Done). Working fills the shared `limit` first and Idle gets the remainder;
 * Later, Quiet and Resolved each have separate caps while reporting uncapped `total`.
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
    later: [],
    idle: [],
    quiet: [],
    resolved: [],
  };
  const pinnedSet = new Set(pinnedThreadKeys);
  const finishedTs = new Map<string, number>();

  for (const entry of entries) {
    if (directRoomIds.has(entry.roomId)) continue;
    const section = sectionOf(entry, now);
    if (section !== 'idle') {
      grouped[section].push(entry);
      continue;
    }
    const signals = signalsOf(entry);
    const quietInput = {
      ...entry.threadRecord.status,
      isPinned: pinnedSet.has(entry.key),
      isUnread: entry.isUnread,
      lastActivityTs: entry.lastActivityTs,
      snoozedUntilTs: entry.snoozedUntilTs,
      signals,
    };
    finishedTs.set(
      entry.key,
      threadQuietActivityTs({
        ...quietInput,
        outcomeTs: signals?.outcome?.ts,
        newsTs: signals?.newsTs,
        now,
      })
    );
    grouped[isQuietThread(quietInput, now) ? 'quiet' : 'idle'].push(entry);
  }

  const returnTs = (entry: CrossRoomThreadIndexEntry): number =>
    threadReturnTs(
      {
        snoozedUntilTs: entry.snoozedUntilTs,
        nextScheduledTs: entry.threadRecord.status.nextScheduledTs,
      },
      now
    );
  const byFinished = byTsDesc((entry) => finishedTs.get(entry.key) ?? entry.lastActivityTs);
  const compares: Record<SidebarThreadSectionId, Compare> = {
    working: byTsDesc(
      (entry) => entry.rootTs ?? entry.threadRecord.cache.oldestTs ?? entry.lastActivityTs
    ),
    later: (left, right) =>
      returnTs(left) - returnTs(right) || compareCrossRoomThreadEntries(left, right),
    idle: byFinished,
    quiet: byFinished,
    resolved: byTsDesc((entry) => entry.resolvedTs ?? entry.lastActivityTs),
  };

  const take = (id: SidebarThreadSectionId, max: number): CrossRoomThreadIndexEntry[] =>
    grouped[id].sort(pinnedFirst(pinnedThreadKeys, compares[id])).slice(0, max);
  const working = take('working', Math.max(0, limit));
  const shown: Record<SidebarThreadSectionId, CrossRoomThreadIndexEntry[]> = {
    working,
    idle: take('idle', Math.max(0, limit) - working.length),
    later: take('later', MAX_SIDEBAR_LATER_THREADS),
    quiet: take('quiet', MAX_SIDEBAR_QUIET_THREADS),
    resolved: take('resolved', MAX_SIDEBAR_RESOLVED_THREADS),
  };

  return SECTION_ORDER.flatMap((id) =>
    shown[id].length > 0 ? [{ id, entries: shown[id], total: grouped[id].length }] : []
  );
};
