import 'fake-indexeddb/auto';
import { act, create } from 'react-test-renderer';
import { MatrixClient, Room } from 'matrix-js-sdk';
import { expect, it, vi } from 'vitest';
import { deleteCacheStoreDb, saveThreadEventsToCache } from '../../event-store/cache/db';
import { useThreadOverviewCachedMetadata } from './threadOverviewCacheMetadata';
import { useThreadOverviewCacheHydration } from './threadOverviewCacheHydration';
import { buildThreadRecord } from '../../event-store/threads/threadRecord';
import { subscribeThreadCacheChanges } from '../../event-store/cache/threadCacheChanges';

it('announces committed changes only, scoped to the reader, and ignores an older replay', async () => {
  const sessionId = 'preview-change-notifications';
  const roomId = '!room:example.org';
  const notify = vi.fn();
  const unsubscribe = subscribeThreadCacheChanges(sessionId, roomId, notify);
  const reply = {
    event_id: '$reply',
    origin_server_ts: 1000,
    room_id: roomId,
    sender: '@agent:example.org',
    type: 'm.room.message',
    content: {
      msgtype: 'm.text',
      body: 'Thinking...',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    },
  };
  try {
    await saveThreadEventsToCache(sessionId, roomId, '$root', [reply]);
    await saveThreadEventsToCache(sessionId, roomId, '$root', [reply]);
    expect(notify).toHaveBeenCalledTimes(1);
    const finished = {
      ...reply,
      unsigned: {
        'm.relations': {
          'm.replace': {
            ...reply,
            event_id: '$edit',
            origin_server_ts: 2000,
            content: {
              msgtype: 'm.text',
              body: '* Ready.',
              'm.new_content': { msgtype: 'm.text', body: 'Ready.' },
              'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
            },
          },
        },
      },
    };
    await saveThreadEventsToCache(sessionId, roomId, '$root', [finished]);
    await saveThreadEventsToCache(sessionId, roomId, '$root', [reply]);
    expect(notify).toHaveBeenCalledTimes(2);
    await saveThreadEventsToCache(sessionId, '!elsewhere:example.org', '$root', [reply]);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith('$root');
    unsubscribe();
    await saveThreadEventsToCache(sessionId, roomId, '$other', [reply]);
    expect(notify).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
    await deleteCacheStoreDb(sessionId);
  }
});

it('refreshes a cached preview when the reply finishes outside the loaded thread timeline', async () => {
  const sessionId = 'preview-revisions';
  const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@reader:example.org' });
  const room = new Room('!room:example.org', mx, '@reader:example.org');
  const rootId = '$root';
  const reply = {
    event_id: '$reply',
    room_id: room.roomId,
    sender: '@agent:example.org',
    origin_server_ts: 1000,
    type: 'm.room.message',
    content: {
      msgtype: 'm.text',
      body: 'Thinking...',
      'io.mindroom.stream_status': 'pending',
      'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
    },
  };
  const roots = [rootId];
  const noThreads: [] = [];
  const noBodies = new Map<string, string>();
  const storeSummary = () => {};
  let records = new Map([[rootId, buildThreadRecord({ room, threadRootId: rootId })]]);
  let preview: string | undefined;
  function Harness() {
    const cachedMetadata = useThreadOverviewCachedMetadata(room.roomId);
    preview = cachedMetadata.latestReplyPreviewMap.get(rootId);
    useThreadOverviewCacheHydration({
      overviewThreadRootIds: roots,
      overviewThreadMetadataCacheLimit: 32,
      room,
      roomThreadListThreads: noThreads,
      sessionId,
      mx,
      showCompactRoomView: true,
      compactThreadRootBodyMap: noBodies,
      compactThreadRecordMap: records,
      threadRecordMap: records,
      cachedMetadata,
      onStoreThreadSummary: storeSummary,
    });
    return null;
  }
  let renderer: ReturnType<typeof create> | undefined;
  try {
    await saveThreadEventsToCache(sessionId, room.roomId, rootId, [reply]);
    await act(async () => {
      renderer = create(<Harness />);
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(preview).toBe('Thinking...');
    });
    const edit = {
      ...reply,
      event_id: '$finished',
      origin_server_ts: 2000,
      content: {
        msgtype: 'm.text',
        body: '* The release notes are ready.',
        'm.new_content': {
          msgtype: 'm.text',
          body: 'The release notes are ready.',
          'io.mindroom.stream_status': 'completed',
        },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
      },
    };
    await saveThreadEventsToCache(sessionId, room.roomId, rootId, [
      { ...reply, unsigned: { 'm.relations': { 'm.replace': edit } } },
    ]);
    const record = buildThreadRecord({ room, threadRootId: rootId, fallbackLastActivityTs: 2000 });
    records = new Map([[rootId, record]]);
    await act(async () => {
      renderer?.update(<Harness />);
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(preview).toBe('The release notes are ready.');
    });
  } finally {
    await act(async () => renderer?.unmount());
    await deleteCacheStoreDb(sessionId);
  }
});
