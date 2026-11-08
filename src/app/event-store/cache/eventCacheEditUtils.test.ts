import {
  createClient,
  FeatureSupport,
  MatrixEvent,
  Room,
  Thread,
  type IEvent,
} from 'matrix-js-sdk';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DecryptionError } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import { installEventContentGuard } from '../../matrix/protocol/untrustedContent';
import { createPreferLiveEventMapper } from './eventRepository';
import { insertCachedRoomTimeline } from '../sdk/roomTimelineSdk';
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

const room = { roomId: '!room:example.org', findEventById: () => undefined } as any;

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

  // ISSUE-207 P1.4 (finding F5, decision D5): standalone same-sender
  // m.replace events are dropped — their content is bundled onto the target.
  it('excludes standalone same-sender m.replace events (bundled onto target)', () => {
    const targetEvent = makeMessageEvent('$target', 1000);
    const firstEdit = makeEditEvent('$edit-1', 2000, '$target', '@alice:example.org', 'first');
    const secondEdit = makeEditEvent('$edit-2', 3000, '$target', '@alice:example.org', 'second');

    const serialized = serializeEventsForCache(room, [targetEvent, firstEdit, secondEdit]);

    expect(serialized.map((event) => event.event_id)).toEqual(['$target']);
    const serializedTarget = serialized[0];
    expect(serializedTarget?.unsigned?.['m.relations']?.['m.replace']).toMatchObject({
      event_id: '$edit-2',
      content: { 'm.new_content': { body: 'second' } },
    });
  });

  it('does not exclude cross-sender m.replace events', () => {
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org');
    const mallory = '@mallory:example.org';
    const crossEdit = makeEditEvent('$cross', 2000, '$target', mallory, 'malicious');

    const serialized = serializeEventsForCache(room, [targetEvent, crossEdit]);

    expect(new Set(serialized.map((event) => event.event_id))).toEqual(
      new Set(['$target', '$cross'])
    );
  });

  it('keeps a same-sender m.replace record when its target is not in the batch', () => {
    // Without the target in the batch the bundled representation cannot be
    // emitted, so the replace record must still be persisted to preserve the
    // information (this is the pre-compaction fallback shape).
    const edit = makeEditEvent('$edit-1', 2000, '$missing-target');
    const serialized = serializeEventsForCache(room, [edit]);
    expect(serialized.map((event) => event.event_id)).toEqual(['$edit-1']);
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

  it('removes a bundled replacement when its edit has been redacted', () => {
    const editEvent = makeEditEvent('$edit-1', 2000, '$target', '@alice:example.org', 'secret');
    const targetEvent = makeMessageEvent('$target', 1000);
    targetEvent.setUnsigned({
      'm.relations': {
        'm.replace': editEvent.event,
      },
    });
    targetEvent.makeReplaced(editEvent);
    const redactionEvent = makeRedactionEvent('$redact', 3000, '$edit-1');

    hydrateCachedEvents({ room, events: [targetEvent, redactionEvent] });

    expect(targetEvent.replacingEvent()).toBeNull();
    expect(targetEvent.getUnsigned()['m.relations']?.['m.replace']).toBeUndefined();
    expect(JSON.stringify(targetEvent.event)).not.toContain('secret');
  });

  it('removes redaction state embedded inside a serialized replacement', () => {
    const editEvent = makeEditEvent('$edit-1', 2000, '$target', '@alice:example.org', 'secret');
    editEvent.setUnsigned({ redacted_because: { event_id: '$redact' } as IEvent });
    const targetEvent = makeMessageEvent('$target', 1000);
    targetEvent.setUnsigned({ 'm.relations': { 'm.replace': editEvent.event } });
    targetEvent.makeReplaced(editEvent);

    hydrateCachedEvents({ room, events: [targetEvent] });

    expect(targetEvent.replacingEvent()).toBeNull();
    expect(targetEvent.getUnsigned()['m.relations']?.['m.replace']).toBeUndefined();
    expect(JSON.stringify(targetEvent.event)).not.toContain('secret');
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

  // Greptile review (PR 5): the instance's existing redaction must win —
  // re-applying a different cached redaction would churn `redacted_because`
  // metadata away from what the live timeline attached.
  it('keeps the existing redaction on an already-redacted instance', () => {
    const targetEvent = makeMessageEvent('$target', 1000, '@alice:example.org', 'visible');
    const liveRedaction = makeRedactionEvent('$redact-live', 2000, '$target');
    targetEvent.makeRedacted(liveRedaction, room);
    // Same timestamp, lexicographically larger id — would win the D12 pick
    // if the tie-break were (wrongly) allowed to override live state.
    const cachedRedaction = makeRedactionEvent('$redact-zzz', 2000, '$target');

    applyCachedRedactions(room, [targetEvent, cachedRedaction]);

    expect(targetEvent.getRedactionEvent()).toMatchObject({
      event_id: '$redact-live',
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

    expect(
      collectRedactedRelationTargetsFromLookup([redactedReactionShell], [staleReaction])
    ).toEqual([
      {
        eventId: '$reaction',
        eventType: 'm.reaction',
        parentEventId: '$target',
        relationType: 'm.annotation',
      },
    ]);
  });
});

// The SDK patch drops a redacted edit that the room knows only from a message's bundle at once,
// and the cache scrubs its stored copies once it saves the redaction. A page read from the cache
// before that, or a root saved for a thread meanwhile, still carries the edit.
describe('cached copies of an edit redacted from a bundle', () => {
  const ROOM = '!room:example.org';
  const ALICE = '@alice:example.org';
  const support = Thread.hasServerSideSupport;
  afterEach(() => {
    Thread.hasServerSideSupport = support;
    vi.restoreAllMocks();
  });

  const client = createClient({ baseUrl: 'https://example.org', userId: ALICE });
  const message = (eventId: string, extra: Partial<IEvent> = {}): Partial<IEvent> => ({
    ...makeMessageEvent(eventId, 1000).event,
    ...extra,
  });
  const withEdit = (raw: Partial<IEvent>): Partial<IEvent> => ({
    ...raw,
    unsigned: {
      'm.relations': {
        'm.replace': makeEditEvent('$edit', 2000, raw.event_id!, ALICE, 'secret').event,
      },
    },
  });
  const liveRoom = () => {
    const live = new Room(ROOM, client, ALICE, { timelineSupport: true });
    live.currentState.setStateEvents([
      new MatrixEvent({
        type: 'm.room.member',
        state_key: ALICE,
        sender: ALICE,
        room_id: ROOM,
        event_id: '$member',
        content: { membership: 'join' },
      }),
    ]);
    const redactEdit = () =>
      live.addLiveEvents([makeRedactionEvent('$redaction', 3000, '$edit')], { addToState: false });
    return { live, redactEdit };
  };

  it('keeps a message the room holds on its original text', async () => {
    const { live, redactEdit } = liveRoom();
    await live.addLiveEvents([client.getEventMapper()(withEdit(message('$target')))], {
      addToState: false,
    });
    await redactEdit();

    const cached = createPreferLiveEventMapper(
      live,
      client.getEventMapper()
    )(withEdit(message('$target')));
    expect(cached).toBe(live.findEventById('$target'));
    expect(cached.getContent().body).toBe('original');
    hydrateCachedEvents({ room: live, events: [cached] });

    expect(cached.getContent().body).toBe('original');
  });

  it('does not let a cached copy of the edit itself put it back', async () => {
    const { live, redactEdit } = liveRoom();
    await live.addLiveEvents([client.getEventMapper()(withEdit(message('$target')))], {
      addToState: false,
    });
    await redactEdit();

    // The edit as a row of its own, as the cache keeps an edit saved apart from its message.
    const mapEvent = createPreferLiveEventMapper(live, client.getEventMapper());
    const events = [
      message('$target'),
      makeEditEvent('$edit', 2000, '$target', ALICE, 'secret').event,
    ].map(mapEvent);
    await insertCachedRoomTimeline({ mx: client, room: live, events });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(live.findEventById('$target')!.getContent().body).toBe('original');
  });

  it('drops the edit from the latest reply of an unopened thread and from its root', async () => {
    vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    const { live, redactEdit } = liveRoom();
    const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } };
    const reply = () =>
      withEdit(
        message('$reply', { content: { msgtype: 'm.text', body: 'original', ...inThread } })
      );
    const root = client.getEventMapper()(
      message('$root', {
        unsigned: {
          'm.relations': {
            'm.thread': { count: 1, current_user_participated: true, latest_event: reply() },
          },
        },
      })
    );
    live.processThreadRoots([root], false);
    await redactEdit();

    // The reply's page as the cache holds it, and the root saved with it.
    const cached = createPreferLiveEventMapper(live, client.getEventMapper())(reply());
    hydrateCachedEvents({ room: live, events: [cached] });
    const [savedRoot] = serializeEventsForCache(live, [root]);

    expect(cached.getContent().body).toBe('original');
    expect(JSON.stringify(cached.event)).not.toContain('secret');
    expect(JSON.stringify(savedRoot)).not.toContain('secret');
  });
});

// The app hides an edit it could not decrypt yet from replacingEvent(), as in every client it
// starts. Installed for the tests below only: it stays installed for the rest of the file.
describe('a cached copy whose edit the room took a redaction of while it could not decrypt it', () => {
  beforeAll(() => {
    installEventContentGuard();
  });

  it('shows its original text once the edit decrypts', async () => {
    const ALICE = '@alice:example.org';
    const client = createClient({ baseUrl: 'https://example.org', userId: ALICE });
    const room = new Room('!room:example.org', client, ALICE, { timelineSupport: true });
    const edit = new MatrixEvent({
      event_id: '$edit',
      room_id: '!room:example.org',
      sender: ALICE,
      origin_server_ts: 2000,
      type: 'm.room.encrypted',
      content: {
        algorithm: 'm.megolm.v1.aes-sha2',
        ciphertext: 'ciphertext',
        'm.relates_to': { rel_type: 'm.replace', event_id: '$target' },
      },
    });
    const crypto = {
      decryptEvent: vi
        .fn()
        .mockRejectedValueOnce(
          new DecryptionError(DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID, 'no key')
        )
        .mockResolvedValueOnce({
          clearEvent: {
            type: 'm.room.message',
            content: makeEditEvent('$edit', 2000, '$target', ALICE, 'secret').getContent(),
          },
        }),
    };
    await edit.attemptDecryption(crypto as never);
    // A copy read from the cache with the edit, before the cache stored its redaction.
    const cached = makeMessageEvent('$target', 1000);
    cached.makeReplaced(edit);
    room.redactedBundledEdits.add('$edit');

    hydrateCachedEvents({ room, events: [cached] });
    await edit.attemptDecryption(crypto as never);

    expect(cached.getContent().body).toBe('original');
  });
});

// A page read from the cache or fetched from the server takes only a redaction its sender may make:
// one the room holds keeps the room's decision, made where it is in the timeline; one only in the
// page is checked against the room's current state, as the SDK checks a page.
describe('a page with a redaction by someone who may not redact the event', () => {
  const ROOM = '!room:example.org';
  const ALICE = '@alice:example.org';
  const OTHER = '@other:example.org';
  const MODERATOR = '@moderator:example.org';
  const POWER_LEVELS = { users: { [MODERATOR]: 50 }, redact: 50 };
  const client = createClient({ baseUrl: 'https://example.org', userId: ALICE });
  const state = (type: string, stateKey: string, content: object, prevContent?: object) =>
    new MatrixEvent({
      type,
      state_key: stateKey,
      sender: MODERATOR,
      room_id: ROOM,
      event_id: `$${type}-${stateKey}-${JSON.stringify(content)}`,
      content,
      unsigned: prevContent ? { prev_content: prevContent } : {},
    });
  const moderatedRoom = () => {
    const live = new Room(ROOM, client, ALICE, { timelineSupport: true });
    live.currentState.setStateEvents([
      state('m.room.create', '', { creator: ALICE, room_version: '10' }),
      ...[ALICE, OTHER, MODERATOR].map((userId) =>
        state('m.room.member', userId, { membership: 'join' })
      ),
      state('m.room.power_levels', '', POWER_LEVELS),
    ]);
    /** A sync batch, added after the state that follows it (MSC4222 state_after). */
    const add = (...batch: MatrixEvent[]) => {
      live.currentState.setStateEvents(batch.filter((event) => event.isState()));
      return live.addLiveEvents(batch, { addToState: false });
    };
    return { live, add };
  };
  // The page's own copies of the message and of a redaction of it.
  const target = () => makeMessageEvent('$target', 1000, ALICE, 'visible');
  const redactionBy = (sender: string) =>
    new MatrixEvent({
      ...makeRedactionEvent(`$redaction-${sender}`, 2000, '$target').event,
      sender,
    });

  it('keeps the message another member without the right redacted', () => {
    const { live } = moderatedRoom();
    const copy = target();

    applyCachedRedactions(live, [copy, redactionBy(OTHER)]);

    expect(copy.isRedacted()).toBe(false);
  });

  it.each([
    ['its sender', ALICE],
    ['a moderator', MODERATOR],
  ])('takes the redaction of %s', (_, sender) => {
    const { live } = moderatedRoom();
    const copy = target();

    applyCachedRedactions(live, [copy, redactionBy(sender)]);

    expect(copy.isRedacted()).toBe(true);
  });

  it('keeps the message the room kept, though its redactor was given the right later', async () => {
    const { live, add } = moderatedRoom();
    const promoted = { ...POWER_LEVELS, users: { ...POWER_LEVELS.users, [OTHER]: 50 } };
    await add(
      target(),
      redactionBy(OTHER),
      state('m.room.power_levels', '', promoted, POWER_LEVELS)
    );
    const copy = target();

    applyCachedRedactions(live, [copy, redactionBy(OTHER)]);

    expect(copy.isRedacted()).toBe(false);
  });

  it('takes the redaction the room took, though its moderator left later', async () => {
    const { live, add } = moderatedRoom();
    await add(target(), redactionBy(MODERATOR));
    await add(state('m.room.member', MODERATOR, { membership: 'leave' }, { membership: 'join' }));
    const copy = target();

    applyCachedRedactions(live, [copy, redactionBy(MODERATOR)]);

    expect(copy.isRedacted()).toBe(true);
  });
});
