import { describe, expect, it } from 'vitest';
import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import {
  buildThreadParticipantMap,
  buildThreadReplyCountMap,
  eventBelongsToThread,
  getValidThreadRootEvent,
  isThreadReplyEvent,
} from './threadUtils';

const makeEvent = (
  eventId: string,
  threadRootId?: string,
  relationType?: string,
  senderId?: string,
  isThreadRoot = false
) => ({
  getId: () => eventId,
  threadRootId,
  getRelation: () => (relationType ? { rel_type: relationType } : undefined),
  getSender: () => senderId,
  isThreadRoot,
});

describe('eventBelongsToThread', () => {
  it('matches thread root events by event id', () => {
    expect(eventBelongsToThread(makeEvent('$root'), '$root')).toBe(true);
  });

  it('matches thread reply events by threadRootId', () => {
    expect(eventBelongsToThread(makeEvent('$reply', '$root'), '$root')).toBe(true);
  });

  it('does not match unrelated events', () => {
    expect(eventBelongsToThread(makeEvent('$other', '$different-root'), '$root')).toBe(false);
  });
});

describe('isThreadReplyEvent', () => {
  it('returns false for unthreaded events', () => {
    expect(isThreadReplyEvent('$event')).toBe(false);
  });

  it('returns false for thread root events associated to their own thread', () => {
    expect(isThreadReplyEvent('$root', '$root')).toBe(false);
  });

  it('returns true for thread reply events', () => {
    expect(isThreadReplyEvent('$reply', '$root')).toBe(true);
  });
});

describe('buildThreadReplyCountMap', () => {
  it('counts thread replies by root id', () => {
    const counts = buildThreadReplyCountMap([
      makeEvent('$reply1', '$root', RelationType.Thread),
      makeEvent('$reply2', '$root', RelationType.Thread),
      makeEvent('$reply3', '$other-root', RelationType.Thread),
    ]);

    expect(counts.get('$root')).toBe(2);
    expect(counts.get('$other-root')).toBe(1);
  });

  it('ignores non-thread relation events', () => {
    const counts = buildThreadReplyCountMap([
      makeEvent('$thread-reply', '$root', RelationType.Thread),
      makeEvent('$annotation', '$root', RelationType.Annotation),
      makeEvent('$edit', '$root', RelationType.Replace),
    ]);

    expect(counts.get('$root')).toBe(1);
  });

  it('deduplicates repeated events by event id', () => {
    const duplicateReply = makeEvent('$reply', '$root', RelationType.Thread);
    const counts = buildThreadReplyCountMap([duplicateReply, duplicateReply]);

    expect(counts.get('$root')).toBe(1);
  });
});

describe('buildThreadParticipantMap', () => {
  it('returns recent unique participants per thread root', () => {
    const participants = buildThreadParticipantMap([
      makeEvent('$reply1', '$root', RelationType.Thread, '@alice:example.org'),
      makeEvent('$reply2', '$root', RelationType.Thread, '@bob:example.org'),
      makeEvent('$reply3', '$root', RelationType.Thread, '@alice:example.org'),
      makeEvent('$reply4', '$root', RelationType.Thread, '@carol:example.org'),
    ]);

    expect(participants.get('$root')).toEqual([
      '@carol:example.org',
      '@alice:example.org',
      '@bob:example.org',
    ]);
  });

  it('skips non-thread relations and events without sender', () => {
    const participants = buildThreadParticipantMap([
      makeEvent('$reply1', '$root', RelationType.Thread, '@alice:example.org'),
      makeEvent('$annotation', '$root', RelationType.Annotation, '@bob:example.org'),
      makeEvent('$reply2', '$root', RelationType.Thread, undefined),
    ]);

    expect(participants.get('$root')).toEqual(['@alice:example.org']);
  });

  it('limits participants per thread root', () => {
    const participants = buildThreadParticipantMap(
      [
        makeEvent('$reply1', '$root', RelationType.Thread, '@alice:example.org'),
        makeEvent('$reply2', '$root', RelationType.Thread, '@bob:example.org'),
        makeEvent('$reply3', '$root', RelationType.Thread, '@carol:example.org'),
      ],
      2
    );

    expect(participants.get('$root')).toEqual(['@carol:example.org', '@bob:example.org']);
  });
});

describe('getValidThreadRootEvent', () => {
  it('returns the known thread root when the SDK has a thread model', () => {
    const rootEvent = makeEvent('$root', undefined, undefined, undefined, true);
    const room = {
      findEventById: () => undefined,
      getThread: () => ({
        rootEvent,
      }),
    };

    expect(getValidThreadRootEvent(room as never, '$root')).toBe(rootEvent);
  });

  it('rejects arbitrary non-thread-root events from the room timeline', () => {
    const nonThreadRootEvent = makeEvent('$bogus');
    const room = {
      findEventById: () => nonThreadRootEvent,
      getThread: () => null,
    };

    expect(getValidThreadRootEvent(room as never, '$bogus')).toBeUndefined();
  });
});
