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
  isCommandSafeTaskId,
  isRecurringTask,
} from './roomSchedules';

const event = (id: string, workflow: Record<string, unknown>, status = 'pending') =>
  new MatrixEvent({
    type: MINDROOM_SCHEDULED_TASK_EVENT,
    state_key: id,
    content: { status, workflow: JSON.stringify(workflow) },
  });

const mockT = ((key: string, params?: Record<string, unknown>) => {
  const map: Record<string, string> = {
    'roomSchedules.awaitingShort': 'Awaiting',
    'roomSchedules.inSeconds': `in ${params?.count}s`,
    'roomSchedules.inMinutes': `in ${params?.count}m`,
    'roomSchedules.inHours': `in ${params?.count}h`,
    'roomSchedules.inHoursMinutes': `in ${params?.hours}h ${params?.minutes}m`,
    'roomSchedules.inDays': `in ${params?.count}d`,
    'roomSchedules.recurring': 'Recurring',
  };
  return map[key] ?? key;
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
  it('includes pending tasks across destinations sorted by time before undated tasks', () => {
    const events = [
      event('recurring', { schedule_type: 'cron', thread_id: '$thread-2' }),
      event('new-thread', { new_thread: true, execute_at: '2099-01-01T12:00:00Z' }),
      event('overdue', { thread_id: '$thread-1', execute_at: '2000-01-01T12:00:00Z' }),
      event('room', { execute_at: '2099-01-01T10:00:00Z' }),
      event('completed', {}, 'completed'),
      event('cancelled', {}, 'cancelled'),
      new MatrixEvent({ type: MINDROOM_SCHEDULED_TASK_EVENT, state_key: 'redacted', content: {} }),
    ];
    expect(getPendingRoomSchedules(events).map((task) => task.taskId)).toEqual([
      'overdue',
      'room',
      'new-thread',
      'recurring',
    ]);
  });

  it('keeps unknown times visible, ignores cron execute_at, parses naive UTC, and maps main to null', () => {
    const tasks = getPendingRoomSchedules([
      event('bad-time', { execute_at: 'not a date' }),
      event('cron', { schedule_type: 'cron', execute_at: '2000-01-01T12:00:00Z' }),
      event('naive', { execute_at: '2026-09-16 09:30:00', thread_id: 'main' }),
    ]);
    expect(tasks.map((task) => [task.taskId, getScheduleTimestamp(task), task.threadId])).toEqual([
      ['naive', 1789551000000, null],
      ['bad-time', undefined, null],
      ['cron', undefined, null],
    ]);
  });
});

describe('isRecurringTask & isCommandSafeTaskId', () => {
  it('detects recurring tasks and validates safe task IDs', () => {
    expect(isRecurringTask(baseTask({ scheduleType: 'once' }))).toBe(false);
    expect(isRecurringTask(baseTask({ scheduleType: 'cron' }))).toBe(true);
    expect(isRecurringTask(baseTask({ cronExpression: '0 9 * * 1-5' }))).toBe(true);
    expect(isRecurringTask(baseTask({ cronDescription: 'Every morning' }))).toBe(true);

    expect(isCommandSafeTaskId('sched_1-A')).toBe(true);
    expect(isCommandSafeTaskId('all-tasks')).toBe(true);
    expect(isCommandSafeTaskId('all')).toBe(false);
    expect(isCommandSafeTaskId('ALL')).toBe(false);
    expect(isCommandSafeTaskId('')).toBe(false);
    expect(isCommandSafeTaskId('task 1')).toBe(false);
    expect(isCommandSafeTaskId('task/1')).toBe(false);
  });
});

describe('formatRelativeCountdown & formatCompactExecutionTime', () => {
  const now = new Date(2026, 8, 15, 10, 0, 0).getTime();

  it('formats awaiting, seconds, minutes, hours, days, and distant dates', () => {
    expect(formatRelativeCountdown(now, now, mockT, 'en-US')).toBe('Awaiting');
    expect(formatRelativeCountdown(now - 5_000, now, mockT, 'en-US')).toBe('Awaiting');
    expect(formatRelativeCountdown(now + 400, now, mockT, 'en-US')).toBe('in 1s');
    expect(formatRelativeCountdown(now + 45_000, now, mockT, 'en-US')).toBe('in 45s');
    expect(formatRelativeCountdown(now + 12 * 60_000, now, mockT, 'en-US')).toBe('in 12m');
    expect(formatRelativeCountdown(now + 2 * 3_600_000, now, mockT, 'en-US')).toBe('in 2h');
    expect(formatRelativeCountdown(now + (2 * 60 + 15) * 60_000, now, mockT, 'en-US')).toBe(
      'in 2h 15m'
    );
    expect(formatRelativeCountdown(now + 3 * 86_400_000, now, mockT, 'en-US')).toBe('in 3d');
    expect(
      formatRelativeCountdown(new Date(2026, 9, 5, 10, 0, 0).getTime(), now, mockT, 'en-US')
    ).toBe('Oct 5');
    expect(
      formatRelativeCountdown(new Date(2027, 0, 15, 10, 0, 0).getTime(), now, mockT, 'en-US')
    ).toBe('Jan 15, 2027');
  });

  it('formats compact local times by omitting redundant date parts', () => {
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
  it('strips trailing timezones when short and falls back to Recurring when long or missing', () => {
    expect(formatShortCadence(baseTask({ cronDescription: 'Every 15 minutes' }), mockT)).toBe(
      'Every 15 minutes'
    );
    expect(
      formatShortCadence(
        baseTask({ cronDescription: 'Daily at 9:00 AM (America/Los_Angeles)' }),
        mockT
      )
    ).toBe('Daily at 9:00 AM');
    expect(formatShortCadence(baseTask({ cronDescription: 'Daily at 09:00 (UTC+2)' }), mockT)).toBe(
      'Daily at 09:00'
    );
    expect(formatShortCadence(baseTask({ cronDescription: 'Daily (workdays)' }), mockT)).toBe(
      'Daily (workdays)'
    );
    expect(
      formatShortCadence(
        baseTask({ cronDescription: 'At 09:30, Monday through Friday (America/Los_Angeles)' }),
        mockT
      )
    ).toBe('Recurring');
    expect(formatShortCadence(baseTask({}), mockT)).toBe('Recurring');
  });
});
