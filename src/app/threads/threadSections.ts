import { isSnoozedAt } from '../event-store/threads/threadSnooze';

/** The sections a list of threads can show in, in the order they show. */
export type ThreadSectionId = 'working' | 'snoozed' | 'idle' | 'resolved';
export const THREAD_SECTION_ORDER: readonly ThreadSectionId[] = [
  'working',
  'snoozed',
  'idle',
  'resolved',
];

/** How a list reads what places one of its threads in a section and orders it there. */
export type ThreadSectionReader<T> = {
  /** An agent streams in it, the message is on its way, or a job runs in it (`isThreadWorking`). */
  isWorking: (item: T) => boolean;
  isResolved: (item: T) => boolean;
  snoozedUntilTs: (item: T) => number | undefined;
  /** When the thread started: Working shows the newest first, and a streamed reply moves none. */
  startedTs: (item: T) => number;
  /** When its last reply finished: Idle shows the newest first. Read once per Idle thread. */
  finishedTs: (item: T) => number;
  /** When it was resolved: Resolved shows the newest first. */
  resolvedTs: (item: T) => number;
  /** The order of threads whose times are equal, and of Snoozed threads that wake together. */
  compare: (left: T, right: T) => number;
  /** A pinned thread's rank: pinned threads lead their section, by rank. */
  pinRank: (item: T) => number | undefined;
};

type Compare<T> = (left: T, right: T) => number;

const pinnedFirst =
  <T>(pinRank: (item: T) => number | undefined, compare: Compare<T>): Compare<T> =>
  (left, right) => {
    const leftRank = pinRank(left);
    const rightRank = pinRank(right);
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    return compare(left, right);
  };

/**
 * Each thread in the first section that fits, at `now`: Working, then Resolved, then Snoozed,
 * else Idle; and each section in its order, pinned threads first. Working goes by when each
 * thread started, Snoozed by when its snooze ends, soonest first, Idle by when its last reply
 * finished, and Resolved by when it was resolved, newest first. The sidebar's THREADS and the
 * Compact room share it, each with its own reader.
 */
export const groupThreadSections = <T>(
  items: Iterable<T>,
  reader: ThreadSectionReader<T>,
  now: number
): Record<ThreadSectionId, T[]> => {
  const sections: Record<ThreadSectionId, T[]> = {
    working: [],
    snoozed: [],
    idle: [],
    resolved: [],
  };
  for (const item of items) {
    let id: ThreadSectionId = 'idle';
    if (reader.isWorking(item)) id = 'working';
    else if (reader.isResolved(item)) id = 'resolved';
    else if (isSnoozedAt(reader.snoozedUntilTs(item), now)) id = 'snoozed';
    sections[id].push(item);
  }

  const finished = new Map(sections.idle.map((item) => [item, reader.finishedTs(item)] as const));
  const newestFirst =
    (tsOf: (item: T) => number): Compare<T> =>
    (left, right) =>
      tsOf(right) - tsOf(left) || reader.compare(left, right);
  const compares: Record<ThreadSectionId, Compare<T>> = {
    working: newestFirst(reader.startedTs),
    snoozed: (left, right) =>
      (reader.snoozedUntilTs(left) ?? 0) - (reader.snoozedUntilTs(right) ?? 0) ||
      reader.compare(left, right),
    idle: newestFirst((item) => finished.get(item) ?? 0),
    resolved: newestFirst(reader.resolvedTs),
  };
  THREAD_SECTION_ORDER.forEach((id) =>
    sections[id].sort(pinnedFirst(reader.pinRank, compares[id]))
  );
  return sections;
};
