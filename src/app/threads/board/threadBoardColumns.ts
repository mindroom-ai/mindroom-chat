import type { MatrixEvent } from 'matrix-js-sdk';
import type { BackgroundJob } from '../../matrix/protocol/backgroundJobsContract';
import {
  parseScheduleTimestamp,
  parseScheduledTaskStateEvent,
} from '../../matrix/protocol/scheduledTaskContract';
import {
  buildRoomThreadScheduledStatusMap,
  getThreadScheduledStatus,
  type ThreadScheduledStatus,
} from '../../event-store/threads/threadScheduledStatus';
import { isSnoozedAt } from '../../event-store/threads/threadSnooze';
import type { ThreadRecord } from '../../event-store/threads/types';

/** The board's columns, left to right. */
export const THREAD_BOARD_COLUMNS = ['working', 'later', 'open', 'done'] as const;
export type ThreadBoardColumn = (typeof THREAD_BOARD_COLUMNS)[number];

/**
 * The column of a thread, by what Chat knows of it at `now`. Where several apply, Working wins,
 * then Done, then Later: a resolved thread that streams again works, a resolved one with a
 * schedule is done.
 */
export const threadBoardColumn = (
  record: ThreadRecord,
  {
    hasJob,
    scheduled,
    now,
  }: {
    /** Whether a live background job names the thread. */
    hasJob: boolean;
    /** The thread's pending schedules at `now`. */
    scheduled: ThreadScheduledStatus;
    now: number;
  }
): ThreadBoardColumn => {
  const { status } = record;
  if (status.isStreaming || hasJob) return 'working';
  if (status.isResolved) return 'done';
  if (isSnoozedAt(status.snoozedUntilTs, now) || scheduled.scheduledTaskCount > 0) return 'later';
  return 'open';
};

const newestFirst = (a: ThreadRecord, b: ThreadRecord) =>
  (b.status.lastActivityTs ?? 0) - (a.status.lastActivityTs ?? 0);

/**
 * The listed threads `rootIds` in their columns: Working and Done newest activity first, Open its
 * unread threads first, Later soonest first (the snooze's end or the next run, a schedule without
 * a time last). A thread without a record is in none.
 */
export const groupThreadBoard = (
  rootIds: readonly string[],
  records: ReadonlyMap<string, ThreadRecord>,
  {
    jobs,
    scheduledTaskEvents,
    now,
  }: { jobs: readonly BackgroundJob[]; scheduledTaskEvents: readonly MatrixEvent[]; now: number }
): Record<ThreadBoardColumn, string[]> => {
  // A job of no thread (null) names none.
  const jobThreadIds = new Set(jobs.map((job) => job.threadId));
  const scheduledMap = buildRoomThreadScheduledStatusMap(scheduledTaskEvents, now);
  const columns: Record<ThreadBoardColumn, ThreadRecord[]> = {
    working: [],
    later: [],
    open: [],
    done: [],
  };
  const laterTs = new Map<string, number>();
  rootIds.forEach((rootId) => {
    const record = records.get(rootId);
    if (!record) return;
    const scheduled = getThreadScheduledStatus(scheduledMap, rootId);
    const column = threadBoardColumn(record, {
      hasJob: jobThreadIds.has(rootId),
      scheduled,
      now,
    });
    columns[column].push(record);
    if (column !== 'later') return;
    const snoozedUntilTs = isSnoozedAt(record.status.snoozedUntilTs, now)
      ? record.status.snoozedUntilTs
      : undefined;
    const ts = Math.min(snoozedUntilTs ?? Infinity, scheduled.nextScheduledTs ?? Infinity);
    laterTs.set(rootId, ts);
  });
  const ids = (list: ThreadRecord[]) => list.map((record) => record.threadRootId);
  const soonest = (a: ThreadRecord, b: ThreadRecord) =>
    (laterTs.get(a.threadRootId) ?? Infinity) - (laterTs.get(b.threadRootId) ?? Infinity) ||
    newestFirst(a, b);
  const unreadFirst = (a: ThreadRecord, b: ThreadRecord) =>
    Number(b.status.isUnread) - Number(a.status.isUnread) || newestFirst(a, b);
  return {
    working: ids(columns.working.sort(newestFirst)),
    later: ids(columns.later.sort(soonest)),
    open: ids(columns.open.sort(unreadFirst)),
    done: ids(columns.done.sort(newestFirst)),
  };
};

/** The times a thread may leave Later: each snooze's end and each pending one-time run. */
export const threadBoardWakeTimes = (
  records: ReadonlyMap<string, ThreadRecord>,
  scheduledTaskEvents: readonly MatrixEvent[]
): (number | undefined)[] => [
  ...Array.from(records.values(), (record) => record.status.snoozedUntilTs),
  ...scheduledTaskEvents.map((event) => {
    const task = parseScheduledTaskStateEvent(event);
    return task?.status === 'pending' ? parseScheduleTimestamp(task.executeAt) : undefined;
  }),
];
