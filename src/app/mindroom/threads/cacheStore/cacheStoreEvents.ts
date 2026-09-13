import type { IEvent } from 'matrix-js-sdk';
import { countCacheProbe } from '../cacheProbe';
import { isCacheWritable, reportCacheWriteError } from '../cacheHealth';
import {
  getCachedPaginationToken,
  mergeCachedPaginationTokens,
} from '../eventCacheTokenUtils';
import { maybeScheduleEvictionCheck } from './cacheEviction';
import { openCacheStore } from './cacheStoreDb';
import { createLedgerTracker } from './cacheStoreLedger';
import {
  EVENTS_BY_SCOPE_TS_INDEX,
  EVENTS_STORE,
  MAX_EVENT_ID,
  MAX_EVENT_TS,
  META_STORE,
  ROOM_LEDGER_STORE,
  ROOM_SCOPE,
  buildEventCacheKey,
  buildMetaKey,
  estimateRawEventBytes,
  type CachedEventRecord,
  type CachedMetaRecord,
} from './cacheStoreSchema';
import {
  filterPageableCachedThreadEvents,
  isRawLocalEchoEventPublic,
  mergeThreadCacheFlag,
  normalizeCachedRoomEvents,
  normalizeCachedThreadEvents,
  normalizeExpectedReplyCount,
  type CachedRoomEvent,
  type CachedThreadEvent,
  type CursorAnchor,
} from './cacheStoreNormalize';

// CINNY-207 P2.1: single-DB event storage. One scoped-cursor core drives
// both room-timeline and thread reads/writes; scope='' addresses the
// room-timeline slice, scope=threadId addresses a thread's slice. The
// legacy per-domain behaviors (skip local-echo in the room cursor; skip
// the root record in the thread cursor) are preserved.

const isRawLocalEchoEventId = (eventId: unknown): boolean =>
  typeof eventId === 'string' && eventId.startsWith('~');

export type CachedRoomEventPage = {
  events: CachedRoomEvent[];
  hasMoreBefore: boolean;
  beforeToken?: string | null;
};

export type CachedThreadEventPage = {
  rootEvent?: Partial<IEvent>;
  events: CachedThreadEvent[];
  hasMoreBefore: boolean;
  beforeToken?: string | null;
  expectedReplyCount?: number;
  snapshotComplete?: boolean;
  relationSnapshotComplete?: boolean;
  tailLoaded?: boolean;
};

const toRawEventInternal = (
  raw: Partial<IEvent> | undefined
): (Partial<IEvent> & { event_id: string; origin_server_ts: number }) | undefined => {
  if (!raw || typeof raw.event_id !== 'string' || raw.event_id.length === 0) return undefined;
  return {
    ...raw,
    event_id: raw.event_id,
    origin_server_ts:
      typeof raw.origin_server_ts === 'number' && Number.isFinite(raw.origin_server_ts)
        ? raw.origin_server_ts
        : 0,
  };
};

type ScopedCursorOptions = {
  sessionId: string;
  roomId: string;
  scope: string;
  limit: number;
  upperBound?: CursorAnchor;
  shouldSkip: (record: CachedEventRecord, rawEvent: Partial<IEvent>) => boolean;
};

type ScopedCursorResult = {
  events: (Partial<IEvent> & { event_id: string; origin_server_ts: number })[];
  hasMoreBefore: boolean;
  meta: CachedMetaRecord | undefined;
};

