import 'fake-indexeddb/auto';
import { act, create } from 'react-test-renderer';
import { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { createSyncEngine } from '../../event-store/engine/syncEngine';
import { SyncEngineProvider } from '../../event-store/engine/engineContext';
import { deleteCacheStoreDb, loadLatestCachedThreadEvents } from '../../event-store/cache/db';
import { persistRoomChunkWithPreferLive } from '../../event-store/cache/eventRepository';
import { useRoomThreadList } from './useRoomThreadList';

it('keeps a listed reply as an edit target even when sync skipped its original event', async () => {
  const userId = '@reader:example.org';
  class Client extends MatrixClient {
    constructor() {
      super({
        baseUrl: 'https://example.org',
        userId,
        fetchFn: () => Promise.reject(new TypeError('Offline')),
      });
      this.clientOpts = { threadSupport: true };
      this.threadSupportPending = Promise.resolve();
    }
  }
  const mx = new Client();
  const room = new Room('!preview:example.org', mx, userId, { timelineSupport: true });
  mx.store.storeRoom(room);
  const engine = createSyncEngine({ mx });
  const reply = {
    event_id: '$listed-reply',
    room_id: room.roomId,
    sender: '@agent:example.org',
    type: 'm.room.message',
    origin_server_ts: 2000,
    content: {
      msgtype: 'm.text',
      body: 'Thinking...',
      'io.mindroom.stream_status': 'pending',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$listed-root' },
    },
  };
  const root = new MatrixEvent({
    event_id: '$listed-root',
    room_id: room.roomId,
    sender: userId,
    type: 'm.room.message',
    origin_server_ts: 1000,
    content: { msgtype: 'm.text', body: 'Which release notes are ready?' },
    unsigned: {
      'm.relations': {
        'm.thread': {
          count: 1,
          current_user_participated: false,
          latest_event: reply,
        },
      },
    },
  });
  vi.spyOn(room, 'fetchRoomThreads').mockImplementation(async () => {
    room.processThreadRoots([root], false);
  });
  function Harness() {
    useRoomThreadList(room);
    return null;
  }
  let renderer: ReturnType<typeof create> | undefined;
  try {
    await act(async () => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <SyncEngineProvider engine={engine}>
            <Harness />
          </SyncEngineProvider>
        </MatrixClientProvider>
      );
    });
    await vi.waitFor(async () => {
      const page = await loadLatestCachedThreadEvents(
        engine.sessionId,
        room.roomId,
        '$listed-root',
        10
      );
      expect(page.events.find((event) => event.event_id === '$listed-reply')?.content?.body).toBe(
        'Thinking...'
      );
      expect(page.tailLoaded).toBe(false);
      expect(page.snapshotComplete).toBe(false);
    });
    const edit = {
      ...reply,
      event_id: '$terminal',
      origin_server_ts: 3000,
      content: {
        msgtype: 'm.text',
        body: '* The release notes are ready.',
        'm.new_content': {
          msgtype: 'm.text',
          body: 'The release notes are ready.',
          'io.mindroom.stream_status': 'completed',
        },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$listed-reply' },
      },
    };
    await persistRoomChunkWithPreferLive({
      mx,
      sessionId: engine.sessionId,
      room,
      chunk: [edit],
      mappedEvents: [new MatrixEvent(edit)],
    });
    const page = await loadLatestCachedThreadEvents(
      engine.sessionId,
      room.roomId,
      '$listed-root',
      10
    );
    const raw = page.events.find((event) => event.event_id === '$listed-reply');
    expect(raw).toBeDefined();
    expect(mx.getEventMapper()(raw!).getContent().body).toBe('The release notes are ready.');
  } finally {
    await act(async () => renderer?.unmount());
    await deleteCacheStoreDb(engine.sessionId);
    vi.restoreAllMocks();
  }
});
