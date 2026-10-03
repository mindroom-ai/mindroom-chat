import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import type { IEvent, Thread } from 'matrix-js-sdk';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { FeatureSupport, Thread as SdkThread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { createBackfillScheduler } from '../backfillScheduler';
import { scheduleReconcile } from '../reconciler';
import { createInitializedThreadForRoot } from '../../threads/sdk/threadBootstrapSdk';
import type { HydratedThreadCachePage } from '../../threads/types';

const ROOT = '$root';
const SENDER = '@agent:example.org';

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

/** Replies 1..count, each followed by its edit, in server order. */
const thread = (count: number): Partial<IEvent>[] =>
  Array.from({ length: count }, (_, i) => [reply(i + 1), edit(i + 1)]).flat();

const ids = (events: readonly Partial<IEvent>[]): string[] =>
  events.map((event) => event.event_id as string);

// The SDK announces replies after an awaited metadata update.
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const setup = () => {
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
  return { mx, room, root, mapper: mx.getEventMapper() };
};

/** Records what the SDK announces while the reconcile adds `server` to `sdkThread`. */
const reconcile = async (
  { mx, room }: ReturnType<typeof setup>,
  sdkThread: Thread,
  server: Partial<IEvent>[]
) => {
  const newReplies: string[] = [];
  const liveArrivals: string[] = [];
  sdkThread.on(ThreadEvent.NewReply, (_thread, event) => newReplies.push(event.getId()!));
  sdkThread.on(RoomEvent.Timeline, (event, _room, _toStart, _removed, data) => {
    if (data.liveEvent) liveArrivals.push(event.getId()!);
  });
  vi.spyOn(mx, 'fetchRelations').mockResolvedValue({ chunk: server.slice().reverse() as never });
  const onRepaired = vi.fn();
  const result = await scheduleReconcile({
    mx,
    sessionId: 'session',
    scheduler: createBackfillScheduler({ mx }),
    roomId: room.roomId,
    room,
    threadId: ROOT,
    cachedPage: { events: [], hasMoreBefore: true, tailLoaded: true } as HydratedThreadCachePage,
    persistRepair: () => ({ rawEvents: [], loadedReplyCount: 0, write: Promise.resolve(true) }),
    onRepaired,
  });
  await settle();
  expect(result.repaired).toBe(true);
  return { newReplies, liveArrivals, onRepaired };
};

describe('reconciler SDK thread injection', () => {
  let support: FeatureSupport;
  beforeEach(() => {
    support = SdkThread.hasServerSideSupport;
    SdkThread.hasServerSideSupport = FeatureSupport.Stable;
  });
  afterEach(() => {
    SdkThread.hasServerSideSupport = support;
    vi.restoreAllMocks();
  });

  it('adds history older than the SDK window as backfill, not as new replies', async () => {
    const env = setup();
    const server = thread(40);
    // Like a fresh app open: the SDK thread holds only the latest page.
    const sdkThread = createInitializedThreadForRoot(env.room, env.root);
    sdkThread.addEvents(server.slice(-6).map(env.mapper), false);
    await settle();

    const { newReplies, liveArrivals } = await reconcile(env, sdkThread, server);

    expect(newReplies).toEqual([]);
    expect(liveArrivals).toEqual([]);
    expect(sdkThread.events.map((event) => event.getId())).toEqual(ids(server));
  });

  it('still appends events newer than the SDK window as new replies', async () => {
    const env = setup();
    const server = thread(40);
    const sdkThread = createInitializedThreadForRoot(env.room, env.root);
    sdkThread.addEvents(server.slice(68, 76).map(env.mapper), false);
    await settle();

    const { newReplies, liveArrivals } = await reconcile(env, sdkThread, server);

    expect(newReplies).toEqual(['$reply-39', '$reply-40']);
    expect(liveArrivals).toEqual(ids(server.slice(76)));
    expect(sdkThread.events.map((event) => event.getId())).toEqual(ids(server));
    expect(sdkThread.lastReply()?.getId()).toBe('$reply-40');
  });

  it('adds everything as backfill to an opened thread with an empty window', async () => {
    const env = setup();
    const server = thread(10);
    const sdkThread = createInitializedThreadForRoot(env.room, env.root);

    const { newReplies, liveArrivals } = await reconcile(env, sdkThread, server);

    expect(newReplies).toEqual([]);
    expect(liveArrivals).toEqual([]);
    expect(sdkThread.events.map((event) => event.getId())).toEqual(ids(server));
  });

  it('leaves an unopened thread to load its own first page', async () => {
    const env = setup();
    const server = thread(10);
    const sdkThread = env.room.createThread(ROOT, env.root, [], false);
    sdkThread.addEvents(server.slice(-2).map(env.mapper), false);
    await settle();
    const eventsBefore = sdkThread.events.map((event) => event.getId());
    const replayBefore = sdkThread.replayEvents?.length;

    const { newReplies, onRepaired } = await reconcile(env, sdkThread, server);

    expect(sdkThread.initialEventsFetched).toBe(false);
    expect(newReplies).toEqual([]);
    expect(sdkThread.events.map((event) => event.getId())).toEqual(eventsBefore);
    expect(sdkThread.replayEvents?.length).toBe(replayBefore);
    // The render still receives the repaired batch.
    expect(onRepaired).toHaveBeenCalledTimes(1);
  });
});