const runScopedCursor = async (
  options: ScopedCursorOptions
): Promise<ScopedCursorResult> => {
  const db = await openCacheStore(options.sessionId);
  if (!db || options.limit <= 0) {
    return { events: [], hasMoreBefore: false, meta: undefined };
  }

  return new Promise<ScopedCursorResult>((resolve, reject) => {
    const transaction = db.transaction([EVENTS_STORE, META_STORE], 'readonly');
    const eventStore = transaction.objectStore(EVENTS_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const index = eventStore.index(EVENTS_BY_SCOPE_TS_INDEX);

    const lower = [options.roomId, options.scope, 0, ''];
    const upper = options.upperBound
      ? [options.roomId, options.scope, options.upperBound.ts, options.upperBound.eventId]
      : [options.roomId, options.scope, MAX_EVENT_TS, MAX_EVENT_ID];
    const range = IDBKeyRange.bound(lower, upper, false, !!options.upperBound);

    const metaRequest = metaStore.get(buildMetaKey(options.roomId, options.scope));

    const events: (Partial<IEvent> & { event_id: string; origin_server_ts: number })[] = [];
    let hasMoreBefore = false;

    const cursorRequest = index.openCursor(range, 'prev');
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;

      const record = cursor.value as CachedEventRecord;
      const normalized = toRawEventInternal(record.rawEvent);
      if (!normalized) {
        cursor.continue();
        return;
      }
      if (options.shouldSkip(record, normalized)) {
        cursor.continue();
        return;
      }

      if (events.length < options.limit) {
        events.push(normalized);
        cursor.continue();
        return;
      }

      hasMoreBefore = true;
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);

    transaction.oncomplete = () =>
      resolve({
        events,
        hasMoreBefore,
        meta: metaRequest.result as CachedMetaRecord | undefined,
      });
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

// --- Room API ---

export const loadLatestCachedRoomEvents = async (
  sessionId: string,
  roomId: string,
  limit: number
): Promise<CachedRoomEventPage> => {
  const { events, hasMoreBefore, meta } = await runScopedCursor({
    sessionId,
    roomId,
    scope: ROOM_SCOPE,
    limit,
    shouldSkip: (_record, rawEvent) => isRawLocalEchoEventId(rawEvent.event_id),
  });
  const orderedEvents = events.reverse() as CachedRoomEvent[];
  return {
    events: orderedEvents,
    hasMoreBefore,
    beforeToken: getCachedPaginationToken(meta?.beforeTokens, orderedEvents[0]?.event_id),
  };
};

export const loadCachedRoomEventsBefore = async (
  sessionId: string,
  roomId: string,
  before: CursorAnchor | undefined,
  limit: number
): Promise<CachedRoomEventPage> => {
  if (!before) return { events: [], hasMoreBefore: false };
  const { events, hasMoreBefore, meta } = await runScopedCursor({
    sessionId,
    roomId,
    scope: ROOM_SCOPE,
    limit,
    upperBound: before,
    shouldSkip: (_record, rawEvent) => isRawLocalEchoEventId(rawEvent.event_id),
  });
  const orderedEvents = events.reverse() as CachedRoomEvent[];
  return {
    events: orderedEvents,
    hasMoreBefore,
    beforeToken: getCachedPaginationToken(meta?.beforeTokens, orderedEvents[0]?.event_id),
  };
};

export const loadCachedRoomPaginationToken = async (
  sessionId: string,
  roomId: string,
  eventId: string | undefined
): Promise<string | null | undefined> => {
  if (!eventId) return undefined;
  const db = await openCacheStore(sessionId);
  if (!db) return undefined;

  return new Promise<string | null | undefined>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readonly');
    const metaStore = transaction.objectStore(META_STORE);
    const metaRequest = metaStore.get(buildMetaKey(roomId, ROOM_SCOPE));

    transaction.oncomplete = () => {
      const meta = metaRequest.result as CachedMetaRecord | undefined;
      resolve(getCachedPaginationToken(meta?.beforeTokens, eventId));
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    metaRequest.onerror = () => reject(metaRequest.error);
  });
};

export const loadCachedRoomEvent = async (
  sessionId: string,
  roomId: string,
  eventId: string
): Promise<CachedRoomEvent | undefined> => {
  if (isRawLocalEchoEventId(eventId)) return undefined;
  const db = await openCacheStore(sessionId);
  if (!db) return undefined;

  return new Promise<CachedRoomEvent | undefined>((resolve, reject) => {
    const transaction = db.transaction(EVENTS_STORE, 'readonly');
    const eventStore = transaction.objectStore(EVENTS_STORE);
    const eventRequest = eventStore.get(buildEventCacheKey(roomId, ROOM_SCOPE, eventId));

    transaction.oncomplete = () => {
      const record = eventRequest.result as CachedEventRecord | undefined;
      const normalized = record ? toRawEventInternal(record.rawEvent) : undefined;
      if (!normalized) {
        resolve(undefined);
        return;
      }
      if (isRawLocalEchoEventId(normalized.event_id)) {
        resolve(undefined);
        return;
      }
      resolve(normalized as CachedRoomEvent);
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    eventRequest.onerror = () => reject(eventRequest.error);
  });
};

export const saveRoomEventsToCache = async (
  sessionId: string,
  roomId: string,
  rawEvents: Partial<IEvent>[],
  beforeTokenForEarliest?: string | null
): Promise<void> => {
  // CINNY-207 P2.3: cache health gate lives at the single write choke
  // point. After a quota failure the session is cache-read-only —
  // skip further writes silently. Deletes stay ungated (they only
  // shrink storage). The eventRepository seam no longer wraps this
  // call in its own gate/catch.
  if (!isCacheWritable()) return;

  // CINNY-207 P2 review: the entire body (including the openCacheStore
  // await) must live inside the error-reporting boundary. Callers
  // invoke us via `void save(...)` — a rejected open here would escape
  // as an unhandled rejection and never trip the health gate.
  try {
    const db = await openCacheStore(sessionId);
    if (!db) return;

    const normalizedEvents = normalizeCachedRoomEvents(rawEvents);
    if (normalizedEvents.length === 0) return;

    countCacheProbe('roomSaveCalls');
    countCacheProbe('roomEventPuts', normalizedEvents.length);
    if (beforeTokenForEarliest !== undefined) {
      countCacheProbe('roomMetaPuts');
    }

    await runSaveRoomEventsTxn(db, roomId, normalizedEvents, beforeTokenForEarliest);
  } catch (error) {
    reportCacheWriteError('roomEventCache.save', error);
    return;
  }

  // CINNY-207 P2.2 commit 3: cheap over-budget probe after saves.
  // Fire-and-forget, module-level debounced.
  maybeScheduleEvictionCheck(sessionId);
};

const runSaveRoomEventsTxn = async (
  db: IDBDatabase,
  roomId: string,
  normalizedEvents: CachedRoomEvent[],
  beforeTokenForEarliest: string | null | undefined
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(
      [EVENTS_STORE, META_STORE, ROOM_LEDGER_STORE],
      'readwrite'
    );
    const eventStore = transaction.objectStore(EVENTS_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const ledgerStore = transaction.objectStore(ROOM_LEDGER_STORE);
    const earliestEventId = normalizedEvents[0]?.event_id;
    const ledger = createLedgerTracker(roomId);

    // Capture the ledger baseline (existing row or bootstrap sum-scan)
    // BEFORE any event puts land — the sum-scan must reflect the
    // pre-write state to avoid double-counting the current puts.
    ledger.readBaseline(ledgerStore, eventStore, () => {
      let pendingPuts = normalizedEvents.length;
      const maybeFinalizeLedger = (): void => {
        pendingPuts -= 1;
        if (pendingPuts === 0) {
          ledger.finalize(ledgerStore);
        }
      };
      normalizedEvents.forEach((rawEvent) => {
        const cacheKey = buildEventCacheKey(roomId, ROOM_SCOPE, rawEvent.event_id);
        const eventRecord: CachedEventRecord = {
          cacheKey,
          roomId,
          scope: ROOM_SCOPE,
          eventId: rawEvent.event_id,
          ts: rawEvent.origin_server_ts,
          rawEvent,
          approxBytes: estimateRawEventBytes(rawEvent),
        };
        const previousRequest = eventStore.get(cacheKey);
        previousRequest.onsuccess = () => {
          const previous = previousRequest.result as CachedEventRecord | undefined;
          ledger.notePut(eventRecord, previous);
          eventStore.put(eventRecord);
          maybeFinalizeLedger();
        };
        previousRequest.onerror = () => reject(previousRequest.error);
      });
    });

    // Legacy-faithful asymmetry: room meta is written ONLY when a token
    // was supplied. Thread meta is written unconditionally (see below).
    if (beforeTokenForEarliest !== undefined && earliestEventId) {
      const metaKey = buildMetaKey(roomId, ROOM_SCOPE);
      const metaRequest = metaStore.get(metaKey);
      metaRequest.onsuccess = () => {
        const currentMeta = metaRequest.result as CachedMetaRecord | undefined;
        const nextMeta: CachedMetaRecord = {
          metaKey,
          roomId,
          scope: ROOM_SCOPE,
          beforeTokens: mergeCachedPaginationTokens(
            currentMeta?.beforeTokens,
            earliestEventId,
            beforeTokenForEarliest
          ),
          rootEvent: currentMeta?.rootEvent,
          expectedReplyCount: currentMeta?.expectedReplyCount,
          snapshotComplete: currentMeta?.snapshotComplete,
          relationSnapshotComplete: currentMeta?.relationSnapshotComplete,
          tailLoaded: currentMeta?.tailLoaded,
          updatedAt: Date.now(),
          lastOpenedTs: currentMeta?.lastOpenedTs,
          // CINNY-207 P5 review (greptile P1: gap marker clears early):
          // preserve the durable `tailDiscontinuity` marker across meta
          // writes. Every persisted batch during a gap-fill run calls
          // through here with a `beforeTokenForEarliest` token, which
          // used to silently strip the marker on the FIRST batch —
          // long before the gap was actually closed. Callers that
          // want to clear the marker (`clearRoomTailDiscontinuity`)
          // do so through the dedicated helper, which is now the only
          // path that removes the field.
          tailDiscontinuity: currentMeta?.tailDiscontinuity,
        };
        metaStore.put(nextMeta);
      };
      metaRequest.onerror = () => reject(metaRequest.error);
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

export const deleteRoomEventsFromCache = async (
  sessionId: string,
  roomId: string,
  eventIds: string[]
): Promise<void> => {
  if (eventIds.length === 0) return;
  // CINNY-207 P2 review: duplicate event ids would double-decrement the
  // ledger (bytes underflow via `noteDelete`) because the deletion
  // schedules read+delete once per id. Dedupe at the entry point so
  // the ledger accounting stays exact regardless of the caller.
  const uniqueEventIds = Array.from(new Set(eventIds));

  // CINNY-207 P2 review: deletes stay UNGATED (they only shrink
  // storage) but must not produce unhandled rejections. Callers use
  // `void del(...)` in redaction paths; swallow any open/txn failure
  // rather than escaping. No `reportCacheWriteError` — deletes
  // failing does not indicate a full-store condition.
  try {
    const db = await openCacheStore(sessionId);
    if (!db) return;

    countCacheProbe('eventDeletes', uniqueEventIds.length);

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        [EVENTS_STORE, ROOM_LEDGER_STORE],
        'readwrite'
      );
      const eventStore = transaction.objectStore(EVENTS_STORE);
      const ledgerStore = transaction.objectStore(ROOM_LEDGER_STORE);
      const ledger = createLedgerTracker(roomId);
      ledger.readBaseline(ledgerStore, eventStore, () => {
        let pendingReads = uniqueEventIds.length;
        const maybeFinalizeLedger = (): void => {
          pendingReads -= 1;
          if (pendingReads === 0) ledger.finalize(ledgerStore);
        };
        uniqueEventIds.forEach((eventId) => {
          const cacheKey = buildEventCacheKey(roomId, ROOM_SCOPE, eventId);
          // Read-before-delete so the ledger decrements exactly (only if
          // the record actually existed).
          const previousRequest = eventStore.get(cacheKey);
          previousRequest.onsuccess = () => {
            const previous = previousRequest.result as CachedEventRecord | undefined;
            ledger.noteDelete(previous);
            eventStore.delete(cacheKey);
            maybeFinalizeLedger();
          };
          previousRequest.onerror = () => reject(previousRequest.error);
        });
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    // Best-effort — see rationale above. Callers do not consume errors.
  }
};

// --- Thread API ---

export const loadLatestCachedThreadEvents = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  limit: number
): Promise<CachedThreadEventPage> => {
  const { events, hasMoreBefore, meta } = await runScopedCursor({
    sessionId,
    roomId,
    scope: threadId,
    limit,
    shouldSkip: (record) => record.eventId === threadId,
  });
  const orderedEvents = events.reverse() as CachedThreadEvent[];
  return {
    rootEvent: meta?.rootEvent,
    events: orderedEvents,
    hasMoreBefore,
    beforeToken: getCachedPaginationToken(meta?.beforeTokens, orderedEvents[0]?.event_id),
    expectedReplyCount: normalizeExpectedReplyCount(meta?.expectedReplyCount),
    snapshotComplete: meta?.snapshotComplete === true,
    relationSnapshotComplete: meta?.relationSnapshotComplete === true,
    tailLoaded: meta?.tailLoaded === true,
  };
};

export const loadCachedThreadEventsBefore = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  before: CursorAnchor | undefined,
  limit: number
): Promise<CachedThreadEventPage> => {
  if (!before) return { events: [], hasMoreBefore: false };
  const { events, hasMoreBefore, meta } = await runScopedCursor({
    sessionId,
    roomId,
    scope: threadId,
    limit,
    upperBound: before,
    shouldSkip: (record) => record.eventId === threadId,
  });
  const orderedEvents = events.reverse() as CachedThreadEvent[];
  return {
    rootEvent: meta?.rootEvent,
    events: orderedEvents,
    hasMoreBefore,
    beforeToken: getCachedPaginationToken(meta?.beforeTokens, orderedEvents[0]?.event_id),
    expectedReplyCount: normalizeExpectedReplyCount(meta?.expectedReplyCount),
    snapshotComplete: meta?.snapshotComplete === true,
    relationSnapshotComplete: meta?.relationSnapshotComplete === true,
    tailLoaded: meta?.tailLoaded === true,
  };
};

export const loadCachedThreadPaginationToken = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  eventId: string
): Promise<string | null | undefined> => {
  const db = await openCacheStore(sessionId);
  if (!db) return undefined;

  return new Promise<string | null | undefined>((resolve, reject) => {
    const transaction = db.transaction([META_STORE], 'readonly');
    const metaStore = transaction.objectStore(META_STORE);
    const metaRequest = metaStore.get(buildMetaKey(roomId, threadId));

    transaction.oncomplete = () => {
      const meta = metaRequest.result as CachedMetaRecord | undefined;
      resolve(getCachedPaginationToken(meta?.beforeTokens, eventId));
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const loadCachedThreadEvent = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  eventId: string
): Promise<CachedThreadEvent | undefined> => {
  const db = await openCacheStore(sessionId);
  if (!db) return undefined;

  return new Promise<CachedThreadEvent | undefined>((resolve, reject) => {
    const transaction = db.transaction([EVENTS_STORE, META_STORE], 'readonly');
    const eventStore = transaction.objectStore(EVENTS_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const eventRequest = eventStore.get(buildEventCacheKey(roomId, threadId, eventId));
    const metaRequest = eventId === threadId ? metaStore.get(buildMetaKey(roomId, threadId)) : undefined;

    transaction.oncomplete = () => {
      const record = eventRequest.result as CachedEventRecord | undefined;
      if (record) {
        resolve(toRawEventInternal(record.rawEvent) as CachedThreadEvent | undefined);
        return;
      }
      if (!metaRequest) {
        resolve(undefined);
        return;
      }
      const meta = metaRequest.result as CachedMetaRecord | undefined;
      resolve(meta?.rootEvent ? (toRawEventInternal(meta.rootEvent) as CachedThreadEvent | undefined) : undefined);
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    eventRequest.onerror = () => reject(eventRequest.error);
    metaRequest?.addEventListener('error', () => reject(metaRequest.error));
  });
};

export const saveThreadEventsToCache = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  rawEvents: Partial<IEvent>[],
  rootEvent?: Partial<IEvent>,
  beforeTokenForEarliest?: string | null,
  tailLoaded?: boolean,
  snapshotComplete?: boolean,
  expectedReplyCount?: number,
  relationSnapshotComplete?: boolean
): Promise<void> => {
  // CINNY-207 P2.3: cache health gate (same rationale as the room save).
  if (!isCacheWritable()) return;

  // CINNY-207 P2 review: keep the open inside the error boundary — see
  // saveRoomEventsToCache for the rationale (callers use `void save`).
  try {
    const db = await openCacheStore(sessionId);
    if (!db) return;

    const normalizedEvents = filterPageableCachedThreadEvents(
      normalizeCachedThreadEvents(rawEvents),
      threadId
    );
    if (normalizedEvents.length === 0 && !rootEvent) return;

    countCacheProbe('threadSaveCalls');
    countCacheProbe('threadEventPuts', normalizedEvents.length);
    countCacheProbe('threadMetaPuts');

    await runSaveThreadEventsTxn(
      db,
      roomId,
      threadId,
      normalizedEvents,
      rootEvent,
      beforeTokenForEarliest,
      tailLoaded,
      snapshotComplete,
      expectedReplyCount,
      relationSnapshotComplete
    );
  } catch (error) {
    reportCacheWriteError('threadEventCache.save', error);
    return;
  }

  // CINNY-207 P2.2 commit 3: same debounced over-budget probe.
  maybeScheduleEvictionCheck(sessionId);
};

const runSaveThreadEventsTxn = async (
  db: IDBDatabase,
  roomId: string,
  threadId: string,
  normalizedEvents: CachedThreadEvent[],
  rootEvent: Partial<IEvent> | undefined,
  beforeTokenForEarliest: string | null | undefined,
  tailLoaded: boolean | undefined,
  snapshotComplete: boolean | undefined,
  expectedReplyCount: number | undefined,
  relationSnapshotComplete: boolean | undefined
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    // Only include ROOM_LEDGER_STORE in the txn when we actually have
    // event puts — a rootEvent-only meta-only save leaves the ledger
    // untouched (per plan: "ledger untouched by meta-only writes").
    const hasEventPuts = normalizedEvents.length > 0;
    const transaction = db.transaction(
      hasEventPuts
        ? [EVENTS_STORE, META_STORE, ROOM_LEDGER_STORE]
        : [EVENTS_STORE, META_STORE],
      'readwrite'
    );
    const eventStore = transaction.objectStore(EVENTS_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const ledgerStore = hasEventPuts ? transaction.objectStore(ROOM_LEDGER_STORE) : undefined;
    const metaKey = buildMetaKey(roomId, threadId);
    const earliestEventId = normalizedEvents[0]?.event_id;
    const normalizedExpectedReplyCount = normalizeExpectedReplyCount(expectedReplyCount);
    const ledger = hasEventPuts ? createLedgerTracker(roomId) : undefined;

    const scheduleEventPuts = (): void => {
      let pendingPuts = normalizedEvents.length;
      const maybeFinalizeLedger = (): void => {
        pendingPuts -= 1;
        if (pendingPuts === 0 && ledger && ledgerStore) {
          ledger.finalize(ledgerStore);
        }
      };
      normalizedEvents.forEach((rawEvent) => {
        const cacheKey = buildEventCacheKey(roomId, threadId, rawEvent.event_id);
        const eventRecord: CachedEventRecord = {
          cacheKey,
          roomId,
          scope: threadId,
          eventId: rawEvent.event_id,
          ts: rawEvent.origin_server_ts,
          rawEvent,
          approxBytes: estimateRawEventBytes(rawEvent),
        };
        const previousRequest = eventStore.get(cacheKey);
        previousRequest.onsuccess = () => {
          const previous = previousRequest.result as CachedEventRecord | undefined;
          if (ledger) ledger.notePut(eventRecord, previous);
          eventStore.put(eventRecord);
          maybeFinalizeLedger();
        };
        previousRequest.onerror = () => reject(previousRequest.error);
      });
    };

    if (ledger && ledgerStore) {
      ledger.readBaseline(ledgerStore, eventStore, scheduleEventPuts);
    } else {
      // Meta-only (rootEvent-only) path — no ledger interaction; still
      // need to run the (empty) put loop so downstream request chains
      // schedule normally.
      scheduleEventPuts();
    }

    // Thread meta is always written (legacy asymmetry preserved).
    const metaRequest = metaStore.get(metaKey);
    metaRequest.onsuccess = () => {
      const currentMeta = metaRequest.result as CachedMetaRecord | undefined;
      const nextMeta: CachedMetaRecord = {
        metaKey,
        roomId,
        scope: threadId,
        beforeTokens: mergeCachedPaginationTokens(
          currentMeta?.beforeTokens,
          earliestEventId,
          beforeTokenForEarliest
        ),
        rootEvent:
          rootEvent && !isRawLocalEchoEventPublic(rootEvent) ? rootEvent : currentMeta?.rootEvent,
        expectedReplyCount: normalizedExpectedReplyCount ?? currentMeta?.expectedReplyCount,
        snapshotComplete: mergeThreadCacheFlag(currentMeta?.snapshotComplete, snapshotComplete),
        relationSnapshotComplete: mergeThreadCacheFlag(
          currentMeta?.relationSnapshotComplete,
          relationSnapshotComplete
        ),
        tailLoaded: mergeThreadCacheFlag(currentMeta?.tailLoaded, tailLoaded),
        updatedAt: Date.now(),
      };
      metaStore.put(nextMeta);
    };
    metaRequest.onerror = () => reject(metaRequest.error);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

export const deleteThreadEventsFromCache = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  eventIds: string[]
): Promise<void> => {
  if (eventIds.length === 0) return;
  // CINNY-207 P2 review: dedupe (same rationale as
  // deleteRoomEventsFromCache — avoid double-decrementing the ledger).
  const uniqueEventIds = Array.from(new Set(eventIds));

  // CINNY-207 P2 review: swallow open/txn failures instead of leaking
  // as unhandled rejections (deletes are ungated but must be safe).
  try {
    const db = await openCacheStore(sessionId);
    if (!db) return;

    countCacheProbe('eventDeletes', uniqueEventIds.length);

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        [EVENTS_STORE, ROOM_LEDGER_STORE],
        'readwrite'
      );
      const eventStore = transaction.objectStore(EVENTS_STORE);
      const ledgerStore = transaction.objectStore(ROOM_LEDGER_STORE);
      const ledger = createLedgerTracker(roomId);
      ledger.readBaseline(ledgerStore, eventStore, () => {
        let pendingReads = uniqueEventIds.length;
        const maybeFinalizeLedger = (): void => {
          pendingReads -= 1;
          if (pendingReads === 0) ledger.finalize(ledgerStore);
        };
        uniqueEventIds.forEach((eventId) => {
          const cacheKey = buildEventCacheKey(roomId, threadId, eventId);
          const previousRequest = eventStore.get(cacheKey);
          previousRequest.onsuccess = () => {
            const previous = previousRequest.result as CachedEventRecord | undefined;
            ledger.noteDelete(previous);
            eventStore.delete(cacheKey);
            maybeFinalizeLedger();
          };
          previousRequest.onerror = () => reject(previousRequest.error);
        });
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    // Best-effort — see rationale above.
  }
};

/**
 * Stamp `lastOpenedTs` on the meta row for a scope. Used by the eviction
 * guard "never evict recently opened threads" (D9). Upserts the meta
 * row without disturbing any other field: if the row is absent (thread
 * never persisted before), a minimal row with just this timestamp is
 * created. Callers are wired in Phase 3/4 when the sync engine and open
 * controllers land.
 */
const noteScopeOpened = async (
  sessionId: string,
  roomId: string,
  scope: string
): Promise<void> => {
  const db = await openCacheStore(sessionId);
  if (!db) return;

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readwrite');
    const metaStore = transaction.objectStore(META_STORE);
    const metaKey = buildMetaKey(roomId, scope);
    const now = Date.now();
    const getRequest = metaStore.get(metaKey);
    getRequest.onsuccess = () => {
      const currentMeta = getRequest.result as CachedMetaRecord | undefined;
      const nextMeta: CachedMetaRecord = currentMeta
        ? { ...currentMeta, lastOpenedTs: now, updatedAt: now }
        : {
            metaKey,
            roomId,
            scope,
            updatedAt: now,
            lastOpenedTs: now,
          };
      metaStore.put(nextMeta);
    };
    getRequest.onerror = () => reject(getRequest.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const noteRoomOpened = (
  sessionId: string,
  roomId: string
): Promise<void> => noteScopeOpened(sessionId, roomId, ROOM_SCOPE);

export const noteThreadOpened = (
  sessionId: string,
  roomId: string,
  threadId: string
): Promise<void> => noteScopeOpened(sessionId, roomId, threadId);

/**
 * Fallback for redaction cleanup: given only a room + event id, walk the
 * room's thread-scoped records (all scopes != '') and delete any record
 * whose `eventId` matches. Room-timeline records (scope=='') are skipped —
 * the redaction path calls `deleteRoomEventsFromCache` separately for
 * those.
 *
 * CINNY-207 P3 gate re-fix: returns the thread scope(s) it deleted from
 * (deduped). This lets the engine's redaction path use the cache itself
 * as the authoritative attribution signal — the tombstone is persisted
 * to precisely the scope(s) where the reaction record lived, even when
 * matrix-js-sdk has already pruned every event-side thread hint by the
 * time RoomEvent.Redaction fires (D8 reaction reality: the SDK has
 * moved the reaction out of the thread's timelineSet AND cleared its
 * `thread` reference before we ever see the redaction). Returns an
 * empty array when nothing matched (open failure, or the cache never
 * held a thread-scoped record for this event id).
 */
export const deleteThreadEventFromCacheByEventId = async (
  sessionId: string,
  roomId: string,
  eventId: string
): Promise<string[]> => {
  // CINNY-207 P2 review: swallow open/txn failures — see
  // deleteRoomEventsFromCache for the rationale.
  try {
    const db = await openCacheStore(sessionId);
    if (!db) return [];

    return await new Promise<string[]>((resolve, reject) => {
      const transaction = db.transaction(
        [EVENTS_STORE, ROOM_LEDGER_STORE],
        'readwrite'
      );
      const eventStore = transaction.objectStore(EVENTS_STORE);
      const ledgerStore = transaction.objectStore(ROOM_LEDGER_STORE);
      const ledger = createLedgerTracker(roomId);
      const deletedScopes = new Set<string>();
      ledger.readBaseline(ledgerStore, eventStore, () => {
        const index = eventStore.index(EVENTS_BY_SCOPE_TS_INDEX);
        const range = IDBKeyRange.bound(
          [roomId, '', 0, ''],
          [roomId, MAX_EVENT_ID, MAX_EVENT_TS, MAX_EVENT_ID]
        );

        const cursorRequest = index.openCursor(range);
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            // Cursor exhausted — finalize ledger before txn autocommits.
            ledger.finalize(ledgerStore);
            return;
          }
          const record = cursor.value as CachedEventRecord;
          // Skip the room-timeline slice; only clean up thread records.
          if (record.scope !== '' && record.eventId === eventId) {
            countCacheProbe('eventDeletes');
            ledger.noteDelete(record);
            deletedScopes.add(record.scope);
            cursor.delete();
          }
          cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error);
      });

      transaction.oncomplete = () => resolve(Array.from(deletedScopes));
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    // Best-effort — see rationale above.
    return [];
  }
};
