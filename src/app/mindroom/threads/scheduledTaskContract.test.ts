import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { describe, expect, it } from 'vitest';
import {
  MINDROOM_SCHEDULED_TASK_EVENT,
  parseScheduledTaskStateEvent,
} from './scheduledTaskContract';

const makeScheduledTaskEvent = (content: Record<string, unknown>, stateKey = 'task-1') =>
  new MatrixEvent({
    content,
    event_id: `$${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: stateKey,
    type: MINDROOM_SCHEDULED_TASK_EVENT,
  });

describe('parseScheduledTaskStateEvent', () => {
  it('parses normalized top-level thread fields', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      thread_id: '$thread',
      new_thread: false,
      workflow: JSON.stringify({
        thread_id: '$legacy-thread',
        new_thread: true,
      }),
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      scheduleType: null,
      threadId: '$thread',
      newThread: false,
      executeAt: null,
      cronSchedule: null,
      nextRunAt: null,
    });
  });

  it('falls back to legacy workflow JSON when top-level fields are missing', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      workflow: JSON.stringify({
        thread_id: '$thread',
        new_thread: false,
      }),
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      scheduleType: null,
      threadId: '$thread',
      newThread: false,
      executeAt: null,
      cronSchedule: null,
      nextRunAt: null,
    });
  });

  it('accepts scheduled_at at the top level and normalizes it to executeAt', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      thread_id: '$thread',
      new_thread: false,
      scheduled_at: '2026-04-04T18:30:00.000Z',
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      scheduleType: null,
      threadId: '$thread',
      newThread: false,
      executeAt: '2026-04-04T18:30:00.000Z',
      cronSchedule: null,
      nextRunAt: null,
    });
  });

  it('accepts scheduled_at in workflow JSON when top-level timing is missing', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      workflow: JSON.stringify({
        thread_id: '$thread',
        new_thread: false,
        scheduled_at: '2026-04-04T18:45:00.000Z',
      }),
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      scheduleType: null,
      threadId: '$thread',
      newThread: false,
      executeAt: '2026-04-04T18:45:00.000Z',
      cronSchedule: null,
      nextRunAt: null,
    });
  });

  it('normalizes cron schedule fields from workflow JSON', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      workflow: JSON.stringify({
        schedule_type: 'cron',
        thread_id: '$thread',
        new_thread: false,
        cron_schedule: {
          minute: '*/5',
          hour: '8-18',
          day: '*',
          month: '*',
          weekday: '1-5',
        },
      }),
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      scheduleType: 'cron',
      threadId: '$thread',
      newThread: false,
      executeAt: null,
      cronSchedule: '*/5 8-18 * * 1-5',
      nextRunAt: null,
    });
  });

  it('preserves an authoritative cron schedule type when both timing fields are serialized', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      workflow: JSON.stringify({
        schedule_type: 'cron',
        thread_id: '$thread',
        new_thread: false,
        execute_at: '2026-04-04T18:30:00.000Z',
        cron_schedule: {
          minute: '*/5',
          hour: '*',
          day: '*',
          month: '*',
          weekday: '*',
        },
      }),
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      scheduleType: 'cron',
      threadId: '$thread',
      newThread: false,
      executeAt: '2026-04-04T18:30:00.000Z',
      cronSchedule: '*/5 * * * *',
      nextRunAt: null,
    });
  });

  it.each(['future', null])(
    'preserves a present unsupported schedule type as non-legacy: %s',
    (scheduleType) => {
      const event = makeScheduledTaskEvent({
        status: 'pending',
        workflow: JSON.stringify({
          schedule_type: scheduleType,
          thread_id: '$thread',
          new_thread: false,
          execute_at: '2026-04-04T18:30:00.000Z',
          cron_schedule: '* * * * *',
        }),
      });

      expect(parseScheduledTaskStateEvent(event)).toMatchObject({
        scheduleType: 'unsupported',
        executeAt: '2026-04-04T18:30:00.000Z',
        cronSchedule: '* * * * *',
      });
    }
  );

  it('trims harmless surrounding whitespace from object-form cron fields', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      thread_id: '$thread',
      new_thread: false,
      cron_schedule: {
        minute: ' */5 ',
        hour: ' * ',
        day: ' 1,15 ',
        month: ' * ',
        weekday: ' 0-6 ',
      },
    });

    expect(parseScheduledTaskStateEvent(event)).toMatchObject({
      cronSchedule: '*/5 * 1,15 * 0-6',
    });
  });

  it.each([
    {
      label: 'object field whitespace',
      cronSchedule: {
        minute: '0 0',
        hour: '*',
        day: '*',
        month: '*',
        weekday: '*',
      },
    },
    {
      label: 'six-field string',
      cronSchedule: '0 0 * * * *',
    },
  ])('rejects $label instead of creating a seconds-precision schedule', ({ cronSchedule }) => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      thread_id: '$thread',
      new_thread: false,
      cron_schedule: cronSchedule,
    });

    expect(parseScheduledTaskStateEvent(event)).toMatchObject({
      cronSchedule: null,
      cronScheduleMalformed: true,
    });
  });

  it('parses top-level next_run_at and gives a top-level cron string precedence', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      thread_id: '$thread',
      new_thread: false,
      cron_schedule: '7 * * * *',
      next_run_at: '2026-04-04T19:07:00.000Z',
      workflow: JSON.stringify({
        cron_schedule: {
          minute: '*/5',
          hour: '*',
          day: '*',
          month: '*',
          weekday: '*',
        },
      }),
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      scheduleType: null,
      threadId: '$thread',
      newThread: false,
      executeAt: null,
      cronSchedule: '7 * * * *',
      nextRunAt: '2026-04-04T19:07:00.000Z',
    });
  });

  it('normalizes malformed cron and next-run data to null without dropping the task', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      thread_id: '$thread',
      new_thread: false,
      next_run_at: 123,
      workflow: JSON.stringify({
        cron_schedule: {
          minute: '*/5',
          hour: '*',
        },
      }),
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      scheduleType: null,
      threadId: '$thread',
      newThread: false,
      executeAt: null,
      cronSchedule: null,
      cronScheduleMalformed: true,
      nextRunAt: null,
    });
  });

  it('returns null when legacy workflow JSON is malformed and fallback is required', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      workflow: '{bad json',
    });

    expect(parseScheduledTaskStateEvent(event)).toBeNull();
  });

  it('classifies a malformed present workflow as non-legacy when new_thread is omitted', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      thread_id: '$thread',
      execute_at: '2026-04-04T18:05:00.000Z',
      workflow: '{bad json',
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      scheduleType: 'unsupported',
      threadId: '$thread',
      newThread: false,
      executeAt: '2026-04-04T18:05:00.000Z',
      cronSchedule: null,
      nextRunAt: null,
    });
  });

  it('rejects a malformed present workflow when new_thread is explicitly invalid', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
      thread_id: '$thread',
      new_thread: 'false',
      workflow: '{bad json',
    });

    expect(parseScheduledTaskStateEvent(event)).toBeNull();
  });

  it('returns a room-level task shape when thread fields are missing', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
    });

    expect(parseScheduledTaskStateEvent(event)).toEqual({
      taskId: 'task-1',
      status: 'pending',
      scheduleType: null,
      threadId: null,
      newThread: false,
      executeAt: null,
      cronSchedule: null,
      nextRunAt: null,
    });
  });

  it('returns null when required fields are missing', () => {
    const event = makeScheduledTaskEvent({
      workflow: JSON.stringify({
        thread_id: '$thread',
        new_thread: false,
      }),
    });

    expect(parseScheduledTaskStateEvent(event)).toBeNull();
  });
});
