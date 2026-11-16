/**
 * A redaction's cache work follows what the redaction touches, not the
 * number of events the room holds: the rows read are counted through the
 * cursors' `continue` calls.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteThreadEventFromCacheByEventId,
  loadCachedRoomEvent,
  loadCachedThreadSummaries,
  loadLatestCachedThreadEvents,
  resetCacheStoreForTesting,
  saveCachedThreadSummary,
  saveRoomEventsToCache,
  saveThreadEventsToCache,
} from '..';
import { CacheStoreBlockedError, getCacheStoreDbName, openCacheStore } from '../cacheStoreDb';
import { EMBEDDED_EVENTS_STORE, EVENTS_STORE, META_STORE } from '../cacheStoreSchema';
import { putLegacyRows } from './legacyRows';

const SESSION_ID = 'redaction-cost-session';
const ROOM_ID = '!room:example.org';
const SENDER = '@alice:example.org';
const BYSTANDERS = 40;
/** The most rows one redaction reads by key in these tests: its own row and the rows it changes. */
const FEW = 4;

type Raw = Partial<IEvent>;

const message = (eventId: string, ts: number, unsigned?: Raw['unsigned']): Raw => ({
  event_id: eventId,
  origin_server_ts: ts,
  sender: SENDER,
  type: 'm.room.message',
  content: { body: eventId },
  ...(unsigned ? { unsigned } : {}),
});

const edit = (eventId: string, targetId: string, ts: number): Raw => ({
  ...message(eventId, ts),
  content: {
    body: `* ${eventId}`,
    'm.new_content': { body: eventId },
    'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
  },
});

/** `targetId` as the server sends it once it was edited: the edit bundled with it. */
const edited = (targetId: string, ts: number, editId: string): Raw =>
  message(targetId, ts, { 'm.relations': { 'm.replace': edit(editId, targetId, ts + 1) } });

/** A thread root with its summary: the latest reply, and MindRoom's previews beside it. */
const root = (rootId: string, latest: Raw, previews: Record<string, Raw> = {}): Raw =>
  message(rootId, 900, {
    'm.relations': {
      'm.thread': { count: 3, latest_event: latest, current_user_participated: false, ...previews },
    },
  });

const redaction = (targetId: string): Raw => ({
  event_id: `$redacts-${targetId}`,
  origin_server_ts: 9000,
  sender: SENDER,
  type: 'm.room.redaction',
  redacts: targetId,
  content: {},
});

const threadSummaryOf = (event: Raw | undefined): Record<string, unknown> | undefined =>
  (event?.unsigned?.['m.relations'] as Record<string, Record<string, unknown>> | undefined)?.[
    'm.thread'
  ];
const bundledEditOf = (event: Raw | undefined): unknown =>
  (event?.unsigned?.['m.relations'] as Record<string, unknown> | undefined)?.['m.replace'];

/** A room timeline and one thread, each holding rows no redaction below touches. */
const seedBystanders = async (): Promise<void> => {
  await saveRoomEventsToCache(
    SESSION_ID,
    ROOM_ID,
    Array.from({ length: BYSTANDERS }, (_, index) => message(`$room-${index}`, 1000 + index))
  );
  await saveThreadEventsToCache(
    SESSION_ID,
    ROOM_ID,
    '$busy',
    Array.from({ length: BYSTANDERS }, (_, index) => message(`$busy-${index}`, 2000 + index)),
    message('$busy', 900)
  );
};

/**
 * Saves the redaction of `targetId` and returns how many rows were read for it: the rows cursors
 * stepped over, and the event rows read by key (the redaction's own row among them).
 */
const redact = async (targetId: string, roomId = ROOM_ID): Promise<number> => {
  const continueSpy = vi.spyOn(IDBCursor.prototype, 'continue');
  let eventRowsRead = 0;
  const nativeGet = IDBObjectStore.prototype.get;
  const getSpy = vi
    .spyOn(IDBObjectStore.prototype, 'get')
    .mockImplementation(function get(this: IDBObjectStore, key) {
      if (this.name === EVENTS_STORE) eventRowsRead += 1;
      return nativeGet.call(this, key);
    });
  await saveRoomEventsToCache(SESSION_ID, roomId, [redaction(targetId)]);
  const rowsRead = continueSpy.mock.calls.length + eventRowsRead;
  continueSpy.mockRestore();
  getSpy.mockRestore();
  return rowsRead;
};

