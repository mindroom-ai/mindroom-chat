import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { EventStatus, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { describe, expect, it, vi } from 'vitest';
import { buildCompactThreadCardViewModelFromRecord } from './compactThreadCardViewModel';
import { buildThreadRecord } from './threadRecord';
import { buildRoomThreadScheduledStatusMap } from './threadScheduledStatus';
import { useRoomThreadScheduledStatusMap } from './useRoomThreadScheduledStatusMap';

const makeEvent = ({
  eventId,
  threadRootId,
  sender,
  body,
  content,
  status,
  ts = 1000,
}: {
  eventId: string;
  threadRootId?: string;
  sender?: string;
  body?: string;
  content?: Record<string, unknown>;
  status?: EventStatus;
  ts?: number;
}): MatrixEvent =>
  ({
    getId: () => eventId,
    threadRootId,
    getSender: () => sender,
    getContent: () => content ?? (body ? { body, msgtype: 'm.text' } : {}),
    getType: () => 'm.room.message',
    getRelation: () => (threadRootId ? { rel_type: 'm.thread' } : undefined),
    isRelation: (relType: string) => !!threadRootId && relType === 'm.thread',
    getTs: () => ts,
    replacingEvent: () => undefined,
    getUnsigned: () => undefined,
    isRedacted: () => false,
    isRedaction: () => false,
    status,
  } as unknown as MatrixEvent);

const makeRoom = ({
  rootEvent,
  thread,
  memberNames = {},
}: {
  rootEvent?: MatrixEvent;
  thread?: ReturnType<Room['getThread']>;
  memberNames?: Record<string, string>;
} = {}): Room =>
  ({
    roomId: '!room:server',
    getThread: vi.fn(() => thread),
    findEventById: vi.fn(() => rootEvent),
    getUnfilteredTimelineSet: vi.fn(() => ({
      relations: {
        getChildEventsForEvent: () => undefined,
      },
    })),
    getMember: vi.fn((userId: string) => {
      const name = memberNames[userId];
      return name
        ? {
            name,
            rawDisplayName: name,
            getMxcAvatarUrl: () => undefined,
          }
        : undefined;
    }),
  } as unknown as Room);

const makeMx = (): MatrixClient =>
  ({
    getUserId: () => '@me:server',
  } as unknown as MatrixClient);

const makeCronScheduledEvent = (): MatrixEvent =>
  ({
    getStateKey: () => 'cron-task',
    getContent: () => ({
      status: 'pending',
      thread_id: '$root',
      new_thread: false,
      workflow: JSON.stringify({
        schedule_type: 'cron',
        cron_schedule: {
          minute: '*/5',
          hour: '*',
          day: '*',
          month: '*',
          weekday: '*',
        },
      }),
    }),
  } as unknown as MatrixEvent);

const buildModel = (
  room: Room,
  overrides: Partial<Parameters<typeof buildThreadRecord>[0]> = {}
) => {
  const record = buildThreadRecord({
    room,
    threadRootId: '$root',
    currentUserId: '@me:server',
    ...overrides,
  });

  return buildCompactThreadCardViewModelFromRecord({
    record,
    room,
    currentUserId: '@me:server',
    mx: makeMx(),
    useAuthentication: false,
  });
};

describe('buildCompactThreadCardViewModelFromRecord', () => {
  it('renders room member display names instead of raw Matrix IDs in card text', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Ask @alice:server to review with @unknown:elsewhere.',
      ts: 1000,
    });
    const reply = makeEvent({
      eventId: '$reply',
      threadRootId: '$root',
      sender: '@agent:server',
      body: 'Waiting for @alice:server.',
      ts: 2000,
    });
    const thread = {
      id: '$root',
      rootEvent,
      events: [reply],
      timeline: [reply],
      lastReply: () => reply,
      replyToEvent: undefined,
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => ({
          getEvents: () => [rootEvent, reply],
          getNeighbouringTimeline: () => undefined,
        }),
        relations: {
          getChildEventsForEvent: () => undefined,
        },
      }),
    } as unknown as ReturnType<Room['getThread']>;
    const room = makeRoom({
      rootEvent,
      thread,
      memberNames: {
        '@alice:server': 'Alice Adams',
        '@agent:server': 'Review Agent',
        '@ipv6:[::1]': 'Local User',
      },
    });

    const model = buildModel(room, {
      threadRootEvent: rootEvent,
      readUpToTs: null,
      summaryInfo: {
        summaryText:
          'Ask @alice:server to review. Notify @ipv6:[::1]. Keep @unknown:elsewhere, @alice:server:8448, and @alice:server.example raw.',
        messageCount: 2,
      },
    });

    expect(model.titleText).toBe(
      'Ask Alice Adams to review. Notify Local User. Keep @unknown:elsewhere, @alice:server:8448, and @alice:server.example raw.'
    );
    expect(model.displayTitleText).toBe(
      'Ask Alice Adams to review. Notify Local User. Keep @unknown:elsewhere, @alice:server:8448, and @alice:server.example raw.'
    );
    expect(model.previewText).toBe('Review Agent: Waiting for Alice Adams.');
  });

  it('builds one compact model from summary, tags, scheduled state, and visible replies', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Root body',
      ts: 1000,
    });
    const reply = makeEvent({
      eventId: '$reply',
      threadRootId: '$root',
      sender: '@agent:server',
      body: 'Latest reply body',
      ts: 2000,
    });
    const thread = {
      id: '$root',
      rootEvent,
      events: [reply],
      timeline: [reply],
      lastReply: () => reply,
      replyToEvent: undefined,
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => ({
          getEvents: () => [rootEvent, reply],
          getNeighbouringTimeline: () => undefined,
        }),
        relations: {
          getChildEventsForEvent: () => undefined,
        },
      }),
    } as unknown as ReturnType<Room['getThread']>;
    const room = makeRoom({
      rootEvent,
      thread,
      memberNames: {
        '@agent:server': 'Agent',
      },
    });

    const model = buildModel(room, {
      threadRootEvent: rootEvent,
      summaryInfo: {
        summaryText: 'Live AI summary',
        messageCount: 9,
      },
      readUpToTs: null,
      scheduledStatus: {
        scheduledTaskCount: 2,
      },
      threadResolution: {
        isResolved: true,
        tags: {
          resolved: {},
          agent: {},
        },
      },
    });

    expect(model.titleText).toBe('Live AI summary');
    expect(model.previewText).toBe('Agent: Latest reply body');
    expect(model.messageCount).toBe(9);
    expect(model.messageCountLabel).toBe('9 msgs');
    expect(model.tags).toEqual(['agent']);
    expect(model.isResolved).toBe(true);
    expect(model.isUnread).toBe(true);
    expect(model.scheduledTaskLabel).toBe('2 pending scheduled tasks');
    expect(model.scheduledDisplayText).toBe('2 scheduled tasks');
    expect(model.participants).toEqual([
      {
        userId: '@agent:server',
        displayName: 'Agent',
        avatarUrl: undefined,
      },
      {
        userId: '@me:server',
        displayName: 'me',
        avatarUrl: undefined,
      },
    ]);
  });

  it('renders a next time instead of a task count for a cron-only event', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-29T12:00:00.000Z'));

    try {
      const room = makeRoom();
      const cronEvent = {
        ...makeCronScheduledEvent(),
        getContent: () => ({
          status: 'pending',
          thread_id: '$root',
          new_thread: false,
          workflow: JSON.stringify({
            schedule_type: 'cron',
            cron_schedule: {
              minute: ' 0 ',
              hour: ' 0 ',
              day: ' 1,31 ',
              month: ' * ',
              weekday: ' * ',
            },
          }),
        }),
      } as MatrixEvent;
      const scheduledStatus = buildRoomThreadScheduledStatusMap(
        [cronEvent],
        Date.parse('2024-02-29T12:00:00.000Z')
      ).get('$root');

      expect(scheduledStatus).toEqual({
        scheduledTaskCount: 1,
        nextScheduledTs: Date.parse('2024-03-01T00:00:00.000Z'),
      });

      const model = buildModel(room, { scheduledStatus });

      expect(model.scheduledDisplayText).toBeDefined();
      expect(model.scheduledDisplayText).not.toBe('1 scheduled task');
      expect(model.scheduledTaskLabel).toBe(
        `1 pending scheduled task, ${model.scheduledDisplayText}`
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders count-only copy when any pending task has an unresolved occurrence', () => {
    const room = makeRoom();
    const makeScheduledEvent = (stateKey: string, content: Record<string, unknown>): MatrixEvent =>
      ({
        getStateKey: () => stateKey,
        getContent: () => ({
          status: 'pending',
          thread_id: '$root',
          new_thread: false,
          ...content,
        }),
      } as unknown as MatrixEvent);
    const scheduledStatus = buildRoomThreadScheduledStatusMap(
      [
        makeScheduledEvent('unknown', { cron_schedule: '0 0 ? * *' }),
        makeScheduledEvent('known', { execute_at: '2026-04-04T18:30:00.000Z' }),
      ],
      Date.parse('2026-04-04T18:00:00.000Z')
    ).get('$root');

    expect(scheduledStatus).toEqual({
      scheduledTaskCount: 2,
      nextScheduledTs: undefined,
      nextScheduledRefreshTs: Date.parse('2026-04-04T18:30:00.000Z'),
    });

    const model = buildModel(room, { scheduledStatus });
    expect(model.scheduledDisplayText).toBe('2 scheduled tasks');
    expect(model.scheduledTaskLabel).toBe('2 pending scheduled tasks');
  });

  it('advances a mounted cron-only card after the occurrence with stable state events', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T18:02:30.000Z'));

    let renderer: ReactTestRenderer | undefined;
    try {
      const room = makeRoom();
      const scheduledTaskEvents = [makeCronScheduledEvent()];
      let latestModel: ReturnType<typeof buildModel> | undefined;
      let latestNextScheduledTs: number | undefined;

      const Harness = () => {
        const scheduledStatus = useRoomThreadScheduledStatusMap(
          room,
          scheduledTaskEvents,
          true,
          0
        ).get('$root');
        latestNextScheduledTs = scheduledStatus?.nextScheduledTs;
        latestModel = buildModel(room, { scheduledStatus });
        return null;
      };

      act(() => {
        renderer = create(React.createElement(Harness));
      });

      expect(latestNextScheduledTs).toBe(Date.parse('2026-04-04T18:05:00.000Z'));
      expect(latestModel?.scheduledDisplayText).toBe('in 2m 30s');

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(latestNextScheduledTs).toBe(Date.parse('2026-04-04T18:05:00.000Z'));
      expect(latestModel?.scheduledDisplayText).toBe('in 2m 29s');

      act(() => {
        vi.advanceTimersByTime(2 * 60 * 1000 + 29 * 1000 + 1);
      });

      expect(latestNextScheduledTs).toBe(Date.parse('2026-04-04T18:10:00.000Z'));
      expect(latestModel?.scheduledDisplayText).toBe('in 5m');
      expect(latestModel?.scheduledTaskLabel).toBe('1 pending scheduled task, in 5m');
      expect(scheduledTaskEvents).toHaveLength(1);
    } finally {
      if (renderer) {
        act(() => {
          renderer?.unmount();
        });
      }
      vi.useRealTimers();
    }
  });

  it('falls back to count copy instead of formatting an elapsed card timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T18:00:00.000Z'));

    try {
      const model = buildModel(makeRoom(), {
        scheduledStatus: {
          scheduledTaskCount: 1,
          nextScheduledTs: Date.parse('2026-04-04T17:59:00.000Z'),
        },
      });

      expect(model.scheduledDisplayText).toBe('1 scheduled task');
      expect(model.scheduledTaskLabel).toBe('1 pending scheduled task');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses cached root preview as the zero-reply title and recent-thread summary', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Original root body',
    });
    const room = makeRoom({ rootEvent });

    const model = buildModel(room, {
      threadRootEvent: rootEvent,
      rootPreviewText: 'Edited root preview',
      fallbackMessageCount: 0,
    });

    expect(model.titleText).toBe('Edited root preview');
    expect(model.previewText).toBe('Edited root preview');
    expect(model.messageCount).toBe(0);
    expect(model.messageCountLabel).toBe('0 replies');
    expect(model.recentThreadSummaryText).toBe('Edited root preview');
  });

  it('uses voice message previews for zero-reply compact card models', () => {
    const filename = 'voice-message-2026-04-24T12-03-00.m4a';
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      content: {
        body: filename,
        filename,
        msgtype: 'm.audio',
        'm.voice': {},
        'm.audio': {
          duration: 1000,
        },
      },
    });
    const room = makeRoom({ rootEvent });

    const model = buildModel(room, {
      threadRootEvent: rootEvent,
    });

    expect(model.titleText).toBe('Voice message');
    expect(model.displayTitleText).toBe('Voice message');
    expect(model.previewText).toBe('Voice message');
    expect(model.primarySummaryText).toBe('Voice message');
    expect(model.recentThreadSummaryText).toBe('Voice message');
    expect(model.messageCount).toBe(0);
    expect(model.messageCountLabel).toBe('0 replies');
  });

  it('falls back to room-level resolution data when overview metadata is absent', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@agent:server',
      body: 'Root body',
    });
    const room = makeRoom({ rootEvent });

    const model = buildModel(room, {
      threadRootEvent: rootEvent,
      threadResolution: {
        tags: {
          resolved: { set_by: '@me:server', set_at: '2026-04-24T00:00:00.000Z' },
          triage: { set_by: '@me:server', set_at: '2026-04-24T00:00:00.000Z' },
        },
        isResolved: true,
      },
    });

    expect(model.isResolved).toBe(true);
    expect(model.tags).toEqual(['triage']);
    expect(model.attentionState).toBe('resolved');
  });

  it('marks compact models pending while a zero-reply root local echo is sending', () => {
    const rootEvent = makeEvent({
      eventId: '~root',
      sender: '@me:server',
      body: 'Pending root body',
      status: EventStatus.SENDING,
    });
    const room = makeRoom({ rootEvent });

    const model = buildModel(room, {
      threadRootId: '~root',
      threadRootEvent: rootEvent,
      fallbackMessageCount: 0,
    });

    expect((model as { hasPendingSend?: boolean }).hasPendingSend).toBe(true);
  });

  it('marks compact models failed while a zero-reply root local echo is not sent', () => {
    const rootEvent = makeEvent({
      eventId: '~root',
      sender: '@me:server',
      body: 'Failed root body',
      status: EventStatus.NOT_SENT,
    });
    const room = makeRoom({ rootEvent });

    const model = buildModel(room, {
      threadRootId: '~root',
      threadRootEvent: rootEvent,
      fallbackMessageCount: 0,
    });

    expect(model.hasFailedSend).toBe(true);
    expect(model.hasPendingSend).toBe(false);
  });

  it('marks compact models pending while the latest visible reply local echo is sending', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      sender: '@me:server',
      body: 'Root body',
      ts: 1000,
    });
    const reply = makeEvent({
      eventId: '~reply',
      threadRootId: '$root',
      sender: '@me:server',
      body: 'Pending reply body',
      status: EventStatus.SENDING,
      ts: 2000,
    });
    const thread = {
      id: '$root',
      rootEvent,
      events: [reply],
      timeline: [reply],
      lastReply: () => reply,
      replyToEvent: undefined,
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => ({
          getEvents: () => [rootEvent, reply],
          getNeighbouringTimeline: () => undefined,
        }),
        relations: {
          getChildEventsForEvent: () => undefined,
        },
      }),
    } as unknown as ReturnType<Room['getThread']>;
    const room = makeRoom({
      rootEvent,
      thread,
      memberNames: {
        '@me:server': 'Me',
      },
    });

    const model = buildModel(room, {
      threadRootEvent: rootEvent,
    });

    expect(model.previewText).toBe('Me: Pending reply body');
    expect((model as { hasPendingSend?: boolean }).hasPendingSend).toBe(true);
  });
});
