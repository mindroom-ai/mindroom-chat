import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { IEvent, MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cache from './index';
import {
  openCacheStore,
  resetCacheStoreForTesting,
  revokeRoomCacheStoreWrites,
} from './cacheStoreDb';
import { registerEncryptedRoomCheck } from './cacheStoreEncryptedRooms';
import {
  EVENTS_STORE,
  META_STORE,
  THREAD_SUMMARIES_STORE,
  buildEncryptedThreadSummaryMetaKey,
  buildEventCacheKey,
  type CachedMetaRecord,
} from './cacheStoreSchema';

// Regression (P2-e2ee-F011): the offline cache keeps an encrypted room's events as ciphertext, but
// it kept the room's AI thread titles, read out of decrypted notices, in the clear.

vi.mock('./cacheStoreLegacyWipe', () => ({
  performLegacyDbWipe: vi.fn(async () => undefined),
}));

const SESSION_ID = 'encrypted-titles-session';
const SECURE = '!secure:example.org';
const PLAIN = '!plain:example.org';
const AGENT = '@helper_bot:example.org';
const TITLE = { summaryText: 'Quarterly budget review', generatedTs: 1, messageCount: 2 };

type ClearPayload = { type: string; content: Record<string, unknown> };

const readAll = async <T>(storeName: string): Promise<T[]> => {
  const db = (await openCacheStore(SESSION_ID))!;
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
};

const storedTitles = () => readAll<{ roomId: string; summaryText: string }>(THREAD_SUMMARIES_STORE);
const storedMeta = () => readAll<CachedMetaRecord>(META_STORE);

const encEvent = (
  eventId: string,
  ts: number,
  threadRootId?: string,
  extra?: Partial<IEvent>
): Partial<IEvent> => ({
  event_id: eventId,
  room_id: SECURE,
  sender: AGENT,
  type: 'm.room.encrypted',
  origin_server_ts: ts,
  content: {
    algorithm: 'm.megolm.v1.aes-sha2',
    ciphertext: `cipher:${eventId}`,
    ...(threadRootId ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadRootId } } : {}),
  },
  ...extra,
});

const summaryClear = (
  text: string,
  ts = 1000,
  extraContent?: Record<string, unknown>
): ClearPayload => ({
  type: 'm.room.message',
  content: {
    msgtype: 'm.notice',
    body: text,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: text,
      generated_at: new Date(ts).toISOString(),
    },
    ...extraContent,
  },
});

const makeDecryptor =
  (clearById: Map<string, ClearPayload | Error>, onDecrypt?: (event: MatrixEvent) => void) =>
  async (event: MatrixEvent) => {
    onDecrypt?.(event);
    const outcome = clearById.get(event.getId() ?? '');
    if (!outcome) return;
    await event.attemptDecryption({
      decryptEvent: async () => {
        if (outcome instanceof Error) throw outcome;
        return { clearEvent: outcome };
      },
    } as never);
  };

