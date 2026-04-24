import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { describe, expect, it, vi } from 'vitest';
import type { MindroomThreadSummaryInfo } from '../../components/message/mindroomThreadSummary';
import {
  buildThreadBadgeViewModel,
  buildTimelineThreadBadgeViewModel,
} from './threadBadgeViewModel';

const makeEvent = ({
  eventId,
  threadRootId,
  sender = '@sender:server',
  body,
  type = 'm.room.message',
  ts = 1000,
  unsigned,
}: {
  eventId: string;
  threadRootId?: string;
  sender?: string;
  body?: string;
  type?: string;
  ts?: number;
  unsigned?: Record<string, unknown>;
}): MatrixEvent =>
  ({
    getId: () => eventId,
    threadRootId,
    getSender: () => sender,
    getContent: () => (body ? { body, msgtype: 'm.text' } : {}),
    getType: () => type,
    getTs: () => ts,
    getRelation: () => (threadRootId ? { rel_type: 'm.thread' } : undefined),
    isRelation: (relType: string) => !!threadRootId && relType === 'm.thread',
    replacingEvent: () => undefined,
    getUnsigned: () => unsigned,
    isRedacted: () => false,
    isRedaction: () => false,
  } as unknown as MatrixEvent);

const makeRoom = ({ thread }: { thread?: ReturnType<Room['getThread']> } = {}): Room =>
  ({
    roomId: '!room:server',
    getThread: vi.fn(() => thread),
    findEventById: vi.fn(() => undefined),
    getUnfilteredTimelineSet: vi.fn(() => ({
      relations: {
        getChildEventsForEvent: () => undefined,
      },
    })),
    hasEncryptionStateEvent: vi.fn(() => false),
  } as unknown as Room);

const buildModel = (overrides: Partial<Parameters<typeof buildThreadBadgeViewModel>[0]> = {}) => {
  const threadRootEvent = makeEvent({
    eventId: '$root',
    body: 'Root body',
  });

  return buildThreadBadgeViewModel({
    room: makeRoom(),
    threadRootEvent,
    threadRootId: '$root',
    replyCount: 3,
    ...overrides,
  });
};

describe('buildThreadBadgeViewModel', () => {
  it('merges cached and fallback summary info into the badge model', () => {
    const olderFallback: MindroomThreadSummaryInfo = {
      summaryText: 'Older fallback summary',
      messageCount: 2,
      generatedTs: 1000,
    };
    const newerCached: MindroomThreadSummaryInfo = {
      summaryText: 'Newer cached summary',
      messageCount: 4,
      generatedTs: 2000,
    };

    const model = buildModel({
      cachedSummaryInfo: newerCached,
      fallbackSummaryInfo: olderFallback,
      participantIds: ['@agent:server'],
      isResolved: true,
    });

    expect(model).toEqual({
      id: {
        roomId: '!room:server',
        threadRootId: '$root',
      },
      summaryInfo: newerCached,
      recentThreadSummaryText: 'Newer cached summary',
      replyCount: 3,
      participantIds: ['@agent:server'],
      isResolved: true,
    });
  });

  it('keeps zero-reply roots renderable when the caller has allowed them', () => {
    const model = buildModel({
      replyCount: 0,
      threadRootEvent: makeEvent({
        eventId: '$root',
        body: 'Standalone root body',
      }),
    });

    expect(model?.replyCount).toBe(0);
    expect(model?.recentThreadSummaryText).toBe('Standalone root body');
  });

  it('does not build a badge while already rendering a thread view', () => {
    expect(buildModel({ activeThreadId: '$root' })).toBeUndefined();
  });

  it('does not build a badge for events that are already thread replies', () => {
    expect(
      buildModel({
        threadRootId: '$reply',
        eventThreadRootId: '$root',
        threadRootEvent: makeEvent({
          eventId: '$reply',
          threadRootId: '$root',
          body: 'Reply body',
        }),
      })
    ).toBeUndefined();
  });

  it('derives a timeline badge from loaded visible replies before fallback maps', () => {
    const rootEvent = makeEvent({
      eventId: '$root',
      body: 'Root body',
    });
    const firstReply = makeEvent({
      eventId: '$reply-a',
      threadRootId: '$root',
      sender: '@agent-a:server',
      body: 'First reply',
    });
    const hiddenThreadMetadata = makeEvent({
      eventId: '$thread-tag',
      threadRootId: '$root',
      sender: '@agent-hidden:server',
      type: 'com.mindroom.thread.tag',
    });
    const latestReply = makeEvent({
      eventId: '$reply-b',
      threadRootId: '$root',
      sender: '@agent-b:server',
      body: 'Latest reply',
    });
    const room = makeRoom({
      thread: {
        events: [firstReply, hiddenThreadMetadata, latestReply],
        timeline: [firstReply, hiddenThreadMetadata, latestReply],
        length: 99,
        rootEvent,
      } as unknown as ReturnType<Room['getThread']>,
    });

    const model = buildTimelineThreadBadgeViewModel({
      room,
      threadRootEvent: rootEvent,
      fallbackReplyCount: 1,
      fallbackParticipantIds: ['@fallback:server'],
      isResolved: true,
    });

    expect(model?.replyCount).toBe(2);
    expect(model?.participantIds).toEqual(['@agent-b:server', '@agent-a:server']);
    expect(model?.isResolved).toBe(true);
  });
});
