import 'fake-indexeddb/auto';
import { type IEvent } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import * as cacheStore from './cacheStore';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import {
  clearRoomCachedContent,
  deleteCacheStoreDb,
  deleteThreadEventsFromCache,
  loadCachedThreadSummaries,
  saveThreadEventsToCache,
} from './cacheStore';
import {
  clearThreadSummarySharedState,
  ensureThreadSummaryStateLoaded,
  getThreadSummaryStateSnapshot,
  storeThreadSummaryInState,
} from './threadSummaryState';

const sessionId = 'summary-state-commits';
const roomId = '!summary:test';
const rootId = '$root';
const event = (id: string, ts: number, body: string, threadRootId = rootId): Partial<IEvent> => ({
  event_id: id,
  room_id: roomId,
  type: 'm.room.message',
  sender: '@alice:test',
  origin_server_ts: ts,
  content: {
    msgtype: 'm.notice',
    body,
    'io.mindroom.thread_summary': true,
    'm.relates_to': { rel_type: 'm.thread', event_id: threadRootId },
  },
});
const title = () => getThreadSummaryStateSnapshot(sessionId, roomId).get(rootId)?.summaryText;

afterEach(async () => {
  clearThreadSummarySharedState(sessionId);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await deleteCacheStoreDb(sessionId);
});

it.each(['room', 'session'] as const)(
  'clears mounted %s summaries when IndexedDB is unavailable',
  async (scope) => {
    vi.stubGlobal('indexedDB', undefined);
    await ensureThreadSummaryStateLoaded(sessionId, roomId);
    const live = { summaryText: 'Live title', eventTs: 20 };
    storeThreadSummaryInState(sessionId, roomId, rootId, live);
    expect(title()).toBe('Live title');

    if (scope === 'room') await clearRoomCachedContent(sessionId, roomId);
    else await deleteCacheStoreDb(sessionId);

    expect(title()).toBeUndefined();
    storeThreadSummaryInState(sessionId, roomId, rootId, live);
    expect(title()).toBe('Live title');
  }
);

it('keeps display-only publications out of the durable summary index', async () => {
  await ensureThreadSummaryStateLoaded(sessionId, roomId);
  storeThreadSummaryInState(sessionId, roomId, rootId, {
    summaryText: 'Live preview',
    eventTs: 20,
  });
  expect(title()).toBe('Live preview');
  expect((await loadCachedThreadSummaries(sessionId, roomId)).has(rootId)).toBe(false);
});

it('updates an already loaded shared state from background history commits', async () => {
  await ensureThreadSummaryStateLoaded(sessionId, roomId);
  await saveThreadEventsToCache(sessionId, roomId, rootId, [event('$one', 10, 'First title')]);
  expect(title()).toBe('First title');
  await saveThreadEventsToCache(sessionId, roomId, rootId, [event('$two', 20, 'New title')]);
  expect(title()).toBe('New title');
});

it('falls back after deletion without retaining the removed cached winner', async () => {
  await saveThreadEventsToCache(sessionId, roomId, rootId, [
    event('$one', 10, 'First title'),
    event('$two', 20, 'Removed title'),
  ]);
  await ensureThreadSummaryStateLoaded(sessionId, roomId);
  await deleteThreadEventsFromCache(sessionId, roomId, rootId, ['$two']);
  expect(title()).toBe('First title');
  await ensureThreadSummaryStateLoaded(sessionId, roomId);
  expect(title()).toBe('First title');
});

it('preserves a newer live title when an older cached winner is deleted', async () => {
  await saveThreadEventsToCache(sessionId, roomId, rootId, [event('$one', 10, 'Cached title')]);
  await ensureThreadSummaryStateLoaded(sessionId, roomId);
  storeThreadSummaryInState(sessionId, roomId, rootId, {
    summaryText: 'New live title',
    eventTs: 30,
  });
  await deleteThreadEventsFromCache(sessionId, roomId, rootId, ['$one']);
  expect(title()).toBe('New live title');
  expect((await loadCachedThreadSummaries(sessionId, roomId)).has(rootId)).toBe(false);
});

