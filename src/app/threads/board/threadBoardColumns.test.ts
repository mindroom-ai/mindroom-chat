import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { BackgroundJob } from '../../matrix/protocol/backgroundJobsContract';
import type { ThreadRecord, ThreadStatusSnapshot } from '../../event-store/threads/types';
import {
  groupThreadBoard,
  threadBoardColumn,
  threadBoardWakeTimes,
  withThreadSchedules,
  type ThreadBoardColumn,
} from './threadBoardColumns';

const NOW = Date.parse('2026-11-16T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const makeRecord = (
  threadRootId: string,
  status: Partial<ThreadStatusSnapshot> = {}
): ThreadRecord => ({
  roomId: '!room:server',
  threadRootId,
  rootEventId: threadRootId,
  presentation: {
    summaryInfo: undefined,
    summaryText: undefined,
    rootPreviewText: undefined,
    latestReplyPreviewText: undefined,
    lastSenderId: undefined,
    lastSenderDisplayName: undefined,
    messageCount: 0,
    participantIds: [],
    replyParticipantIds: [],
    primarySummaryText: undefined,
    recentThreadSummaryText: undefined,
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 0,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    lastActivityTs: 0,
    tags: [],
    ...status,
  },
  cache: { eventCount: 0, relationSnapshotComplete: false, tailLoaded: false },
  absoluteIndex: 0,
});

const scheduleEvent = (
  threadId: string | null,
  executeAt: number | null,
  { status = 'pending' } = {}
): MatrixEvent =>
  ({
    getStateKey: () => `task-${String(threadId)}-${String(executeAt)}`,
    getContent: () => ({
      status,
      thread_id: threadId,
      new_thread: false,
      execute_at: executeAt === null ? null : new Date(executeAt).toISOString(),
      ...(executeAt === null ? { cron_description: 'Every Monday at 9:00' } : {}),
    }),
  } as unknown as MatrixEvent);

const job = (threadId: string | null): BackgroundJob => ({
  jobId: `job-${String(threadId)}`,
  agentId: '@agent:server',
  threadId,
  kind: 'tool',
  tool: 'shell',
  status: 'running',
  startedAt: '2026-11-16T11:00:00Z',
});

// Each state alone, as a record, the room's jobs and schedules make it.
type Facts = { status?: Partial<ThreadStatusSnapshot>; job?: boolean; scheduledAt?: number | null };
const columnOf = ({ status, job: hasJob = false, scheduledAt }: Facts, now = NOW) => {
  const records = withThreadSchedules(
    new Map([['$t', makeRecord('$t', status)]]),
    scheduledAt === undefined ? [] : [scheduleEvent('$t', scheduledAt)],
    now
  );
  const record = records.get('$t');
  if (!record) throw new Error('no record');
  return threadBoardColumn(record, { hasJob, now });
};

const streaming: Facts['status'] = { isStreaming: true };
const resolved: Facts['status'] = { isResolved: true };
const snoozed: Facts['status'] = { snoozedUntilTs: NOW + HOUR };

