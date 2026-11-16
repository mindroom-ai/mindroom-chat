import type { ThreadRecord } from '../../event-store/threads/types';
import { isThreadWorking } from '../../event-store/threads/threadWorking';
import type { CrossRoomThreadIndexEntry } from '../cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../cross-room/threadSignals';
import { groupThreadSections, THREAD_SECTION_ORDER, type ThreadSectionId } from '../threadSections';

/** One section of a Compact room's cards, in its order. */
export type CompactThreadSection = { id: ThreadSectionId; rootIds: string[] };

/**
 * The Compact room's listed threads (`threadRootIds`, filtered and in the list's order) in the
 * sidebar's sections (`groupThreadSections`), empty ones left out. A thread is Working while an
 * agent streams in it, its message is on its way, or a background job runs in it
 * (`jobThreadIds`). The index entry of the thread (`entryOf`), when the index has it, gives when
 * it started and was resolved, and its signals (`signalsOf`) when its last run finished, as in
 * the sidebar; the record stands in for what it lacks. Ties keep the list's order, and the
 * room's pinned threads (`pinnedRootIds`, in pin order) lead their section.
 */
export const buildCompactThreadSections = ({
  threadRootIds,
  recordMap,
  jobThreadIds,
  entryOf,
  signalsOf,
  pinnedRootIds,
  now,
}: {
  threadRootIds: readonly string[];
  recordMap: ReadonlyMap<string, ThreadRecord>;
  jobThreadIds: ReadonlySet<string>;
  entryOf: (rootId: string) => CrossRoomThreadIndexEntry | undefined;
  signalsOf: (entry: CrossRoomThreadIndexEntry) => ThreadSignals | undefined;
  pinnedRootIds: readonly string[];
  now: number;
}): CompactThreadSection[] => {
  const records = threadRootIds.flatMap((rootId) => recordMap.get(rootId) ?? []);
  const places = new Map(records.map((item, index) => [item, index] as const));
  const pinRanks = new Map(pinnedRootIds.map((rootId, index) => [rootId, index] as const));
  const activityOf = (item: ThreadRecord) => item.status.lastActivityTs ?? 0;
  const sections = groupThreadSections(
    records,
    {
      isWorking: (item) => isThreadWorking(item.status, jobThreadIds.has(item.threadRootId)),
      isResolved: (item) => item.status.isResolved,
      snoozedUntilTs: (item) => item.status.snoozedUntilTs,
      startedTs: (item) =>
        entryOf(item.threadRootId)?.rootTs ?? item.cache.oldestTs ?? activityOf(item),
      finishedTs: (item) => {
        const entry = entryOf(item.threadRootId);
        const signals = entry && signalsOf(entry);
        return Math.max(signals?.outcome?.ts ?? 0, signals?.newsTs ?? 0, activityOf(item));
      },
      resolvedTs: (item) => entryOf(item.threadRootId)?.resolvedTs ?? activityOf(item),
      compare: (left, right) => (places.get(left) ?? 0) - (places.get(right) ?? 0),
      pinRank: (item) => pinRanks.get(item.threadRootId),
    },
    now
  );
  return THREAD_SECTION_ORDER.flatMap((id) =>
    sections[id].length > 0 ? [{ id, rootIds: sections[id].map((item) => item.threadRootId) }] : []
  );
};
