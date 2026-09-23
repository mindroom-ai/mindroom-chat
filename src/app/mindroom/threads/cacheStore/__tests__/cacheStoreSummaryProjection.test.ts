import 'fake-indexeddb/auto';
import { createClient, Room, type IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  deleteCacheStoreDb,
  resetCacheStoreForTesting,
  saveThreadEventsToCache,
  loadCachedThreadSummaries,
  deleteThreadEventsFromCache,
  openCacheStore,
  EVENTS_STORE,
  THREAD_SUMMARIES_STORE,
  META_STORE,
  buildEventCacheKey,
  clearRoomCachedContent,
  captureCacheStoreWriteLease,
  saveThreadEventsToCacheCommitted,
  loadCachedThreadEvent,
} from '..';
import { repairCachedThreadSummaries } from '../cacheStoreSummaryProjection';
import { seedLegacyCachedThreadSummary } from './summaryFixtures';
import { subscribeCachedThreadSummaryChanges } from '../cacheStoreSummaryChanges';
import { reportCacheWriteError, resetCacheHealthForTesting } from '../../cacheHealth';
import { persistRoomChunkWithPreferLive } from '../../eventRepository';

const session = 'summary-projection';
const roomId = '!room:test';
const root = '$root';
const sender = '@alice:test';
const message = (id: string, ts = 10, body = 'ordinary'): Partial<IEvent> => ({
  event_id: id,
  room_id: roomId,
  origin_server_ts: ts,
  sender,
  type: 'm.room.message',
  content: { msgtype: 'm.notice', body, 'm.relates_to': { rel_type: 'm.thread', event_id: root } },
});
const summary = (id: string, ts = 10, body = 'Buried title'): Partial<IEvent> => ({
  ...message(id, ts),
  content: { ...message(id, ts, body).content, 'io.mindroom.thread_summary': true },
});
const edit = (target: string, ts: number, content = summary('$edit').content): Partial<IEvent> => ({
  ...message('$edit', ts),
  content: {
    msgtype: 'm.notice',
    body: '* edited',
    'm.new_content': content,
    'm.relates_to': { rel_type: 'm.replace', event_id: target },
  },
});
const read = async () => (await loadCachedThreadSummaries(session, roomId)).get(root);
const repair = async () =>
  repairCachedThreadSummaries(
    (await openCacheStore(session))!,
    captureCacheStoreWriteLease(session, roomId),
    roomId
  );
const save = (...events: Partial<IEvent>[]) =>
  saveThreadEventsToCache(session, roomId, root, events);
const ingest = () => {
  const mx = createClient({ baseUrl: 'https://matrix.test', userId: sender });
  const room = new Room(roomId, mx, sender);
  mx.getRoom = (id) => (id === roomId ? room : null);
  return (chunk: Partial<IEvent>[]) =>
    persistRoomChunkWithPreferLive({ mx, room, sessionId: session, chunk });
};
const seedLegacy = async (
  rows = [
    summary('$summary'),
    ...Array.from({ length: 100 }, (_, i) => message('$reply' + i, 20 + i)),
  ]
) => {
  const db = (await openCacheStore(session))!;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([EVENTS_STORE, META_STORE], 'readwrite');
    tx.objectStore(META_STORE).put({
      metaKey: `${roomId}|${root}`,
      roomId,
      scope: root,
      updatedAt: 1,
    });
    rows.forEach((rawEvent) => {
      tx.objectStore(EVENTS_STORE).put({
        cacheKey: buildEventCacheKey(roomId, root, rawEvent.event_id!),
        roomId,
        scope: root,
        eventId: rawEvent.event_id,
        ts: rawEvent.origin_server_ts,
        rawEvent,
        approxBytes: 100,
      });
    });
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
};
beforeEach(() => {
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await repair();
  await deleteCacheStoreDb(session);
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
});

