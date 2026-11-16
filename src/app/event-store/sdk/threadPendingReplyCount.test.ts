import { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, expect, it, vi } from 'vitest';
import { createInitializedThreadForRoot } from './threadBootstrapSdk';

const makeReply = (n: number): MatrixEvent =>
  new MatrixEvent({
    event_id: `$reply-${n}`,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
    origin_server_ts: 1_000 + n,
    content: {
      msgtype: 'm.text',
      body: `reply ${n}`,
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    },
  });

class ThreadEnabledClient extends MatrixClient {
  constructor() {
    super({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
    // Configure real thread routing without starting a network sync loop.
    this.clientOpts = { threadSupport: true };
  }
}

const previousSupport = Thread.hasServerSideSupport;
afterEach(() => {
  Thread.hasServerSideSupport = previousSupport;
  vi.restoreAllMocks();
});

// patches/matrix-js-sdk+41.7.0.patch: every event a thread adds counts its pending replies again,
// over the whole thread. Only local echoes have a status, so that is asked first.
it('counts pending replies without reading the thread of every event it holds', async () => {
  Thread.hasServerSideSupport = FeatureSupport.Stable;
  const mx = new ThreadEnabledClient();
  const room = new Room('!room:example.org', mx, '@alice:example.org', { timelineSupport: true });
  vi.spyOn(mx, 'fetchRoomEvent');
  const root = new MatrixEvent({
    event_id: '$root',
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
    origin_server_ts: 1_000,
    content: { msgtype: 'm.text', body: 'root' },
  });
  const thread = createInitializedThreadForRoot(room, root);
  thread.addEvents(
    Array.from({ length: 100 }, (_v, n) => makeReply(200 + n)),
    false
  );
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  const reads = vi.spyOn(MatrixEvent.prototype, 'threadRootId', 'get');
  // A page of older history, as scrolling up a long thread brings it.
  thread.addEvents(
    Array.from({ length: 100 }, (_v, n) => makeReply(199 - n)),
    true
  );
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  expect(thread.events).toHaveLength(200);
  // Placing an event reads its thread a few times; counting over the whole thread read 200 more.
  expect(reads.mock.calls.length).toBeLessThan(10 * 100);
});