describe('threadBoardColumn', () => {
  it.each<[string, Facts, ThreadBoardColumn]>([
    ['nothing', {}, 'open'],
    ['a streaming reply', { status: streaming }, 'working'],
    ['a live job', { job: true }, 'working'],
    ['a snooze', { status: snoozed }, 'later'],
    ['a pending schedule', { scheduledAt: NOW + HOUR }, 'later'],
    ['a recurring schedule without a time', { scheduledAt: null }, 'later'],
    ['a resolution', { status: resolved }, 'done'],
    ['an unread reply', { status: { isUnread: true } }, 'open'],
  ])('puts a thread with %s alone in its column', (_name, facts, column) => {
    expect(columnOf(facts)).toBe(column);
  });

  it.each<[string, Facts, ThreadBoardColumn]>([
    ['streaming and resolved', { status: { ...streaming, ...resolved } }, 'working'],
    ['streaming and snoozed', { status: { ...streaming, ...snoozed } }, 'working'],
    ['streaming and scheduled', { status: streaming, scheduledAt: NOW + HOUR }, 'working'],
    ['a job and resolved', { job: true, status: resolved }, 'working'],
    ['a job and snoozed', { job: true, status: snoozed }, 'working'],
    ['a job and scheduled', { job: true, scheduledAt: NOW + HOUR }, 'working'],
    ['streaming and a job', { job: true, status: streaming }, 'working'],
    ['resolved and snoozed', { status: { ...resolved, ...snoozed } }, 'done'],
    ['resolved and scheduled', { status: resolved, scheduledAt: NOW + HOUR }, 'done'],
    ['snoozed and scheduled', { status: snoozed, scheduledAt: NOW + HOUR }, 'later'],
    ['unread and snoozed', { status: { isUnread: true, ...snoozed } }, 'later'],
    ['unread and resolved', { status: { isUnread: true, ...resolved } }, 'done'],
    ['unread and streaming', { status: { isUnread: true, ...streaming } }, 'working'],
  ])('puts a thread %s in one column, by Working, Done, Later, Open', (_name, facts, column) => {
    expect(columnOf(facts)).toBe(column);
  });

  it('puts a thread whose snooze has passed in Open', () => {
    expect(columnOf({ status: { snoozedUntilTs: NOW - 1 } })).toBe('open');
    expect(columnOf({ status: { snoozedUntilTs: NOW } })).toBe('open');
  });

  it('puts a thread whose one-time schedule has passed in Open', () => {
    expect(columnOf({ scheduledAt: NOW - 1 })).toBe('open');
    expect(columnOf({ scheduledAt: NOW })).toBe('open');
    // The same schedule, read before its time.
    expect(columnOf({ scheduledAt: NOW }, NOW - 1)).toBe('later');
  });
});

type Thread = [string, Partial<ThreadStatusSnapshot>];

const records = (entries: Thread[]) =>
  new Map(entries.map(([id, status]) => [id, makeRecord(id, status)]));

/** The board of these threads, with the room's jobs and schedules, at `NOW`. */
const board = (
  entries: Thread[],
  { jobs = [] as BackgroundJob[], events = [] as MatrixEvent[] } = {}
) => groupThreadBoard(withThreadSchedules(records(entries), events, NOW), { jobs, now: NOW });

describe('withThreadSchedules', () => {
  it('gives a record its pending schedules at the clock, and keeps the others as they were', () => {
    const map = records([
      ['$scheduled', {}],
      ['$past', {}],
      ['$plain', {}],
    ]);
    const result = withThreadSchedules(
      map,
      [scheduleEvent('$scheduled', NOW + HOUR), scheduleEvent('$past', NOW - 1)],
      NOW
    );
    expect(result.get('$scheduled')?.status).toMatchObject({
      scheduledTaskCount: 1,
      nextScheduledTs: NOW + HOUR,
    });
    expect(result.get('$past')).toBe(map.get('$past'));
    expect(result.get('$plain')).toBe(map.get('$plain'));
  });

  it('carries a recurring schedule description for the card', () => {
    const result = withThreadSchedules(
      records([['$cron', {}]]),
      [scheduleEvent('$cron', null)],
      NOW
    );
    expect(result.get('$cron')?.status).toMatchObject({
      scheduledTaskCount: 1,
      cronDescription: 'Every Monday at 9:00',
    });
  });
});

