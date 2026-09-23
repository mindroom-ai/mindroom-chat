import 'fake-indexeddb/auto';
import type { IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteCacheStoreDb,
  resetCacheStoreForTesting,
  saveThreadEventsToCache,
  loadCachedThreadSummaries,
  deleteThreadEventsFromCache,
  saveRoomEventsToCache,
  openCacheStore,
  EVENTS_STORE,
  ROOM_LEDGER_STORE,
  revokeRoomCacheStoreWrites,
  buildEventCacheKey,
  clearRoomCachedContent,
  captureCacheStoreWriteLease,
  saveThreadEventsToCacheCommitted,
  deleteThreadEventFromCacheByEventId,
  loadCachedThreadEvent,
  THREAD_SUMMARIES_STORE,
  META_STORE,
} from '..';

import { seedLegacyCachedThreadSummary } from './summaryFixtures';
import { subscribeCachedThreadSummaryChanges } from '../cacheStoreSummaryChanges';
import { EVENTS_BY_SUMMARY_CANDIDATE_INDEX } from '../cacheStoreSchema';
import {
  getCacheHealth,
  reportCacheWriteError,
  resetCacheHealthForTesting,
} from '../../cacheHealth';

const session = 'summary-projection';
const room = '!room:test';
const root = '$root';
const message = (id: string, ts = 10, body = 'ordinary'): Partial<IEvent> => ({
  event_id: id,
  origin_server_ts: ts,
  sender: '@alice:test',
  type: 'm.room.message',
  content: { msgtype: 'm.notice', body },
});
const summary = (id: string, ts = 10, body = 'Buried title'): Partial<IEvent> => ({
  ...message(id, ts, body),
  content: { msgtype: 'm.notice', body, 'io.mindroom.thread_summary': true },
});
const edit = (id: string, target: string, ts: number, body = 'Edited title'): Partial<IEvent> => ({
  ...message(id, ts),
  content: {
    ...summary(id, ts, body).content,
    'm.new_content': summary(id, ts, body).content,
    'm.relates_to': { rel_type: 'm.replace', event_id: target },
  },
});
const read = async () => (await loadCachedThreadSummaries(session, room)).get(root);
const save = (...events: Partial<IEvent>[]) => saveThreadEventsToCache(session, room, root, events);

const seedLegacy = async (rows: Partial<IEvent>[]) => {
  const db = (await openCacheStore(session))!;
  await new Promise<void>((resolve) => {
    const tx = db.transaction([EVENTS_STORE, ROOM_LEDGER_STORE], 'readwrite');
    tx.objectStore(ROOM_LEDGER_STORE).put({
      roomId: room,
      eventCount: rows.length,
      approxBytes: rows.length * 100,
      lastActivityTs: 400,
    });
    rows.forEach((rawEvent) =>
      tx.objectStore(EVENTS_STORE).put({
        cacheKey: buildEventCacheKey(room, root, rawEvent.event_id!),
        roomId: room,
        scope: root,
        eventId: rawEvent.event_id,
        ts: rawEvent.origin_server_ts,
        rawEvent,
        approxBytes: 100,
      })
    );
    tx.oncomplete = () => resolve();
  });
  return db;
};

beforeEach(() => {
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await deleteCacheStoreDb(session);
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
});