it('persists a buried summary without mounting a view and falls back after deletion', async () => {
  await save(
    summary('$older', 1, 'Older'),
    summary('$summary'),
    ...Array.from({ length: 100 }, (_, i) => message('$reply' + i, 20 + i))
  );
  expect((await read())?.summaryText).toBe('Buried title');
  await deleteThreadEventsFromCache(session, roomId, root, ['$summary']);
  expect((await read())?.summaryText).toBe('Older');
  await deleteThreadEventsFromCache(session, roomId, root, ['$older']);
  expect(await read()).toBeUndefined();
});

it.each([false, true])(
  'uses ingestion for standalone edits arriving before their target: %s',
  async (editFirst) => {
    const persist = ingest();
    const original = message('$original');
    const replacement = edit('$original', 100);
    if (editFirst) await persist([replacement]);
    await persist([original]);
    if (!editFirst) await persist([replacement]);
    expect(await read()).toMatchObject({ summaryText: 'Buried title', eventTs: 100 });
    await persist([
      { ...message('$redact', 200), type: 'm.room.redaction', redacts: '$edit', content: {} },
    ]);
    expect(await read()).toBeUndefined();
  }
);

it('uses accepted bundled content, ignores wrong-sender edits, and removes summary metadata', async () => {
  const persist = ingest();
  await persist([summary('$summary'), { ...edit('$summary', 100), sender: '@mallory:test' }]);
  expect((await read())?.eventTs).toBe(10);
  await persist([edit('$summary', 200, summary('$new', 200, 'Edited title').content)]);
  expect(await read()).toMatchObject({ summaryText: 'Edited title', eventTs: 200 });
  await persist([{ ...edit('$summary', 300, message('$ordinary').content), event_id: '$remove' }]);
  expect(await read()).toBeUndefined();
});

it.each([true, false])(
  'updates a repaired legacy title when a standalone summary-creating edit is redacted: %s',
  async (createsSummary) => {
    const original = createsSummary ? message('$original') : summary('$original');
    const replacement = edit(
      '$original',
      100,
      createsSummary ? summary('$new').content : message('$new').content
    );
    await seedLegacy([original, replacement]);
    await repair();
    expect((await read())?.summaryText).toBe(createsSummary ? 'Buried title' : undefined);
    await ingest()([
      { ...message('$redaction', 200), type: 'm.room.redaction', redacts: '$edit', content: {} },
    ]);
    expect((await read())?.summaryText).toBe(createsSummary ? undefined : 'Buried title');
  }
);

it('preserves legacy-only titles, but establishes provenance when history supplies the same notice', async () => {
  await seedLegacyCachedThreadSummary(session, roomId, root, {
    summaryText: 'Buried title',
    eventTs: 10,
  });
  await save(message('$ordinary'));
  await repair();
  expect((await read())?.summaryText).toBe('Buried title');
  await save(summary('$summary'));
  await deleteThreadEventsFromCache(session, roomId, root, ['$summary']);
  expect(await read()).toBeUndefined();
});

it('paints existing titles before background repair, shares repair, and never rescans after reopen', async () => {
  await seedLegacy();
  await seedLegacyCachedThreadSummary(session, roomId, '$known', {
    summaryText: 'Available immediately',
  });
  const listener = vi.fn();
  const unsubscribe = subscribeCachedThreadSummaryChanges(session, roomId, listener);
  const scheduled: Array<() => void> = [];
  const schedule = globalThis.setTimeout;
  const gate = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: () => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (delay === 0) {
      scheduled.push(callback);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }
    return schedule(callback, delay, ...args);
  }) as typeof setTimeout);
  try {
    const titles = await loadCachedThreadSummaries(session, roomId);
    expect(titles.get('$known')?.summaryText).toBe('Available immediately');
    expect(titles.has(root)).toBe(false);
    const db = (await openCacheStore(session))!;
    const lease = captureCacheStoreWriteLease(session, roomId);
    const pending = repairCachedThreadSummaries(db, lease, roomId);
    expect(repairCachedThreadSummaries(db, lease, roomId)).toBe(pending);
    expect(listener).not.toHaveBeenCalled();
    gate.mockRestore();
    scheduled.splice(0).forEach((callback) => callback());
    await pending;
    expect((await read())?.summaryText).toBe('Buried title');
    await repair();
    resetCacheStoreForTesting();
    const scans = vi.spyOn(IDBIndex.prototype, 'getAll');
    await repair();
    expect(scans).not.toHaveBeenCalled();
  } finally {
    gate.mockRestore();
    unsubscribe();
  }
});

