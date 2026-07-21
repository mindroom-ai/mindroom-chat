import React from 'react';
import { EventEmitter } from 'events';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { MINDROOM_SCHEDULED_TASK_EVENT } from './scheduledTaskContract';
import { useThreadHeaderInfo, type ThreadHeaderInfo } from './useThreadHeaderInfo';
import { useStateEvents } from './useStateEvents';

vi.mock('./useStateEvents', () => ({
  useStateEvents: vi.fn(),
}));

vi.mock('./useThreadEventRefresh', () => ({
  useThreadEventRefresh: () => undefined,
}));

const mockedUseStateEvents = vi.mocked(useStateEvents);

const makeSummaryEvent = (body: string, generatedAt: string, eventId: string) =>
  new MatrixEvent({
    content: {
      msgtype: 'm.notice',
      body,
      'io.mindroom.thread_summary': {
        version: 1,
        summary: body,
        generated_at: generatedAt,
      },
    },
    event_id: eventId,
    origin_server_ts: Date.parse(generatedAt),
    room_id: '!room:example.org',
    sender: '@agent:example.org',
    type: 'm.room.message',
  });

const makeScheduledTaskEvent = (
  {
    status = 'pending',
    threadId,
    newThread = false,
    executeAt,
    scheduledAt,
    cronSchedule,
  }: {
    status?: string;
    threadId?: string | null;
    newThread?: boolean;
    executeAt?: string;
    scheduledAt?: string;
    cronSchedule?: Record<'minute' | 'hour' | 'day' | 'month' | 'weekday', string>;
  },
  stateKey: string
) =>
  new MatrixEvent({
    content: {
      status,
      thread_id: threadId,
      new_thread: newThread,
      execute_at: executeAt,
      scheduled_at: scheduledAt,
      workflow:
        cronSchedule === undefined
          ? undefined
          : JSON.stringify({
              schedule_type: 'cron',
              cron_schedule: cronSchedule,
            }),
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
  threadId?: string;
  onRender: (value: ThreadHeaderInfo) => void;
};

function Harness({ room, threadId, onRender }: HarnessProps) {
  onRender(useThreadHeaderInfo(room, threadId));
  return null;
}

const renderHookHarness = (
  room: Room,
  threadId: string | undefined,
  getEvents: () => MatrixEvent[]
): {
  getSnapshot: () => ThreadHeaderInfo;
  getRenderCount: () => number;
  update: () => void;
  renderer: ReactTestRenderer;
} => {
  let latestSnapshot: ThreadHeaderInfo | undefined;
  let renderCount = 0;
  let renderer!: ReactTestRenderer;
  mockedUseStateEvents.mockImplementation(() => getEvents());

  const onRender = (value: ThreadHeaderInfo) => {
    renderCount += 1;
    latestSnapshot = value;
  };

  act(() => {
    renderer = create(React.createElement(Harness, { room, threadId, onRender }));
  });

  return {
    getSnapshot: () => {
      if (!latestSnapshot) {
        throw new Error('Hook snapshot was not captured');
      }
      return latestSnapshot;
    },
    getRenderCount: () => renderCount,
    update: () => {
      act(() => {
        renderer.update(React.createElement(Harness, { room, threadId, onRender }));
      });
    },
    renderer,
  };
};

type MockThread = {
  rootEvent: MatrixEvent;
  events: MatrixEvent[];
  timeline: MatrixEvent[];
};

type MockRoom = Room &
  EventEmitter & {
    thread: MockThread;
    setThread: (thread: MockThread | undefined) => void;
  };

const createThread = (threadRootId = '$root') => {
  const rootEvent = new MatrixEvent({
    content: { body: 'Root message', msgtype: 'm.text' },
    event_id: threadRootId,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });
  const olderSummary = makeSummaryEvent('Older summary', '2026-04-04T18:00:00.000Z', '$summary-1');
  const latestSummary = makeSummaryEvent(
    'Latest summary',
    '2026-04-04T18:10:00.000Z',
    '$summary-2'
  );
  const replyTimelineEvent = new MatrixEvent({
    content: { body: 'Thread reply', msgtype: 'm.text' },
    event_id: '$reply',
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@bob:example.org',
    type: 'm.room.message',
  });

  return {
    rootEvent,
    replyLookupEvent: {
      getId: () => '$reply',
      threadRootId,
    },
    thread: {
      rootEvent,
      events: [olderSummary, replyTimelineEvent, latestSummary],
      timeline: [olderSummary, replyTimelineEvent, latestSummary],
    } as MockThread,
  };
};

const createRoom = ({
  threadRootId = '$root',
  replyEventId,
  threadInitiallyAvailable = true,
}: {
  threadRootId?: string;
  replyEventId?: string;
  threadInitiallyAvailable?: boolean;
} = {}): MockRoom => {
  const { rootEvent, replyLookupEvent, thread } = createThread(threadRootId);
  const emitter = new EventEmitter();
  let currentThread = threadInitiallyAvailable ? thread : undefined;

  return Object.assign(emitter, {
    roomId: '!room:example.org',
    thread,
    setThread: (nextThread: MockThread | undefined) => {
      currentThread = nextThread;
    },
    getThread: vi.fn((eventId: string) => (eventId === threadRootId ? currentThread : undefined)),
    findEventById: vi.fn((eventId: string) => {
      if (eventId === (replyEventId ?? '$reply')) return replyLookupEvent;
      if (eventId === threadRootId) return rootEvent;
      return undefined;
    }),
  }) as unknown as MockRoom;
};

describe('useThreadHeaderInfo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T18:00:00.000Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves a reply event id to the canonical thread root for scheduled task state', () => {
    const room = createRoom({ replyEventId: '$reply-event' });
    const { getSnapshot, renderer } = renderHookHarness(room, '$reply-event', () => [
      makeScheduledTaskEvent(
        {
          threadId: '$root',
          executeAt: '2026-04-04T18:15:00.000Z',
        },
        'task-1'
      ),
    ]);

    expect(getSnapshot()).toMatchObject({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse('2026-04-04T18:15:00.000Z'),
      scheduledDisplayText: 'in 15m',
    });
    expect(room.findEventById).toHaveBeenCalledWith('$reply-event');

    renderer.unmount();
  });

  it('renders a next time instead of a task count for a cron-only event', () => {
    vi.setSystemTime(new Date('2024-02-29T12:00:00.000Z'));
    const room = createRoom();
    const { getSnapshot, renderer } = renderHookHarness(room, '$root', () => [
      makeScheduledTaskEvent(
        {
          threadId: '$root',
          cronSchedule: {
            minute: ' 0 ',
            hour: ' 0 ',
            day: ' 1,31 ',
            month: ' * ',
            weekday: ' * ',
          },
        },
        'cron-task'
      ),
    ]);

    expect(getSnapshot()).toMatchObject({
      scheduledTaskCount: 1,
      nextScheduledTs: Date.parse('2024-03-01T00:00:00.000Z'),
      scheduledDisplayText: expect.any(String),
    });
    expect(getSnapshot().scheduledDisplayText).not.toBe('1 scheduled task');

    renderer.unmount();
  });

  it('renders count-only banner metadata when any pending occurrence is unresolved', () => {
    vi.setSystemTime(new Date('2026-04-04T18:00:00.000Z'));
    const room = createRoom();
    const { getSnapshot, renderer } = renderHookHarness(room, '$root', () => [
      makeScheduledTaskEvent(
        {
          threadId: '$root',
          cronSchedule: {
            minute: '0',
            hour: '0',
            day: '?',
            month: '*',
            weekday: '*',
          },
        },
        'unknown-task'
      ),
      makeScheduledTaskEvent(
        {
          threadId: '$root',
          executeAt: '2026-04-04T18:30:00.000Z',
        },
        'known-task'
      ),
    ]);

    expect(getSnapshot()).toMatchObject({
      scheduledTaskCount: 2,
      nextScheduledTs: undefined,
      scheduledDisplayText: '2 scheduled tasks',
    });

    act(() => {
      vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    });

    expect(getSnapshot()).toMatchObject({
      scheduledTaskCount: 1,
      nextScheduledTs: undefined,
      scheduledDisplayText: '1 scheduled task',
    });

    renderer.unmount();
  });

  it('caps a far-future count-only refresh boundary without a timer hot loop', () => {
    const room = createRoom();
    const { getRenderCount, getSnapshot, renderer } = renderHookHarness(room, '$root', () => [
      makeScheduledTaskEvent(
        {
          threadId: '$root',
          cronSchedule: {
            minute: '0',
            hour: '0',
            day: '?',
            month: '*',
            weekday: '*',
          },
        },
        'unknown-task'
      ),
      makeScheduledTaskEvent(
        {
          threadId: '$root',
          executeAt: '2027-04-04T18:00:00.000Z',
        },
        'far-future-task'
      ),
    ]);

    expect(getSnapshot()).toMatchObject({
      scheduledTaskCount: 2,
      nextScheduledTs: undefined,
      scheduledDisplayText: '2 scheduled tasks',
    });
    expect(getRenderCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(getRenderCount()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    renderer.unmount();
  });

  it('continues selected-thread cron work without publishing a partial next occurrence', () => {
    vi.setSystemTime(new Date('2026-04-04T18:02:30.000Z'));
    const room = createRoom();
    const scheduledTaskEvents = [
      makeScheduledTaskEvent(
        {
          threadId: '$other',
          cronSchedule: {
            minute: '*/5',
            hour: '*',
            day: '*',
            month: '*',
            weekday: '*',
          },
        },
        'other-task'
      ),
      makeScheduledTaskEvent(
        {
          threadId: '$root',
          cronSchedule: {
            minute: '0',
            hour: '0',
            day: '1-31',
            month: '*',
            weekday: '1',
          },
        },
        'selected-expanded-task'
      ),
      makeScheduledTaskEvent(
        {
          threadId: '$root',
          cronSchedule: {
            minute: '*/5',
            hour: '*',
            day: '*',
            month: '*',
            weekday: '*',
          },
        },
        'selected-near-task'
      ),
    ];
    const { getSnapshot, renderer } = renderHookHarness(room, '$root', () => scheduledTaskEvents);

    expect(getSnapshot()).toMatchObject({
      scheduledTaskCount: 2,
      nextScheduledTs: undefined,
      scheduledDisplayText: '2 scheduled tasks',
    });

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(getSnapshot()).toMatchObject({
      scheduledTaskCount: 2,
      nextScheduledTs: Date.parse('2026-04-04T18:05:00.000Z'),
      scheduledDisplayText: expect.any(String),
    });

    renderer.unmount();
  });

  it('re-arms after an external render just after a recurring occurrence', () => {
    vi.setSystemTime(new Date('2026-04-04T18:02:30.000Z'));
    const room = createRoom();
    const scheduledTaskEvents = [
      makeScheduledTaskEvent(
        {
          threadId: '$root',
          cronSchedule: {
            minute: '*/5',
            hour: '*',
            day: '*',
            month: '*',
            weekday: '*',
          },
        },
        'cron-task'
      ),
    ];
    const { getSnapshot, update, renderer } = renderHookHarness(
      room,
      '$root',
      () => scheduledTaskEvents
    );

    expect(getSnapshot()).toMatchObject({
      nextScheduledTs: Date.parse('2026-04-04T18:05:00.000Z'),
      scheduledDisplayText: 'in 2m 30s',
    });

    vi.setSystemTime(new Date('2026-04-04T18:05:00.100Z'));
    update();

    expect(getSnapshot()).toMatchObject({
      nextScheduledTs: undefined,
      scheduledDisplayText: '1 scheduled task',
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(getSnapshot()).toMatchObject({
      nextScheduledTs: Date.parse('2026-04-04T18:10:00.000Z'),
      scheduledDisplayText: 'in 4m 59s',
    });
    expect(scheduledTaskEvents).toHaveLength(1);

    renderer.unmount();
  });

  it('returns empty scheduled metadata when there are no pending tasks', () => {
    const room = createRoom({ threadInitiallyAvailable: false });
    const { getSnapshot, renderer } = renderHookHarness(room, '$root', () => []);

    expect(getSnapshot()).toMatchObject({
      scheduledTaskCount: 0,
      nextScheduledTs: undefined,
      scheduledDisplayText: undefined,
    });

    renderer.unmount();
  });

  it('counts scheduled tasks and picks the earliest future execution time', () => {
    const room = createRoom();
    const { getSnapshot, renderer } = renderHookHarness(room, '$root', () => [
      makeScheduledTaskEvent(
        {
          threadId: '$root',
          scheduledAt: '2026-04-04T18:03:45.000Z',
        },
        'task-1'
      ),
      makeScheduledTaskEvent(
        {
          threadId: '$root',
          executeAt: '2026-04-04T18:15:00.000Z',
        },
        'task-2'
      ),
      makeScheduledTaskEvent(
        {
          threadId: '$root',
          newThread: true,
          executeAt: '2026-04-04T18:02:00.000Z',
        },
        'task-3'
      ),
      makeScheduledTaskEvent(
        {
          status: 'completed',
          threadId: '$root',
          executeAt: '2026-04-04T18:01:00.000Z',
        },
        'task-4'
      ),
    ]);

    expect(getSnapshot()).toMatchObject({
      scheduledTaskCount: 2,
      nextScheduledTs: Date.parse('2026-04-04T18:03:45.000Z'),
      scheduledDisplayText: 'in 3m 45s',
    });

    renderer.unmount();
  });

  it('updates the countdown text as time advances', () => {
    const room = createRoom();
    const { getSnapshot, update, renderer } = renderHookHarness(room, '$root', () => [
      makeScheduledTaskEvent(
        {
          threadId: '$root',
          executeAt: '2026-04-04T18:03:45.000Z',
        },
        'task-1'
      ),
    ]);

    expect(getSnapshot().scheduledDisplayText).toBe('in 3m 45s');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    update();

    expect(getSnapshot().scheduledDisplayText).toBe('in 3m 44s');

    renderer.unmount();
  });
});
