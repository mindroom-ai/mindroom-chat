import React from 'react';
import 'fake-indexeddb/auto';
import { EventStatus, MatrixEvent } from 'matrix-js-sdk';
import type { IEvent, MatrixClient, Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackfillScheduler, MindroomSyncEngineProvider } from '../engine';
import type { MindroomSyncEngine } from '../engine';
import { resetCacheStoreForTesting, saveThreadEventsToCache } from './cacheStore';
import { clearThreadOpenSeedSnapshotsForTests } from './threadOpenSeedCache';
import { useThreadSeedPrewarmController } from './threadSeedPrewarmController';

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

// NOTE: the controller persists through the engine facade
// (`engine.persist.persistThreadEventCache`, reached via
// `useMindroomSyncEngine()`), NOT through a prop — the spy the tests
// assert on lives on the fake engine passed to the provider below.
function Harness({ mx, room }: { mx: MatrixClient; room: Room }) {
  useThreadSeedPrewarmController({
    room,
    mx,
    sessionId: SESSION_ID,
    prefetchDepthRef: { current: 10_000 },
    activeThreadId: undefined,
    priorityTargets: [{ threadId: THREAD_ID }],
    // Keep the IDB seed pass inert so the tests exercise ONLY the
    // network content-prefetch phase.
    loadThreadOpenSeedSnapshotFromCache: async () => [],
    debugTraceId: 'prewarm-test',
  });
  return null;
}

const renderPrewarm = async (mx: MatrixClient, room: Room, engine: MindroomSyncEngine) => {
  await act(async () => {
    create(
      React.createElement(
        MindroomSyncEngineProvider,
        { engine },
        React.createElement(Harness, { mx, room })
      )
    );
  });
};

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 80; i += 1) {
    if (predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    });
  }
};

describe('threadSeedPrewarmController network content prefetch (2026-07-06 eager cache)', () => {
  beforeEach(() => {
    resetCacheStoreForTesting();
    clearThreadOpenSeedSnapshotsForTests();
  });
  afterEach(() => {
    resetCacheStoreForTesting();
    clearThreadOpenSeedSnapshotsForTests();
  });

  const setup = ({ withKnownStaleReply = false } = {}) => {
    const rootEvent = makeRootEvent();
    const knownStaleReply = new MatrixEvent(
      rawReply('$known-stale-reply', 1_500) as ConstructorParameters<typeof MatrixEvent>[0]
    );
    const pendingLocalEcho = new MatrixEvent(
      rawReply('~pending-local-echo', 1_600) as ConstructorParameters<typeof MatrixEvent>[0]
    );
    pendingLocalEcho.status = EventStatus.SENDING;
    const room = {
      roomId: ROOM_ID,
      getThread: () =>
        withKnownStaleReply
          ? {
              rootEvent,
              events: [knownStaleReply, pendingLocalEcho],
              timeline: [knownStaleReply, pendingLocalEcho],
            }
          : null,
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
      persist: { persistThreadEventCache },
      sessionId: SESSION_ID,
    } as unknown as MindroomSyncEngine;
    return { mx, room, engine, fetchRelations, persistThreadEventCache };
  };

  it('downloads full thread content for a priority target with no complete cached snapshot', async () => {
    const { mx, room, engine, fetchRelations, persistThreadEventCache } = setup({
      withKnownStaleReply: true,
    });

    await renderPrewarm(mx, room, engine);
    await waitFor(() => persistThreadEventCache.mock.calls.length > 0);

    // Cold cache → the prewarm band fetched the thread's relations …
    expect(fetchRelations).toHaveBeenCalled();
    // … and persisted an honest, relations-proven snapshot through the
    // engine persist facade (room-bound signature).
    expect(persistThreadEventCache).toHaveBeenCalledTimes(1);
    const [
      persistRoom,
      threadId,
      events,
      ,
      beforeToken,
      tailLoaded,
      ,
      ,
      relationSnapshotComplete,
      replyCountEvidence,
    ] = persistThreadEventCache.mock.calls[0];
    expect(persistRoom).toBe(room);
    expect(threadId).toBe(THREAD_ID);
    expect((events as MatrixEvent[]).map((event) => event.getId())).toEqual(['$reply-1']);
    expect(beforeToken).toBeNull();
    expect(tailLoaded).toBe(true);
    expect(relationSnapshotComplete).toBe(true);
    expect(replyCountEvidence).toEqual({
      knownEventIds: ['$known-stale-reply', '$reply-1'],
      visibleEventIds: ['$reply-1'],
    });
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
    // Give the drain loop time to (incorrectly) fire if it were going to.
    await waitFor(() => fetchRelations.mock.calls.length > 0);

    expect(fetchRelations).not.toHaveBeenCalled();
    expect(persistThreadEventCache).not.toHaveBeenCalled();
  });

  it('gives up without persisting when the thread root is not SDK-resolvable (PR #84 greptile P2)', async () => {
    const { mx, engine, fetchRelations, persistThreadEventCache } = setup();
    // Root never resolves → fetchAndPersistThreadContent bails before
    // enqueuing; nothing is fetched or persisted, and the open-time
    // drain remains the fallback for this thread.
    const rootlessRoom = {
      roomId: ROOM_ID,
      getThread: () => null,
      findEventById: () => undefined,
      getLastActiveTimestamp: () => 0,
    } as unknown as Room;

    await renderPrewarm(mx, rootlessRoom, engine);
    await waitFor(() => fetchRelations.mock.calls.length > 0);

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
    await waitFor(() => fetchRelations.mock.calls.length > 0);

    expect(fetchRelations).not.toHaveBeenCalled();
    expect(persistThreadEventCache).not.toHaveBeenCalled();
  });
});