describe('transaction-owned thread summaries', () => {
  it('keeps legacy reads available after an asynchronous migration transaction failure', async () => {
    await seedLegacy([summary('$summary')]);
    await seedLegacyCachedThreadSummary(session, room, root, { summaryText: 'Existing legacy' });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function failMigrationPut(
      this: IDBObjectStore,
      ...args
    ) {
      // A duplicate primary key fails asynchronously and aborts the transaction.
      return this.name === EVENTS_STORE ? this.add(...args) : originalPut.apply(this, args);
    });
    expect((await read())?.summaryText).toBe('Existing legacy');
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(warning).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: 'ConstraintError' })
    );
  });
  it('backfills ordinary legacy history without scheduling empty summary projections', async () => {
    await seedLegacy(Array.from({ length: 256 }, (_, i) => message(`$ordinary-${i}`, i)));
    const reads = vi.spyOn(IDBIndex.prototype, 'getAll');
    expect(await read()).toBeUndefined();
    expect(
      reads.mock.contexts.filter(
        (index) => (index as IDBIndex).name === EVENTS_BY_SUMMARY_CANDIDATE_INDEX
      )
    ).toHaveLength(0);
  });
  it('invalidates an edited summary when another scope receives a non-summary revision', async () => {
    const original = message('$original');
    await save({
      ...original,
      unsigned: { 'm.relations': { 'm.replace': edit('$promote', '$original', 100) } },
    });
    expect((await read())?.summaryText).toBe('Edited title');
    const replacement = {
      ...edit('$remove', '$original', 200),
      content: {
        msgtype: 'm.notice',
        body: '* ordinary',
        'm.new_content': { msgtype: 'm.notice', body: 'ordinary' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
      },
    };
    await saveRoomEventsToCache(session, room, [
      { ...original, unsigned: { 'm.relations': { 'm.replace': replacement } } },
    ]);
    expect(await read()).toBeUndefined();
  });
  it.each([false, true])(
    'keeps committed titles readable when migration cannot write (already read-only: %s)',
    async (readOnly) => {
      await seedLegacy([summary('$summary')]);
      await seedLegacyCachedThreadSummary(session, room, root, { summaryText: 'Existing legacy' });
      const quota = new DOMException('Quota exceeded', 'QuotaExceededError');
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      if (readOnly) reportCacheWriteError('fixture', quota);
      const originalPut = IDBObjectStore.prototype.put;
      let writeAttempts = 0;
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function failMigrationPut(
        this: IDBObjectStore,
        ...args
      ) {
        if (this.name === EVENTS_STORE) {
          writeAttempts += 1;
          throw quota;
        }
        return originalPut.apply(this, args);
      });
      expect((await read())?.summaryText).toBe('Existing legacy');
      expect(getCacheHealth().state).toBe('read-only');
      expect(writeAttempts).toBe(readOnly ? 0 : 1);
      expect((await read())?.summaryText).toBe('Existing legacy');
      expect(writeAttempts).toBe(readOnly ? 0 : 1);
      vi.restoreAllMocks();
      resetCacheHealthForTesting();
      expect((await read())?.summaryText).toBe('Buried title');
    }
  );
  it.each([false, true])(
    'merges accepted revisions across room and thread copies (room first: %s)',
    async (roomFirst) => {
      const original = summary('$summary');
      const replacement = {
        ...edit('$edit', '$summary', 100),
        content: {
          msgtype: 'm.notice',
          body: '* ordinary',
          'm.new_content': { msgtype: 'm.notice', body: 'ordinary' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$summary' },
        },
      };
      const roomCopy = {
        ...original,
        content: { ...original.content, 'm.relates_to': { rel_type: 'm.thread', event_id: root } },
        unsigned: { 'm.relations': { 'm.replace': replacement } },
      };
      if (roomFirst) await saveRoomEventsToCache(session, room, [roomCopy]);
      await save(original);
      if (!roomFirst) await saveRoomEventsToCache(session, room, [roomCopy]);
      expect(await read()).toBeUndefined();
    }
  );
  it('establishes provenance when accepted history exactly matches a legacy title', async () => {
    await seedLegacyCachedThreadSummary(session, room, root, {
      summaryText: 'Buried title',
      eventTs: 10,
    });
    await save(summary('$summary'));
    expect((await read())?.summaryText).toBe('Buried title');
    await deleteThreadEventsFromCache(session, room, root, ['$summary']);
    expect(await read()).toBeUndefined();
  });
  it('persists a buried summary without mounting a view', async () => {
    await save(
      summary('$summary'),
      ...Array.from({ length: 96 }, (_, i) => message(`$reply${i}`, 20 + i))
    );
    expect((await read())?.summaryText).toBe('Buried title');
  });
  it('resolves cross-page edits and redactions through accepted events', async () => {
    await save(
      summary('$summary'),
      ...Array.from({ length: 160 }, (_, i) => message(`$reply${i}`, 20 + i))
    );
    await save(edit('$edit', '$summary', 300));
    expect(await read()).toEqual({ summaryText: 'Edited title', eventTs: 300 });
    await saveRoomEventsToCache(session, room, [
      { ...message('$redaction', 400), type: 'm.room.redaction', redacts: '$edit', content: {} },
    ]);
    expect((await read())?.summaryText).toBe('Buried title');
  });
  it.each([5, 500])('accepts a late ordinary target with timestamp %s', async (ts) => {
    await save(edit('$edit', '$ordinary', 100));
    expect(await read()).toBeUndefined();
    await save(message('$ordinary', ts));
    expect(await read()).toEqual({ summaryText: 'Edited title', eventTs: 100 });
  });
  it('rejects a different sender replacement and falls back after deletion', async () => {
    await save(summary('$old', 1, 'Old'), summary('$summary', 10), {
      ...edit('$bad', '$summary', 100),
      sender: '@mallory:test',
    });
    expect((await read())?.summaryText).toBe('Buried title');
    await deleteThreadEventsFromCache(session, room, root, ['$summary']);
    expect((await read())?.summaryText).toBe('Old');
  });
  it('backfills raw legacy rows and never walks history again after completion', async () => {
    await seedLegacy([
      summary('$legacy'),
      ...Array.from({ length: 300 }, (_, i) => message(`$reply${i}`, 20 + i)),
    ]);
    expect((await read())?.summaryText).toBe('Buried title');
    const cursor = vi.spyOn(IDBIndex.prototype, 'openCursor');
    await read();
    await save(message('$new', 500));
    await read();
    expect(
      (cursor.mock.contexts as IDBIndex[]).filter((index) => index.name === 'by_scope_ts')
    ).toHaveLength(0);
  });
  it('rejects stale writes after clear and accepts fresh writes', async () => {
    await save(summary('$summary'));
    const lease = captureCacheStoreWriteLease(session, room);
    await clearRoomCachedContent(session, room);
    expect(
      await saveThreadEventsToCacheCommitted(
        session,
        room,
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
    await save(summary('$fresh', 100, 'Fresh'));
    expect((await read())?.summaryText).toBe('Fresh');
  });
  it.each(['target-first', 'edit-first'])(
    'indexes room-only summary-creating edits: %s',
    async (order) => {
      const target = {
        ...message('$ordinary'),
        content: {
          ...message('$ordinary').content,
          'm.relates_to': { rel_type: 'm.thread', event_id: root },
        },
      };
      const replacement = edit('$edit', '$ordinary', 100);
      const rows = order === 'target-first' ? [target, replacement] : [replacement, target];
      for (const row of rows) await saveRoomEventsToCache(session, room, [row]);
      expect((await read())?.summaryText).toBe('Edited title');
    }
  );
  it('uses bundled replacement content and accepted chronology', async () => {
    await save({
      ...summary('$summary'),
      unsigned: { 'm.relations': { 'm.replace': edit('$edit', '$summary', 200) } },
    });
    expect(await read()).toEqual({ summaryText: 'Edited title', eventTs: 200 });
  });
  it('removes a summary promoted by an edit when that edit is deleted across scopes', async () => {
    await save(message('$ordinary'), edit('$edit', '$ordinary', 100));
    expect((await read())?.summaryText).toBe('Edited title');
    await deleteThreadEventFromCacheByEventId(session, room, '$edit');
    expect(await read()).toBeUndefined();
  });
  it('preserves summary-only legacy records with no raw source', async () => {
    await seedLegacyCachedThreadSummary(session, room, root, {
      summaryText: 'Legacy manual',
      isManual: true,
      generatedTs: 100,
    });
    await save(message('$ordinary'));
    expect((await read())?.summaryText).toBe('Legacy manual');
  });
  it('does no history or candidate scans during ordinary streaming', async () => {
    await save(summary('$summary'), message('$ordinary'));
    await read();
    const cursor = vi.spyOn(IDBIndex.prototype, 'openCursor');
    const getAll = vi.spyOn(IDBIndex.prototype, 'getAll');
    const history = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    for (let i = 0; i < 5; i += 1) {
      await save(message('$reply' + i, 100 + i), {
        ...edit('$stream' + i, '$ordinary', 200 + i),
        content: {
          'm.relates_to': { rel_type: 'm.replace', event_id: '$ordinary' },
          'm.new_content': { msgtype: 'm.text', body: 'stream ' + i },
          body: '* stream',
          msgtype: 'm.text',
        },
      });
    }
    expect(
      (cursor.mock.contexts as IDBIndex[]).filter((index) => index.name === 'by_scope_ts')
    ).toHaveLength(0);
    expect(
      (history.mock.contexts as IDBObjectStore[]).filter((store) => store.name === EVENTS_STORE)
    ).toHaveLength(0);
    expect(
      (getAll.mock.contexts as IDBIndex[]).filter((index) => index.name === 'by_summary_candidate')
    ).toHaveLength(0);
    await save(edit('$summaryEdit', '$summary', 500));
    expect((await read())?.summaryText).toBe('Edited title');
  });
  it('publishes neither event nor summary when its transaction aborts', async () => {
    await save(summary('$summary'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const listener = vi.fn();
    const unsubscribe = subscribeCachedThreadSummaryChanges(session, room, listener);
    const put = IDBObjectStore.prototype.put;
    const fault = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function abortSummary(this: IDBObjectStore, value, key) {
        const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
        if (this.name === THREAD_SUMMARIES_STORE)
          request.addEventListener('success', () => this.transaction.abort(), { once: true });
        return request;
      });
    expect(
      await saveThreadEventsToCacheCommitted(session, room, root, [edit('$edit', '$summary', 100)])
    ).toBe(false);
    fault.mockRestore();
    expect(listener).not.toHaveBeenCalled();
    expect(await loadCachedThreadEvent(session, room, root, '$edit')).toBeUndefined();
    expect((await read())?.summaryText).toBe('Buried title');
    unsubscribe();
  });
  it('publishes only committed summary changes and retains subscriptions through clears', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCachedThreadSummaryChanges(session, room, listener);
    await save(summary('$summary'));
    await save(message('$ordinary'));
    expect(listener).toHaveBeenCalledTimes(1);
    await clearRoomCachedContent(session, room);
    expect(listener).toHaveBeenLastCalledWith({ type: 'clear' });
    await save(summary('$fresh', 100, 'Fresh'));
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'summary',
        previous: undefined,
        summary: expect.objectContaining({ summaryText: 'Fresh' }),
      })
    );
    await deleteCacheStoreDb(session);
    expect(listener).toHaveBeenLastCalledWith({ type: 'clear' });
    unsubscribe();
  });

  it('removes summary metadata through an accepted ordinary replacement', async () => {
    await save(summary('$old', 1, 'Old'), summary('$summary'));
    await save({
      ...edit('$edit', '$summary', 100),
      content: {
        msgtype: 'm.notice',
        body: '* ordinary',
        'm.new_content': { msgtype: 'm.notice', body: 'ordinary' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$summary' },
      },
    });
    expect((await read())?.summaryText).toBe('Old');
  });
  it('resumes bounded migration after interruption and database reopen', async () => {
    const db = await seedLegacy([
      summary('$zsummary'),
      ...Array.from({ length: 300 }, (_, i) => message('$reply' + i, 20 + i)),
    ]);
    const getAll = IDBObjectStore.prototype.getAll;
    let interrupted = false;
    const pages: { lower: unknown; limit: number | undefined }[] = [];
    const spy = vi
      .spyOn(IDBObjectStore.prototype, 'getAll')
      .mockImplementation(function observe(this: IDBObjectStore, query, limit) {
        const request = getAll.call(this, query, limit);
        if (this.name === EVENTS_STORE) {
          pages.push({ lower: (query as IDBKeyRange).lower, limit });
          if (!interrupted) {
            interrupted = true;
            this.transaction.addEventListener(
              'complete',
              () => revokeRoomCacheStoreWrites(session, room),
              { once: true }
            );
          }
        }
        return request;
      });
    expect(await read()).toBeUndefined();
    expect(pages).toHaveLength(1);
    db.close();
    resetCacheStoreForTesting();
    expect((await read())?.summaryText).toBe('Buried title');
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.every((page) => page.limit === 128)).toBe(true);
    expect(pages[1].lower).not.toBe(pages[0].lower);
    const pageCount = pages.length;
    await read();
    expect(pages).toHaveLength(pageCount);
    spy.mockRestore();
  });
  it('does not publish a stale mutation when clear revokes its active transaction', async () => {
    await save(summary('$summary'));
    const listener = vi.fn();
    const unsubscribe = subscribeCachedThreadSummaryChanges(session, room, listener);
    const put = IDBObjectStore.prototype.put;
    let clearing: Promise<number> | undefined;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function clearDuringPut(this: IDBObjectStore, value, key) {
        const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
        if (this.name === THREAD_SUMMARIES_STORE)
          request.addEventListener(
            'success',
            () => {
              clearing = clearRoomCachedContent(session, room);
            },
            { once: true }
          );
        return request;
      });
    await save(edit('$edit', '$summary', 100));
    await clearing;
    spy.mockRestore();
    expect(listener.mock.calls).toEqual([[{ type: 'clear' }]]);
    expect(await read()).toBeUndefined();
    unsubscribe();
  });

  it('revisits a projected thread changed before migration completion', async () => {
    await save(summary('$summary'));
    const db = (await openCacheStore(session))!;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put({
        metaKey: room + '|__summaryMigration',
        roomId: room,
        phase: 'project',
      });
      tx.oncomplete = () => resolve();
    });
    await deleteThreadEventsFromCache(session, room, root, ['$summary']);
    expect(await read()).toBeUndefined();
  });
  it('does not republish an unchanged structured summary', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCachedThreadSummaryChanges(session, room, listener);
    const raw = summary('$manual');
    raw.content!['io.mindroom.thread_summary'] = {
      version: 1,
      model: 'manual',
      generated_at: '2026-01-01T00:00:00Z',
      summary: 'Manual',
      message_count: 12,
    };
    await save(raw);
    await save(raw);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
  it('repairs legacy cross-page relation evidence before publishing a winner', async () => {
    await seedLegacy([
      summary('$a-summary', 10, 'Original'),
      ...Array.from({ length: 300 }, (_, i) => message('$middle' + i, 20 + i)),
      edit('$z-edit', '$a-summary', 400),
      {
        ...message('$zz-redaction', 500),
        type: 'm.room.redaction',
        redacts: '$z-edit',
        content: {},
      },
    ]);
    expect(await read()).toEqual({ summaryText: 'Original', eventTs: 10 });
  });
});
