import { describe, expect, it, vi } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import {
  SCHEDULED_TASK_CRON_FIELD_TOKEN_LIMITS,
  SCHEDULED_TASK_CRON_MAX_TOKEN_LENGTH,
} from './scheduledTaskContract';
import {
  buildRoomThreadScheduledStatusMap,
  createRoomThreadScheduledStatusResolver,
  getNextThreadScheduledTs,
  getRoomScheduledTaskCounts,
  getThreadScheduledStatus,
  type ThreadScheduledStatus,
} from './threadScheduledStatus';

const cronEvaluationSpy = vi.hoisted(() => vi.fn());
const cronMockState = vi.hoisted(() => ({ noOccurrenceExpression: null as string | null }));

vi.mock('croner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('croner')>();
  return {
    ...actual,
    Cron: (...args: Parameters<typeof actual.Cron>) => {
      cronEvaluationSpy(args[0]);
      if (String(args[0]) === cronMockState.noOccurrenceExpression) {
        return { nextRun: () => null } as ReturnType<typeof actual.Cron>;
      }
      return actual.Cron(...args);
    },
  };
});

const makeScheduledEvent = ({
  stateKey = 'task',
  status = 'pending',
  threadId = '$thread',
  newThread = false,
  executeAt,
  cronSchedule,
  nextRunAt,
  scheduleType,
}: {
  stateKey?: string;
  status?: string;
  threadId?: string | null;
  newThread?: boolean;
  executeAt?: string | null;
  cronSchedule?: unknown;
  nextRunAt?: string | null;
  scheduleType?: unknown;
}): MatrixEvent =>
  ({
    getStateKey: () => stateKey,
    getContent: () => ({
      status,
      thread_id: threadId,
      new_thread: newThread,
      execute_at: executeAt,
      cron_schedule: cronSchedule,
      next_run_at: nextRunAt,
      workflow:
        scheduleType === undefined ? undefined : JSON.stringify({ schedule_type: scheduleType }),
    }),
  } as unknown as MatrixEvent);

