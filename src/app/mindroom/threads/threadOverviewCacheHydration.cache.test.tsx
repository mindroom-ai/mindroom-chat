import 'fake-indexeddb/auto';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MatrixClient, Room } from 'matrix-js-sdk';
import { expect, it, vi } from 'vitest';
import {
  deleteCacheStoreDb,
  loadCachedThreadSummaries,
  saveThreadEventsToCache,
} from './cacheStore';
import { useThreadOverviewCachedMetadata } from './threadOverviewCacheMetadata';
import { useThreadOverviewCacheHydration } from './threadOverviewCacheHydration';
import { useRoomThreadSummaryState } from './useRoomThreadSummaryState';
import { clearThreadSummarySharedState } from './threadSummaryState';
import * as cacheStore from './cacheStore';

it('reads later overview batches even when the first threads have no cached replies', async () => {
  const sessionId = 'overview-batches';
  const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
  const room = new Room('!room:example.org', mx, '@alice:example.org');
  const roots = ['$empty-a', '$empty-b', '$saved-a', '$saved-b'];
  const summaries = new Map();
  const storeSummary = (rootId: string, info: unknown) => summaries.set(rootId, info);
  for (const rootId of roots.slice(2)) {
    await saveThreadEventsToCache(sessionId, room.roomId, rootId, [
      {
        event_id: `${rootId}-reply`,
        room_id: room.roomId,
        sender: '@alice:example.org',
        origin_server_ts: 1000,
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          body: 'Saved reply',
          'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
        },
      },
      {
        event_id: `${rootId}-summary`,
        room_id: room.roomId,
        sender: '@alice:example.org',
        origin_server_ts: 2000,
        type: 'm.room.message',
        content: {
          msgtype: 'm.notice',
          body: 'Saved summary',
          'io.mindroom.thread_summary': true,
          'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
        },
      },
    ]);
  }
  const noThreads: [] = [];
  const noBodies = new Map();
  const noRecords = new Map();
  let previews: ReadonlyMap<string, string> = new Map();
  function Harness() {
    const cachedMetadata = useThreadOverviewCachedMetadata(room.roomId);
    previews = cachedMetadata.latestReplyPreviewMap;
    useThreadOverviewCacheHydration({
      overviewThreadRootIds: roots,
      overviewThreadMetadataCacheLimit: 2,
      room,
      roomThreadListThreads: noThreads,
      sessionId,
      mx,
      showCompactRoomView: true,
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
    await act(async () => {
      renderer = create(<Harness />);
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(previews.get('$saved-b')).toBe('Saved reply');
      expect(summaries.get('$saved-b')).toEqual({ summaryText: 'Saved summary', eventTs: 2000 });
    });
  } finally {
    await act(async () => renderer?.unmount());
    await deleteCacheStoreDb(sessionId);
  }
});

it.each([
  { downloadedLater: false, initialReplies: 96 },
  { downloadedLater: true, initialReplies: 96 },
  { downloadedLater: true, initialReplies: 20 },
])(
  'recovers a buried summary without opening its thread (downloaded later: $downloadedLater, initial replies: $initialReplies)',
  async ({ downloadedLater, initialReplies }) => {
    const sessionId = 'overview-buried-summary';
    const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
    const room = new Room('!room:example.org', mx, '@alice:example.org');
    const roots = ['$root'];
    const noThreads: [] = [];
    const noBodies = new Map();
    const noRecords = new Map();
    const summaryEvent = {
      event_id: '$summary',
      origin_server_ts: 1000,
      type: 'm.room.message',
      sender: '@alice:example.org',
      content: {
        msgtype: 'm.notice',
        body: 'A summary already downloaded in the background',
        'io.mindroom.thread_summary': true,
        'm.relates_to': { rel_type: 'm.thread', event_id: roots[0] },
      },
    };
    await saveThreadEventsToCache(sessionId, room.roomId, roots[0], [
      ...(downloadedLater ? [] : [summaryEvent]),
      ...Array.from({ length: initialReplies }, (_, index) => ({
        event_id: `$reply-${index}`,
        origin_server_ts: 2000 + index,
        type: 'm.room.message',
        sender: '@alice:example.org',
        content: {
          msgtype: 'm.text',
          body: `Later reply ${index}`,
          'm.relates_to': { rel_type: 'm.thread', event_id: roots[0] },
        },
      })),
    ]);
    expect((await loadCachedThreadSummaries(sessionId, room.roomId)).size).toBe(0);
    let overviewEventCount: number | undefined;
    function Harness() {
      const cachedMetadata = useThreadOverviewCachedMetadata(room.roomId);
      const { summaryMap, storeThreadSummary } = useRoomThreadSummaryState({
        sessionId,
        roomId: room.roomId,
      });
      overviewEventCount = cachedMetadata.coverageMap.get(roots[0])?.eventCount;
      useThreadOverviewCacheHydration({
        overviewThreadRootIds: roots,
        overviewThreadMetadataCacheLimit: 2,
        room,
        roomThreadListThreads: noThreads,
        sessionId,
        mx,
        showCompactRoomView: true,
        compactThreadRootBodyMap: noBodies,
        compactThreadRecordMap: noRecords,
        threadRecordMap: noRecords,
        cachedMetadata,
        onStoreThreadSummary: storeThreadSummary,
      });
      return <span>{summaryMap.get(roots[0])?.summaryText ?? 'Original prompt'}</span>;
    }
    let renderer: ReturnType<typeof create> | undefined;
    const recoveryRead = vi.spyOn(cacheStore, 'loadLatestCachedThreadEvents');
    try {
      await act(async () => {
        renderer = create(<Harness />);
      });
      if (downloadedLater) {
        await vi.waitFor(() => expect(overviewEventCount).toBe(Math.min(32, initialReplies)));
        if (initialReplies > 32) await vi.waitFor(() => expect(recoveryRead).toHaveBeenCalled());
        // Let the initial missing-summary scan settle, then grow history behind
        // the unchanged 32-event tail and activity timestamp.
        await act(async () => {
          await Promise.all(recoveryRead.mock.results.map((result) => result.value));
        });
        await act(async () =>
          saveThreadEventsToCache(sessionId, room.roomId, roots[0], [
            summaryEvent,
            ...Array.from({ length: 100 }, (_, index) => ({
              ...summaryEvent,
              event_id: `$older-${index}`,
              origin_server_ts: 1100 + index,
              content: {
                msgtype: 'm.text',
                body: 'Older downloaded reply',
                'm.relates_to': { rel_type: 'm.thread', event_id: roots[0] },
              },
            })),
          ])
        );
      }
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(renderer?.root.findByType('span').children).toEqual([
          'A summary already downloaded in the background',
        ]);
      });
      expect(overviewEventCount).toBe(Math.min(32, initialReplies));
      await vi.waitFor(async () => {
        expect(
          (await loadCachedThreadSummaries(sessionId, room.roomId)).get(roots[0])?.summaryText
        ).toBe('A summary already downloaded in the background');
      });
    } finally {
      await act(async () => renderer?.unmount());
      recoveryRead.mockRestore();
      clearThreadSummarySharedState(sessionId);
      await deleteCacheStoreDb(sessionId);
    }
  }
);
