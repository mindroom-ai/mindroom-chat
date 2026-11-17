import { createClient, EventStatus, MatrixEvent, Room } from 'matrix-js-sdk';
import { DecryptionError } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import { afterEach, describe, expect, it } from 'vitest';
import { getEditedEvent } from '../../matrix/room';
import { aggregateCachedRelationEvents, hydrateCachedEvents } from './eventCacheEditUtils';
import { mergeThreadBackfillEvents } from './threadCacheSnapshot';
import {
  clearThreadOpenSeedSnapshotsForTests,
  getThreadOpenSeedSnapshot,
  saveThreadOpenSeedSnapshot,
} from './threadOpenSeedCache';

const ROOM_ID = '!room:example.org';
const AGENT = '@agent:example.org';
const ALICE = '@alice:example.org';

const client = createClient({ baseUrl: 'https://example.org', userId: ALICE });
const room = new Room(ROOM_ID, client, ALICE);

const makeEvent = (
  eventId: string,
  ts: number,
  sender: string,
  type: string,
  content: Record<string, unknown>
) =>
  new MatrixEvent({
    content,
    event_id: eventId,
    origin_server_ts: ts,
    room_id: ROOM_ID,
    sender,
    type,
  });

const makeRedaction = (eventId: string, ts: number, redacts: string) =>
  new MatrixEvent({
    content: {},
    event_id: eventId,
    origin_server_ts: ts,
    redacts,
    room_id: ROOM_ID,
    sender: AGENT,
    type: 'm.room.redaction',
  });

const makeRoot = () => makeEvent('$root', 1000, ALICE, 'm.room.message', { body: 'question' });

const makeReply = (eventId = '$reply', ts = 2000, sender = AGENT) =>
  makeEvent(eventId, ts, sender, 'm.room.message', {
    body: 'thinking',
    'm.relates_to': { event_id: '$root', rel_type: 'm.thread' },
  });

const makeEdit = (
  eventId: string,
  ts: number,
  targetEventId = '$reply',
  sender = AGENT,
  metadata: Record<string, unknown> = {}
) =>
  makeEvent(eventId, ts, sender, 'm.room.message', {
    body: `* ${eventId}`,
    'm.new_content': { body: eventId, msgtype: 'm.text', ...metadata },
    'm.relates_to': { event_id: targetEventId, rel_type: 'm.replace' },
  });

const makeStreamedEdits = (count: number, targetEventId = '$reply', sender = AGENT) =>
  Array.from({ length: count }, (_, index) =>
    makeEdit(`$${sender}-${targetEventId}-${index}`, 3000 + index, targetEventId, sender)
  );

const seedIds = () => getThreadOpenSeedSnapshot(room, '$root').map((event) => event.getId());

describe('saveThreadOpenSeedSnapshot', () => {
  afterEach(() => {
    clearThreadOpenSeedSnapshotsForTests();
  });

  it('keeps only the newest same-sender edit of a streamed reply', () => {
    const edits = makeStreamedEdits(30);
    const newest = edits[edits.length - 1];

    saveThreadOpenSeedSnapshot(room, '$root', [makeRoot(), makeReply(), ...edits.reverse()]);

    const seed = getThreadOpenSeedSnapshot(room, '$root');
    expect(seed).toHaveLength(3);
    expect(seed.map((event) => event.getId())).toEqual(['$root', '$reply', newest?.getId()]);
    expect(seed[2]).toBe(newest);
  });

  it('leaves one edit when a later write merges in a newer edit', () => {
    saveThreadOpenSeedSnapshot(room, '$root', [makeRoot(), makeReply(), ...makeStreamedEdits(5)]);
    const newerEdit = makeEdit('$edit-newer', 9000);

    saveThreadOpenSeedSnapshot(
      room,
      '$root',
      mergeThreadBackfillEvents(getThreadOpenSeedSnapshot(room, '$root'), [newerEdit])
    );

    expect(seedIds()).toEqual(['$root', '$reply', '$edit-newer']);
  });

  it('keeps every edit by another sender, as the event cache does', () => {
    const crossSenderEdits = makeStreamedEdits(3, '$reply', '@mallory:example.org');

    saveThreadOpenSeedSnapshot(room, '$root', [
      makeRoot(),
      makeReply(),
      ...makeStreamedEdits(4),
      ...crossSenderEdits,
    ]);

    expect(seedIds()).toEqual([
      '$root',
      '$reply',
      '$@agent:example.org-$reply-3',
      ...crossSenderEdits.map((event) => event.getId()),
    ]);
  });

  it('keeps each edited event its own newest edit', () => {
    saveThreadOpenSeedSnapshot(room, '$root', [
      makeRoot(),
      makeReply('$reply'),
      makeReply('$other', 2500),
      ...makeStreamedEdits(3, '$reply'),
      ...makeStreamedEdits(3, '$other'),
    ]);

    expect(seedIds()).toEqual([
      '$root',
      '$reply',
      '$other',
      '$@agent:example.org-$reply-2',
      '$@agent:example.org-$other-2',
    ]);
  });

  it('leaves events other than superseded edits as they are', () => {
    const events = [
      makeRoot(),
      makeReply(),
      makeReply('$second', 2100, ALICE),
      makeEvent('$reaction', 2200, ALICE, 'm.reaction', {
        'm.relates_to': { event_id: '$reply', key: '👍', rel_type: 'm.annotation' },
      }),
      makeEvent('$redaction', 2300, ALICE, 'm.room.redaction', { redacts: '$second' }),
      // The cache keeps an edit whose target is not in the batch: nothing tells whose edit it is.
      makeEdit('$orphan-edit-1', 2400, '$missing'),
      makeEdit('$orphan-edit-2', 2500, '$missing'),
    ];

    saveThreadOpenSeedSnapshot(room, '$root', events);

    expect(getThreadOpenSeedSnapshot(room, '$root')).toEqual(events);
  });
});

