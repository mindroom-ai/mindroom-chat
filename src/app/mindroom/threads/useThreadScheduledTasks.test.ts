import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { MINDROOM_SCHEDULED_TASK_EVENT } from './scheduledTaskContract';
import { useThreadScheduledTasks } from './useThreadScheduledTasks';
import { useStateEvents } from './useStateEvents';

const cronEvaluationSpy = vi.hoisted(() => vi.fn());

vi.mock('croner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('croner')>();
  return {
    ...actual,
    Cron: (...args: Parameters<typeof actual.Cron>) => {
      cronEvaluationSpy(args[0]);
      return actual.Cron(...args);
    },
  };
});

vi.mock('./useStateEvents', () => ({
  useStateEvents: vi.fn(),
}));

const mockedUseStateEvents = vi.mocked(useStateEvents);

const makeScheduledTaskEvent = (
  {
    status = 'pending',
    threadId,
    newThread = false,
    executeAt,
    cronSchedule,
    nextRunAt,
    scheduleType,
  }: {
    status?: string;
    threadId?: string | null;
    newThread?: boolean;
    executeAt?: string | null;
    cronSchedule?: string | null;
    nextRunAt?: string | null;
    scheduleType?: unknown;
  },
  stateKey: string
) =>
  new MatrixEvent({
    content: {
      status,
      workflow: JSON.stringify({
        thread_id: threadId,
        new_thread: newThread,
        execute_at: executeAt,
        cron_schedule: cronSchedule,
        schedule_type: scheduleType,
      }),
      next_run_at: nextRunAt,
    },
    event_id: `$${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: stateKey,
    type: MINDROOM_SCHEDULED_TASK_EVENT,
  });

type HarnessProps = {
  room: Room;
  threadRootId?: string;
  onRender: (value: number) => void;
};

function Harness({ room, threadRootId, onRender }: HarnessProps) {
  onRender(useThreadScheduledTasks(room, threadRootId));
  return null;
}

const renderHookHarness = (
  room: Room,
  threadRootId: string | undefined,
  getEvents: () => MatrixEvent[]
): {
  getSnapshot: () => number;
  update: () => void;
  renderer: ReactTestRenderer;
} => {
  let latestSnapshot: number | undefined;
  mockedUseStateEvents.mockImplementation(() => getEvents());

  const onRender = (value: number) => {
    latestSnapshot = value;
  };

  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(React.createElement(Harness, { room, threadRootId, onRender }));
  });
  if (!renderer) throw new Error('Hook renderer was not created');

  return {
    getSnapshot: () => {
      if (latestSnapshot === undefined) {
        throw new Error('Hook snapshot was not captured');
      }
      return latestSnapshot;
    },
    update: () => {
      act(() => {
        renderer.update(React.createElement(Harness, { room, threadRootId, onRender }));
      });
    },
    renderer,
  };
};

describe('useThreadScheduledTasks', () => {
  it('returns an empty map for rooms without scheduled tasks', () => {
    const room = {} as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => []);

    expect(getSnapshot()).toBe(0);
    expect(mockedUseStateEvents).toHaveBeenCalledWith(room, MINDROOM_SCHEDULED_TASK_EVENT);

    renderer.unmount();
  });

  it('counts one pending thread-targeted scheduled task', () => {
    const room = {} as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => [
      makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-1'),
    ]);

    expect(getSnapshot()).toBe(1);

    renderer.unmount();
  });

  it('filters out non-pending task statuses', () => {
    const room = {} as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => [
      makeScheduledTaskEvent({ status: 'completed', threadId: '$thread-1' }, 'task-1'),
      makeScheduledTaskEvent({ status: 'cancelled', threadId: '$thread-1' }, 'task-2'),
      makeScheduledTaskEvent({ status: 'failed', threadId: '$thread-1' }, 'task-3'),
      makeScheduledTaskEvent({ status: 'expired', threadId: '$thread-1' }, 'task-4'),
    ]);

    expect(getSnapshot()).toBe(0);

    renderer.unmount();
  });

  it('filters out tasks without a thread id', () => {
    const room = {} as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => [
      makeScheduledTaskEvent({ threadId: null }, 'task-1'),
    ]);

    expect(getSnapshot()).toBe(0);

    renderer.unmount();
  });

  it('filters out tasks that create a new thread', () => {
    const room = {} as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => [
      makeScheduledTaskEvent({ threadId: '$thread-1', newThread: true }, 'task-1'),
    ]);

    expect(getSnapshot()).toBe(0);

    renderer.unmount();
  });

  it('aggregates multiple pending tasks for the same thread', () => {
    const room = {} as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => [
      makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-1'),
      makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-2'),
      makeScheduledTaskEvent({ threadId: '$thread-2' }, 'task-3'),
    ]);

    expect(getSnapshot()).toBe(2);

    renderer.unmount();
  });

  it('returns zero when thread root id is missing', () => {
    const room = {} as Room;
    const { getSnapshot, renderer } = renderHookHarness(room, undefined, () => [
      makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-1'),
    ]);

    expect(getSnapshot()).toBe(0);

    renderer.unmount();
  });

  it('recomputes when the scheduled-task event list changes', () => {
    const room = {} as Room;
    let events = [makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-1')];
    const { getSnapshot, update, renderer } = renderHookHarness(room, '$thread-1', () => events);

    const initialCount = getSnapshot();
    expect(initialCount).toBe(1);

    events = [
      ...events,
      makeScheduledTaskEvent({ threadId: '$thread-1' }, 'task-2'),
      makeScheduledTaskEvent({ threadId: '$thread-2' }, 'task-3'),
    ];

    update();

    expect(getSnapshot()).not.toBe(initialCount);
    expect(getSnapshot()).toBe(2);

    renderer.unmount();
  });

  it('expires a one-shot count at its authoritative next run', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T18:00:00.000Z'));
    const room = {} as Room;
    const events = [
      makeScheduledTaskEvent(
        {
          threadId: '$thread-1',
          scheduleType: 'once',
          executeAt: '2026-04-04T18:30:00.000Z',
          nextRunAt: '2026-04-04T18:01:00.000Z',
        },
        'task-1'
      ),
    ];

    try {
      const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => events);

      expect(getSnapshot()).toBe(1);
      expect(vi.getTimerCount()).toBe(1);

      act(() => {
        vi.advanceTimersByTime(60_001);
      });

      expect(getSnapshot()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      renderer.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not resurrect an elapsed legacy one-shot at execute_at', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T18:02:30.000Z'));
    const room = {} as Room;
    const events = [
      makeScheduledTaskEvent(
        {
          threadId: '$thread-1',
          nextRunAt: '2026-04-04T18:00:00.000Z',
          executeAt: '2026-04-04T18:30:00.000Z',
        },
        'task-1'
      ),
    ];

    try {
      const { getSnapshot, renderer } = renderHookHarness(room, '$thread-1', () => events);

      expect(getSnapshot()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      renderer.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps multiple count-only indicator observers off Croner and continuation timers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T18:00:00.000Z'));
    const room = {} as Room;
    const events = Array.from({ length: 40 }, (_value, index) =>
      makeScheduledTaskEvent(
        {
          threadId: '$thread-1',
          cronSchedule: `${index} * * * *`,
        },
        `task-${index}`
      )
    );
    mockedUseStateEvents.mockImplementation(() => [...events]);
    cronEvaluationSpy.mockClear();
    let renderer: ReactTestRenderer | undefined;

    try {
      act(() => {
        renderer = create(
          React.createElement(
            React.Fragment,
            null,
            ...[
              { id: 'badge-a', threadRootId: '$thread-1' },
              { id: 'badge-b', threadRootId: '$thread-1' },
              { id: 'badge-c', threadRootId: '$thread-1' },
              { id: 'room-input', threadRootId: undefined },
            ].map(({ id, threadRootId }) =>
              React.createElement(Harness, {
                key: id,
                room,
                threadRootId,
                onRender: () => undefined,
              })
            )
          )
        );
      });

      expect(cronEvaluationSpy).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (renderer) {
        act(() => {
          renderer?.unmount();
        });
      }
      vi.useRealTimers();
    }
  });
});