it('clears shared titles and accepts new committed history without remounting', async () => {
  await saveThreadEventsToCache(sessionId, roomId, rootId, [event('$one', 10, 'Old title')]);
  await ensureThreadSummaryStateLoaded(sessionId, roomId);
  expect(title()).toBe('Old title');
  await clearRoomCachedContent(sessionId, roomId);
  expect(title()).toBeUndefined();
  storeThreadSummaryInState(sessionId, roomId, rootId, { summaryText: 'Old title', eventTs: 10 });
  expect(title()).toBe('Old title');
  await saveThreadEventsToCache(sessionId, roomId, rootId, [event('$two', 20, 'Fresh title')]);
  expect(title()).toBe('Fresh title');
});

it('allows genuine SDK candidates to supply a title after a cache clear', async () => {
  await ensureThreadSummaryStateLoaded(sessionId, roomId);
  const candidates = [
    { summaryText: 'Older title', eventTs: 10 },
    { summaryText: 'Newest title', eventTs: 20 },
  ];
  storeThreadSummaryInState(sessionId, roomId, rootId, ...candidates);
  expect(title()).toBe('Newest title');
  await clearRoomCachedContent(sessionId, roomId);
  expect(title()).toBeUndefined();
  storeThreadSummaryInState(sessionId, roomId, rootId, ...candidates);
  expect(title()).toBe('Newest title');
  expect((await loadCachedThreadSummaries(sessionId, roomId)).has(rootId)).toBe(false);
});

it('retries interrupted hydration without losing other cached titles or newer live values', async () => {
  await saveThreadEventsToCache(sessionId, roomId, rootId, [event('$one', 10, 'Removed title')]);
  await saveThreadEventsToCache(sessionId, roomId, '$other', [
    event('$other-summary', 5, 'Other cached title', '$other'),
  ]);
  let complete!: (value: Map<string, MindroomThreadSummaryInfo>) => void;
  const loadSummaries = vi.spyOn(cacheStore, 'loadCachedThreadSummaries').mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  const loading = ensureThreadSummaryStateLoaded(sessionId, roomId);
  storeThreadSummaryInState(sessionId, roomId, rootId, {
    summaryText: 'Removed title',
    eventTs: 10,
  });
  storeThreadSummaryInState(sessionId, roomId, '$live', { summaryText: 'Live title', eventTs: 30 });
  await deleteThreadEventsFromCache(sessionId, roomId, rootId, ['$one']);
  await saveThreadEventsToCache(sessionId, roomId, '$committed', [
    event('$new-summary', 6, 'New committed title', '$committed'),
  ]);
  expect(loadSummaries).toHaveBeenCalledTimes(1);
  complete(new Map([[rootId, { summaryText: 'Removed title', eventTs: 10 }]]));
  await loading;
  expect(title()).toBeUndefined();
  const snapshot = getThreadSummaryStateSnapshot(sessionId, roomId);
  expect(snapshot.get('$other')?.summaryText).toBe('Other cached title');
  expect(snapshot.get('$committed')?.summaryText).toBe('New committed title');
  expect(snapshot.get('$live')?.summaryText).toBe('Live title');
  expect(loadSummaries).toHaveBeenCalledTimes(2);
});

it.each(['delete', 'clear'] as const)(
  'does not restore a stale cache read after %s commits',
  async (action) => {
    await saveThreadEventsToCache(sessionId, roomId, rootId, [event('$one', 10, 'Old title')]);
    let complete!: (value: Map<string, MindroomThreadSummaryInfo>) => void;
    vi.spyOn(cacheStore, 'loadCachedThreadSummaries').mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      })
    );
    const loading = ensureThreadSummaryStateLoaded(sessionId, roomId);
    if (action === 'delete') await deleteThreadEventsFromCache(sessionId, roomId, rootId, ['$one']);
    else await clearRoomCachedContent(sessionId, roomId);
    complete(new Map([[rootId, { summaryText: 'Old title', eventTs: 10 }]]));
    await loading;
    expect(title()).toBeUndefined();
    await saveThreadEventsToCache(sessionId, roomId, rootId, [event('$two', 20, 'Fresh title')]);
    expect(title()).toBe('Fresh title');
  }
);
