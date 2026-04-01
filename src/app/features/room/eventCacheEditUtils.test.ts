import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  aggregateCachedRelationEvents,
  applyCachedRedactions,
  applyCachedReplaceRelations,
  collectRedactedRelationTargetsFromLookup,
  hydrateCachedEvents,
  serializeEventsForCache,
} from './eventCacheEditUtils';

const makeMessageEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  body = 'original'
) =>
  new MatrixEvent({
    content: {
      body,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeEditEvent = (
  eventId: string,
  ts: number,
  targetEventId: string,
  sender = '@alice:example.org',
  body = eventId
) =>
  new MatrixEvent({
    content: {
      body: `* ${body}`,
      'm.new_content': {
        body,
        msgtype: 'm.text',
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeRedactionEvent = (eventId: string, ts: number, targetEventId: string) =>
  new MatrixEvent({
    content: {},
    event_id: eventId,
    origin_server_ts: ts,
    redacts: targetEventId,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.redaction',
  });

const makeReactionEvent = (eventId: string, ts: number, targetEventId: string, key = '👍') =>
  new MatrixEvent({
    content: {
      'm.relates_to': {
        event_id: targetEventId,
        key,
        rel_type: 'm.annotation',
      },
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.reaction',
  });

const room = { roomId: '!room:example.org' } as any;

describe('applyCachedReplaceRelations', () => {
  it('applies the latest cached replacement event to the target message', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const olderEdit = makeEditEvent('$edit-1', 2000, '$target', '@alice:example.org', 'older');
    const newerEdit = makeEditEvent('$edit-2', 3000, '$target', '@alice:example.org', 'newer');

    applyCachedReplaceRelations([targetEvent, olderEdit, newerEdit]);

    expect(targetEvent.replacingEvent()?.getId()).toBe('$edit-2');
  });

  it('does not override a newer replacement with an older cached edit', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const sdkReplacement = makeEditEvent('$sdk', 4000, '$target');
    const olderCachedEdit = makeEditEvent('$cached', 3000, '$target');

    targetEvent.makeReplaced(sdkReplacement);
    applyCachedReplaceRelations([targetEvent, olderCachedEdit]);

    expect(targetEvent.replacingEvent()?.getId()).toBe('$sdk');
  });
});

describe('serializeEventsForCache', () => {
  it('stores the latest replacement under unsigned relations for the target event', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const firstEdit = makeEditEvent('$edit-1', 2000, '$target', '@alice:example.org', 'first');
    const secondEdit = makeEditEvent('$edit-2', 2000, '$target', '@alice:example.org', 'second');

    const serializedTarget = serializeEventsForCache(room, [
      targetEvent,
      firstEdit,
      secondEdit,
    ]).find((event) => event.event_id === '$target');

    expect(serializedTarget?.unsigned?.['m.relations']?.['m.replace']).toMatchObject({
      event_id: '$edit-2',
      content: {
        'm.new_content': {
          body: 'second',
        },
      },
    });
  });

  it('persists an existing sdk replacement even when the edit event is not in the batch', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const sdkReplacement = makeEditEvent('$sdk', 3000, '$target', '@alice:example.org', 'latest');

    targetEvent.makeReplaced(sdkReplacement);

    const serializedTarget = serializeEventsForCache(room, [targetEvent]).find(
      (event) => event.event_id === '$target'
    );

    expect(serializedTarget?.unsigned?.['m.relations']?.['m.replace']).toMatchObject({
      event_id: '$sdk',
      content: {
        'm.new_content': {
          body: 'latest',
        },
      },
    });
  });

  it('persists cached redactions onto the target event payload', () => {
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org', 'visible');
    const redactionEvent = makeRedactionEvent('$redact', 2000, '$target');

    const serializedTarget = serializeEventsForCache(room, [targetEvent, redactionEvent]).find(
      (event) => event.event_id === '$target'
    );

    expect(serializedTarget?.unsigned?.redacted_because).toMatchObject({
      event_id: '$redact',
    });
    expect(serializedTarget?.content).toEqual({});
  });
});

describe('hydrateCachedEvents', () => {
  it('rehydrates a serialized replacement stored under unsigned relations', () => {
    const targetEvent = new MatrixEvent({
      content: {
        body: 'Thinking...  ⋯',
        msgtype: 'm.text',
      },
      event_id: '$target',
      origin_server_ts: 1000,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
      unsigned: {
        'm.relations': {
          'm.replace': {
            content: {
              body: '* Final answer',
              'm.new_content': {
                body: 'Final answer',
                msgtype: 'm.text',
              },
              'm.relates_to': {
                event_id: '$target',
                rel_type: 'm.replace',
              },
              msgtype: 'm.text',
            },
            event_id: '$edit-1',
            origin_server_ts: 2000,
            room_id: '!room:example.org',
            sender: '@alice:example.org',
            type: 'm.room.message',
          },
        },
      },
    });

    hydrateCachedEvents({
      room,
      events: [targetEvent],
    });

    expect(targetEvent.replacingEvent()?.getId()).toBe('$edit-1');
  });

  it('ignores serialized replacements that are missing origin_server_ts', () => {
    const targetEvent = new MatrixEvent({
      content: {
        body: 'Thinking...  ⋯',
        msgtype: 'm.text',
      },
      event_id: '$target',
      origin_server_ts: 1000,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
      unsigned: {
        'm.relations': {
          'm.replace': {
            content: {
              body: '* Final answer',
              'm.new_content': {
                body: 'Final answer',
                msgtype: 'm.text',
              },
              'm.relates_to': {
                event_id: '$target',
                rel_type: 'm.replace',
              },
              msgtype: 'm.text',
            },
            event_id: '$edit-1',
            room_id: '!room:example.org',
            sender: '@alice:example.org',
            type: 'm.room.message',
          },
        },
      },
    });

    hydrateCachedEvents({
      room,
      events: [targetEvent],
    });

    expect(targetEvent.replacingEvent()).toBeNull();
  });
});

describe('applyCachedRedactions', () => {
  it('redacts the cached target event when the redaction event is present', () => {
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org', 'visible');
    const redactionEvent = makeRedactionEvent('$redact', 2000, '$target');

    applyCachedRedactions(room, [targetEvent, redactionEvent]);

    expect(targetEvent.isRedacted()).toBe(true);
    expect(targetEvent.getRedactionEvent()).toMatchObject({
      event_id: '$redact',
    });
  });
});

describe('aggregateCachedRelationEvents', () => {
  it('aggregates cached reaction events into timeline relations once per event id', () => {
    const aggregateChildEvent = vi.fn();
    const timelineSet = {
      relations: {
        aggregateChildEvent,
      },
    } as any;
    const seenEventIds = new Set<string>();
    const reactionEvent = makeReactionEvent('$reaction', 2000, '$target');

    aggregateCachedRelationEvents([reactionEvent], [timelineSet], seenEventIds);
    aggregateCachedRelationEvents([reactionEvent], [timelineSet], seenEventIds);

    expect(aggregateChildEvent).toHaveBeenCalledTimes(1);
    expect(aggregateChildEvent).toHaveBeenCalledWith(reactionEvent, timelineSet);
  });

  it('removes a stale aggregated reaction when a redacted shell for the same event id arrives', () => {
    const existingReaction = makeReactionEvent('$reaction', 2000, '$target');
    const staleRelations = {
      getRelations: () => [existingReaction],
      removeEvent: vi.fn(() => Promise.resolve()),
    };
    const timelineSet = {
      relations: {
        aggregateChildEvent: vi.fn(),
        getChildEventsForEvent: vi.fn(() => staleRelations),
      },
    } as any;
    const seenEventIds = new Set<string>(['$reaction']);
    const redactedReactionShell = makeReactionEvent('$reaction', 2100, '$target');
    vi.spyOn(redactedReactionShell, 'isRedacted').mockReturnValue(true);

    aggregateCachedRelationEvents([redactedReactionShell], [timelineSet], seenEventIds);

    expect(staleRelations.removeEvent).toHaveBeenCalledWith(existingReaction);
    expect(timelineSet.relations.aggregateChildEvent).not.toHaveBeenCalled();
  });
});

describe('collectRedactedRelationTargetsFromLookup', () => {
  it('recovers parent relation metadata for an already-redacted relation shell', () => {
    const staleReaction = makeReactionEvent('$reaction', 2000, '$target');
    const redactedReactionShell = new MatrixEvent({
      content: {},
      event_id: '$reaction',
      origin_server_ts: 2100,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.reaction',
      unsigned: {
        redacted_because: {
          auth_events: [],
          content: {
            redacts: '$reaction',
          },
          depth: 1,
          event_id: '$redaction',
          hashes: {
            sha256: '',
          },
          origin: 'example.org',
          origin_server_ts: 2200,
          prev_events: [],
          redacts: '$reaction',
          room_id: '!room:example.org',
          sender: '@alice:example.org',
          type: 'm.room.redaction',
        },
      },
    });

    expect(collectRedactedRelationTargetsFromLookup([redactedReactionShell], [staleReaction])).toEqual([
      {
        eventId: '$reaction',
        eventType: 'm.reaction',
        parentEventId: '$target',
        relationType: 'm.annotation',
      },
    ]);
  });
});
