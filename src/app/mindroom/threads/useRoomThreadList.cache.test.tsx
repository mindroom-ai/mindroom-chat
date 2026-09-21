import 'fake-indexeddb/auto';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { createMindroomSyncEngine } from '../engine/mindroomSyncEngine';
import { MindroomSyncEngineProvider } from '../engine/engineContext';
import {
  deleteCacheStoreDb,
  loadLatestCachedThreadEvents,
  saveRoomEventsToCache,
  saveThreadEventsToCache,
} from './cacheStore';
import { useRoomThreadList } from './useRoomThreadList';
import { buildCompactThreadRootData } from './compactThreadRootData';

const userId = '@alice:example.org';
const roomId = '!offline:example.org';
let renderer: ReactTestRenderer | undefined;
let sessionId: string;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  if (sessionId) await deleteCacheStoreDb(sessionId);
  vi.restoreAllMocks();
});

it('restores 400 cached threads while only one is in the SDK and discovery is pending', async () => {
  const fetchFn = vi.fn(() => Promise.reject(new TypeError('Offline')));
  class OfflineClient extends MatrixClient {
    constructor() {
      super({ baseUrl: 'https://example.org', userId, fetchFn });
      this.clientOpts = { threadSupport: true };
    }
  }
  const mx = new OfflineClient();
  mx.threadSupportPending = new Promise(() => {});
  const room = new Room(roomId, mx, userId, { timelineSupport: true });
  room.setMaxListeners(500);
  mx.store.storeRoom(room);
  const engine = createMindroomSyncEngine({ mx });
  sessionId = engine.sessionId;
  const roots = Array.from({ length: 400 }, (_, index): Partial<IEvent> => {
    const reply = {
      event_id: `$reply-${index}`,
      room_id: roomId,
      sender: userId,
      origin_server_ts: 2000 + index,
      type: 'm.room.message',
      content: {
        msgtype: 'm.text',
        body: `Reply ${index}`,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: `$root-${index}`,
        },
      },
    };
    return {
      event_id: `$root-${index}`,
      room_id: roomId,
      sender: userId,
      origin_server_ts: 1000 + index,
      type: 'm.room.message',
      content: { msgtype: 'm.text', body: `Thread ${index}` },
      unsigned: {
        'm.relations': {
          'm.thread': { count: 1, current_user_participated: true, latest_event: reply },
        },
      },
    };
  });
  await Promise.all(
    roots.map(async (root, index) => {
      // Historical pagination can save the reply before encountering the root.
      if (index % 2 === 0) {
        const reply = root.unsigned!['m.relations']!['m.thread']!.latest_event as IEvent;
        // A root cached before its first reply has no server thread bundle.
        root.unsigned = {};
        await saveRoomEventsToCache(sessionId, roomId, [root]);
        await saveThreadEventsToCache(sessionId, roomId, root.event_id!, [
          reply,
          {
            event_id: `$reaction-${index}`,
            room_id: roomId,
            sender: userId,
            origin_server_ts: 3000 + index,
            type: 'm.reaction',
            content: {
              'm.relates_to': { rel_type: 'm.annotation', event_id: reply.event_id, key: '👍' },
            },
          },
        ]);
      } else {
        await saveThreadEventsToCache(sessionId, roomId, root.event_id!, [], root);
      }
    })
  );
  await saveThreadEventsToCache(sessionId, '!another:example.org', '$foreign', [], {
    ...roots[0],
    event_id: '$foreign',
    room_id: '!another:example.org',
  });
  const liveRoot = new MatrixEvent({
    ...roots[399],
    content: { msgtype: 'm.text', body: 'Newer live title' },
  });
  room.processThreadRoots([liveRoot], false);
  expect(room.getThreads()).toHaveLength(1);
  let ids: string[] = [];
  function Harness() {
    const { threads } = useRoomThreadList(room);
    ids = buildCompactThreadRootData({
      room,
      threads,
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
    }).ids;
    return null;
  }
  await act(async () => {
    renderer = create(
      <MatrixClientProvider value={mx}>
        <MindroomSyncEngineProvider engine={engine}>
          <Harness />
        </MindroomSyncEngineProvider>
      </MatrixClientProvider>
    );
  });
  await act(async () => {
    await vi.waitFor(() => expect(ids).toHaveLength(400), { timeout: 5000 });
  });
  expect(new Set(ids)).toEqual(new Set(roots.map((root) => root.event_id)));
  expect(fetchFn).not.toHaveBeenCalled();
  expect(room.getLiveTimeline().getEvents()).toHaveLength(0);
  expect(room.getThread('$root-399')?.rootEvent).toBe(liveRoot);
  expect(liveRoot.getContent().body).toBe('Newer live title');
  expect(room.getThread('$root-0')?.replyToEvent?.getId()).toBe('$reply-0');
  expect(room.getThread('$root-0')?.initialEventsFetched).toBe(false);
  expect(room.getThread('$root-1')?.events).toHaveLength(0);
});

it('saves server-listed roots without claiming their replies have been downloaded', async () => {
  class Client extends MatrixClient {
    constructor() {
      super({ baseUrl: 'https://example.org', userId });
      this.clientOpts = { threadSupport: true };
      this.threadSupportPending = Promise.resolve();
    }
  }
  const mx = new Client();
  const room = new Room(roomId, mx, userId, { timelineSupport: true });
  mx.store.storeRoom(room);
  const engine = createMindroomSyncEngine({ mx });
  sessionId = engine.sessionId;
  const root = new MatrixEvent({
    event_id: '$listed',
    room_id: roomId,
    sender: userId,
    origin_server_ts: 1000,
    type: 'm.room.message',
    content: { msgtype: 'm.text', body: 'Listed by server' },
  });
  vi.spyOn(room, 'fetchRoomThreads').mockImplementation(async () => {
    room.processThreadRoots([root], false);
  });
  function Harness() {
    useRoomThreadList(room);
    return null;
  }
  await act(async () => {
    renderer = create(
      <MatrixClientProvider value={mx}>
        <MindroomSyncEngineProvider engine={engine}>
          <Harness />
        </MindroomSyncEngineProvider>
      </MatrixClientProvider>
    );
    await vi.waitFor(async () => {
      const cached = await loadLatestCachedThreadEvents(sessionId, roomId, '$listed', 1);
      expect(cached.rootEvent?.content?.body).toBe('Listed by server');
      expect(cached.events).toEqual([]);
      expect(cached.tailLoaded).toBe(false);
      expect(cached.snapshotComplete).toBe(false);
    });
  });
});
