import type { ThreadRecord } from '../../event-store/threads/types';
import {
  classifyThreadWorkflow,
  isQuietThread,
  nextThreadQuietTs,
  threadQuietActivityTs,
  threadReturnTs,
  type ThreadWorkflowBucket,
} from '../../event-store/threads/threadWorkflow';
import type { CrossRoomThreadIndexEntry } from '../cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../cross-room/threadSignals';

export type CompactThreadSectionId = ThreadWorkflowBucket | 'quiet';

/** The sections in workflow-tab order, with Quiet folded before Done. */
export const COMPACT_THREAD_SECTION_ORDER: readonly CompactThreadSectionId[] = [
  'needsYou',
  'working',
  'later',
  'quiet',
  'done',
];

const isCompactThreadSectionId = (value: unknown): value is CompactThreadSectionId =>
  COMPACT_THREAD_SECTION_ORDER.some((id) => id === value);

/** Keeps valid unique saved section IDs and appends any missing IDs in canonical order. */
export const normalizeCompactSectionOrder = (order: unknown): CompactThreadSectionId[] => {
  const seen = new Set<CompactThreadSectionId>();
  const normalized: CompactThreadSectionId[] = [];
  if (Array.isArray(order)) {
    for (const id of order) {
      if (isCompactThreadSectionId(id) && !seen.has(id)) {
        seen.add(id);
        normalized.push(id);
      }
    }
  }
  for (const id of COMPACT_THREAD_SECTION_ORDER) {
    if (!seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }
  return normalized;
};

/** One section of a Compact room's cards, in its order. */
export type CompactThreadSection = { id: CompactThreadSectionId; rootIds: string[] };

type BuildCompactThreadSectionsInput = {
  threadRootIds: readonly string[];
  recordMap: ReadonlyMap<string, ThreadRecord>;
  entryOf: (rootId: string) => CrossRoomThreadIndexEntry | undefined;
  signalsOf: (entry: CrossRoomThreadIndexEntry) => ThreadSignals | undefined;
  pinnedRootIds: readonly string[];
  now: number;
  quietNow?: number;
  sectionOrder?: readonly CompactThreadSectionId[];
};

type Compare = (left: ThreadRecord, right: ThreadRecord) => number;

/**
 * The Compact room's listed threads in workflow buckets (`classifyThreadWorkflow` at `now`),
 * splitting read, inactive Needs you threads into Quiet (`isQuietThread` at `quietNow`), empty
 * sections omitted. Needs you and Quiet sort by `threadQuietActivityTs` (reading `signalsOf` once
 * per Needs you candidate); pinned threads lead their section.
 */
export const buildCompactThreadSections = ({
  threadRootIds,
  recordMap,
  entryOf,
  signalsOf,
  pinnedRootIds,
  now,
  quietNow = now,
  sectionOrder,
}: BuildCompactThreadSectionsInput): {
  sections: CompactThreadSection[];
  nextQuietWakeTs?: number;
} => {
  const grouped: Record<CompactThreadSectionId, ThreadRecord[]> = {
    working: [],
    needsYou: [],
    later: [],
    quiet: [],
    done: [],
  };
  const places = new Map<ThreadRecord, number>();
  const pinRanks = new Map(pinnedRootIds.map((rootId, index) => [rootId, index] as const));
  const finishedTs = new Map<ThreadRecord, number>();
  let nextQuietWakeTs: number | undefined;

  threadRootIds.forEach((rootId) => {
    const item = recordMap.get(rootId);
    if (!item) return;
    places.set(item, places.size);
    const bucket = classifyThreadWorkflow(item.status, now);
    if (bucket !== 'needsYou') {
      grouped[bucket].push(item);
      return;
    }
    const entry = entryOf(item.threadRootId);
    const signals = entry && signalsOf(entry);
    const quietInput = { ...item.status, isPinned: pinRanks.has(item.threadRootId), signals };
    finishedTs.set(
      item,
      threadQuietActivityTs({
        ...item.status,
        outcomeTs: signals?.outcome?.ts,
        newsTs: signals?.newsTs,
        now: quietNow,
      })
    );
    if (isQuietThread(quietInput, quietNow)) {
      grouped.quiet.push(item);
    } else {
      grouped.needsYou.push(item);
      const wakeTs = nextThreadQuietTs(quietInput, quietNow);
      if (wakeTs !== undefined && (nextQuietWakeTs === undefined || wakeTs < nextQuietWakeTs)) {
        nextQuietWakeTs = wakeTs;
      }
    }
  });

  const listOrder: Compare = (left, right) => (places.get(left) ?? 0) - (places.get(right) ?? 0);
  const newestFirst =
    (tsOf: (item: ThreadRecord) => number): Compare =>
    (left, right) =>
      tsOf(right) - tsOf(left) || listOrder(left, right);
  const activityOf = (item: ThreadRecord) => item.status.lastActivityTs ?? 0;
  const byFinished = newestFirst((item) => finishedTs.get(item) ?? 0);
  const compares: Record<CompactThreadSectionId, Compare> = {
    working: newestFirst(
      (item) => entryOf(item.threadRootId)?.rootTs ?? item.cache.oldestTs ?? activityOf(item)
    ),
    needsYou: byFinished,
    later: (left, right) =>
      threadReturnTs(left.status, now) - threadReturnTs(right.status, now) ||
      listOrder(left, right),
    quiet: byFinished,
    done: newestFirst((item) => entryOf(item.threadRootId)?.resolvedTs ?? activityOf(item)),
  };

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

  const orderedIds = sectionOrder
    ? normalizeCompactSectionOrder(sectionOrder)
    : COMPACT_THREAD_SECTION_ORDER;
  const sections = orderedIds.flatMap((id) =>
    grouped[id].length > 0
      ? [
          {
            id,
            rootIds: grouped[id].sort(pinnedFirst(compares[id])).map((item) => item.threadRootId),
          },
        ]
      : []
  );
  return nextQuietWakeTs !== undefined ? { sections, nextQuietWakeTs } : { sections };
};
