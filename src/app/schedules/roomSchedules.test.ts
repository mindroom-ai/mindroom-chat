import type { TFunction } from 'i18next';
import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  MINDROOM_SCHEDULED_TASK_EVENT,
  type ParsedScheduledTask,
} from '../matrix/protocol/scheduledTaskContract';
import {
  formatCompactExecutionTime,
  formatRelativeCountdown,
  formatShortCadence,
  getPendingRoomSchedules,
  getScheduleTimestamp,
  isRecurringTask,
} from './roomSchedules';

const event = (taskId: string, workflow: Record<string, unknown>, status = 'pending') =>
  new MatrixEvent({
    type: MINDROOM_SCHEDULED_TASK_EVENT,
    state_key: taskId,
    content: { status, workflow: JSON.stringify(workflow) },
  });

const mockT = ((key: string, params?: Record<string, unknown>) => {
  switch (key) {
    case 'roomSchedules.awaitingShort':
      return 'Awaiting';
    case 'roomSchedules.inSeconds':
      return `in ${params?.count}s`;
    case 'roomSchedules.inMinutes':
      return `in ${params?.count}m`;
    case 'roomSchedules.inHours':
      return `in ${params?.count}h`;
    case 'roomSchedules.inHoursMinutes':
      return `in ${params?.hours}h ${params?.minutes}m`;
    case 'roomSchedules.inDays':
      return `in ${params?.count}d`;
    case 'roomSchedules.recurring':
      return 'Recurring';
    default:
      return key;
  }
}) as unknown as TFunction;

const baseTask = (overrides: Partial<ParsedScheduledTask> = {}): ParsedScheduledTask => ({
  taskId: 'task-1',
  status: 'pending',
  threadId: null,
  newThread: false,
  executeAt: null,
  scheduleType: 'once',
  ...overrides,
});

describe('pending room schedules', () => {
  it('includes all destinations and overdue tasks, sorted by time before undated tasks', () => {
    const events = [
      event('recurring', { schedule_type: 'cron', thread_id: '$thread-2' }),
      event('new-thread', { new_thread: true, execute_at: '2099-01-01T12:00:00Z' }),
      event('overdue', { thread_id: '$thread-1', execute_at: '2000-01-01T12:00:00Z' }),
      event('room', { execute_at: '2099-01-01T10:00:00Z' }),
      event('completed', {}, 'completed'),
      event('cancelled', {}, 'cancelled'),
      event('failed', {}, 'failed'),
      new MatrixEvent({ type: MINDROOM_SCHEDULED_TASK_EVENT, state_key: 'redacted', content: {} }),
    ];
    expect(getPendingRoomSchedules(events).map((task) => task.taskId)).toEqual([
      'overdue',
      'room',
      'new-thread',
      'recurring',
    ]);
  });

  it('keeps unknown times visible and does not interpret a cron execute_at as the next run', () => {
    const tasks = getPendingRoomSchedules([
      event('bad-time', { execute_at: 'not a date' }),
      event('cron', { schedule_type: 'cron', execute_at: '2000-01-01T12:00:00Z' }),
    ]);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => getScheduleTimestamp(task))).toEqual([undefined, undefined]);
  });

  it.each(['2026-09-16T09:30:00', '2026-09-16 09:30:00'])(
    'treats %s as UTC without an offset',
    (executeAt) => {
      const [task] = getPendingRoomSchedules([event('naive', { execute_at: executeAt })]);
      expect(getScheduleTimestamp(task!)).toBe(1789551000000);
    }
  );

  it('recognizes the legacy main destination as the room timeline', () => {
    const [task] = getPendingRoomSchedules([event('main', { thread_id: 'main' })]);
    expect(task!.threadId).toBeNull();
  });
});

describe('isRecurringTask', () => {
  it('identifies cron tasks by scheduleType, cronExpression, or cronDescription', () => {
    expect(isRecurringTask(baseTask({ scheduleType: 'once' }))).toBe(false);
    expect(isRecurringTask(baseTask({ scheduleType: 'cron' }))).toBe(true);
    expect(isRecurringTask(baseTask({ cronExpression: '0 9 * * 1-5' }))).toBe(true);
    expect(isRecurringTask(baseTask({ cronDescription: 'Every morning' }))).toBe(true);
  });
});