// Generated with /srv/mindroom's installed croniter in UTC; expected values are exclusive next runs.
const CRONITER_PARITY_FIXTURES = [
  ['every minute from boundary', '* * * * *', '2026-04-04T18:00:00Z', '2026-04-04T18:01:00Z'],
  ['every minute with seconds', '* * * * *', '2026-04-04T18:00:42Z', '2026-04-04T18:01:00Z'],
  ['hourly at minute 07', '7 * * * *', '2026-04-04T18:06:00Z', '2026-04-04T18:07:00Z'],
  ['hourly at minute 07 exclusive', '7 * * * *', '2026-04-04T18:07:00Z', '2026-04-04T19:07:00Z'],
  ['daily across UTC boundary', '30 0 * * *', '2026-04-04T23:59:00Z', '2026-04-05T00:30:00Z'],
  ['five-minute step', '*/5 * * * *', '2026-04-04T18:02:30Z', '2026-04-04T18:05:00Z'],
  ['minute list', '0,15,45 * * * *', '2026-04-04T18:16:00Z', '2026-04-04T18:45:00Z'],
  ['hour list', '0 8,17 * * *', '2026-04-04T08:00:00Z', '2026-04-04T17:00:00Z'],
  ['minute range', '10-12 * * * *', '2026-04-04T18:10:00Z', '2026-04-04T18:11:00Z'],
  ['hour range with step', '0 9-17/2 * * *', '2026-04-04T10:00:00Z', '2026-04-04T11:00:00Z'],
  [
    'weekday range with stepped minutes',
    '*/20 9-17/2 * * 1-5',
    '2026-04-03T17:41:00Z',
    '2026-04-06T09:00:00Z',
  ],
  ['weekday zero Sunday', '0 0 * * 0', '2026-04-04T12:00:00Z', '2026-04-05T00:00:00Z'],
  ['weekday seven Sunday', '0 0 * * 7', '2026-04-05T00:00:00Z', '2026-04-12T00:00:00Z'],
  ['day-of-month or weekday', '0 0 13 * 5', '2026-02-14T00:00:00Z', '2026-02-20T00:00:00Z'],
  [
    'day-of-month arm wins February rollover',
    '0 8 1 * 6',
    '2024-02-29T12:00:00Z',
    '2024-03-01T08:00:00Z',
  ],
  [
    'day-of-month arm wins before Monday',
    '0 0 1 * 1',
    '2026-02-27T12:34:56Z',
    '2026-03-01T00:00:00Z',
  ],
  ['month rollover', '0 0 1 * *', '2026-12-31T23:59:00Z', '2027-01-01T00:00:00Z'],
  ['year rollover', '0 0 1 1 *', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'],
  ['leap day from non-leap year', '0 0 29 2 *', '2027-02-28T23:59:00Z', '2028-02-29T00:00:00Z'],
  ['leap day exclusive', '0 0 29 2 *', '2028-02-29T00:00:00Z', '2032-02-29T00:00:00Z'],
  ['month list', '0 6 1 1,4,7,10 *', '2026-04-01T06:00:00Z', '2026-07-01T06:00:00Z'],
  ['weekday list', '30 14 * * 1,3,5', '2026-04-02T15:00:00Z', '2026-04-03T14:30:00Z'],
  [
    'day-of-month list across leap February',
    '0 0 1,31 * *',
    '2024-02-29T12:00:00Z',
    '2024-03-01T00:00:00Z',
  ],
  [
    'day-of-month wildcard step across February',
    '0 0 */5 * *',
    '2029-02-28T18:46:56Z',
    '2029-03-01T00:00:00Z',
  ],
  [
    'day-of-month range step across February',
    '0 0 1-31/15 * *',
    '2029-02-28T18:46:56Z',
    '2029-03-01T00:00:00Z',
  ],
  ['weekday oversized step', '0 0 * * */8', '2024-02-29T12:00:00Z', '2024-03-03T00:00:00Z'],
  ['minute equal range', '5-5 * * * *', '2026-04-04T18:05:00Z', '2026-04-04T18:06:00Z'],
  ['hour equal range', '0 8-8 * * *', '2026-04-04T08:00:00Z', '2026-04-04T09:00:00Z'],
  ['day equal range', '0 0 15-15 * *', '2026-04-04T12:00:00Z', '2026-04-05T00:00:00Z'],
  ['month equal range', '0 0 1 4-4 *', '2026-04-01T00:00:00Z', '2026-05-01T00:00:00Z'],
  ['weekday equal range', '0 0 * * 2-2', '2026-04-04T12:00:00Z', '2026-04-05T00:00:00Z'],
  ['numeric base step', '5/10 * * * *', '2026-04-04T18:06:00Z', '2026-04-04T18:15:00Z'],
  [
    'complex OR day-of-month arm wins',
    '0 8 1,15 * */3',
    '2024-02-29T12:00:00Z',
    '2024-03-01T08:00:00Z',
  ],
  [
    'complex OR day-of-week arm wins',
    '0 0 1,15 * */2',
    '2026-04-04T12:00:00Z',
    '2026-04-05T00:00:00Z',
  ],
  [
    'mixed valid and impossible DOM values in OR arm',
    '0 0 14/17 2,4,6,11 6-6/2',
    '2026-10-01T09:03:51Z',
    '2026-11-01T00:00:00Z',
  ],
  ['maximum hour numeric step', '0 23/2 * * *', '2026-04-04T22:30:00Z', '2026-04-05T00:00:00Z'],
  [
    'unstepped wildcard dominates DOW list',
    '0 0 13 * *,6',
    '2026-04-04T12:00:00Z',
    '2026-04-13T00:00:00Z',
  ],
  [
    'equal DOW range remains a restricted OR arm',
    '0 0 13 * 6-6',
    '2026-04-04T12:00:00Z',
    '2026-04-05T00:00:00Z',
  ],
  [
    'full DOW step collapses beside starred DOM step',
    '* * */23 * */1',
    '2025-04-26T10:12:57Z',
    '2025-05-01T00:00:00Z',
  ],
  [
    'full DOW union collapses beside starred DOM step',
    '* * */5 * 6-7,1-5,7,2-3',
    '2025-11-27T03:07:37Z',
    '2025-12-01T00:00:00Z',
  ],
  [
    'full DOM range collapses beside starred DOW step',
    '0 0 1-31 * */7',
    '2026-04-06T12:00:00Z',
    '2026-04-12T00:00:00Z',
  ],
  [
    'full DOM equal range collapses beside starred DOW step',
    '0 0 15-15 * */7',
    '2026-04-06T12:00:00Z',
    '2026-04-12T00:00:00Z',
  ],
  [
    'full DOM equal range remains restricted beside literal DOW',
    '0 0 15-15 * 6',
    '2026-04-04T12:00:00Z',
    '2026-04-05T00:00:00Z',
  ],
] as const;

// This documented FORK_CHANGES.md boundary intentionally keeps exotic croniter grammar count-only.
const CRONITER_VALID_UNSUPPORTED_FIXTURES = [
  ['question-mark wildcard', '0 0 ? * *'],
  ['nearest weekday suffix', '0 0 1W * *'],
  ['nearest weekday prefix', '0 0 W15 * *'],
  ['last Friday', '0 0 * * L5'],
  ['wrapped hour range', '0 22-2 * * *'],
  ['wrapped month range', '0 0 1 11-2 *'],
  ['wrapped weekday range', '0 9 * * 5-1'],
  ['month name', '0 0 1 NOV *'],
] as const;

const CRONITER_INVALID_NUMERIC_FIXTURES = [
  ['April 31 with weekday arm', '0 9 31 4 1'],
  ['February 31 with weekday arm', '0 0 31 2 0'],
  ['February 31 without weekday arm', '0 0 31 2 *'],
] as const;

describe('threadScheduledStatus', () => {
  it('groups pending future scheduled tasks by thread', () => {
    const now = Date.parse('2026-04-04T18:00:00.000Z');
    const futureDate = '2026-04-04T19:00:00.000Z';
    const pastDate = '2026-04-04T17:00:00.000Z';

    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({ stateKey: 'task-1', threadId: '$thread-1', executeAt: futureDate }),
        makeScheduledEvent({ stateKey: 'task-2', threadId: '$thread-1', executeAt: futureDate }),
        makeScheduledEvent({ stateKey: 'task-3', threadId: '$thread-2', executeAt: futureDate }),
        makeScheduledEvent({ stateKey: 'task-4', status: 'completed', threadId: '$thread-1' }),
        makeScheduledEvent({ stateKey: 'task-5', threadId: '$thread-1', newThread: true }),
        makeScheduledEvent({ stateKey: 'task-6', threadId: '$thread-3', executeAt: pastDate }),
        makeScheduledEvent({ stateKey: 'task-7', threadId: null, executeAt: futureDate }),
      ],
      now
    );

    expect(getThreadScheduledStatus(statusMap, '$thread-1')).toEqual({
      scheduledTaskCount: 2,
      nextScheduledTs: Date.parse(futureDate),
    });
    expect(getThreadScheduledStatus(statusMap, '$thread-2')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse(futureDate),
    });
    expect(statusMap.has('$thread-3')).toBe(false);
  });

  it('counts invalid or missing timestamps while suppressing the aggregate next time', () => {
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({ stateKey: 'task-1', executeAt: undefined }),
        makeScheduledEvent({ stateKey: 'task-2', executeAt: 'not-a-date' }),
        makeScheduledEvent({
          stateKey: 'task-3',
          executeAt: '2026-04-04T18:05:00.000Z',
        }),
      ],
      Date.parse('2026-04-04T18:00:00.000Z')
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 3,
      nextScheduledTs: undefined,
      nextScheduledRefreshTs: Date.parse('2026-04-04T18:05:00.000Z'),
    });
  });

  it('resolves the next UTC occurrence for a cron-only task', () => {
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const statusMap = buildRoomThreadScheduledStatusMap(
      [makeScheduledEvent({ cronSchedule: '*/5 * * * *' })],
      now
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse('2026-04-04T18:05:00.000Z'),
    });
  });

  it('picks the earliest occurrence across one-shot and cron tasks', () => {
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({
          stateKey: 'one-shot',
          executeAt: '2026-04-04T18:10:00.000Z',
        }),
        makeScheduledEvent({ stateKey: 'recurring', cronSchedule: '*/5 * * * *' }),
      ],
      now
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 2,
      nextScheduledTs: Date.parse('2026-04-04T18:05:00.000Z'),
    });
  });

  it('prefers next_run_at over one-shot and cron timing', () => {
    const now = Date.parse('2026-04-04T18:00:00.000Z');
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({
          nextRunAt: '2026-04-04T18:30:00.000Z',
          executeAt: '2026-04-04T18:05:00.000Z',
          cronSchedule: '* * * * *',
        }),
      ],
      now
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse('2026-04-04T18:30:00.000Z'),
    });
  });

  it('uses only cron timing for an authoritative cron workflow containing both fields', () => {
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({
          scheduleType: 'cron',
          executeAt: '2026-04-04T18:03:00.000Z',
          cronSchedule: '*/5 * * * *',
        }),
      ],
      now
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse('2026-04-04T18:05:00.000Z'),
    });
  });

  it('uses only execute_at timing for an authoritative one-shot workflow', () => {
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({
          scheduleType: 'once',
          executeAt: '2026-04-04T18:03:00.000Z',
          cronSchedule: '* * * * *',
        }),
      ],
      now
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse('2026-04-04T18:03:00.000Z'),
    });
  });

  it('omits an authoritative one-shot with elapsed next_run_at despite future execute_at', () => {
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({
          scheduleType: 'once',
          nextRunAt: '2026-04-04T18:00:00.000Z',
          executeAt: '2026-04-04T18:30:00.000Z',
        }),
      ],
      Date.parse('2026-04-04T18:02:30.000Z')
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 0,
    });
  });

  it('omits a legacy one-shot with elapsed next_run_at despite future execute_at', () => {
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({
          nextRunAt: '2026-04-04T18:00:00.000Z',
          executeAt: '2026-04-04T18:30:00.000Z',
        }),
      ],
      Date.parse('2026-04-04T18:02:30.000Z')
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 0,
    });
  });

  it('keeps a task with an unsupported authoritative schedule type as count-only', () => {
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({
          scheduleType: 'future',
          executeAt: '2026-04-04T18:03:00.000Z',
          cronSchedule: '*/5 * * * *',
        }),
      ],
      now
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: undefined,
    });
  });

  it('honors authoritative next_run_at for an unsupported future schedule type', () => {
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({
          scheduleType: 'future',
          nextRunAt: '2026-04-04T18:30:00.000Z',
          executeAt: '2026-04-04T18:03:00.000Z',
          cronSchedule: '*/5 * * * *',
        }),
      ],
      now
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse('2026-04-04T18:30:00.000Z'),
    });
  });

  it('keeps an unsupported type with elapsed next_run_at as count-only', () => {
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({
          scheduleType: 'future',
          nextRunAt: '2026-04-04T18:00:00.000Z',
          executeAt: '2026-04-04T18:30:00.000Z',
          cronSchedule: '* * * * *',
        }),
      ],
      Date.parse('2026-04-04T18:02:30.000Z')
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: undefined,
    });
  });

  it('falls through a stale next_run_at to the next cron occurrence', () => {
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({
          nextRunAt: '2026-04-04T18:00:00.000Z',
          cronSchedule: '*/5 * * * *',
        }),
      ],
      now
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse('2026-04-04T18:05:00.000Z'),
    });
  });

  it('falls through an elapsed execute_at to the next cron occurrence for legacy state', () => {
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({
          executeAt: '2026-04-04T18:00:00.000Z',
          cronSchedule: '*/5 * * * *',
        }),
      ],
      now
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse('2026-04-04T18:05:00.000Z'),
    });
  });

  it('keeps an elapsed recurring task as count-only when its cron cannot be evaluated', () => {
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const statusMap = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent({
          executeAt: '2026-04-04T18:00:00.000Z',
          cronSchedule: 'not a supported cron expression',
        }),
      ],
      now
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: undefined,
    });
  });

  it.each([
    ['future', '2026-04-04T18:05:00.000Z'],
    ['elapsed', '2026-04-04T17:55:00.000Z'],
  ])(
    'keeps a pending task with a malformed workflow count-only: %s execute_at',
    (_label, executeAt) => {
      const event = {
        getStateKey: () => 'malformed-workflow',
        getContent: () => ({
          status: 'pending',
          thread_id: '$thread',
          execute_at: executeAt,
          workflow: '{bad json',
        }),
      } as unknown as MatrixEvent;

      const statusMap = buildRoomThreadScheduledStatusMap(
        [event],
        Date.parse('2026-04-04T18:00:00.000Z')
      );

      expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
        scheduledTaskCount: 1,
        nextScheduledTs: undefined,
      });
    }
  );

  it('still honors top-level next_run_at when the present workflow is malformed', () => {
    const event = {
      getStateKey: () => 'malformed-workflow',
      getContent: () => ({
        status: 'pending',
        thread_id: '$thread',
        execute_at: '2026-04-04T18:05:00.000Z',
        next_run_at: '2026-04-04T18:10:00.000Z',
        workflow: '{bad json',
      }),
    } as unknown as MatrixEvent;

    const statusMap = buildRoomThreadScheduledStatusMap(
      [event],
      Date.parse('2026-04-04T18:00:00.000Z')
    );

    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse('2026-04-04T18:10:00.000Z'),
    });
  });

  it.each([
    ['six-field string', '0 0 * * * *'],
    ['incomplete object', { minute: '0', hour: '*', day: '*', month: '*' }],
  ])(
    'keeps an elapsed legacy task with malformed cron data as count-only: %s',
    (_label, cronSchedule) => {
      const statusMap = buildRoomThreadScheduledStatusMap(
        [
          makeScheduledEvent({
            executeAt: '2026-04-04T18:00:00.000Z',
            cronSchedule,
          }),
        ],
        Date.parse('2026-04-04T18:02:30.000Z')
      );

      expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
        scheduledTaskCount: 1,
        nextScheduledTs: undefined,
      });
    }
  );

  it.each(['unknown-first', 'known-first'] as const)(
    'suppresses a thread timestamp when a pending occurrence is unresolved: %s',
    (order) => {
      const now = Date.parse('2026-04-04T18:00:00.000Z');
      const unknownEvent = makeScheduledEvent({
        stateKey: 'unknown',
        cronSchedule: '0 0 ? * *',
      });
      const knownEvent = makeScheduledEvent({
        stateKey: 'known',
        executeAt: '2026-04-04T18:05:00.000Z',
      });
      const statusMap = buildRoomThreadScheduledStatusMap(
        order === 'unknown-first' ? [unknownEvent, knownEvent] : [knownEvent, unknownEvent],
        now
      );

      expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
        scheduledTaskCount: 2,
        nextScheduledTs: undefined,
        nextScheduledRefreshTs: Date.parse('2026-04-04T18:05:00.000Z'),
      });
    }
  );

  it.each(CRONITER_PARITY_FIXTURES)(
    'matches backend croniter for %s',
    (_label, cronSchedule, nowIso, expectedIso) => {
      const statusMap = buildRoomThreadScheduledStatusMap(
        [makeScheduledEvent({ cronSchedule })],
        Date.parse(nowIso)
      );

      expect(getThreadScheduledStatus(statusMap, '$thread').nextScheduledTs).toBe(
        Date.parse(expectedIso)
      );
    }
  );

  it.each(CRONITER_VALID_UNSUPPORTED_FIXTURES)(
    'uses honest count fallback for croniter-valid unsupported grammar: %s',
    (_label, cronSchedule) => {
      const statusMap = buildRoomThreadScheduledStatusMap(
        [makeScheduledEvent({ cronSchedule })],
        Date.parse('2026-04-04T18:02:30.000Z')
      );

      expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
        scheduledTaskCount: 1,
        nextScheduledTs: undefined,
      });
    }
  );

  it.each(CRONITER_INVALID_NUMERIC_FIXTURES)(
    'does not invent an occurrence for backend-invalid numeric grammar: %s',
    (_label, cronSchedule) => {
      const statusMap = buildRoomThreadScheduledStatusMap(
        [makeScheduledEvent({ cronSchedule })],
        Date.parse('2026-04-01T00:00:00.000Z')
      );

      expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
        scheduledTaskCount: 1,
        nextScheduledTs: undefined,
      });
    }
  );

  it('reuses each Croner evaluation until its occurrence rolls over', () => {
    const cronSchedule = '11,37 * * * *';
    const initialNow = Date.parse('2026-04-04T18:02:30.000Z');
    const events = [makeScheduledEvent({ cronSchedule })];
    const resolver = createRoomThreadScheduledStatusResolver();
    const getNextTs = (now: number) =>
      getThreadScheduledStatus(resolver.resolve(events, now, '$thread'), '$thread').nextScheduledTs;
    cronEvaluationSpy.mockClear();

    expect(getNextTs(initialNow)).toBe(Date.parse('2026-04-04T18:11:00.000Z'));
    expect(getNextTs(initialNow + 1000)).toBe(Date.parse('2026-04-04T18:11:00.000Z'));
    expect(cronEvaluationSpy).toHaveBeenCalledTimes(1);

    expect(getNextTs(Date.parse('2026-04-04T18:11:00.000Z'))).toBe(
      Date.parse('2026-04-04T18:37:00.000Z')
    );
    expect(cronEvaluationSpy).toHaveBeenCalledTimes(2);
  });

  it('caches an unexpected no-occurrence result per resolver content', () => {
    const cronSchedule = '11,37 * * * *';
    const now = Date.parse('2026-04-01T00:00:00.000Z');
    const events = [makeScheduledEvent({ cronSchedule })];
    const resolver = createRoomThreadScheduledStatusResolver();
    const getNextTs = (taskEvents: readonly MatrixEvent[]) =>
      getThreadScheduledStatus(resolver.resolve(taskEvents, now, '$thread'), '$thread')
        .nextScheduledTs;
    cronEvaluationSpy.mockClear();
    cronMockState.noOccurrenceExpression = cronSchedule;

    try {
      expect(getNextTs(events)).toBe(undefined);
      expect(getNextTs(events)).toBe(undefined);
      expect(cronEvaluationSpy).toHaveBeenCalledTimes(1);

      expect(getNextTs([...events])).toBe(undefined);
      expect(cronEvaluationSpy).toHaveBeenCalledTimes(1);

      const independentResolver = createRoomThreadScheduledStatusResolver();
      expect(
        getThreadScheduledStatus(
          independentResolver.resolve([...events], now, '$thread'),
          '$thread'
        ).nextScheduledTs
      ).toBe(undefined);
      expect(cronEvaluationSpy).toHaveBeenCalledTimes(2);
    } finally {
      cronMockState.noOccurrenceExpression = null;
    }
  });

  it('retries a time-dependent no-occurrence result when the caller clock moves backward', () => {
    const cronSchedule = '11,37 * * * *';
    const laterNow = Date.parse('2026-04-02T00:00:00.000Z');
    const earlierNow = Date.parse('2026-04-01T00:00:00.000Z');
    const events = [makeScheduledEvent({ cronSchedule })];
    const resolver = createRoomThreadScheduledStatusResolver();
    const getNextTs = (now: number) =>
      getThreadScheduledStatus(resolver.resolve(events, now, '$thread'), '$thread').nextScheduledTs;
    cronEvaluationSpy.mockClear();
    cronMockState.noOccurrenceExpression = cronSchedule;

    try {
      expect(getNextTs(laterNow)).toBe(undefined);
      expect(cronEvaluationSpy).toHaveBeenCalledTimes(1);

      cronMockState.noOccurrenceExpression = null;
      expect(getNextTs(earlierNow)).toBe(Date.parse('2026-04-01T00:11:00.000Z'));
      expect(cronEvaluationSpy).toHaveBeenCalledTimes(2);
    } finally {
      cronMockState.noOccurrenceExpression = null;
    }
  });

  it('parses retained workflow state once across the complete deferred lifecycle', () => {
    const historicalCount = 405;
    const pendingCount = 65;
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    let contentReads = 0;
    const historicalWorkflows = new Set<string>();
    const pendingWorkflows = new Set<string>();
    const makeWorkflowEvent = (status: string, index: number): MatrixEvent => {
      const cronSchedule = `${index % 60} ${Math.floor(index / 60) % 24} * * *`;
      const workflow = JSON.stringify({
        schedule_type: 'cron',
        thread_id: `$${status}-${index}`,
        new_thread: false,
        cron_schedule: cronSchedule,
        ...(status === 'pending' ? {} : { retained_payload: 'x'.repeat(2800) }),
      });
      (status === 'pending' ? pendingWorkflows : historicalWorkflows).add(workflow);
      return {
        getStateKey: () => `${status}-${index}`,
        getContent: () => {
          contentReads += 1;
          return { status, workflow };
        },
      } as unknown as MatrixEvent;
    };
    const events = [
      ...Array.from({ length: historicalCount }, (_value, index) =>
        makeWorkflowEvent('completed', index)
      ),
      ...Array.from({ length: pendingCount }, (_value, index) =>
        makeWorkflowEvent('pending', index)
      ),
    ];
    const resolver = createRoomThreadScheduledStatusResolver();
    const jsonParseSpy = vi.spyOn(JSON, 'parse');
    cronEvaluationSpy.mockClear();

    try {
      let finalStatusMap: ReadonlyMap<string, ThreadScheduledStatus> = new Map();
      const callsPerBuild = Array.from({ length: 3 }, () => {
        const callsBeforeBuild = cronEvaluationSpy.mock.calls.length;
        finalStatusMap = resolver.resolve(events, now);
        return cronEvaluationSpy.mock.calls.length - callsBeforeBuild;
      });
      const parsedWorkflowInputs = jsonParseSpy.mock.calls.map(([input]) => input);

      expect(callsPerBuild).toEqual([32, 32, 1]);
      expect(contentReads).toBe(historicalCount + pendingCount);
      expect(parsedWorkflowInputs.filter((input) => pendingWorkflows.has(input))).toHaveLength(
        pendingCount
      );
      expect(parsedWorkflowInputs.some((input) => historicalWorkflows.has(input))).toBe(false);
      expect(finalStatusMap).toHaveLength(pendingCount);
      expect(
        [...finalStatusMap.values()].every(({ nextScheduledTs }) => nextScheduledTs !== undefined)
      ).toBe(true);
    } finally {
      jsonParseSpy.mockRestore();
    }
  });

  it('bounds Croner calls per build and retains every live-state occurrence without eviction', () => {
    const eventCount = 257;
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const events = Array.from({ length: eventCount }, (_value, index) => {
      const minute = index % 60;
      const hour = Math.floor(index / 60) % 24;
      return makeScheduledEvent({
        stateKey: `valid-${index}`,
        threadId: `$valid-${index}`,
        cronSchedule: `${minute} ${hour} * * *`,
      });
    });
    const resolver = createRoomThreadScheduledStatusResolver();
    cronEvaluationSpy.mockClear();

    let finalStatusMap: ReadonlyMap<string, ThreadScheduledStatus> = new Map();
    const callsPerBuild = Array.from({ length: 9 }, () => {
      const callsBeforeBuild = cronEvaluationSpy.mock.calls.length;
      finalStatusMap = resolver.resolve(events, now);
      return cronEvaluationSpy.mock.calls.length - callsBeforeBuild;
    });

    expect(callsPerBuild).toEqual([32, 32, 32, 32, 32, 32, 32, 32, 1]);
    expect(cronEvaluationSpy).toHaveBeenCalledTimes(eventCount);
    expect(finalStatusMap.size).toBe(eventCount);
    expect(
      [...finalStatusMap.values()].every(({ nextScheduledTs }) => nextScheduledTs !== undefined)
    ).toBe(true);

    resolver.resolve(events, now + 1000);
    expect(cronEvaluationSpy).toHaveBeenCalledTimes(eventCount);
  });

  it('starts a fresh continuation budget after every completed recurring rollover', () => {
    const eventCount = 33;
    const rolloverCount = 70;
    const events = Array.from({ length: eventCount }, (_value, index) =>
      makeScheduledEvent({
        stateKey: `rollover-${index}`,
        threadId: `$rollover-${index}`,
        cronSchedule: `${index}-${index} * * * *`,
      })
    );
    const resolver = createRoomThreadScheduledStatusResolver();
    let now = Date.parse('2026-04-04T18:00:00.000Z');
    cronEvaluationSpy.mockClear();

    for (let rollover = 0; rollover < rolloverCount; rollover += 1) {
      const expectedNextTs = now + 60_000;
      let buildCount = 0;
      let statusMap: ReadonlyMap<string, ThreadScheduledStatus> = new Map();
      do {
        statusMap = resolver.resolve(events, now);
        buildCount += 1;
      } while (
        [...statusMap.values()].some(
          ({ hasDeferredCronEvaluation }) => hasDeferredCronEvaluation === true
        ) &&
        buildCount < 10
      );

      expect(buildCount).toBe(2);
      expect(statusMap).toHaveLength(eventCount);
      expect(
        [...statusMap.values()].every(({ nextScheduledTs }) => nextScheduledTs === expectedNextTs)
      ).toBe(true);
      now = expectedNextTs;
    }

    expect(cronEvaluationSpy).toHaveBeenCalledTimes(eventCount * rolloverCount);
  });

  it('terminally bounds full-state visits across a large deferred lifecycle', () => {
    const eventCount = 500;
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const events = Array.from({ length: eventCount }, (_value, index) => {
      const minute = index % 60;
      const hour = Math.floor(index / 60) % 24;
      return makeScheduledEvent({
        stateKey: `bounded-${index}`,
        threadId: `$bounded-${index}`,
        cronSchedule: `${minute} ${hour} * * *`,
      });
    });
    const resolver = createRoomThreadScheduledStatusResolver();
    cronEvaluationSpy.mockClear();

    let buildCount = 0;
    let statusMap: ReadonlyMap<string, ThreadScheduledStatus> = new Map();
    do {
      statusMap = resolver.resolve(events, now);
      buildCount += 1;
    } while (
      [...statusMap.values()].some(
        ({ hasDeferredCronEvaluation }) => hasDeferredCronEvaluation === true
      ) &&
      buildCount < 100
    );

    expect(buildCount).toBe(8);
    expect(eventCount * buildCount).toBeLessThanOrEqual(4096);
    expect(cronEvaluationSpy).toHaveBeenCalledTimes(256);
    expect(statusMap.get('$bounded-255')?.nextScheduledTs).toBeDefined();
    expect(statusMap.get('$bounded-256')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: undefined,
    });
    expect(
      [...statusMap.values()].every(
        ({ hasDeferredCronEvaluation }) => hasDeferredCronEvaluation === undefined
      )
    ).toBe(true);

    resolver.resolve(events, now);
    expect(cronEvaluationSpy).toHaveBeenCalledTimes(256);
  });

  it('charges every expanded day arm to the same per-build Croner budget', () => {
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const events = [
      makeScheduledEvent({
        stateKey: 'expanded',
        threadId: '$thread',
        cronSchedule: '0 0 1-31 * 1',
      }),
      makeScheduledEvent({
        stateKey: 'deferred',
        threadId: '$thread',
        cronSchedule: '*/5 * * * *',
      }),
    ];
    const resolver = createRoomThreadScheduledStatusResolver();
    cronEvaluationSpy.mockClear();

    const initialMap = resolver.resolve(events, now);
    expect(cronEvaluationSpy).toHaveBeenCalledTimes(32);
    expect(getThreadScheduledStatus(initialMap, '$thread')).toEqual({
      scheduledTaskCount: 2,
      nextScheduledTs: undefined,
      hasDeferredCronEvaluation: true,
    });

    const nextMap = resolver.resolve(events, now);
    expect(cronEvaluationSpy).toHaveBeenCalledTimes(33);
    expect(getThreadScheduledStatus(nextMap, '$thread')).toEqual({
      scheduledTaskCount: 2,
      nextScheduledTs: Date.parse('2026-04-04T18:05:00.000Z'),
    });
  });

  it('rejects a hostile impossible-calendar corpus without entering Croner', () => {
    const impossibleCount = 2049;
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const impossibleEvents = Array.from({ length: impossibleCount }, (_value, index) => {
      const minute = index % 60;
      const hour = Math.floor(index / 60) % 24;
      const weekday = Math.floor(index / (60 * 24)) % 7;
      return makeScheduledEvent({
        stateKey: `impossible-${index}`,
        threadId: `$impossible-${index}`,
        cronSchedule: `${minute} ${hour} 31 2 ${weekday}`,
      });
    });
    const events = [
      makeScheduledEvent({
        stateKey: 'valid',
        threadId: '$valid',
        cronSchedule: '*/5 * * * *',
      }),
      ...impossibleEvents,
    ];
    cronEvaluationSpy.mockClear();

    const startedAt = performance.now();
    const statusMap = buildRoomThreadScheduledStatusMap(events, now);
    const elapsedMs = performance.now() - startedAt;

    expect(cronEvaluationSpy).toHaveBeenCalledTimes(1);
    expect(getThreadScheduledStatus(statusMap, '$valid').nextScheduledTs).toBe(
      Date.parse('2026-04-04T18:05:00.000Z')
    );
    expect(elapsedMs).toBeLessThan(500);
  });

  it('bounds parsing and Croner work for maximum-size finite-domain lists', () => {
    const eventCount = 500;
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const coprimeMultipliers = [1, 7, 11, 13, 17, 19, 23, 29, 31];
    const minuteTokenCount = SCHEDULED_TASK_CRON_FIELD_TOKEN_LIMITS[0];
    const events = Array.from({ length: eventCount }, (_value, eventIndex) => {
      const shift = eventIndex % minuteTokenCount;
      const multiplier = coprimeMultipliers[Math.floor(eventIndex / minuteTokenCount)];
      const minuteList = Array.from({ length: minuteTokenCount }, (_token, tokenIndex) =>
        String((tokenIndex * multiplier + shift) % minuteTokenCount).padStart(
          SCHEDULED_TASK_CRON_MAX_TOKEN_LENGTH,
          '0'
        )
      ).join(',');
      return makeScheduledEvent({
        stateKey: `max-list-${eventIndex}`,
        threadId: `$max-list-${eventIndex}`,
        cronSchedule: `${minuteList} * * * *`,
      });
    });
    cronEvaluationSpy.mockClear();

    const startedAt = performance.now();
    const statusMap = buildRoomThreadScheduledStatusMap(events, now);
    const elapsedMs = performance.now() - startedAt;

    expect(cronEvaluationSpy).toHaveBeenCalledTimes(32);
    expect(statusMap.get('$max-list-31')?.nextScheduledTs).toBeDefined();
    expect(statusMap.get('$max-list-32')).toMatchObject({
      nextScheduledTs: undefined,
      hasDeferredCronEvaluation: true,
    });
    expect(elapsedMs).toBeLessThan(500);
  });

  it.each([
    ['too many minute tokens', `${Array.from({ length: 61 }, () => '0').join(',')} * * * *`],
    ['oversized token', `${'0'.repeat(25)} * * * *`],
    ['oversized expression', `${'0,'.repeat(2000)}0 * * * *`],
  ])('degrades cron input beyond finite parser limits: %s', (_label, cronSchedule) => {
    cronEvaluationSpy.mockClear();

    const statusMap = buildRoomThreadScheduledStatusMap(
      [makeScheduledEvent({ cronSchedule })],
      Date.parse('2026-04-04T18:02:30.000Z')
    );

    expect(cronEvaluationSpy).not.toHaveBeenCalled();
    expect(getThreadScheduledStatus(statusMap, '$thread')).toEqual({
      scheduledTaskCount: 1,
      nextScheduledTs: undefined,
    });
  });

  it('exposes count and next-time compatibility selectors from the same status map logic', () => {
    const events = [
      makeScheduledEvent({ stateKey: 'task-1', executeAt: '2026-04-04T18:15:00.000Z' }),
      makeScheduledEvent({ stateKey: 'task-2', executeAt: '2026-04-04T18:05:00.000Z' }),
    ];
    const now = Date.parse('2026-04-04T18:00:00.000Z');

    expect(getRoomScheduledTaskCounts(events, now).get('$thread')).toBe(2);
    expect(getNextThreadScheduledTs(events, '$thread', now)).toBe(
      Date.parse('2026-04-04T18:05:00.000Z')
    );
  });

  it('keeps count selectors from exhausting later next-time queries', () => {
    const now = Date.parse('2026-04-04T18:02:30.000Z');
    const events = Array.from({ length: 500 }, (_value, index) => {
      const minute = index % 60;
      const hour = Math.floor(index / 60) % 24;
      return makeScheduledEvent({
        stateKey: `selector-${index}`,
        threadId: `$selector-${index}`,
        cronSchedule: `${minute} ${hour} * * *`,
      });
    });
    cronEvaluationSpy.mockClear();

    Array.from({ length: 8 }, () => getRoomScheduledTaskCounts(events, now)).forEach((counts) => {
      expect(counts).toHaveLength(500);
    });
    expect(cronEvaluationSpy).not.toHaveBeenCalled();

    expect(getNextThreadScheduledTs(events, '$selector-499', now)).toBe(
      Date.parse('2026-04-05T08:19:00.000Z')
    );
    expect(getNextThreadScheduledTs(events, '$selector-498', now)).toBe(
      Date.parse('2026-04-05T08:18:00.000Z')
    );
  });
});