const embeddedKeys = async (): Promise<IDBValidKey[]> => {
  const db = await openCacheStore(SESSION_ID);
  const request = db!.transaction(EMBEDDED_EVENTS_STORE).objectStore(EMBEDDED_EVENTS_STORE);
  return new Promise((resolve, reject) => {
    const keys = request.getAllKeys();
    keys.onsuccess = () => resolve(keys.result);
    keys.onerror = () => reject(keys.error);
  });
};

const rootCopyOf = async (threadId: string): Promise<Raw | undefined> =>
  (await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, threadId, 10)).rootEvent;

describe('cache work of a redaction', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = new IDBFactory();
    resetCacheStoreForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetCacheStoreForTesting();
  });

  it('deleteThreadEventFromCacheByEventId reads only the copies of that event', async () => {
    await seedBystanders();
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [message('$reaction', 3000)]);
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, '$a', [message('$reaction', 3000)]);
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, '$b', [message('$reaction', 3000)]);

    const continueSpy = vi.spyOn(IDBCursor.prototype, 'continue');
    const scopes = await deleteThreadEventFromCacheByEventId(SESSION_ID, ROOM_ID, '$reaction');

    expect(scopes.sort()).toEqual(['$a', '$b']);
    // Three copies (the room's own stays), none of the 80 other rows.
    expect(continueSpy.mock.calls.length).toBeLessThanOrEqual(3);
    const busy = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, '$busy', 100);
    expect(busy.events).toHaveLength(BYSTANDERS);
  });

  it('drops a redacted edit from the message that bundles it, reading no other row', async () => {
    await seedBystanders();
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [edited('$target', 3000, '$edit')]);
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, '$t', [edited('$reply', 3100, '$edit-2')]);
    expect(bundledEditOf(await loadCachedRoomEvent(SESSION_ID, ROOM_ID, '$target'))).toBeDefined();

    expect(await redact('$edit')).toBeLessThanOrEqual(FEW);
    expect(await redact('$edit-2')).toBeLessThanOrEqual(FEW);

    const target = await loadCachedRoomEvent(SESSION_ID, ROOM_ID, '$target');
    expect(target?.event_id).toBe('$target');
    expect(bundledEditOf(target)).toBeUndefined();
    const thread = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, '$t', 10);
    expect(thread.events.map(bundledEditOf)).toEqual([undefined]);
    // The rows no longer embed the edits, so nothing lists them under those.
    expect((await embeddedKeys()).filter((key) => (key as string[])[0] === ROOM_ID)).toEqual([
      [ROOM_ID, '$busy', 1, `${ROOM_ID}|$busy`],
    ]);
  });

  it("drops a redacted reply from a root's summary, in the room's copy and the thread's", async () => {
    await seedBystanders();
    const threadRoot = root('$root', message('$latest', 3000));
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [threadRoot]);
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, '$root', [], threadRoot);

    expect(await redact('$latest')).toBeLessThanOrEqual(FEW);

    const roomCopy = await loadCachedRoomEvent(SESSION_ID, ROOM_ID, '$root');
    expect(threadSummaryOf(roomCopy)).toEqual({ count: 2, current_user_participated: false });
    expect(threadSummaryOf(await rootCopyOf('$root'))).toEqual({
      count: 2,
      current_user_participated: false,
    });
    // Neither copy embeds the reply now: the thread's is listed under its own ID only.
    expect((await embeddedKeys()).filter((key) => (key as string[])[1] !== '$busy')).toEqual([
      [ROOM_ID, '$root', 1, `${ROOM_ID}|$root`],
    ]);
  });

  it("drops a redacted preview, and a redacted edit of the latest reply, from a root's summary", async () => {
    await seedBystanders();
    const threadRoot = root('$root', edited('$latest', 3000, '$latest-edit'), {
      'io.mindroom.title': message('$title', 2900),
    });
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [threadRoot]);
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, '$root', [], threadRoot);

    expect(await redact('$title')).toBeLessThanOrEqual(FEW);
    expect(await redact('$latest-edit')).toBeLessThanOrEqual(FEW);

    for (const copy of [
      await loadCachedRoomEvent(SESSION_ID, ROOM_ID, '$root'),
      await rootCopyOf('$root'),
    ]) {
      const summary = threadSummaryOf(copy);
      expect(summary).not.toHaveProperty('io.mindroom.title');
      expect((summary?.latest_event as Raw).event_id).toBe('$latest');
      expect(bundledEditOf(summary?.latest_event as Raw)).toBeUndefined();
    }
  });

  it("drops a redacted root from its thread's own copy", async () => {
    await seedBystanders();
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      '$root',
      [message('$reply', 3000)],
      message('$root', 900)
    );
    expect((await rootCopyOf('$root'))?.event_id).toBe('$root');

    expect(await redact('$root')).toBeLessThanOrEqual(FEW);

    expect(await rootCopyOf('$root')).toBeUndefined();
  });

  it('deletes the summary made from a redacted notice, and no other', async () => {
    await seedBystanders();
    await saveCachedThreadSummary(SESSION_ID, ROOM_ID, '$a', { summaryText: 'A', eventId: '$n-a' });
    await saveCachedThreadSummary(SESSION_ID, ROOM_ID, '$b', { summaryText: 'B', eventId: '$n-b' });

    expect(await redact('$n-a')).toBeLessThanOrEqual(FEW);

    const summaries = await loadCachedThreadSummaries(SESSION_ID, ROOM_ID);
    expect([...summaries.keys()]).toEqual(['$b']);
  });

  it('lists a row under the events it embeds now, not those it embedded', async () => {
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [edited('$target', 3000, '$edit-1')]);
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      { ...edited('$target', 3000, '$edit-2'), origin_server_ts: 3000 },
    ]);
    const threadRoot = root('$root', message('$latest-1', 3000));
    await saveThreadEventsToCache(SESSION_ID, ROOM_ID, '$root', [], threadRoot);
    await saveThreadEventsToCache(
      SESSION_ID,
      ROOM_ID,
      '$root',
      [],
      root('$root', message('$latest-2', 3100)),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'authoritative'
    );

    const replacement = bundledEditOf(await loadCachedRoomEvent(SESSION_ID, ROOM_ID, '$target'));
    const listed = (await embeddedKeys()).map((key) => (key as string[])[1]).sort();
    expect(listed).toEqual(
      [
        (replacement as Raw).event_id,
        '$root',
        (threadSummaryOf(await rootCopyOf('$root'))?.latest_event as Raw).event_id,
      ].sort()
    );
  });

  it("merges a tombstone into its event's copies after an earlier save marked the event", async () => {
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [redaction('$gone')]);
    await putLegacyRows(SESSION_ID, ROOM_ID, {
      events: [{ scope: '$t', rawEvent: message('$gone', 3000) }],
    });

    const tombstone: Raw = {
      ...message('$gone', 3000),
      content: {},
      unsigned: { redacted_because: redaction('$gone') as IEvent },
    };
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [tombstone, redaction('$other')]);

    const thread = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, '$t', 10);
    expect(thread.events.map((event) => !!event.unsigned?.redacted_because)).toEqual([true]);
  });
});

