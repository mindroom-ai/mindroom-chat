import React from 'react';
import 'fake-indexeddb/auto';
import { MatrixEvent, createClient, Room as SdkRoom } from 'matrix-js-sdk';
import type { IEvent, MatrixClient, Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEnginePersistFacade } from '../../event-store/engine/enginePersistFacade';
import {
  createSyncEngine,
  createBackfillScheduler,
  SyncEngineProvider,
} from '../../event-store/engine';
import type { SyncEngine } from '../../event-store/engine';
import { resetCacheStoreForTesting, saveThreadEventsToCache } from '../../event-store/cache/db';
import {
  clearThreadOpenSeedSnapshotsForTests,
  getThreadOpenSeedSnapshot,
} from '../../event-store/cache/threadOpenSeedCache';
import { loadThreadCachedSnapshot } from '../../event-store/cache/eventRepository';
import { useThreadSeedPrewarmController } from './threadSeedPrewarmController';

vi.mock('../../event-store/cache/eventRepository', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../event-store/cache/eventRepository')>();
  return { ...original, loadThreadCachedSnapshot: vi.fn(original.loadThreadCachedSnapshot) };
});

const SESSION_ID = 'session-prewarm-test';
const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root:example.org';

const rawReply = (id: string, ts: number): Partial<IEvent> => ({
  event_id: id,
  origin_server_ts: ts,
  type: 'm.room.message',
  room_id: ROOM_ID,
  sender: '@alice:example.org',
  content: {
    body: id,
    'm.relates_to': { event_id: THREAD_ID, rel_type: 'm.thread' },
  },
});

const makeRootEvent = () =>
  new MatrixEvent({
    content: { body: 'root', msgtype: 'm.text' },
    event_id: THREAD_ID,
    origin_server_ts: 1_000,
    room_id: ROOM_ID,
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

// The controller only reads the cache: the spies on the fake engine below check that it neither
// fetches relations nor persists thread events.
function Harness({ mx, room }: { mx: MatrixClient; room: Room }) {
  useThreadSeedPrewarmController({
    room,
    mx,
    sessionId: SESSION_ID,
    prefetchDepthRef: { current: 10_000 },
    activeThreadId: undefined,
    priorityTargets: [{ threadId: THREAD_ID }],
    debugTraceId: 'prewarm-test',
  });
  return null;
}

const renderPrewarm = async (mx: MatrixClient, room: Room, engine: SyncEngine) => {
  await act(async () => {
    create(
      React.createElement(
        SyncEngineProvider,
        { engine },
        React.createElement(Harness, { mx, room })
      )
    );
  });
};

describe('threadSeedPrewarmController cache-only seeds', () => {
  beforeEach(() => {
    resetCacheStoreForTesting();
    clearThreadOpenSeedSnapshotsForTests();
  });
  afterEach(() => {
    resetCacheStoreForTesting();
    clearThreadOpenSeedSnapshotsForTests();
  });

  const setup = () => {
    const rootEvent = makeRootEvent();
    const room = {
      roomId: ROOM_ID,
      getThread: () => null,
      findEventById: (eventId: string) => (eventId === THREAD_ID ? rootEvent : undefined),
      getLastActiveTimestamp: () => 0,
    } as unknown as Room;
    const fetchRelations = vi.fn(async () => ({
      chunk: [rawReply('$reply-1', 2_000)],
      next_batch: undefined,
    }));
    const mx = {
      getEventMapper: () => (raw: Partial<IEvent>) =>
        new MatrixEvent(raw as ConstructorParameters<typeof MatrixEvent>[0]),
      fetchRelations,
      getRoom: () => room,
    } as unknown as MatrixClient;
    const persistThreadEventCache = vi.fn();
    const engine = {
      scheduler: createBackfillScheduler({ mx }),
      persist: { ...createEnginePersistFacade({ sessionId: SESSION_ID }), persistThreadEventCache },
      sessionId: SESSION_ID,
    } as unknown as SyncEngine;
    return { mx, room, engine, fetchRelations, persistThreadEventCache };
  };

  it('leaves cold-cache networking to the engine', async () => {
    const { mx, room, engine, fetchRelations, persistThreadEventCache } = setup();
    await renderPrewarm(mx, room, engine);
    expect(fetchRelations).not.toHaveBeenCalled();
    expect(persistThreadEventCache).not.toHaveBeenCalled();
  });

  it('skips the network entirely when the cached snapshot is already relations-proven complete', async () => {
    const { mx, room, engine, fetchRelations, persistThreadEventCache } = setup();
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$cached-reply', 1_500)],
      { event_id: THREAD_ID, origin_server_ts: 1_000, type: 'm.room.message' },
      null,
      true,
      true,
      1,
      true
    );

    await renderPrewarm(mx, room, engine);
    expect(fetchRelations).not.toHaveBeenCalled();
    expect(persistThreadEventCache).not.toHaveBeenCalled();
  });

  it('gives up without persisting when the thread root is not SDK-resolvable (PR #84 greptile P2)', async () => {
    const { mx, engine, fetchRelations, persistThreadEventCache } = setup();
    // The root never resolves; nothing is fetched or persisted.
    const rootlessRoom = {
      roomId: ROOM_ID,
      getThread: () => null,
      findEventById: () => undefined,
      getLastActiveTimestamp: () => 0,
    } as unknown as Room;

    await renderPrewarm(mx, rootlessRoom, engine);

    expect(fetchRelations).not.toHaveBeenCalled();
    expect(persistThreadEventCache).not.toHaveBeenCalled();
  });

  it('skips the network for a count-proven (relation-unproven) snapshot — review finding #4', async () => {
    const { mx, room, engine, fetchRelations, persistThreadEventCache } = setup();
    // Sweep-warmed shape: snapshotComplete + tailLoaded proven, but no
    // /relations pass ever ran (relationSnapshotComplete=false). The
    // open paints this from cache under the eager-cache coverage
    // policy, so prefetching it again would be a redundant full drain.
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      THREAD_ID,
      [rawReply('$cached-reply', 1_500)],
      { event_id: THREAD_ID, origin_server_ts: 1_000, type: 'm.room.message' },
      null,
      true,
      true,
      1,
      false
    );

    await renderPrewarm(mx, room, engine);

    expect(fetchRelations).not.toHaveBeenCalled();
    expect(persistThreadEventCache).not.toHaveBeenCalled();
  });
});

