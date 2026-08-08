import { describe, expect, it } from 'vitest';
import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import {
  buildThreadParticipantMap,
  buildThreadReplyCountMap,
  buildVisibleThreadParticipantMap,
  buildVisibleThreadReplyCountMap,
  eventBelongsToThread,
  getPreferredVisibleThreadReplyEvents,
  getValidThreadRootEvent,
  getVisibleThreadMessageCount,
  getVisibleThreadParticipantIds,
  hasLoadedThreadReplyEvents,
  isVisibleThreadTextMessageEventType,
  isVisibleThreadReplyEvent,
  isVisibleThreadReplyEventType,
  isThreadReplyEvent,
  reconcileThreadReplyCountSnapshotWithEvidence,
} from './threadUtils';

const makeEvent = (
  eventId: string,
  threadRootId?: string,
  relationType?: string,
  senderId?: string,
  isThreadRoot = false,
  type = 'm.room.message'
) => ({
  getId: () => eventId,
  threadRootId,
  getRelation: () => (relationType ? { rel_type: relationType } : undefined),
  getSender: () => senderId,
  getType: () => type,
  isThreadRoot,
  isRedacted: () => false,
  isRedaction: () => false,
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

describe('reconcileThreadReplyCountSnapshotWithEvidence', () => {
  it('does not reclassify an excluded stale reply or double-subtract its redaction', () => {
    const staleVisibleReply = makeEvent(
      '$reply',
      '$root',
      RelationType.Thread,
      '@alice:example.org'
    );
    const afterStaleVisible = reconcileThreadReplyCountSnapshotWithEvidence({
      baseCount: 23,
      events: [staleVisibleReply],
      evidence: { knownEventIds: ['$reply'], visibleEventIds: [] },
      threadRootId: '$root',
    });

    expect(afterStaleVisible).toEqual({
      replyCount: 23,
      evidence: { knownEventIds: ['$reply'], visibleEventIds: [] },
      incorporatedEventIds: [],
    });

    const redactedReply = {
      ...staleVisibleReply,
      isRedacted: () => true,
    };
    expect(
      reconcileThreadReplyCountSnapshotWithEvidence({
        baseCount: afterStaleVisible.replyCount,
        events: [redactedReply],
        evidence: afterStaleVisible.evidence,
        threadRootId: '$root',
      })
    ).toEqual({
      replyCount: 23,
      evidence: { knownEventIds: ['$reply'], visibleEventIds: [] },
      incorporatedEventIds: [],
    });
  });

  it('marks an unknown redaction known without subtracting it', () => {
    const redactedReply = {
      ...makeEvent('$reply', '$root', RelationType.Thread, '@alice:example.org'),
      isRedacted: () => true,
    };
    const afterRedaction = reconcileThreadReplyCountSnapshotWithEvidence({
      baseCount: 23,
      events: [redactedReply],
      evidence: { knownEventIds: [], visibleEventIds: [] },
      threadRootId: '$root',
    });

    expect(afterRedaction).toEqual({
      replyCount: 23,
      evidence: { knownEventIds: ['$reply'], visibleEventIds: [] },
      incorporatedEventIds: ['$reply'],
    });
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

describe('isVisibleThreadReplyEventType', () => {
  it('accepts renderable threaded text message event types', () => {
    expect(isVisibleThreadTextMessageEventType('m.room.message')).toBe(true);
    expect(isVisibleThreadTextMessageEventType('m.room.encrypted')).toBe(true);
    expect(isVisibleThreadTextMessageEventType('com.mindroom.thread.tag')).toBe(false);
  });

  it('accepts supported visible threaded event types', () => {
    expect(isVisibleThreadReplyEventType('m.room.message')).toBe(true);
    expect(isVisibleThreadReplyEventType('m.room.encrypted')).toBe(true);
    expect(isVisibleThreadReplyEventType('m.sticker')).toBe(true);
    expect(isVisibleThreadReplyEventType('m.room.topic')).toBe(true);
  });

  it('rejects metadata-only threaded relation types', () => {
    expect(isVisibleThreadReplyEventType('com.mindroom.thread.tag')).toBe(false);
  });
});

describe('isVisibleThreadReplyEvent', () => {
  it('accepts visible threaded replies', () => {
    expect(
      isVisibleThreadReplyEvent(
        makeEvent('$reply', '$root', RelationType.Thread, '@alice:example.org')
      )
    ).toBe(true);
  });

  it('rejects threaded metadata events that do not render in the timeline', () => {
    expect(
      isVisibleThreadReplyEvent(
        makeEvent(
          '$thread-tag',
          '$root',
          RelationType.Thread,
          '@alice:example.org',
          false,
          'com.mindroom.thread.tag'
        )
      )
    ).toBe(false);
  });
});

describe('buildVisibleThreadReplyCountMap', () => {
  it('counts only visible threaded replies', () => {
    const counts = buildVisibleThreadReplyCountMap([
      makeEvent('$reply-1', '$root', RelationType.Thread),
      makeEvent(
        '$thread-tag-1',
        '$root',
        RelationType.Thread,
        '@alice:example.org',
        false,
        'com.mindroom.thread.tag'
      ),
      makeEvent('$reply-2', '$root', RelationType.Thread),
    ]);

    expect(counts.get('$root')).toBe(2);
  });
});

describe('getPreferredVisibleThreadReplyEvents', () => {
  it('prefers loaded events over timeline fallback and filters hidden thread metadata', () => {
    const visibleReply = makeEvent('$reply-1', '$root', RelationType.Thread);
    const hiddenReply = makeEvent(
      '$thread-tag',
      '$root',
      RelationType.Thread,
      '@alice:example.org',
      false,
      'com.mindroom.thread.tag'
    );
    const timelineReply = makeEvent('$reply-2', '$root', RelationType.Thread);

    const replyEvents = getPreferredVisibleThreadReplyEvents({
      events: [visibleReply, hiddenReply],
      timeline: [timelineReply],
    });

    expect(replyEvents).toEqual([visibleReply]);
  });
});

describe('hasLoadedThreadReplyEvents', () => {
  it('returns true when the thread has loaded events or timeline entries', () => {
    expect(hasLoadedThreadReplyEvents({ events: [makeEvent('$reply', '$root')] })).toBe(true);
    expect(hasLoadedThreadReplyEvents({ timeline: [makeEvent('$reply', '$root')] })).toBe(true);
  });

  it('returns false for empty or missing reply collections', () => {
    expect(hasLoadedThreadReplyEvents({ events: [], timeline: [] })).toBe(false);
    expect(hasLoadedThreadReplyEvents(undefined)).toBe(false);
  });
});

describe('getVisibleThreadMessageCount', () => {
  it('counts only visible loaded replies', () => {
    expect(
      getVisibleThreadMessageCount({
        events: [
          makeEvent('$reply-1', '$root', RelationType.Thread),
          makeEvent(
            '$thread-tag',
            '$root',
            RelationType.Thread,
            '@alice:example.org',
            false,
            'com.mindroom.thread.tag'
          ),
        ],
      })
    ).toBe(1);
  });

  it('returns zero when a loaded thread only contains hidden metadata relations', () => {
    expect(
      getVisibleThreadMessageCount({
        events: [
          makeEvent(
            '$thread-tag',
            '$root',
            RelationType.Thread,
            '@alice:example.org',
            false,
            'com.mindroom.thread.tag'
          ),
        ],
      })
    ).toBe(0);
  });

  it('falls back to sdk or bundled counts when replies are not loaded yet', () => {
    expect(getVisibleThreadMessageCount({ length: 3 })).toBe(3);
    expect(getVisibleThreadMessageCount(undefined, 2)).toBe(2);
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

describe('buildVisibleThreadParticipantMap', () => {
  it('ignores non-renderable threaded metadata relations when collecting participants', () => {
    const participants = buildVisibleThreadParticipantMap([
      makeEvent(
        '$thread-tag',
        '$root',
        RelationType.Thread,
        '@tagger:example.org',
        false,
        'com.mindroom.thread.tag'
      ),
      makeEvent('$reply-1', '$root', RelationType.Thread, '@alice:example.org'),
      makeEvent('$reply-2', '$root', RelationType.Thread, '@bob:example.org'),
    ]);

    expect(participants.get('$root')).toEqual(['@bob:example.org', '@alice:example.org']);
  });
});

describe('getVisibleThreadParticipantIds', () => {
  it('returns recent visible reply senders and falls back to the root sender', () => {
    expect(
      getVisibleThreadParticipantIds(
        {
          events: [
            makeEvent('$reply-1', '$root', RelationType.Thread, '@alice:example.org'),
            makeEvent(
              '$thread-tag',
              '$root',
              RelationType.Thread,
              '@tagger:example.org',
              false,
              'com.mindroom.thread.tag'
            ),
            makeEvent('$reply-2', '$root', RelationType.Thread, '@bob:example.org'),
          ],
        },
        makeEvent('$root', undefined, undefined, '@carol:example.org')
      )
    ).toEqual(['@bob:example.org', '@alice:example.org', '@carol:example.org']);
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