/** The stores and indexes of schema v6, with the rows a v6 build left in them. */
const seedVersionSixDatabase = async (
  rows: { roomId: string; scope: string; rawEvent: Raw }[],
  roots: { roomId: string; rootEvent: Raw }[]
): Promise<void> => {
  const request = indexedDB.open(getCacheStoreDbName(SESSION_ID), 6);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('attachments', { keyPath: 'mxcUri' }).createIndex('by_access_bytes', [
      'lastAccessedAt',
      'byteLength',
    ]);
    const references = db.createObjectStore('attachment_references', { keyPath: 'referenceKey' });
    references.createIndex('by_room', 'roomId');
    references.createIndex('by_attachment', 'mxcUri');
    references.createIndex('by_owner', ['roomId', 'eventId']);
    const events = db.createObjectStore(EVENTS_STORE, { keyPath: 'cacheKey' });
    events.createIndex('by_scope_ts', ['roomId', 'scope', 'ts', 'eventId']);
    events.createIndex('by_room_event', ['roomId', 'eventId']);
    const meta = db.createObjectStore(META_STORE, { keyPath: 'metaKey' });
    db.createObjectStore('room_ledger', { keyPath: 'roomId' });
    const summaries = db.createObjectStore('thread_summaries', { keyPath: 'cacheKey' });
    summaries.createIndex('by_room', 'roomId');
    rows.forEach(({ roomId, scope, rawEvent }) =>
      events.put({
        cacheKey: `${roomId}|${scope}|${rawEvent.event_id}`,
        roomId,
        scope,
        eventId: rawEvent.event_id,
        ts: rawEvent.origin_server_ts,
        rawEvent,
        approxBytes: JSON.stringify(rawEvent).length,
      })
    );
    roots.forEach(({ roomId, rootEvent }) =>
      meta.put({
        metaKey: `${roomId}|${rootEvent.event_id}`,
        roomId,
        scope: rootEvent.event_id,
        rootEvent,
        updatedAt: 1,
      })
    );
    summaries.put({
      cacheKey: `${ROOM_ID}|$old-root`,
      roomId: ROOM_ID,
      threadRootId: '$old-root',
      summaryText: 'Old',
      eventId: '$old-notice',
      updatedAt: 1,
    });
  };
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
};