describe('groupThreadBoard', () => {
  it('puts every thread in exactly one column', () => {
    expect(
      board([
        ['$open', {}],
        ['$done', resolved],
        ['$later', snoozed],
        ['$working', streaming],
      ])
    ).toEqual({
      working: ['$working'],
      later: ['$later'],
      open: ['$open'],
      done: ['$done'],
    });
  });

  it('moves no thread for a job whose threadId is null, nor for one of another thread', () => {
    const columns = board(
      [
        ['$a', {}],
        ['$b', {}],
      ],
      { jobs: [job(null), job('$other')] }
    );
    expect(columns.working).toEqual([]);
    expect(columns.open).toEqual(['$a', '$b']);
  });

  it('puts a thread a live job names in Working', () => {
    const columns = board(
      [
        ['$a', {}],
        ['$b', {}],
      ],
      { jobs: [job('$b')] }
    );
    expect(columns.working).toEqual(['$b']);
  });

  it('reads the schedules at its clock: one whose time passed leaves Later', () => {
    const columns = board(
      [
        ['$past', {}],
        ['$future', {}],
      ],
      { events: [scheduleEvent('$past', NOW - 1), scheduleEvent('$future', NOW + HOUR)] }
    );
    expect(columns.later).toEqual(['$future']);
    expect(columns.open).toEqual(['$past']);
  });

  it('reads only pending schedules of a thread', () => {
    const columns = board(
      [
        ['$a', {}],
        ['$b', {}],
      ],
      {
        events: [
          scheduleEvent('$a', NOW + HOUR, { status: 'cancelled' }),
          scheduleEvent(null, NOW + HOUR),
        ],
      }
    );
    expect(columns.later).toEqual([]);
  });

  it('orders Working and Done by newest activity first', () => {
    const columns = board([
      ['$w-old', { isStreaming: true, lastActivityTs: 1 }],
      ['$d-old', { isResolved: true, lastActivityTs: 2 }],
      ['$w-new', { isStreaming: true, lastActivityTs: 3 }],
      ['$d-new', { isResolved: true, lastActivityTs: 4 }],
    ]);
    expect(columns.working).toEqual(['$w-new', '$w-old']);
    expect(columns.done).toEqual(['$d-new', '$d-old']);
  });

  it('puts unread threads first in Open, each part newest first', () => {
    const columns = board([
      ['$read-new', { lastActivityTs: 4 }],
      ['$unread-old', { isUnread: true, lastActivityTs: 1 }],
      ['$read-old', { lastActivityTs: 2 }],
      ['$unread-new', { isUnread: true, lastActivityTs: 3 }],
    ]);
    expect(columns.open).toEqual(['$unread-new', '$unread-old', '$read-new', '$read-old']);
  });

  it('orders Later soonest first, by snooze end or next run, a schedule without a time last', () => {
    const columns = board(
      [
        ['$snooze-late', { snoozedUntilTs: NOW + 3 * HOUR }],
        ['$cron', {}],
        ['$run-soon', {}],
        ['$snooze-soon', { snoozedUntilTs: NOW + HOUR }],
        // Snoozed past its next run: that run comes first.
        ['$both', { snoozedUntilTs: NOW + 5 * HOUR }],
      ],
      {
        events: [
          scheduleEvent('$cron', null),
          scheduleEvent('$run-soon', NOW + 2 * HOUR),
          scheduleEvent('$both', NOW + 2.5 * HOUR),
        ],
      }
    );
    expect(columns.later).toEqual(['$snooze-soon', '$run-soon', '$both', '$snooze-late', '$cron']);
  });
});

describe('threadBoardWakeTimes', () => {
  it('lists every snooze end and pending one-time run, so the board looks again at each', () => {
    const times = threadBoardWakeTimes(
      records([
        ['$a', { snoozedUntilTs: NOW + HOUR }],
        ['$b', {}],
      ]),
      [
        scheduleEvent('$b', NOW + 2 * HOUR),
        scheduleEvent('$b', null),
        scheduleEvent('$b', NOW + 3 * HOUR, { status: 'completed' }),
      ]
    );
    expect(times.filter((ts) => ts !== undefined).sort()).toEqual([NOW + HOUR, NOW + 2 * HOUR]);
  });
});
