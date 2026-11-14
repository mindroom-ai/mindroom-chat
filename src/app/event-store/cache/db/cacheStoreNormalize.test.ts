import { describe, expect, it } from 'vitest';
import { normalizeCachedRoomEvents, normalizeCachedThreadEvents } from './cacheStoreNormalize';

// A cached page is shown in cache order, the order the store's index keeps: sent time, then event
// ID by code unit. Inside one millisecond '$B' comes before '$a' ('B' is 0x42, 'a' 0x61), whatever
// the reader's locale; the server's order there is unknown to the cache.

const event = (eventId: string, ts: number, threadId?: string) => ({
  event_id: eventId,
  room_id: '!room:test',
  type: 'm.room.message',
  sender: '@alice:test',
  origin_server_ts: ts,
  content: {
    msgtype: 'm.text',
    body: eventId,
    ...(threadId ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } } : {}),
  },
});

describe('a cached page in cache order', () => {
  it("orders a room's events of one millisecond by code unit", () => {
    const events = normalizeCachedRoomEvents([
      event('$a', 1000),
      event('$B', 1000),
      event('$c', 900),
    ]);

    expect(events.map((rawEvent) => rawEvent.event_id)).toEqual(['$c', '$B', '$a']);
  });

  it("orders a thread's replies of one millisecond by code unit", () => {
    const events = normalizeCachedThreadEvents([
      event('$a', 1000, '$root'),
      event('$B', 1000, '$root'),
    ]);

    expect(events.map((rawEvent) => rawEvent.event_id)).toEqual(['$B', '$a']);
  });
});