describe('a cache an earlier schema wrote (v6)', () => {
  const OTHER_ROOM_ID = '!other:example.org';

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).indexedDB = new IDBFactory();
    resetCacheStoreForTesting();
    const oldRoot = root('$old-root', message('$old-latest', 3000));
    await seedVersionSixDatabase(
      [
        ...Array.from({ length: BYSTANDERS }, (_, index) => ({
          roomId: ROOM_ID,
          scope: '',
          rawEvent: message(`$old-${index}`, 1000 + index),
        })),
        { roomId: ROOM_ID, scope: '', rawEvent: edited('$old-target', 3000, '$old-edit') },
        { roomId: ROOM_ID, scope: '$t', rawEvent: edited('$old-reply', 3100, '$old-edit-2') },
        { roomId: ROOM_ID, scope: '', rawEvent: oldRoot },
        { roomId: OTHER_ROOM_ID, scope: '', rawEvent: edited('$far-target', 3000, '$far-edit') },
      ],
      [{ roomId: ROOM_ID, rootEvent: oldRoot }]
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetCacheStoreForTesting();
  });

  it('opens with every row readable', async () => {
    const db = await openCacheStore(SESSION_ID);

    expect(db?.version).toBe(7);
    const target = await loadCachedRoomEvent(SESSION_ID, ROOM_ID, '$old-target');
    expect((bundledEditOf(target) as Raw).event_id).toBe('$old-edit');
    expect((await rootCopyOf('$old-root'))?.event_id).toBe('$old-root');
    expect([...(await loadCachedThreadSummaries(SESSION_ID, ROOM_ID)).keys()]).toEqual([
      '$old-root',
    ]);
  });

  it("finds the rows of a room's first redaction by reading the room, and the next by key", async () => {
    expect(await redact('$old-edit')).toBeGreaterThan(BYSTANDERS);
    const target = await loadCachedRoomEvent(SESSION_ID, ROOM_ID, '$old-target');
    expect(target?.event_id).toBe('$old-target');
    expect(bundledEditOf(target)).toBeUndefined();

    // The room's rows are listed now: its later redactions read only their own rows.
    expect(await redact('$old-edit-2')).toBeLessThanOrEqual(FEW);
    expect(await redact('$old-latest')).toBeLessThanOrEqual(FEW);
    const thread = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, '$t', 10);
    expect(thread.events.map(bundledEditOf)).toEqual([undefined]);
    expect(threadSummaryOf(thread.rootEvent)).toBeUndefined();
    const roomCopy = await loadCachedRoomEvent(SESSION_ID, ROOM_ID, '$old-root');
    expect(threadSummaryOf(roomCopy)).not.toHaveProperty('latest_event');
    expect(threadSummaryOf(await rootCopyOf('$old-root'))).not.toHaveProperty('latest_event');

    // Another room of the same cache is still unlisted, and is read on its own first redaction.
    await redact('$far-edit', OTHER_ROOM_ID);
    expect(
      bundledEditOf(await loadCachedRoomEvent(SESSION_ID, OTHER_ROOM_ID, '$far-target'))
    ).toBeUndefined();
  });

  it('reads a room once: not again after a reload', async () => {
    expect(await redact('$old-edit')).toBeGreaterThan(BYSTANDERS);

    // A reload: the page's connection and memory are gone, the database stays.
    (await openCacheStore(SESSION_ID))!.close();
    resetCacheStoreForTesting();

    expect(await redact('$old-edit-2')).toBeLessThanOrEqual(FEW);
    const thread = await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, '$t', 10);
    expect(thread.events.map(bundledEditOf)).toEqual([undefined]);
  });

  it('finds a row saved after the upgrade, before and after the room is read', async () => {
    // Saved while the room's old rows are still unlisted: one new row, one old row saved again.
    await saveRoomEventsToCache(SESSION_ID, ROOM_ID, [
      edited('$new-target', 4000, '$new-edit'),
      edited('$old-target', 3000, '$old-edit'),
      edited('$newer-target', 4100, '$newer-edit'),
    ]);

    // The room's first redaction reads the room, the new rows with it.
    expect(await redact('$new-edit')).toBeGreaterThan(BYSTANDERS);
    expect(
      bundledEditOf(await loadCachedRoomEvent(SESSION_ID, ROOM_ID, '$new-target'))
    ).toBeUndefined();

    // Later ones find by key what was saved before the room was read.
    expect(await redact('$newer-edit')).toBeLessThanOrEqual(FEW);
    expect(await redact('$old-edit')).toBeLessThanOrEqual(FEW);
    for (const targetId of ['$newer-target', '$old-target']) {
      const target = await loadCachedRoomEvent(SESSION_ID, ROOM_ID, targetId);
      expect(target?.event_id).toBe(targetId);
      expect(bundledEditOf(target)).toBeUndefined();
    }
  });

  it('upgrades while a tab of the earlier build is open, which gives way', async () => {
    // The v6 build's connection: it closes when another tab asks for a newer version.
    const oldTab = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(getCacheStoreDbName(SESSION_ID), 6);
      request.onsuccess = () => resolve(request.result);
    });
    oldTab.onversionchange = () => oldTab.close();

    expect((await openCacheStore(SESSION_ID))?.version).toBe(7);
    expect(await redact('$old-edit')).toBeGreaterThan(BYSTANDERS);
  });

  it('reports a blocked open while an earlier tab holds on, and opens once it lets go', async () => {
    const oldTab = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(getCacheStoreDbName(SESSION_ID), 6);
      request.onsuccess = () => resolve(request.result);
    });

    await expect(openCacheStore(SESSION_ID)).rejects.toBeInstanceOf(CacheStoreBlockedError);
    // The old tab's rows are untouched, and it can still read them.
    expect(oldTab.version).toBe(6);

    oldTab.close();
    expect((await openCacheStore(SESSION_ID))?.version).toBe(7);
    const target = await loadCachedRoomEvent(SESSION_ID, ROOM_ID, '$old-target');
    expect((bundledEditOf(target) as Raw).event_id).toBe('$old-edit');
  });

  it('deletes the summary an earlier schema saved from a notice redacted now', async () => {
    await redact('$old-notice');

    expect((await loadCachedThreadSummaries(SESSION_ID, ROOM_ID)).size).toBe(0);
  });
});
