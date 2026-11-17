import 'fake-indexeddb/auto';
import { act, create } from 'react-test-renderer';
import { MatrixClient, Room } from 'matrix-js-sdk';
import { expect, it, vi } from 'vitest';
import { deleteCacheStoreDb, saveThreadEventsToCache } from '../../event-store/cache/db';
import { useThreadOverviewCachedMetadata } from './threadOverviewCacheMetadata';
import { useThreadOverviewCacheHydration } from './threadOverviewCacheHydration';

it('a list mounted again shows what its room had read, then reads its threads again', async () => {
  const sessionId = 'overview-remount';
  const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
  const room = new Room('!room:example.org', mx, '@alice:example.org');
  const rootId = '$root';
  const saveReply = (id: string, ts: number, body: string) =>
    saveThreadEventsToCache(sessionId, room.roomId, rootId, [
      {
        event_id: id,
        room_id: room.roomId,
        sender: '@bob:example.org',
        origin_server_ts: ts,
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          body,
          'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
        },
      },
    ]);
  const roots = [rootId];
  const noThreads: [] = [];
  const noBodies = new Map<string, string>();
  const noRecords = new Map();
  const storeSummary = () => {};
  const shown: (string | undefined)[] = [];
  function Harness() {
    const cachedMetadata = useThreadOverviewCachedMetadata(room);
    shown.push(cachedMetadata.latestReplyPreviewMap.get(rootId));
    useThreadOverviewCacheHydration({
      overviewThreadRootIds: roots,
      overviewThreadMetadataCacheLimit: 10,
      room,
      roomThreadListThreads: noThreads,
      sessionId,
      mx,
      showCompactRoomView: false,
      compactThreadRootBodyMap: noBodies,
      compactThreadRecordMap: noRecords,
      threadRecordMap: noRecords,
      cachedMetadata,
      onStoreThreadSummary: storeSummary,
    });
    return null;
  }
  let renderer: ReturnType<typeof create> | undefined;
  try {
    // The root is cached too, so the card's preview needs no other read.
    await saveThreadEventsToCache(sessionId, room.roomId, rootId, [
      {
        event_id: rootId,
        room_id: room.roomId,
        sender: '@alice:example.org',
        origin_server_ts: 500,
        type: 'm.room.message',
        content: { msgtype: 'm.text', body: 'Root' },
      },
    ]);
    await saveReply('$first', 1000, 'First reply');
    await act(async () => {
      renderer = create(<Harness />);
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(shown.at(-1)).toBe('First reply');
    });
    // Opening a thread unmounts the list; a reply cached meanwhile is heard by no one.
    await act(async () => renderer?.unmount());
    await saveReply('$later', 3000, 'Later reply');

    shown.length = 0;
    await act(async () => {
      renderer = create(<Harness />);
    });
    expect(shown[0]).toBe('First reply');
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(shown.at(-1)).toBe('Later reply');
    });
  } finally {
    await act(async () => renderer?.unmount());
    await deleteCacheStoreDb(sessionId);
  }
});
