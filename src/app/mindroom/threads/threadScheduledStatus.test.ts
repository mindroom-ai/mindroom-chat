import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import {
  buildRoomThreadScheduledStatusMap,
  getNextThreadScheduledTs,
  getRoomScheduledTaskCounts,
  getThreadScheduledStatus,
} from './threadScheduledStatus';

const makeScheduledEvent = ({
  stateKey = 'task',
  status = 'pending',
  threadId = '$thread',
  newThread = false,
  executeAt,
}: {
  stateKey?: string;
  status?: string;
  threadId?: string | null;
  newThread?: boolean;
  executeAt?: string | null;
}): MatrixEvent =>
  ({
    getStateKey: () => stateKey,
    getContent: () => ({
      status,
      thread_id: threadId,
      new_thread: newThread,
      execute_at: executeAt,
    }),
  } as unknown as MatrixEvent);

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

  it('counts invalid or missing timestamps without making them the next scheduled time', () => {
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
      nextScheduledTs: Date.parse('2026-04-04T18:05:00.000Z'),
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
});
