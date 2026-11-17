import type { ThreadRecord } from '../../event-store/threads/types';
import {
  classifyThreadWorkflow,
  threadReturnTs,
  type ThreadWorkflowBucket,
} from '../../event-store/threads/threadWorkflow';
import type { CrossRoomThreadIndexEntry } from '../cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../cross-room/threadSignals';
import { holdOrder } from './useHeldThreadOrder';

/** The sections in the order they show: Working on top, then as the workflow tabs. */
export const COMPACT_THREAD_SECTION_ORDER: readonly ThreadWorkflowBucket[] = [
  'working',
  'needsYou',
  'later',
  'done',
];

/** One section of a Compact room's cards, in its order. */
export type CompactThreadSection = { id: ThreadWorkflowBucket; rootIds: string[] };

type Compare = (left: ThreadRecord, right: ThreadRecord) => number;

/**
 * The Compact room's listed threads (`threadRootIds`, filtered and in the list's order) in the
 * workflow buckets the tabs count (`classifyThreadWorkflow`), empty ones left out, so a tab that
 * shows one bucket shows one section. Working goes by when each thread started, Needs you by when
 * its last run finished or its newest message came (`signalsOf`, read once per such thread; a
 * streaming reply's edits count only once it ends), Later by when it comes back
 * (`threadReturnTs`), soonest first, and Done by when it was resolved. The index entry of the
 * thread (`entryOf`), when the index has it, gives when it started and was resolved; the record
 * stands in for what it lacks. Ties keep the list's order, and the room's pinned threads
 * (`pinnedRootIds`, in the list's order) lead their section.
 */
export const buildCompactThreadSections = ({
  threadRootIds,
  recordMap,
  entryOf,
  signalsOf,
  pinnedRootIds,
  now,
}: {
  threadRootIds: readonly string[];
  recordMap: ReadonlyMap<string, ThreadRecord>;
  entryOf: (rootId: string) => CrossRoomThreadIndexEntry | undefined;
  signalsOf: (entry: CrossRoomThreadIndexEntry) => ThreadSignals | undefined;
  pinnedRootIds: readonly string[];
  now: number;
}): CompactThreadSection[] => {
  const grouped: Record<ThreadWorkflowBucket, ThreadRecord[]> = {
    working: [],
    needsYou: [],
    later: [],
    done: [],
  };
  const places = new Map<ThreadRecord, number>();
  threadRootIds.forEach((rootId) => {
    const item = recordMap.get(rootId);
    if (!item) return;
    places.set(item, places.size);
    grouped[classifyThreadWorkflow(item.status, now)].push(item);
  });

  const listOrder: Compare = (left, right) => (places.get(left) ?? 0) - (places.get(right) ?? 0);
  const newestFirst =
    (tsOf: (item: ThreadRecord) => number): Compare =>
    (left, right) =>
      tsOf(right) - tsOf(left) || listOrder(left, right);
  const activityOf = (item: ThreadRecord) => item.status.lastActivityTs ?? 0;
  const finishedTs = new Map(
    grouped.needsYou.map((item) => {
      const entry = entryOf(item.threadRootId);
      const signals = entry && signalsOf(entry);
      // A reply that still streams counts from when it was sent (`activityOf`), not by its
      // newest edit (`newsTs`), so a thread that needs you keeps its place at every chunk.
      const newsTs = item.status.isStreaming ? 0 : signals?.newsTs ?? 0;
      const ts = Math.max(signals?.outcome?.ts ?? 0, newsTs, activityOf(item));
      return [item, ts] as const;
    })
  );
  const compares: Record<ThreadWorkflowBucket, Compare> = {
    working: newestFirst(
      (item) => entryOf(item.threadRootId)?.rootTs ?? item.cache.oldestTs ?? activityOf(item)
    ),
    needsYou: newestFirst((item) => finishedTs.get(item) ?? 0),
    later: (left, right) =>
      threadReturnTs(left.status, now) - threadReturnTs(right.status, now) ||
      listOrder(left, right),
    done: newestFirst((item) => entryOf(item.threadRootId)?.resolvedTs ?? activityOf(item)),
  };

  const pinRanks = new Map(pinnedRootIds.map((rootId, index) => [rootId, index] as const));
  const pinnedFirst =
    (compare: Compare): Compare =>
    (left, right) => {
      const leftRank = pinRanks.get(left.threadRootId);
      const rightRank = pinRanks.get(right.threadRootId);
      if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
      if (leftRank !== undefined) return -1;
      if (rightRank !== undefined) return 1;
      return compare(left, right);
    };

  return COMPACT_THREAD_SECTION_ORDER.flatMap((id) =>
    grouped[id].length > 0
      ? [
          {
            id,
            rootIds: grouped[id].sort(pinnedFirst(compares[id])).map((item) => item.threadRootId),
          },
        ]
      : []
  );
};

/**
 * The sections while the cards' order is held, the one hold of a list in sections: each card in
 * the sections shown before (`shown`) stays in the section it showed in, at its place there
 * (`holdOrder`), and each of those sections stays, emptied or not, so no header comes or goes
 * under the pointer. A thread new to the list takes its section in `live`, whose header comes
 * with it, and joins that section where the live order puts it.
 */
export const holdCompactThreadSections = (
  live: readonly CompactThreadSection[],
  shown: readonly CompactThreadSection[]
): CompactThreadSection[] => {
  const shownIn = new Map(
    shown.flatMap(({ id, rootIds }) => rootIds.map((rootId) => [rootId, id] as const))
  );
  return COMPACT_THREAD_SECTION_ORDER.flatMap((id) => {
    const members = live.flatMap((section) =>
      section.rootIds.filter((rootId) => (shownIn.get(rootId) ?? section.id) === id)
    );
    const shownSection = shown.find((section) => section.id === id);
    if (!shownSection) return members.length > 0 ? [{ id, rootIds: members }] : [];
    return [{ id, rootIds: holdOrder(shownSection.rootIds, members) }];
  });
};