it.each(['room', 'session'] as const)(
  'cancels background repair and stale writes when clearing %s cache',
  async (scope) => {
    await seedLegacy();
    const db = (await openCacheStore(session))!;
    const lease = captureCacheStoreWriteLease(session, roomId);
    const pending = repairCachedThreadSummaries(db, lease, roomId);
    if (scope === 'room') await clearRoomCachedContent(session, roomId);
    else await deleteCacheStoreDb(session);
    await pending;
    expect(
      await saveThreadEventsToCacheCommitted(
        session,
        roomId,
        root,
        [summary('$stale')],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'partial',
        lease
      )
    ).toBe(false);
    expect(await read()).toBeUndefined();
    await save(summary('$fresh', 30, 'Fresh'));
    expect((await read())?.summaryText).toBe('Fresh');
  }
);

it('keeps committed titles readable with read-only storage and repairs after recovery', async () => {
  await seedLegacy();
  await seedLegacyCachedThreadSummary(session, roomId, '$known', { summaryText: 'Known' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  reportCacheWriteError('fixture', new DOMException('Quota exceeded', 'QuotaExceededError'));
  const titles = await loadCachedThreadSummaries(session, roomId);
  expect(titles.get('$known')?.summaryText).toBe('Known');
  await repair();
  expect(titles.has(root)).toBe(false);
  resetCacheHealthForTesting();
  await repair();
  expect((await read())?.summaryText).toBe('Buried title');
});

it('does no history scans or summary writes during ordinary streaming', async () => {
  const persist = ingest();
  await persist([message('$ordinary')]);
  await repair();
  let scans = 0;
  let puts = 0;
  const getAll = IDBIndex.prototype.getAll;
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBIndex.prototype, 'getAll').mockImplementation(function countScans(
    this: IDBIndex,
    ...args
  ) {
    if (this.name === 'by_scope_ts') scans += 1;
    return getAll.apply(this, args);
  });
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function countPuts(
    this: IDBObjectStore,
    ...args
  ) {
    if (this.name === THREAD_SUMMARIES_STORE) puts += 1;
    return put.apply(this, args);
  });
  for (let i = 0; i < 10; i += 1) {
    await persist([
      {
        ...edit('$ordinary', 100 + i, message('$ordinary', i, 'token ' + i).content),
        event_id: '$stream' + i,
      },
    ]);
  }
  expect(scans).toBe(0);
  expect(puts).toBe(0);
});

it('does not rescan history when a streaming snapshot repeats an unchanged summary', async () => {
  const notice = summary('$summary');
  await save(notice, message('$ordinary'));
  await repair();
  const scans = vi.spyOn(IDBIndex.prototype, 'getAll');
  await save(notice, {
    ...message('$ordinary'),
    unsigned: {
      'm.relations': {
        'm.replace': edit('$ordinary', 100, message('$ordinary', 100, 'streaming').content),
      },
    },
  });
  expect(scans).not.toHaveBeenCalled();
});

it('publishes neither event nor summary when the summary transaction fails', async () => {
  const listener = vi.fn();
  const unsubscribe = subscribeCachedThreadSummaryChanges(session, roomId, listener);
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function failSummary(
    this: IDBObjectStore,
    ...args
  ) {
    if (this.name === THREAD_SUMMARIES_STORE) throw new Error('summary write failure');
    return put.apply(this, args);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(
      await saveThreadEventsToCacheCommitted(session, roomId, root, [summary('$summary')])
    ).toBe(false);
    expect(await loadCachedThreadEvent(session, roomId, root, '$summary')).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
  }
});
