import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import type { IEvent } from 'matrix-js-sdk';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { FeatureSupport, Thread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { createBackfillScheduler } from '../backfillScheduler';
import { scheduleReconcile } from '../reconciler';
import type { HydratedThreadCachePage } from '../../threads/types';

const ROOT = '$root';
const SENDER = '@agent:example.org';

let support: FeatureSupport;
beforeEach(() => {
  support = Thread.hasServerSideSupport;
  Thread.hasServerSideSupport = FeatureSupport.Stable;
});
afterEach(() => {
  Thread.hasServerSideSupport = support;
  vi.restoreAllMocks();
});

const reply = (index: number): Partial<IEvent> => ({
  event_id: `$reply-${index}`,
  room_id: '!room:example.org',
  type: 'm.room.message',
  sender: SENDER,
  origin_server_ts: 100 * index,
  content: {
    msgtype: 'm.text',
    body: `reply ${index}`,
    'm.relates_to': { rel_type: 'm.thread', event_id: ROOT },
  },
});

// The SDK announces replies after an awaited metadata update.
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const edit = (index: number): Partial<IEvent> => ({
  event_id: `$edit-${index}`,
  room_id: '!room:example.org',
  type: 'm.room.message',
  sender: SENDER,
  origin_server_ts: 100 * index + 10,
  content: {
    msgtype: 'm.text',
    body: `* reply ${index} edited`,
    'm.new_content': { msgtype: 'm.text', body: `reply ${index} edited` },
    'm.relates_to': { rel_type: 'm.replace', event_id: `$reply-${index}` },
  },
});

it('adds reconciled history older than the SDK thread window as backfill, not as new replies', async () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  mx.canSupport.set(Feature.RelationsRecursion, ServerSupport.Stable);
  const room = new Room('!room:example.org', mx, '@alice:example.org', { timelineSupport: true });
  mx.store.storeRoom(room);
  const root = new MatrixEvent({
    event_id: ROOT,
    room_id: room.roomId,
    type: 'm.room.message',
    sender: SENDER,
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body: 'root' },
  });
  const history = Array.from({ length: 40 }, (_, i) => [reply(i + 1), edit(i + 1)]).flat();
  const mapper = mx.getEventMapper();

  // Like a fresh app open: the SDK thread holds only the latest page.
  const thread = room.createThread(ROOT, root, [], false);
  thread.initialEventsFetched = true;
  thread.replayEvents = null;
  thread.addEvents(history.slice(-6).map(mapper), false);
  await settle();

  const newReplies: string[] = [];
  const liveArrivals: string[] = [];
  thread.on(ThreadEvent.NewReply, (_thread, event) => newReplies.push(event.getId()!));
  thread.on(RoomEvent.Timeline, (event, _room, _toStart, _removed, data) => {
    if (data.liveEvent) liveArrivals.push(event.getId()!);
  });
  vi.spyOn(mx, 'fetchRelations').mockResolvedValue({ chunk: history.slice().reverse() as never });

  const result = await scheduleReconcile({
    mx,
    sessionId: 'session',
    scheduler: createBackfillScheduler({ mx }),
    roomId: room.roomId,
    room,
    threadId: ROOT,
    cachedPage: {
      events: history.slice(-6),
      hasMoreBefore: true,
      tailLoaded: true,
    } as HydratedThreadCachePage,
    persistRepair: () => ({ rawEvents: [], loadedReplyCount: 0, write: Promise.resolve(true) }),
  });
  await settle();

  expect(result.repaired).toBe(true);
  expect(newReplies).toEqual([]);
  expect(liveArrivals).toEqual([]);
  expect(thread.events.map((event) => event.getId())).toEqual(
    history.map((event) => event.event_id)
  );
});
