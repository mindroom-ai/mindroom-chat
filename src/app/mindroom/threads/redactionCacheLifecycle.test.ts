import { describe, expect, it, vi } from 'vitest';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import {
  planRedactionCacheCleanup,
  removeAggregatedReactionByEventId,
} from './redactionCacheLifecycle';

const makeEvent = ({
  eventId,
  type = 'm.room.message',
  isRedaction = false,
  associatedId,
  threadRootId,
}: {
  eventId: string;
  type?: string;
  isRedaction?: boolean;
  associatedId?: string;
  threadRootId?: string;
}): MatrixEvent =>
  ({
    getId: () => eventId,
    getType: () => type,
    isRedaction: () => isRedaction,
    getAssociatedId: () => associatedId,
    getRelation: () => undefined,
    threadRootId,
    isThreadRoot: false,
  } as unknown as MatrixEvent);

const makeRoom = (eventsById: Record<string, MatrixEvent>): Room =>
  ({
    roomId: '!room:example.org',
    findEventById: (eventId: string) => eventsById[eventId],
    getThread: () => undefined,
  } as unknown as Room);

describe('planRedactionCacheCleanup', () => {
  it('returns undefined for non-redaction events', () => {
    const room = makeRoom({});
    const notRedaction = makeEvent({ eventId: '$msg' });
    expect(planRedactionCacheCleanup({ room, redactionEvent: notRedaction })).toBeUndefined();
  });

  it('returns undefined when the redaction has no target id', () => {
    const room = makeRoom({});
    const redaction = makeEvent({ eventId: '$redaction', isRedaction: true });
    expect(planRedactionCacheCleanup({ room, redactionEvent: redaction })).toBeUndefined();
  });

  it('plans no action for an unknown target (left to the reconcile pass)', () => {
    const room = makeRoom({});
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$gone',
    });
    expect(planRedactionCacheCleanup({ room, redactionEvent: redaction })).toEqual({
      redactedEventId: '$gone',
      threadTargetFromFallback: false,
      deleteRecords: false,
    });
  });

  it('plans record deletion for a redacted reaction on a thread reply', () => {
    const reply = makeEvent({ eventId: '$reply', threadRootId: '$root' });
    const reaction = makeEvent({
      eventId: '$reaction',
      type: 'm.reaction',
      threadRootId: '$root',
    });
    const room = makeRoom({ $reply: reply, $reaction: reaction });
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });

    const plan = planRedactionCacheCleanup({ room, redactionEvent: redaction });
    expect(plan).toMatchObject({
      redactedEventId: '$reaction',
      threadCacheTargetId: '$root',
      threadTargetFromFallback: false,
      deleteRecords: true,
    });
  });

  it('plans a re-persist (tombstone), not deletion, for a redacted thread message', () => {
    const reply = makeEvent({ eventId: '$reply', threadRootId: '$root' });
    const room = makeRoom({ $reply: reply });
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$reply',
    });

    const plan = planRedactionCacheCleanup({ room, redactionEvent: redaction });
    expect(plan).toMatchObject({
      redactedEventId: '$reply',
      threadCacheTargetId: '$root',
      deleteRecords: false,
    });
  });

  it('falls back to the open thread id when the pruned reaction lost its thread hints', () => {
    const prunedReaction = makeEvent({ eventId: '$reaction', type: 'm.reaction' });
    const room = makeRoom({ $reaction: prunedReaction });
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });

    const plan = planRedactionCacheCleanup({
      room,
      redactionEvent: redaction,
      fallbackThreadId: '$open-thread',
    });
    expect(plan).toMatchObject({
      redactedEventId: '$reaction',
      threadCacheTargetId: '$open-thread',
      threadTargetFromFallback: true,
      deleteRecords: true,
    });
  });

  it('leaves the thread target undefined when no hint exists (scan fallback)', () => {
    const prunedReaction = makeEvent({ eventId: '$reaction', type: 'm.reaction' });
    const room = makeRoom({ $reaction: prunedReaction });
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$reaction',
    });

    const plan = planRedactionCacheCleanup({ room, redactionEvent: redaction });
    expect(plan).toMatchObject({
      redactedEventId: '$reaction',
      threadCacheTargetId: undefined,
      threadTargetFromFallback: false,
      deleteRecords: true,
    });
  });

  it('plans a room-level re-persist for a redacted room message', () => {
    const message = makeEvent({ eventId: '$msg' });
    const room = makeRoom({ $msg: message });
    const redaction = makeEvent({
      eventId: '$redaction',
      isRedaction: true,
      associatedId: '$msg',
    });

    const plan = planRedactionCacheCleanup({ room, redactionEvent: redaction });
    expect(plan).toMatchObject({
      redactedEventId: '$msg',
      threadCacheTargetId: undefined,
      deleteRecords: false,
    });
  });
});

describe('removeAggregatedReactionByEventId', () => {
  const makeAggregatedReaction = (eventId: string): MatrixEvent =>
    ({ getId: () => eventId } as unknown as MatrixEvent);

  const makeTimelineSet = (relationsByParent: Record<string, MatrixEvent[]>) => {
    const removeEvent = vi.fn();
    const timelineSet = {
      relations: {
        getChildEventsForEvent: (parentId: string) => {
          const relationEvents = relationsByParent[parentId];
          if (!relationEvents) return undefined;
          return {
            getRelations: () => relationEvents,
            removeEvent,
          };
        },
      },
    };
    return { timelineSet, removeEvent };
  };

  it('removes a clone-aggregated reaction by event id and reports the parent', () => {
    const staleReaction = makeAggregatedReaction('$reaction');
    const { timelineSet, removeEvent } = makeTimelineSet({ $reply: [staleReaction] });

    const parentId = removeAggregatedReactionByEventId({
      timelineSets: [timelineSet as never],
      candidateParentIds: ['$other', '$reply'],
      redactedEventId: '$reaction',
    });

    expect(parentId).toBe('$reply');
    expect(removeEvent).toHaveBeenCalledWith(staleReaction);
  });

  it('leaves unrelated reactions alone and returns undefined when nothing matches', () => {
    const otherReaction = makeAggregatedReaction('$other-reaction');
    const { timelineSet, removeEvent } = makeTimelineSet({ $reply: [otherReaction] });

    const parentId = removeAggregatedReactionByEventId({
      timelineSets: [timelineSet as never, undefined],
      candidateParentIds: ['$reply'],
      redactedEventId: '$reaction',
    });

    expect(parentId).toBeUndefined();
    expect(removeEvent).not.toHaveBeenCalled();
  });

  it('handles empty timeline sets', () => {
    expect(
      removeAggregatedReactionByEventId({
        timelineSets: [undefined],
        candidateParentIds: ['$reply'],
        redactedEventId: '$reaction',
      })
    ).toBeUndefined();
  });
});