describe('thread titles of encrypted rooms in the offline cache', () => {
  let disposers: Array<() => void> = [];
  const register = (
    check: (roomId: string) => boolean,
    decrypt?: (event: MatrixEvent) => Promise<void>
  ) => {
    const dispose = registerEncryptedRoomCheck(SESSION_ID, check, decrypt);
    disposers.push(dispose);
    return dispose;
  };

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    disposers = [];
  });

  afterEach(() => {
    disposers.forEach((dispose) => dispose());
    resetCacheStoreForTesting();
  });

  it('keep the titles of an encrypted room off disk and delete what an older version kept', async () => {
    // An older version, which had no check, kept the title in the clear.
    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$old', TITLE);
    expect((await storedTitles()).map((record) => record.roomId)).toEqual([SECURE]);

    const forget = register((roomId) => roomId === SECURE);
    expect((await cache.loadCachedThreadSummaries(SESSION_ID, SECURE)).size).toBe(0);
    expect(await storedTitles()).toEqual([]);

    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$new', TITLE);
    await cache.saveCachedThreadSummary(SESSION_ID, PLAIN, '$plain', TITLE);
    expect((await storedTitles()).map((record) => record.roomId)).toEqual([PLAIN]);
    expect((await cache.loadCachedThreadSummaries(SESSION_ID, PLAIN)).get('$plain')).toMatchObject(
      TITLE
    );

    // Once the session's client is gone, nothing is known to be encrypted.
    forget();
    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$later', TITLE);
    expect((await storedTitles()).map((record) => record.roomId).sort()).toEqual([PLAIN, SECURE]);
  });

  it('round-trips pointers past 32 newer replies with no plaintext in meta or thread_summaries', async () => {
    const clearById = new Map<string, ClearPayload>([
      ['$sum-alpha', summaryClear('Lantern sprint notes', 1000)],
      [
        '$sum-inner',
        summaryClear('Harbor logistics plan', 1500, {
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root-inner' },
        }),
      ],
    ]);
    const staleDispose = register((roomId) => roomId === SECURE);
    register((roomId) => roomId === SECURE, makeDecryptor(clearById));
    staleDispose();

    const replies = Array.from({ length: 35 }, (_, i) =>
      encEvent(`$reply-${i}`, 2000 + i, '$root-alpha')
    );
    await cache.saveThreadEventsToCache(SESSION_ID, SECURE, '$root-alpha', [
      encEvent('$sum-alpha', 1000, '$root-alpha'),
      ...replies,
    ]);
    await cache.saveThreadEventsToCache(SESSION_ID, SECURE, '$root-inner', [
      encEvent('$sum-inner', 1500),
    ]);
    const tail = await cache.loadLatestCachedThreadEventsBatch(
      SESSION_ID,
      SECURE,
      ['$root-alpha'],
      32
    );
    expect(tail.get('$root-alpha')?.events.map((e) => e.event_id)).not.toContain('$sum-alpha');

    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$root-alpha', {
      summaryText: 'Lantern sprint notes',
      eventId: '$sum-alpha',
      eventTs: 1000,
    });
    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$root-inner', {
      summaryText: 'Harbor logistics plan',
      eventId: '$sum-inner',
    });

    expect(await storedTitles()).toEqual([]);
    const meta = await storedMeta();
    expect(meta.some((row) => row.summaryEventId === '$sum-alpha')).toBe(true);
    expect(JSON.stringify(meta)).not.toMatch(/Lantern|Harbor/);

    const loaded = await cache.loadCachedThreadSummaries(SESSION_ID, SECURE);
    expect(loaded.get('$root-alpha')).toMatchObject({
      summaryText: 'Lantern sprint notes',
      eventId: '$sum-alpha',
      eventTs: 1000,
    });
    expect(loaded.get('$root-inner')?.summaryText).toBe('Harbor logistics plan');
  });

  it('applies same-sender encrypted m.replace edits and ignores cross-sender, redacted, or unreadable edits', async () => {
    const editPayload = (targetId: string, text: string): ClearPayload => ({
      type: 'm.room.message',
      content: {
        msgtype: 'm.notice',
        body: `* ${text}`,
        'm.new_content': summaryClear(text, 2000).content,
        'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
      },
    });
    const clearById = new Map<string, ClearPayload | Error>([
      ['$sum-ed', summaryClear('Initial cedar draft')],
      ['$ed-ok', editPayload('$sum-ed', 'Final cedar itinerary')],
      ['$sum-x', summaryClear('Original maple title')],
      ['$ed-x', editPayload('$sum-x', 'Spoofed title')],
      ['$sum-red', summaryClear('Original birch title')],
      ['$sum-bad', summaryClear('Original willow title')],
      ['$ed-bad', new Error('missing key')],
    ]);
    const observedRooms = new Map<string, string | undefined>();
    register(
      (roomId) => roomId === SECURE,
      makeDecryptor(clearById, (e) => observedRooms.set(e.getId() ?? '', e.getRoomId()))
    );
    const withEdit = (id: string, sender = AGENT, redacted = false) => ({
      unsigned: {
        'm.relations': {
          'm.replace': {
            event_id: id,
            sender,
            type: 'm.room.encrypted',
            origin_server_ts: 2000,
            content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: `cipher:${id}` },
            ...(redacted ? { unsigned: { redacted_because: { event_id: '$red' } } } : {}),
          },
        },
      },
    });
    const cases: Array<[string, string, Partial<IEvent>]> = [
      ['$r-ed', '$sum-ed', withEdit('$ed-ok')],
      ['$r-x', '$sum-x', withEdit('$ed-x', '@other:example.org')],
      ['$r-red', '$sum-red', withEdit('$ed-red', AGENT, true)],
      ['$r-bad', '$sum-bad', withEdit('$ed-bad')],
    ];
    for (const [root, sumId, extra] of cases) {
      await cache.saveThreadEventsToCache(SESSION_ID, SECURE, root, [
        encEvent(sumId, 1000, root, extra),
      ]);
      await cache.saveCachedThreadSummary(SESSION_ID, SECURE, root, { eventId: sumId });
    }

    const loaded = await cache.loadCachedThreadSummaries(SESSION_ID, SECURE);
    expect(observedRooms.get('$ed-ok')).toBe(SECURE);
    expect(loaded.get('$r-ed')).toMatchObject({
      summaryText: 'Final cedar itinerary',
      eventTs: 2000,
      eventId: '$sum-ed',
    });
    expect(loaded.get('$r-x')?.summaryText).toBe('Original maple title');
    expect(loaded.get('$r-red')?.summaryText).toBe('Original birch title');
    expect(loaded.get('$r-bad')?.summaryText).toBe('Original willow title');
  });

  it('omits redacted notices and skips saving pointers for known-redacted event IDs', async () => {
    const clearById = new Map<string, ClearPayload>([
      ['$sum-live', summaryClear('Kept pine notes')],
      ['$sum-redacted', summaryClear('Redacted secret', 2000)],
      ['$sum-tomb', summaryClear('Tombstone secret', 2000)],
    ]);
    register((roomId) => roomId === SECURE, makeDecryptor(clearById));

    await cache.saveThreadEventsToCache(SESSION_ID, SECURE, '$r-live', [
      encEvent('$sum-live', 1000, '$r-live'),
    ]);
    await cache.saveThreadEventsToCache(SESSION_ID, SECURE, '$r-tomb', [
      encEvent('$sum-tomb', 2000, '$r-tomb', {
        unsigned: {
          redacted_because: {
            event_id: '$red-1',
            room_id: SECURE,
            sender: AGENT,
            type: 'm.room.redaction',
            origin_server_ts: 2500,
            content: {},
            unsigned: {},
          },
        },
      }),
    ]);
    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$r-live', { eventId: '$sum-live' });
    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$r-tomb', { eventId: '$sum-tomb' });
    await cache.saveRoomEventsToCache(SESSION_ID, SECURE, [
      {
        event_id: '$red-2',
        room_id: SECURE,
        sender: AGENT,
        type: 'm.room.redaction',
        origin_server_ts: 3000,
        redacts: '$sum-redacted',
        content: { redacts: '$sum-redacted' },
      },
    ]);
    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$r-live', {
      eventId: '$sum-redacted',
    });
    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$r-new-red', {
      eventId: '$sum-redacted',
    });

    const loaded = await cache.loadCachedThreadSummaries(SESSION_ID, SECURE);
    expect(loaded.get('$r-live')?.summaryText).toBe('Kept pine notes');
    expect(loaded.has('$r-tomb')).toBe(false);
    expect(
      (await storedMeta()).some(
        (row) => row.metaKey === buildEncryptedThreadSummaryMetaKey(SECURE, '$r-new-red')
      )
    ).toBe(false);
  });

  it('keeps pointers across missing rows or decryption failures and ignores ID-less or local-echo saves', async () => {
    const clearById = new Map<string, ClearPayload | Error>([
      ['$sum-locked', new Error('key pending')],
    ]);
    register((roomId) => roomId === SECURE, makeDecryptor(clearById));

    await cache.saveThreadEventsToCache(SESSION_ID, SECURE, '$r-locked', [
      encEvent('$sum-locked', 1000, '$r-locked'),
    ]);
    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$r-locked', {
      eventId: '$sum-locked',
    });
    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$r-missing', {
      eventId: '$sum-missing',
    });
    // ID-less and local-echo candidates must not overwrite existing pointers.
    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$r-locked', { summaryText: 'No ID' });
    await cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$r-locked', {
      summaryText: 'Local echo',
      eventId: '~local-1',
    });

    expect((await cache.loadCachedThreadSummaries(SESSION_ID, SECURE)).size).toBe(0);
    expect(
      (await storedMeta())
        .map((r) => r.summaryEventId)
        .filter(Boolean)
        .sort()
    ).toEqual(['$sum-locked', '$sum-missing']);

    clearById.set('$sum-locked', summaryClear('Unlocked juniper title'));
    clearById.set('$sum-missing', summaryClear('Synced spruce title', 1100));
    await cache.saveThreadEventsToCache(SESSION_ID, SECURE, '$r-missing', [
      encEvent('$sum-missing', 1100, '$r-missing'),
    ]);

    const loaded = await cache.loadCachedThreadSummaries(SESSION_ID, SECURE);
    expect(loaded.get('$r-locked')?.summaryText).toBe('Unlocked juniper title');
    expect(loaded.get('$r-missing')?.summaryText).toBe('Synced spruce title');
  });

  it('honors revoked write leases, rejects invalid targets, and clears pointers on whole-room eviction', async () => {
    const clearById = new Map<string, ClearPayload>([
      ['$sum-good', summaryClear('Aspen review notes')],
      ['$sum-xroom', summaryClear('Foreign room title')],
      ['$sum-wrong', summaryClear('Other thread title')],
      [
        '$msg-plain',
        {
          type: 'm.room.message',
          content: {
            msgtype: 'm.text',
            body: 'Regular reply',
            'm.relates_to': { rel_type: 'm.thread', event_id: '$r-plain' },
          },
        },
      ],
    ]);
    let releaseDecrypt: (() => void) | undefined;
    let holdNextDecrypt = false;
    const baseDecrypt = makeDecryptor(clearById);
    register(
      (roomId) => roomId === SECURE,
      async (event) => {
        if (holdNextDecrypt) {
          holdNextDecrypt = false;
          await new Promise<void>((resolve) => {
            releaseDecrypt = resolve;
          });
        }
        await baseDecrypt(event);
      }
    );

    const blocked = cache.saveCachedThreadSummary(SESSION_ID, SECURE, '$r-blocked', {
      eventId: '$sum-blocked',
    });
    revokeRoomCacheStoreWrites(SESSION_ID, SECURE);
    await blocked;
    expect(
      (await storedMeta()).some(
        (r) => r.metaKey === buildEncryptedThreadSummaryMetaKey(SECURE, '$r-blocked')
      )
    ).toBe(false);

    await cache.saveThreadEventsToCache(SESSION_ID, SECURE, '$r-good', [
      encEvent('$sum-good', 1000, '$r-good'),
    ]);
    await cache.saveThreadEventsToCache(SESSION_ID, SECURE, '$r-wrong', [
      encEvent('$sum-wrong', 1000, '$r-other'),
    ]);
    await cache.saveThreadEventsToCache(SESSION_ID, SECURE, '$r-plain', [
      encEvent('$msg-plain', 1000, '$r-plain'),
    ]);
    const db = (await openCacheStore(SESSION_ID))!;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(EVENTS_STORE, 'readwrite');
      tx.objectStore(EVENTS_STORE).put({
        cacheKey: buildEventCacheKey(SECURE, '$r-xroom', '$sum-xroom'),
        roomId: SECURE,
        scope: '$r-xroom',
        eventId: '$sum-xroom',
        ts: 1000,
        approxBytes: 100,
        rawEvent: encEvent('$sum-xroom', 1000, '$r-xroom', { room_id: '!other:example.org' }),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    for (const [root, id] of [
      ['$r-good', '$sum-good'],
      ['$r-xroom', '$sum-xroom'],
      ['$r-wrong', '$sum-wrong'],
      ['$r-plain', '$msg-plain'],
    ] as const) {
      await cache.saveCachedThreadSummary(SESSION_ID, SECURE, root, { eventId: id });
    }

    // Revoking lease mid-decryption discards in-flight load results.
    holdNextDecrypt = true;
    const pending = cache.loadCachedThreadSummaries(SESSION_ID, SECURE);
    await vi.waitFor(() => expect(releaseDecrypt).toBeDefined());
    revokeRoomCacheStoreWrites(SESSION_ID, SECURE);
    releaseDecrypt!();
    expect((await pending).size).toBe(0);

    // Without revocation, only the valid same-room, matching-thread summary survives.
    const loaded = await cache.loadCachedThreadSummaries(SESSION_ID, SECURE);
    expect([...loaded.keys()]).toEqual(['$r-good']);
    expect(loaded.get('$r-good')?.summaryText).toBe('Aspen review notes');

    // Whole-room eviction removes the pointer rows too.
    await cache.clearRoomCachedContent(SESSION_ID, SECURE);
    expect((await storedMeta()).some((r) => r.roomId === SECURE && r.summaryEventId)).toBe(false);
  });
});
