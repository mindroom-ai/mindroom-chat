import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { BackgroundJob } from '../../matrix/protocol/backgroundJobsContract';
import type { ThreadRecord, ThreadStatusSnapshot } from '../../event-store/threads/types';
import {
  buildRoomThreadScheduledStatusMap,
  getThreadScheduledStatus,
} from '../../event-store/threads/threadScheduledStatus';
import {
  groupThreadBoard,
  threadBoardColumn,
  threadBoardWakeTimes,
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

const iso = (ts: number) => new Date(ts).toISOString();

const scheduleEvent = (
  threadId: string | null,
  executeAt: number | null,
  { status = 'pending', stateKey = `task-${String(threadId)}-${String(executeAt)}` } = {}
): MatrixEvent =>
  ({
    getStateKey: () => stateKey,
    getContent: () => ({
      status,
      thread_id: threadId,
      new_thread: false,
      execute_at: executeAt === null ? null : iso(executeAt),
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
const columnOf = ({ status, job: hasJob = false, scheduledAt }: Facts, now = NOW) =>
  threadBoardColumn(makeRecord('$t', status), {
    hasJob,
    scheduled: getThreadScheduledStatus(
      buildRoomThreadScheduledStatusMap(
        scheduledAt === undefined ? [] : [scheduleEvent('$t', scheduledAt)],
        now
      ),
      '$t'
    ),
    now,
  });

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

describe('groupThreadBoard', () => {
  const records = (entries: [string, Partial<ThreadStatusSnapshot>][]) =>
    new Map(entries.map(([id, status]) => [id, makeRecord(id, status)]));

  it('puts every listed thread in exactly one column, and skips one it has no record of', () => {
    const map = records([
      ['$open', {}],
      ['$done', resolved],
      ['$later', snoozed],
      ['$working', streaming],
    ]);
    const columns = groupThreadBoard(['$open', '$done', '$later', '$working', '$unknown'], map, {
      jobs: [],
      scheduledTaskEvents: [],
      now: NOW,
    });
    expect(columns).toEqual({
      working: ['$working'],
      later: ['$later'],
      open: ['$open'],
      done: ['$done'],
    });
  });

  it('moves no thread for a job whose threadId is null, nor for one of a thread not listed', () => {
    const map = records([
      ['$a', {}],
      ['$b', {}],
    ]);
    const columns = groupThreadBoard(['$a', '$b'], map, {
      jobs: [job(null), job('$other')],
      scheduledTaskEvents: [],
      now: NOW,
    });
    expect(columns.working).toEqual([]);
    expect(columns.open).toEqual(['$a', '$b']);
  });

  it('puts a thread a live job names in Working', () => {
    const columns = groupThreadBoard(
      ['$a', '$b'],
      records([
        ['$a', {}],
        ['$b', {}],
      ]),
      {
        jobs: [job('$b')],
        scheduledTaskEvents: [],
        now: NOW,
      }
    );
    expect(columns.working).toEqual(['$b']);
  });

  it('reads the schedules at its clock: one whose time passed leaves Later', () => {
    const map = records([
      ['$past', {}],
      ['$future', {}],
    ]);
    const columns = groupThreadBoard(['$past', '$future'], map, {
      jobs: [],
      scheduledTaskEvents: [scheduleEvent('$past', NOW - 1), scheduleEvent('$future', NOW + HOUR)],
      now: NOW,
    });
    expect(columns.later).toEqual(['$future']);
    expect(columns.open).toEqual(['$past']);
  });

  it('reads only pending schedules of existing threads', () => {
    const columns = groupThreadBoard(
      ['$a', '$b'],
      records([
        ['$a', {}],
        ['$b', {}],
      ]),
      {
        jobs: [],
        scheduledTaskEvents: [
          scheduleEvent('$a', NOW + HOUR, { status: 'cancelled' }),
          scheduleEvent(null, NOW + HOUR),
        ],
        now: NOW,
      }
    );
    expect(columns.later).toEqual([]);
  });

  it('orders Working and Done by newest activity first', () => {
    const map = records([
      ['$w-old', { isStreaming: true, lastActivityTs: 1 }],
      ['$w-new', { isStreaming: true, lastActivityTs: 3 }],
      ['$d-old', { isResolved: true, lastActivityTs: 2 }],
      ['$d-new', { isResolved: true, lastActivityTs: 4 }],
    ]);
    const columns = groupThreadBoard(['$w-old', '$d-old', '$w-new', '$d-new'], map, {
      jobs: [],
      scheduledTaskEvents: [],
      now: NOW,
    });
    expect(columns.working).toEqual(['$w-new', '$w-old']);
    expect(columns.done).toEqual(['$d-new', '$d-old']);
  });

  it('puts unread threads first in Open, each part newest first', () => {
    const map = records([
      ['$read-new', { lastActivityTs: 4 }],
      ['$unread-old', { isUnread: true, lastActivityTs: 1 }],
      ['$read-old', { lastActivityTs: 2 }],
      ['$unread-new', { isUnread: true, lastActivityTs: 3 }],
    ]);
    const columns = groupThreadBoard(
      ['$read-new', '$unread-old', '$read-old', '$unread-new'],
      map,
      { jobs: [], scheduledTaskEvents: [], now: NOW }
    );
    expect(columns.open).toEqual(['$unread-new', '$unread-old', '$read-new', '$read-old']);
  });

  it('orders Later soonest first, by snooze end or next run, a schedule without a time last', () => {
    const map = records([
      ['$snooze-late', { snoozedUntilTs: NOW + 3 * HOUR }],
      ['$cron', {}],
      ['$run-soon', {}],
      ['$snooze-soon', { snoozedUntilTs: NOW + HOUR }],
      // Snoozed past its next run: that run comes first.
      ['$both', { snoozedUntilTs: NOW + 5 * HOUR }],
    ]);
    const columns = groupThreadBoard(
      ['$snooze-late', '$cron', '$run-soon', '$snooze-soon', '$both'],
      map,
      {
        jobs: [],
        scheduledTaskEvents: [
          scheduleEvent('$cron', null),
          scheduleEvent('$run-soon', NOW + 2 * HOUR),
          scheduleEvent('$both', NOW + 2.5 * HOUR),
        ],
        now: NOW,
      }
    );
    expect(columns.later).toEqual(['$snooze-soon', '$run-soon', '$both', '$snooze-late', '$cron']);
  });
});

describe('threadBoardWakeTimes', () => {
  it('lists every snooze end and pending one-time run, so the board looks again at each', () => {
    const map = new Map([
      ['$a', makeRecord('$a', { snoozedUntilTs: NOW + HOUR })],
      ['$b', makeRecord('$b')],
    ]);
    const times = threadBoardWakeTimes(map, [
      scheduleEvent('$b', NOW + 2 * HOUR),
      scheduleEvent('$b', null),
      scheduleEvent('$b', NOW + 3 * HOUR, { status: 'completed' }),
    ]);
    expect([...times].filter((ts) => ts !== undefined).sort()).toEqual([
      NOW + HOUR,
      NOW + 2 * HOUR,
    ]);
  });
});
