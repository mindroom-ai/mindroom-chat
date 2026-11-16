import type { MatrixEvent } from 'matrix-js-sdk';
import type { BackgroundJob } from '../../matrix/protocol/backgroundJobsContract';
import {
  parseScheduleTimestamp,
  parseScheduledTaskStateEvent,
} from '../../matrix/protocol/scheduledTaskContract';
import {
  buildRoomThreadScheduledStatusMap,
  getThreadScheduledStatus,
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
  { status }: ThreadRecord,
  {
    hasJob,
    now,
  }: {
    /** Whether a live background job names the thread. */
    hasJob: boolean;
    now: number;
  }
): ThreadBoardColumn => {
  if (status.isStreaming || hasJob) return 'working';
  if (status.isResolved) return 'done';
  if (isSnoozedAt(status.snoozedUntilTs, now) || status.scheduledTaskCount > 0) return 'later';
  return 'open';
};

/**
 * The records with the room's pending schedules at `now` (`scheduledTaskCount`, `nextScheduledTs`,
 * `cronDescription`), which the card shows; a record whose schedules are unchanged stays the same.
 */
export const withThreadSchedules = (
  records: ReadonlyMap<string, ThreadRecord>,
  scheduledTaskEvents: readonly MatrixEvent[],
  now: number
): ReadonlyMap<string, ThreadRecord> => {
  const scheduledMap = buildRoomThreadScheduledStatusMap(scheduledTaskEvents, now);
  const result = new Map<string, ThreadRecord>();
  records.forEach((record, rootId) => {
    const { scheduledTaskCount, nextScheduledTs, cronDescription } = getThreadScheduledStatus(
      scheduledMap,
      rootId
    );
    const { status } = record;
    const same =
      status.scheduledTaskCount === scheduledTaskCount &&
      status.nextScheduledTs === nextScheduledTs &&
      status.cronDescription === cronDescription;
    result.set(
      rootId,
      same
        ? record
        : { ...record, status: { ...status, scheduledTaskCount, nextScheduledTs, cronDescription } }
    );
  });
  return result;
};

const newestFirst = (a: ThreadRecord, b: ThreadRecord) =>
  (b.status.lastActivityTs ?? 0) - (a.status.lastActivityTs ?? 0);

/**
 * The threads of `records` in their columns: Working and Done newest activity first, Open its
 * unread threads first, Later soonest first (the snooze's end or the next run, a schedule without
 * a time last).
 */
export const groupThreadBoard = (
  records: ReadonlyMap<string, ThreadRecord>,
  { jobs, now }: { jobs: readonly BackgroundJob[]; now: number }
): Record<ThreadBoardColumn, string[]> => {
  // A job of no thread (null) names none.
  const jobThreadIds = new Set(jobs.map((job) => job.threadId));
  const columns: Record<ThreadBoardColumn, ThreadRecord[]> = {
    working: [],
    later: [],
    open: [],
    done: [],
  };
  records.forEach((record, rootId) => {
    columns[threadBoardColumn(record, { hasJob: jobThreadIds.has(rootId), now })].push(record);
  });
  const laterTs = ({ status }: ThreadRecord) =>
    Math.min(
      isSnoozedAt(status.snoozedUntilTs, now) ? status.snoozedUntilTs ?? Infinity : Infinity,
      status.nextScheduledTs ?? Infinity
    );
  const soonest = (a: ThreadRecord, b: ThreadRecord) =>
    laterTs(a) - laterTs(b) || newestFirst(a, b);
  const unreadFirst = (a: ThreadRecord, b: ThreadRecord) =>
    Number(b.status.isUnread) - Number(a.status.isUnread) || newestFirst(a, b);
  const ids = (list: ThreadRecord[]) => list.map((record) => record.threadRootId);
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