const TOOL_TRACE_KEY = 'io.mindroom.tool_trace';
const STREAM_STATUS_KEY = 'io.mindroom.stream_status';
const trace = (tool: string) => ({ version: 2, events: [{ tool_name: tool }] });

const makeUndecryptableEdit = async (eventId: string, ts: number) => {
  const edit = makeEvent(eventId, ts, AGENT, 'm.room.encrypted', {
    algorithm: 'm.megolm.v1.aes-sha2',
    ciphertext: 'ciphertext',
    'm.relates_to': { event_id: '$reply', rel_type: 'm.replace' },
  });
  const crypto = {
    decryptEvent: () =>
      Promise.reject(
        new DecryptionError(DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID, 'no key')
      ),
  };
  await edit.attemptDecryption(crypto as never);
  return edit;
};

type Shown = { body: unknown; toolTrace: unknown };

/**
 * What the reply shows once `events` are hydrated and aggregated into a room's timeline set, as
 * `setSupplementalThreadEvents` does with a seed: through the seed (`compact`) or as they are.
 */
const showReply = (events: MatrixEvent[], compact: boolean): Shown => {
  const liveRoom = new Room(ROOM_ID, client, ALICE, { timelineSupport: true });
  let seed = events;
  if (compact) {
    saveThreadOpenSeedSnapshot(liveRoom, '$root', events);
    seed = getThreadOpenSeedSnapshot(liveRoom, '$root');
  }
  const timelineSet = liveRoom.getUnfilteredTimelineSet();
  const redactedRelationTargets = hydrateCachedEvents({ room: liveRoom, events: seed });
  aggregateCachedRelationEvents(seed, [timelineSet], undefined, redactedRelationTargets);
  const reply = seed.find((event) => event.getId() === '$reply');
  if (!reply) throw new Error('the seed lost the reply');
  const content = getEditedEvent('$reply', reply, timelineSet)?.getContent()['m.new_content'] as
    | Record<string, unknown>
    | undefined;
  return {
    body: content ? content.body : reply.getOriginalContent().body,
    toolTrace: content?.[TOOL_TRACE_KEY],
  };
};

/** What the reply shows through the seed, checked against what the same events show without it. */
const expectSeedShows = async (build: () => MatrixEvent[] | Promise<MatrixEvent[]>) => {
  const shown = showReply(await build(), true);
  expect(shown).toEqual(showReply(await build(), false));
  return shown;
};