it('does not publish a held seed read after room clear', async () => {
  const mx = createClient({
    baseUrl: 'https://seed.example.org',
    userId: '@alice:seed.example.org',
  });
  const room = new SdkRoom(ROOM_ID, mx, '@alice:seed.example.org');
  mx.store.storeRoom(room);
  const engine = createSyncEngine({ mx });
  await saveThreadEventsToCache(engine.sessionId, ROOM_ID, THREAD_ID, [rawReply('$held-seed', 1)]);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The seed read finds the cached reply, then waits until the room is cleared.
  const load = vi.mocked(loadThreadCachedSnapshot);
  const readCache = load.getMockImplementation()!;
  load.mockClear();
  let readSnapshot: Awaited<ReturnType<typeof readCache>>;
  let markRead!: () => void;
  const read = new Promise<void>((resolve) => {
    markRead = resolve;
  });
  load.mockImplementationOnce(async (options) => {
    readSnapshot = await readCache(options);
    markRead();
    await held;
    return readSnapshot;
  });
  let controller!: ReturnType<typeof useThreadSeedPrewarmController>;
  function HeldHarness() {
    controller = useThreadSeedPrewarmController({
      room,
      mx,
      sessionId: engine.sessionId,
      prefetchDepthRef: { current: 200 },
      activeThreadId: undefined,
      priorityTargets: [{ threadId: THREAD_ID }],
      debugTraceId: 'clear-held-seed',
    });
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(SyncEngineProvider, { engine }, React.createElement(HeldHarness))
    );
  });
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  await read;
  expect(readSnapshot?.events.map((event) => event.getId())).toEqual(['$held-seed']);
  const pending = controller.waitForExistingOrQueued(THREAD_ID, {});
  await engine.offline.clear(ROOM_ID);
  await act(async () => {
    release();
    await pending;
  });
  expect(getThreadOpenSeedSnapshot(room, THREAD_ID)).toEqual([]);
  act(() => renderer.unmount());
  engine.stop();
});
