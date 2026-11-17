import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeThreadBackfillEvents } from './threadCacheSnapshot';
import {
  clearThreadOpenSeedSnapshotsForTests,
  getThreadOpenSeedSnapshot,
  saveThreadOpenSeedSnapshot,
} from './threadOpenSeedCache';

const ROOM_ID = '!room:example.org';
const AGENT = '@agent:example.org';
const ALICE = '@alice:example.org';

const room = new Room(ROOM_ID, createClient({ baseUrl: 'https://example.org' }), ALICE);

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

const makeRoot = () => makeEvent('$root', 1000, ALICE, 'm.room.message', { body: 'question' });

const makeReply = (eventId = '$reply', ts = 2000, sender = AGENT) =>
  makeEvent(eventId, ts, sender, 'm.room.message', {
    body: 'thinking',
    'm.relates_to': { event_id: '$root', rel_type: 'm.thread' },
  });

const makeEdit = (eventId: string, ts: number, targetEventId = '$reply', sender = AGENT) =>
  makeEvent(eventId, ts, sender, 'm.room.message', {
    body: `* ${eventId}`,
    'm.new_content': { body: eventId, msgtype: 'm.text' },
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
