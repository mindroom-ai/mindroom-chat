import { MatrixClient, MatrixEvent, MemoryStore, Room } from 'matrix-js-sdk';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { expect, it, vi } from 'vitest';
import { resolveCachedOverviewUpdate } from './threadOverviewCacheHydration';

const userId = '@alice:example.org';

class OfflineClient extends MatrixClient {
  constructor() {
    super({
      baseUrl: 'https://example.org',
      userId,
      // The event mapper finds rooms through the store; the default one keeps none.
      store: new MemoryStore(),
      fetchFn: vi.fn(() => Promise.reject(new TypeError('Offline'))),
    });
    this.clientOpts = { threadSupport: true };
    this.threadSupportPending = new Promise(() => {});
  }
}

const rawReply = (index: number) => ({
  event_id: `$cached-reply-${index}`,
  room_id: '!room:example.org',
  sender: userId,
  type: 'm.room.message',
  origin_server_ts: 1000 + index,
  content: {
    msgtype: 'm.text',
    body: `Cached reply ${index}`,
    'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
  },
});

it('reads cached pages without leaving their events on the thread (one per visit before)', () => {
  const mx = new OfflineClient();
  const room = new Room('!room:example.org', mx, userId, { timelineSupport: true });
  mx.store.storeRoom(room);
  const root = new MatrixEvent({
    event_id: '$root',
    room_id: room.roomId,
    sender: userId,
    type: 'm.room.message',
    origin_server_ts: 1000,
    content: { msgtype: 'm.text', body: 'A question' },
    unsigned: { 'm.relations': { 'm.thread': { count: 2, current_user_participated: true } } },
  });
  room.processThreadRoots([root], true);
  const thread = room.getThread('$root');
  if (!thread) throw new Error('no thread');
  const listenersBefore = thread.listenerCount(ThreadEvent.Update);

  // Each visit of the room's Compact view reads the thread's cached page again.
  for (let visit = 0; visit < 10; visit += 1) {
    resolveCachedOverviewUpdate({
      rootId: '$root',
      room,
      mapper: mx.getEventMapper(),
      cachedPage: { hasMoreBefore: false, events: [rawReply(1), rawReply(2)] },
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map(),
    });
  }

  expect(thread.listenerCount(ThreadEvent.Update)).toBe(listenersBefore);
});
