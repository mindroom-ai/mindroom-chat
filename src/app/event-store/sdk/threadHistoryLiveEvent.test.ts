import { MatrixClient, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, expect, it } from 'vitest';
import { createInitializedThreadForRoot } from './threadBootstrapSdk';

const makeReply = (eventId: string, ts: number): MatrixEvent =>
  new MatrixEvent({
    event_id: eventId,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
      body: eventId,
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
});

// patches/matrix-js-sdk+45.2.0.patch: Thread.insertEventIntoTimeline gates upstream #5652's
// liveEvent flag with `this.addingHistory === undefined` so out-of-order history replies stay
// non-live while out-of-order live replies are still announced as live.
it('reports out-of-order history replies as non-live and out-of-order live replies as live', async () => {
  Thread.hasServerSideSupport = FeatureSupport.Stable;
  const mx = new ThreadEnabledClient();
  const room = new Room('!room:example.org', mx, '@alice:example.org', { timelineSupport: true });
  const root = new MatrixEvent({
    event_id: '$root',
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
    origin_server_ts: 1_000,
    content: { msgtype: 'm.text', body: 'root' },
  });
  const thread = createInitializedThreadForRoot(room, root);

  // Seed a newer reply first so later replies with smaller timestamps take insertEventIntoTimeline.
  thread.addEvent(makeReply('$reply-newest', 3_000), false);
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  const liveByEventId = new Map<string, boolean | undefined>();
  thread.on(RoomEvent.Timeline, (event, _room, _toStart, _removed, data) => {
    const id = event.getId();
    if (id) liveByEventId.set(id, data.liveEvent);
  });

  thread.addEventsAsHistory([makeReply('$reply-history-ooo', 2_000)]);
  thread.addEvent(makeReply('$reply-live-ooo', 2_500), false);

  expect(liveByEventId.get('$reply-history-ooo')).toBe(false);
  expect(liveByEventId.get('$reply-live-ooo')).toBe(true);
  expect(thread.events.map((event) => event.getId())).toEqual([
    '$reply-history-ooo',
    '$reply-live-ooo',
    '$reply-newest',
  ]);
});
