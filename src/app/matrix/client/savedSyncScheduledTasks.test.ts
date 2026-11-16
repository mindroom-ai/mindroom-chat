import { describe, expect, it } from 'vitest';
import { SyncAccumulator } from 'matrix-js-sdk/lib/sync-accumulator';
import type { ISyncResponse } from 'matrix-js-sdk/lib/sync-accumulator';
import { MINDROOM_SCHEDULED_TASK_EVENT } from '../protocol/scheduledTaskContract';
import { dropSettledScheduledTasks } from './savedSyncScheduledTasks';

const ROOM = '!room:example.org';

const stateEvent = (type: string, stateKey: string, content: unknown) => ({
  type,
  state_key: stateKey,
  content,
  event_id: `$${type}-${stateKey}`,
  sender: '@mindroom_agent:example.org',
  origin_server_ts: 1,
});

const task = (taskId: string, content: unknown) =>
  stateEvent(MINDROOM_SCHEDULED_TASK_EVENT, taskId, content);

const syncOf = (state: unknown[]): ISyncResponse =>
  ({
    next_batch: 'next',
    rooms: {
      join: {
        [ROOM]: {
          timeline: { events: [], prev_batch: 'prev', limited: false },
          state: { events: state },
          account_data: { events: [] },
          ephemeral: { events: [] },
          summary: {},
          unread_notifications: {},
        },
      },
    },
  } as unknown as ISyncResponse);

const stateKeysOf = (events: { type: string; state_key?: string }[] | undefined, type: string) =>
  (events ?? [])
    .filter((event) => event.type === type)
    .map((event) => event.state_key)
    .sort();

describe('dropSettledScheduledTasks', () => {
  it('keeps pending tasks and drops finished, cancelled and malformed ones', () => {
    const tasks: Record<string, unknown> = {
      pending: task('pending', { status: 'pending' }),
      completed: task('completed', { status: 'completed' }),
      cancelled: task('cancelled', { status: 'cancelled' }),
      emptied: task('emptied', {}),
      noContent: { type: MINDROOM_SCHEDULED_TASK_EVENT },
      notRecord: task('notRecord', 'pending'),
    };
    const name = stateEvent('m.room.name', '', { name: 'Room' });
    const sync = {
      joinRooms: {
        [ROOM]: {
          _currentState: { [MINDROOM_SCHEDULED_TASK_EVENT]: tasks, 'm.room.name': { '': name } },
        },
      },
    };

    dropSettledScheduledTasks(sync);

    expect(Object.keys(tasks)).toEqual(['pending']);
    expect(sync.joinRooms[ROOM]._currentState['m.room.name']).toEqual({ '': name });
  });

  it('removes the task type once no task is left, and passes over rooms without state', () => {
    const sync = {
      joinRooms: {
        [ROOM]: {
          _currentState: {
            [MINDROOM_SCHEDULED_TASK_EVENT]: { done: task('done', { status: 'completed' }) },
          },
        },
        '!bare:example.org': {},
      },
    };

    dropSettledScheduledTasks(sync);

    expect(sync.joinRooms[ROOM]._currentState).toEqual({});
    expect(() => dropSettledScheduledTasks({})).not.toThrow();
  });

  it('leaves only pending tasks in the state the SDK saves, under both state keys', () => {
    const accumulator = new SyncAccumulator({ maxTimelineEntries: 500 });
    accumulator.accumulate(
      syncOf([
        task('pending', { status: 'pending' }),
        task('done', { status: 'completed' }),
        stateEvent('m.room.name', '', { name: 'Room' }),
      ])
    );

    dropSettledScheduledTasks(accumulator as unknown as { joinRooms: Record<string, object> });

    const room = accumulator.getJSON(true).roomsData.join[ROOM];
    expect(stateKeysOf(room?.state?.events, MINDROOM_SCHEDULED_TASK_EVENT)).toEqual(['pending']);
    expect(
      stateKeysOf(room?.['org.matrix.msc4222.state_after']?.events, MINDROOM_SCHEDULED_TASK_EVENT)
    ).toEqual(['pending']);
    expect(stateKeysOf(room?.state?.events, 'm.room.name')).toEqual(['']);
  });
});
