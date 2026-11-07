import { createClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { readOnlyEventMapper } from './readOnlyEventMapper';

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

describe('readOnlyEventMapper', () => {
  it("leaves the thread summary of an event the room holds as the room's", async () => {
    const mx = createClient({ baseUrl: 'https://example.org', userId, accessToken: 'token' });
    const room = new Room(roomId, mx, userId);
    mx.store.storeRoom(room);
    // The room's root no longer counts a redacted reply; the cached copy, saved before the
    // redaction, still does.
    await room.addLiveEvents([new MatrixEvent(root(2, reply('$support', 300)))], {
      addToState: false,
    });
    const held = room.findEventById('$root');

    const mapped = readOnlyEventMapper(room, mx.getEventMapper())(root(3, reply('$support', 300)));

    expect(mapped).toBe(held);
    expect(threadSummary(mapped)).toMatchObject({ count: 2 });
  });
});
