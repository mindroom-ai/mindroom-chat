import { createClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { createPreferLiveEventMapper } from '../cache/eventRepository';
import { keepHeldThreadSummaries, readOnlyEventMapper } from './readOnlyEventMapper';

const roomId = '!room:example.org';
const userId = '@alice:example.org';

const reply = (eventId: string, ts: number): Partial<IEvent> => ({
  event_id: eventId,
  room_id: roomId,
  sender: userId,
  type: 'm.room.message',
  origin_server_ts: ts,
  content: {
    msgtype: 'm.text',
    body: eventId,
    'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
  },
});

/** The thread's root with a summary that counts `count` replies up to `latest`. */
const root = (count: number, latest: Partial<IEvent>): IEvent =>
  ({
    event_id: '$root',
    room_id: roomId,
    sender: userId,
    type: 'm.room.message',
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body: 'Launch checklist' },
    unsigned: { 'm.relations': { 'm.thread': { count, latest_event: latest } } },
  } as IEvent);

const threadSummary = (event: MatrixEvent) => event.getUnsigned()['m.relations']?.['m.thread'];

/** A room that holds the thread's root, whose summary counts 2 replies up to `$support`. */
const roomHoldingRoot = async () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId, accessToken: 'token' });
  const room = new Room(roomId, mx, userId);
  mx.store.storeRoom(room);
  await room.addLiveEvents([new MatrixEvent(root(2, reply('$support', 300)))], {
    addToState: false,
  });
  return { mx, room, held: room.findEventById('$root') };
};

describe('readOnlyEventMapper', () => {
  it("leaves the thread summary of an event the room holds as the room's", async () => {
    // The room's root no longer counts a redacted reply; the cached copy, saved before the
    // redaction, still does.
    const { mx, room, held } = await roomHoldingRoot();

    const mapped = readOnlyEventMapper(room, mx.getEventMapper())(root(3, reply('$support', 300)));

    expect(mapped).toBe(held);
    expect(threadSummary(mapped)).toMatchObject({ count: 2 });
  });
});

describe('keepHeldThreadSummaries', () => {
  it("keeps the room's summary when the event cache's merge would raise it", async () => {
    // The cached copy adds a newer cached reply to a count from before the redaction.
    const { mx, room, held } = await roomHoldingRoot();
    const mapper = keepHeldThreadSummaries(
      room,
      createPreferLiveEventMapper(room, mx.getEventMapper())
    );

    const mapped = mapper(root(4, reply('$sales', 400)));

    expect(mapped).toBe(held);
    expect(threadSummary(mapped)).toMatchObject({
      count: 2,
      latest_event: { event_id: '$support' },
    });
  });

  it('gives a root the room does not hold the summary of its copy', async () => {
    const { mx, room } = await roomHoldingRoot();
    const mapper = keepHeldThreadSummaries(
      room,
      createPreferLiveEventMapper(room, mx.getEventMapper())
    );

    const other = mapper({ ...root(5, reply('$other-reply', 500)), event_id: '$other-root' });

    expect(threadSummary(other)).toMatchObject({ count: 5 });
  });
});