describe('formatRelativeCountdown', () => {
  const now = new Date(2026, 8, 15, 10, 0, 0).getTime();

  it('returns Awaiting for past or current times', () => {
    expect(formatRelativeCountdown(now, now, mockT, 'en-US')).toBe('Awaiting');
    expect(formatRelativeCountdown(now - 5_000, now, mockT, 'en-US')).toBe('Awaiting');
  });

  it('formats seconds with a 1s minimum, minutes, hours, and days up to 7d', () => {
    expect(formatRelativeCountdown(now + 400, now, mockT, 'en-US')).toBe('in 1s');
    expect(formatRelativeCountdown(now + 45_000, now, mockT, 'en-US')).toBe('in 45s');
    expect(formatRelativeCountdown(now + 12 * 60_000, now, mockT, 'en-US')).toBe('in 12m');
    expect(formatRelativeCountdown(now + 2 * 3_600_000, now, mockT, 'en-US')).toBe('in 2h');
    expect(formatRelativeCountdown(now + (2 * 60 + 15) * 60_000, now, mockT, 'en-US')).toBe(
      'in 2h 15m'
    );
    expect(formatRelativeCountdown(now + 3 * 86_400_000, now, mockT, 'en-US')).toBe('in 3d');
    expect(formatRelativeCountdown(now + 7 * 86_400_000, now, mockT, 'en-US')).toBe('in 7d');
  });

  it('formats dates beyond 7 days with year only when in another year', () => {
    const laterSameYear = new Date(2026, 9, 5, 10, 0, 0).getTime();
    const nextYear = new Date(2027, 0, 15, 10, 0, 0).getTime();
    expect(formatRelativeCountdown(laterSameYear, now, mockT, 'en-US')).toBe('Oct 5');
    expect(formatRelativeCountdown(nextYear, now, mockT, 'en-US')).toBe('Jan 15, 2027');
  });
});

describe('formatCompactExecutionTime', () => {
  const now = new Date(2026, 8, 15, 10, 0, 0).getTime();

  it('omits date on the same day, includes month/day in the same year, and includes year otherwise', () => {
    const sameDay = new Date(2026, 8, 15, 14, 30, 45).getTime();
    const sameYear = new Date(2026, 9, 2, 9, 15, 0).getTime();
    const otherYear = new Date(2028, 0, 1, 8, 5, 0).getTime();

    expect(formatCompactExecutionTime(sameDay, now, 'en-US')).toBe('2:30 PM');
    expect(formatCompactExecutionTime(sameYear, now, 'en-US')).toBe('Oct 2, 9:15 AM');
    expect(formatCompactExecutionTime(otherYear, now, 'en-US')).toContain('2028');
    expect(formatCompactExecutionTime(otherYear, now, 'en-US')).not.toMatch(/:\d{2}:\d{2}/);
  });
});

describe('formatShortCadence', () => {
  it('uses short descriptions directly, extracts leading phrases, and falls back to Recurring', () => {
    expect(formatShortCadence(baseTask({ cronDescription: 'Every 15 minutes' }), mockT)).toBe(
      'Every 15 minutes'
    );
    expect(
      formatShortCadence(
        baseTask({ cronDescription: 'At 09:30, Monday through Friday (America/Los_Angeles)' }),
        mockT
      )
    ).toBe('At 09:30');
    expect(
      formatShortCadence(
        baseTask({ cronDescription: 'Every weekday at 09:00 (America/Los_Angeles)' }),
        mockT
      )
    ).toBe('Every weekday at 09:00');
    expect(
      formatShortCadence(
        baseTask({ cronDescription: 'Every Monday Tuesday Wednesday Thursday at nine' }),
        mockT
      )
    ).toBe('Recurring');
    expect(formatShortCadence(baseTask({}), mockT)).toBe('Recurring');
  });
});