describe('saveThreadOpenSeedSnapshot with edits the app cannot show', () => {
  afterEach(() => {
    clearThreadOpenSeedSnapshotsForTests();
  });

  it('keeps the readable edit before a newer redacted one', async () => {
    const shown = await expectSeedShows(() => {
      // A copy that still has its content, as the event cache can hold, marked redacted.
      const newest = makeEdit('$newest', 3100);
      newest.setUnsigned({
        redacted_because: {
          content: {},
          event_id: '$redaction',
          origin_server_ts: 3200,
          redacts: '$newest',
          room_id: ROOM_ID,
          sender: AGENT,
          type: 'm.room.redaction',
          unsigned: {},
        },
      });
      return [makeRoot(), makeReply(), makeEdit('$readable', 3000), newest];
    });

    expect(shown.body).toBe('$readable');
  });

  it('keeps the readable edit before a newer one the batch redacts', async () => {
    const shown = await expectSeedShows(() => [
      makeRoot(),
      makeReply(),
      makeEdit('$readable', 3000),
      makeEdit('$newest', 3100),
      makeRedaction('$redaction', 3200, '$newest'),
    ]);

    expect(shown.body).toBe('$readable');
  });

  it('keeps the readable edit before a newer one without m.new_content', async () => {
    const shown = await expectSeedShows(() => [
      makeRoot(),
      makeReply(),
      makeEdit('$readable', 3000),
      makeEvent('$newest', 3100, AGENT, 'm.room.message', {
        body: '* no new content',
        'm.relates_to': { event_id: '$reply', rel_type: 'm.replace' },
      }),
    ]);

    expect(shown.body).toBe('$readable');
  });

  it('keeps the readable edit before a newer one that did not decrypt', async () => {
    const shown = await expectSeedShows(async () => [
      makeRoot(),
      makeReply(),
      makeEdit('$readable', 3000),
      await makeUndecryptableEdit('$newest', 3100),
    ]);

    expect(shown.body).toBe('$readable');
  });

  it.each([EventStatus.CANCELLED, EventStatus.SENDING])(
    'keeps the newest sent edit and a newer one whose status is %s',
    (status) => {
      const pending = makeEdit('$pending', 3100);
      pending.setStatus(status);

      saveThreadOpenSeedSnapshot(room, '$root', [
        makeRoot(),
        makeReply(),
        makeEdit('$older', 2900),
        makeEdit('$sent', 3000),
        pending,
      ]);

      expect(seedIds()).toEqual(['$root', '$reply', '$sent', '$pending']);
    }
  );

  it('drops an unusable edit older than a readable one', async () => {
    const undecryptable = await makeUndecryptableEdit('$undecryptable', 2900);

    saveThreadOpenSeedSnapshot(room, '$root', [
      makeRoot(),
      makeReply(),
      undecryptable,
      makeEdit('$readable', 3000),
    ]);

    expect(seedIds()).toEqual(['$root', '$reply', '$readable']);
  });
});

describe('saveThreadOpenSeedSnapshot with metadata a newer edit borrows', () => {
  afterEach(() => {
    clearThreadOpenSeedSnapshotsForTests();
  });

  const streamWithTrace = () => [
    makeRoot(),
    makeReply(),
    ...Array.from({ length: 5 }, (_, index) =>
      makeEdit(`$traced-${index}`, 3000 + index, '$reply', AGENT, {
        [STREAM_STATUS_KEY]: 'streaming',
        [TOOL_TRACE_KEY]: trace(`tool-${index}`),
      })
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      makeEdit(`$body-${index}`, 4000 + index, '$reply', AGENT, {
        [STREAM_STATUS_KEY]: index === 4 ? 'completed' : 'streaming',
      })
    ),
  ];

  it('keeps the newest edit with a tool trace the newest edit lacks', async () => {
    const shown = await expectSeedShows(streamWithTrace);

    expect(shown).toEqual({ body: '$body-4', toolTrace: trace('tool-4') });
    saveThreadOpenSeedSnapshot(room, '$root', streamWithTrace());
    expect(seedIds()).toEqual(['$root', '$reply', '$traced-4', '$body-4']);
  });

  it('keeps that edit when a later body-only edit merges into the compacted seed', async () => {
    const compactThenMerge = () => {
      const liveRoom = new Room(ROOM_ID, client, ALICE);
      saveThreadOpenSeedSnapshot(liveRoom, '$root', streamWithTrace());
      return mergeThreadBackfillEvents(getThreadOpenSeedSnapshot(liveRoom, '$root'), [
        makeEdit('$body-later', 5000, '$reply', AGENT, { [STREAM_STATUS_KEY]: 'completed' }),
      ]);
    };

    const shown = await expectSeedShows(compactThenMerge);

    expect(shown).toEqual({ body: '$body-later', toolTrace: trace('tool-4') });
    saveThreadOpenSeedSnapshot(room, '$root', compactThenMerge());
    expect(seedIds()).toEqual(['$root', '$reply', '$traced-4', '$body-later']);
  });

  it('drops older edits whose metadata every newer kept edit carries', () => {
    saveThreadOpenSeedSnapshot(room, '$root', [
      makeRoot(),
      makeReply(),
      ...Array.from({ length: 30 }, (_, index) =>
        makeEdit(`$traced-${index}`, 3000 + index, '$reply', AGENT, {
          [STREAM_STATUS_KEY]: 'streaming',
          [TOOL_TRACE_KEY]: trace(`tool-${index}`),
        })
      ),
    ]);

    expect(seedIds()).toEqual(['$root', '$reply', '$traced-29']);
  });
});
