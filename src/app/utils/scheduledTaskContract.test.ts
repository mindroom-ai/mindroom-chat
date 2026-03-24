import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { describe, expect, it } from 'vitest';
import { StateEvent } from '../../types/matrix/room';
import { parseScheduledTaskStateEvent } from './scheduledTaskContract';

const makeScheduledTaskEvent = (content: Record<string, unknown>, stateKey = 'task-1') =>
  new MatrixEvent({
    content,
    event_id: `$${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: stateKey,
    type: StateEvent.MindRoomScheduledTask,
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
      threadId: '$thread',
      newThread: false,
      executeAt: null,
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
      threadId: '$thread',
      newThread: false,
      executeAt: null,
    });
  });

  it('returns null when legacy workflow JSON is malformed and fallback is required', () => {
    const event = makeScheduledTaskEvent({
      status: 'pending',
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
      threadId: null,
      newThread: false,
      executeAt: null,
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
