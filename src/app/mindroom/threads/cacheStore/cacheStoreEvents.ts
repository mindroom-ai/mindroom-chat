import type { IEvent } from 'matrix-js-sdk';
import { countCacheProbe } from '../cacheProbe';
import { isCacheWritable, reportCacheWriteError } from '../cacheHealth';
import {
  collectEmbeddedRelationEventIds,
  collectExplicitRedactedEventIds,
  mergeRawEventRevisions,
  stripRedactedRelationsFromRawEvent,
  type RelationSnapshotMode,
} from '../eventRevision';
import { getCachedPaginationToken, mergeCachedPaginationTokens } from '../eventCacheTokenUtils';
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
  mergeThreadExpectedReplyCount,
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

// One marker row per redacted id gives later stale event pages an O(batch)
// lookup without replaying an ever-growing room-wide registry. Whole-room
// eviction removes these rows with the rest of the room's meta records.
const REDACTED_RELATION_META_PREFIX = '__redactedRelation:';

const getRedactedRelationMetaScope = (eventId: string): string =>
  `${REDACTED_RELATION_META_PREFIX}${encodeURIComponent(eventId)}`;

const getRedactedRelationMetaKey = (roomId: string, eventId: string): string =>
  buildMetaKey(roomId, getRedactedRelationMetaScope(eventId));

const stripKnownRedactedRelations = <T extends Partial<IEvent>>(
  rawEvents: readonly T[],
  redactedEventIds: ReadonlySet<string>
): T[] =>
  rawEvents.map((rawEvent) => stripRedactedRelationsFromRawEvent(rawEvent, redactedEventIds) as T);

const buildMergedEventRecord = (
  roomId: string,
  scope: string,
  incoming: CachedRoomEvent | CachedThreadEvent,
  previous: CachedEventRecord | undefined,
  relationSnapshotMode: RelationSnapshotMode
): CachedEventRecord => {
  const rawEvent = mergeRawEventRevisions(previous?.rawEvent, incoming, relationSnapshotMode);
  return {
    cacheKey: buildEventCacheKey(roomId, scope, incoming.event_id),
    roomId,
    scope,
    eventId: incoming.event_id,
    ts:
      typeof rawEvent.origin_server_ts === 'number' && Number.isFinite(rawEvent.origin_server_ts)
        ? rawEvent.origin_server_ts
        : incoming.origin_server_ts,
    rawEvent,
    approxBytes: estimateRawEventBytes(rawEvent),
  };
};

const canPersistMarkedEvent = (
  rawEvent: Partial<IEvent>,
  previousRawEvent: Partial<IEvent> | undefined,
  redactedEventIds: ReadonlySet<string>
): boolean => {
  const eventId = rawEvent.event_id;
  return (
    typeof eventId !== 'string' ||
    !redactedEventIds.has(eventId) ||
    !!rawEvent.unsigned?.redacted_because ||
    !!previousRawEvent?.unsigned?.redacted_because
  );
};

const collectRedactionMarkerCandidateIds = (rawEvents: readonly Partial<IEvent>[]): Set<string> => {
  const eventIds = collectEmbeddedRelationEventIds(rawEvents);
  rawEvents.forEach((rawEvent) => {
    if (typeof rawEvent.event_id === 'string') {
      eventIds.add(rawEvent.event_id);
    }
  });
  return eventIds;
};

const loadKnownRedactedRelationEventIds = (
  metaStore: IDBObjectStore,
  roomId: string,
  candidates: ReadonlySet<string>,
  current: ReadonlySet<string>,
  onReady: (eventIds: Set<string>) => void,
  onError: (error: DOMException | null) => void
): void => {
  if (candidates.size === 0) {
    onReady(new Set(current));
    return;
  }
  const knownEventIds = new Set(current);
  const unresolvedEventIds = Array.from(candidates).filter(
    (eventId) => !knownEventIds.has(eventId)
  );
  if (unresolvedEventIds.length === 0) {
    onReady(knownEventIds);
    return;
  }

  let pending = unresolvedEventIds.length;
  let failed = false;
  unresolvedEventIds.forEach((eventId) => {
    const request = metaStore.get(getRedactedRelationMetaKey(roomId, eventId));
    request.onsuccess = () => {
      if (failed) return;
      if (request.result) knownEventIds.add(eventId);
      pending -= 1;
      if (pending === 0) onReady(knownEventIds);
    };
    request.onerror = () => {
      if (failed) return;
      failed = true;
      onError(request.error);
    };
  });
};

const collectRedactedTombstones = (
  rawEvents: readonly Partial<IEvent>[]
): Map<string, Partial<IEvent>> => {
  const tombstones = new Map<string, Partial<IEvent>>();
  rawEvents.forEach((rawEvent) => {
    if (typeof rawEvent.event_id === 'string' && rawEvent.unsigned?.redacted_because) {
      tombstones.set(rawEvent.event_id, rawEvent);
    }
  });
  return tombstones;
};

/**
 * Return the subset of `redactedEventIds` that have no marker row yet
 * on the room's meta store. Callers use this to gate the room-wide
 * scrub cursor: once an id is marked, every historical repair for it
 * has been applied and re-scrubbing on later saves is pure work.
 */
const collectRedactedIdsWithoutMarker = async (
  db: IDBDatabase,
  roomId: string,
  redactedEventIds: ReadonlySet<string>
): Promise<Set<string>> => {
  if (redactedEventIds.size === 0) return new Set();
  return new Promise<Set<string>>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, 'readonly');
    const metaStore = transaction.objectStore(META_STORE);
    const unmarkedIds = new Set(redactedEventIds);
    let failed = false;
    redactedEventIds.forEach((eventId) => {
      const request = metaStore.get(getRedactedRelationMetaKey(roomId, eventId));
      request.onsuccess = () => {
        if (failed) return;
        if (request.result) unmarkedIds.delete(eventId);
      };
      request.onerror = () => {
        if (failed) return;
        failed = true;
        reject(request.error);
      };
    });
    transaction.oncomplete = () => {
      if (!failed) resolve(unmarkedIds);
    };
    transaction.onerror = () => {
      if (!failed) reject(transaction.error);
    };
    transaction.onabort = () => {
      if (!failed) reject(transaction.error);
    };
  });
};

const runScrubRedactedRelationsTxn = async (
  db: IDBDatabase,
  roomId: string,
  redactedEventIds: ReadonlySet<string>,
  tombstones: ReadonlyMap<string, Partial<IEvent>>
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([EVENTS_STORE, META_STORE, ROOM_LEDGER_STORE], 'readwrite');
    const eventStore = transaction.objectStore(EVENTS_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const ledgerStore = transaction.objectStore(ROOM_LEDGER_STORE);
    const ledger = createLedgerTracker(roomId);

    redactedEventIds.forEach((eventId) => {
      const scope = getRedactedRelationMetaScope(eventId);
      metaStore.put({
        metaKey: buildMetaKey(roomId, scope),
        roomId,
        scope,
        updatedAt: Date.now(),
      } satisfies CachedMetaRecord);
    });

    const repairRawEvent = (
      rawEvent: Partial<IEvent>,
      eventId?: string
    ): Partial<IEvent> | undefined => {
      const tombstone = eventId ? tombstones.get(eventId) : undefined;
      if (
        eventId &&
        redactedEventIds.has(eventId) &&
        !tombstone &&
        !rawEvent.unsigned?.redacted_because
      ) {
        return undefined;
      }
      const merged = tombstone ? mergeRawEventRevisions(rawEvent, tombstone) : rawEvent;
      return stripRedactedRelationsFromRawEvent(merged, redactedEventIds);
    };

    ledger.readBaseline(ledgerStore, eventStore, () => {
      const eventRange = IDBKeyRange.bound(
        [roomId, ROOM_SCOPE, 0, ''],
        [roomId, MAX_EVENT_ID, MAX_EVENT_TS, MAX_EVENT_ID]
      );
      const cursorRequest = eventStore.index(EVENTS_BY_SCOPE_TS_INDEX).openCursor(eventRange);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          ledger.finalize(ledgerStore);
          return;
        }

        const previous = cursor.value as CachedEventRecord;
        const rawEvent = repairRawEvent(previous.rawEvent, previous.eventId);
        if (!rawEvent) {
          ledger.noteDelete(previous);
          cursor.delete();
          cursor.continue();
          return;
        }

        if (rawEvent !== previous.rawEvent) {
          const nextRecord: CachedEventRecord = {
            ...previous,
            rawEvent,
            approxBytes: estimateRawEventBytes(rawEvent),
          };
          ledger.notePut(nextRecord, previous);
          cursor.update(nextRecord);
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });

    const metaCursorRequest = metaStore.openCursor(
      IDBKeyRange.bound(buildMetaKey(roomId, ROOM_SCOPE), buildMetaKey(roomId, MAX_EVENT_ID))
    );
    metaCursorRequest.onsuccess = () => {
      const cursor = metaCursorRequest.result;
      if (!cursor) return;
      const currentMeta = cursor.value as CachedMetaRecord;
      if (currentMeta.rootEvent) {
        const rootEvent = repairRawEvent(currentMeta.rootEvent, currentMeta.rootEvent.event_id);
        if (!rootEvent) {
          cursor.update({ ...currentMeta, rootEvent: undefined, updatedAt: Date.now() });
        } else if (rootEvent !== currentMeta.rootEvent) {
          cursor.update({ ...currentMeta, rootEvent, updatedAt: Date.now() });
        }
      }
      cursor.continue();
    };
    metaCursorRequest.onerror = () => reject(metaCursorRequest.error);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

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

const runScopedCursor = async (options: ScopedCursorOptions): Promise<ScopedCursorResult> => {
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

export const saveRoomEventsToCacheCommitted = async (
  sessionId: string,
  roomId: string,
  rawEvents: Partial<IEvent>[],
  beforeTokenForEarliest?: string | null,
  relationSnapshotMode: RelationSnapshotMode = 'partial'
): Promise<boolean> => {
  // CINNY-207 P2.3: cache health gate lives at the single write choke
  // point. After a quota failure the session is cache-read-only —
  // skip further writes silently. Deletes stay ungated (they only
  // shrink storage). The eventRepository seam no longer wraps this
  // call in its own gate/catch.
  if (!isCacheWritable()) return false;

  // CINNY-207 P2 review: the entire body (including the openCacheStore
  // await) must live inside the error-reporting boundary. Callers
  // invoke us via `void save(...)` — a rejected open here would escape
  // as an unhandled rejection and never trip the health gate.
  try {
    const db = await openCacheStore(sessionId);
    if (!db) return false;

    const redactedEventIds = collectExplicitRedactedEventIds(rawEvents);
    const redactedTombstones = collectRedactedTombstones(rawEvents);
    const normalizedEvents = normalizeCachedRoomEvents(rawEvents);
    if (redactedEventIds.size > 0) {
      // Only scrub for ids we have never marked before: marker rows are
      // written by the scrub itself, so an already-marked id was fully
      // repaired on its first save and re-scrubbing is pure work.
      const unscrubbedIds = await collectRedactedIdsWithoutMarker(db, roomId, redactedEventIds);
      if (unscrubbedIds.size > 0) {
        await runScrubRedactedRelationsTxn(db, roomId, unscrubbedIds, redactedTombstones);
      }
    }
    if (normalizedEvents.length === 0) return true;

    countCacheProbe('roomSaveCalls');
    if (beforeTokenForEarliest !== undefined) {
      countCacheProbe('roomMetaPuts');
    }

    await runSaveRoomEventsTxn(
      db,
      roomId,
      normalizedEvents,
      beforeTokenForEarliest,
      relationSnapshotMode,
      redactedEventIds
    );
  } catch (error) {
    reportCacheWriteError('roomEventCache.save', error);
    return false;
  }

  // CINNY-207 P2.2 commit 3: cheap over-budget probe after saves.
  // Fire-and-forget, module-level debounced.
  maybeScheduleEvictionCheck(sessionId);
  return true;
};

export const saveRoomEventsToCache = async (
  ...args: Parameters<typeof saveRoomEventsToCacheCommitted>
): Promise<void> => {
  await saveRoomEventsToCacheCommitted(...args);
};

const runSaveRoomEventsTxn = async (
  db: IDBDatabase,
  roomId: string,
  normalizedEvents: CachedRoomEvent[],
  beforeTokenForEarliest: string | null | undefined,
  relationSnapshotMode: RelationSnapshotMode,
  redactedEventIds: ReadonlySet<string>
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([EVENTS_STORE, META_STORE, ROOM_LEDGER_STORE], 'readwrite');
    const eventStore = transaction.objectStore(EVENTS_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const ledgerStore = transaction.objectStore(ROOM_LEDGER_STORE);
    const ledger = createLedgerTracker(roomId);

    const scheduleMetaPut = (earliestEventId: string | undefined): void => {
      // Legacy-faithful asymmetry: room meta is written ONLY when a token
      // was supplied. Thread meta is written unconditionally (see below).
      if (beforeTokenForEarliest === undefined || !earliestEventId) return;
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
    };

    loadKnownRedactedRelationEventIds(
      metaStore,
      roomId,
      collectRedactionMarkerCandidateIds(normalizedEvents),
      redactedEventIds,
      (knownRedactedEventIds) => {
        const eventsToConsider = stripKnownRedactedRelations(
          normalizedEvents,
          knownRedactedEventIds
        );

        // Capture the ledger baseline before any event puts land so a
        // bootstrap sum reflects only the pre-write state.
        ledger.readBaseline(ledgerStore, eventStore, () => {
          const persistedEventIds: Array<string | undefined> = new Array(eventsToConsider.length);
          let pendingPuts = eventsToConsider.length;
          if (pendingPuts === 0) {
            ledger.finalize(ledgerStore);
            scheduleMetaPut(undefined);
            return;
          }
          const maybeFinalizeLedger = (): void => {
            pendingPuts -= 1;
            if (pendingPuts !== 0) return;
            ledger.finalize(ledgerStore);
            scheduleMetaPut(persistedEventIds.find((eventId) => eventId !== undefined));
          };
          eventsToConsider.forEach((rawEvent, index) => {
            const cacheKey = buildEventCacheKey(roomId, ROOM_SCOPE, rawEvent.event_id);
            const previousRequest = eventStore.get(cacheKey);
            previousRequest.onsuccess = () => {
              const previous = previousRequest.result as CachedEventRecord | undefined;
              if (!canPersistMarkedEvent(rawEvent, previous?.rawEvent, knownRedactedEventIds)) {
                maybeFinalizeLedger();
                return;
              }
              const eventRecord = buildMergedEventRecord(
                roomId,
                ROOM_SCOPE,
                rawEvent,
                previous,
                relationSnapshotMode
              );
              countCacheProbe('roomEventPuts');
              ledger.notePut(eventRecord, previous);
              eventStore.put(eventRecord);
              persistedEventIds[index] = rawEvent.event_id;
              maybeFinalizeLedger();
            };
            previousRequest.onerror = () => reject(previousRequest.error);
          });
        });
      },
      reject
    );

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
      const transaction = db.transaction([EVENTS_STORE, ROOM_LEDGER_STORE], 'readwrite');
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

/**
 * Assemble a CachedThreadEventPage from a meta row + ordered replies.
 * Passing `undefined` for `meta` produces a "no cached state" page
 * (snapshot flags false, no beforeToken) — used both when the cache is
 * empty AND for the batch loader's early-return shape so every returned
 * page carries the same field set.
 */
const buildThreadEventPage = (
  meta: CachedMetaRecord | undefined,
  orderedEvents: CachedThreadEvent[],
  hasMoreBefore: boolean
): CachedThreadEventPage => ({
  rootEvent: meta?.rootEvent,
  events: orderedEvents,
  hasMoreBefore,
  beforeToken: getCachedPaginationToken(meta?.beforeTokens, orderedEvents[0]?.event_id),
  expectedReplyCount: normalizeExpectedReplyCount(meta?.expectedReplyCount),
  snapshotComplete: meta?.snapshotComplete === true,
  relationSnapshotComplete: meta?.relationSnapshotComplete === true,
  tailLoaded: meta?.tailLoaded === true,
});

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
  return buildThreadEventPage(meta, events.reverse() as CachedThreadEvent[], hasMoreBefore);
};

/** Read several thread tails in one IndexedDB transaction. */
export const loadLatestCachedThreadEventsBatch = async (
  sessionId: string,
  roomId: string,
  threadIds: readonly string[],
  limit: number
): Promise<Map<string, CachedThreadEventPage>> => {
  const uniqueThreadIds = Array.from(new Set(threadIds));
  const empty = new Map<string, CachedThreadEventPage>();
  if (uniqueThreadIds.length === 0) return empty;
  const db = await openCacheStore(sessionId);
  if (!db || limit <= 0) {
    uniqueThreadIds.forEach((threadId) => {
      empty.set(threadId, buildThreadEventPage(undefined, [], false));
    });
    return empty;
  }

  return new Promise<Map<string, CachedThreadEventPage>>((resolve, reject) => {
    const transaction = db.transaction([EVENTS_STORE, META_STORE], 'readonly');
    const eventIndex = transaction.objectStore(EVENTS_STORE).index(EVENTS_BY_SCOPE_TS_INDEX);
    const metaStore = transaction.objectStore(META_STORE);
    const states = uniqueThreadIds.map((threadId) => {
      const events: CachedThreadEvent[] = [];
      let hasMoreBefore = false;
      const range = IDBKeyRange.bound(
        [roomId, threadId, 0, ''],
        [roomId, threadId, MAX_EVENT_TS, MAX_EVENT_ID]
      );
      const cursorRequest = eventIndex.openCursor(range, 'prev');
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const record = cursor.value as CachedEventRecord;
        const normalized = toRawEventInternal(record.rawEvent) as CachedThreadEvent | undefined;
        if (!normalized || record.eventId === threadId) {
          cursor.continue();
          return;
        }
        if (events.length < limit) {
          events.push(normalized);
          cursor.continue();
          return;
        }
        hasMoreBefore = true;
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
      return {
        threadId,
        events,
        get hasMoreBefore() {
          return hasMoreBefore;
        },
        metaRequest: metaStore.get(buildMetaKey(roomId, threadId)),
      };
    });

    transaction.oncomplete = () => {
      const pages = new Map<string, CachedThreadEventPage>();
      states.forEach(({ threadId, events, hasMoreBefore, metaRequest }) => {
        const meta = metaRequest.result as CachedMetaRecord | undefined;
        pages.set(threadId, buildThreadEventPage(meta, events.reverse(), hasMoreBefore));
      });
      resolve(pages);
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

export const loadCachedThreadEventsBefore = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  before: CursorAnchor | undefined,
  limit: number
): Promise<CachedThreadEventPage> => {
  if (!before) return buildThreadEventPage(undefined, [], false);
  const { events, hasMoreBefore, meta } = await runScopedCursor({
    sessionId,
    roomId,
    scope: threadId,
    limit,
    upperBound: before,
    shouldSkip: (record) => record.eventId === threadId,
  });
  return buildThreadEventPage(meta, events.reverse() as CachedThreadEvent[], hasMoreBefore);
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
    const metaRequest =
      eventId === threadId ? metaStore.get(buildMetaKey(roomId, threadId)) : undefined;

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
      resolve(
        meta?.rootEvent
          ? (toRawEventInternal(meta.rootEvent) as CachedThreadEvent | undefined)
          : undefined
      );
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    eventRequest.onerror = () => reject(eventRequest.error);
    metaRequest?.addEventListener('error', () => reject(metaRequest.error));
  });
};

export const saveThreadEventsToCacheCommitted = async (
  sessionId: string,
  roomId: string,
  threadId: string,
  rawEvents: Partial<IEvent>[],
  rootEvent?: Partial<IEvent>,
  beforeTokenForEarliest?: string | null,
  tailLoaded?: boolean,
  snapshotComplete?: boolean,
  expectedReplyCount?: number,
  relationSnapshotComplete?: boolean,
  relationSnapshotMode: RelationSnapshotMode = 'partial'
): Promise<boolean> => {
  // CINNY-207 P2.3: cache health gate (same rationale as the room save).
  if (!isCacheWritable()) return false;

  // CINNY-207 P2 review: keep the open inside the error boundary — see
  // saveRoomEventsToCache for the rationale (callers use `void save`).
  try {
    const db = await openCacheStore(sessionId);
    if (!db) return false;

    const redactionEvidence = rootEvent ? [...rawEvents, rootEvent] : rawEvents;
    const redactedEventIds = collectExplicitRedactedEventIds(redactionEvidence);
    const redactedTombstones = collectRedactedTombstones(redactionEvidence);
    const normalizedEvents = filterPageableCachedThreadEvents(
      normalizeCachedThreadEvents(rawEvents),
      threadId
    );
    if (redactedEventIds.size > 0) {
      // Gate the room-wide scrub on marker presence (see room-save above).
      const unscrubbedIds = await collectRedactedIdsWithoutMarker(db, roomId, redactedEventIds);
      if (unscrubbedIds.size > 0) {
        await runScrubRedactedRelationsTxn(db, roomId, unscrubbedIds, redactedTombstones);
      }
    }
    if (normalizedEvents.length === 0 && !rootEvent) return true;

    countCacheProbe('threadSaveCalls');
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
      relationSnapshotComplete,
      relationSnapshotMode,
      redactedEventIds
    );
  } catch (error) {
    reportCacheWriteError('threadEventCache.save', error);
    return false;
  }

  // CINNY-207 P2.2 commit 3: same debounced over-budget probe.
  maybeScheduleEvictionCheck(sessionId);
  return true;
};

export const saveThreadEventsToCache = async (
  ...args: Parameters<typeof saveThreadEventsToCacheCommitted>
): Promise<void> => {
  await saveThreadEventsToCacheCommitted(...args);
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
  relationSnapshotComplete: boolean | undefined,
  relationSnapshotMode: RelationSnapshotMode,
  redactedEventIds: ReadonlySet<string>
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    // Only include ROOM_LEDGER_STORE in the txn when we actually have
    // event puts — a rootEvent-only meta-only save leaves the ledger
    // untouched (per plan: "ledger untouched by meta-only writes").
    const hasEventPuts = normalizedEvents.length > 0;
    const transaction = db.transaction(
      hasEventPuts ? [EVENTS_STORE, META_STORE, ROOM_LEDGER_STORE] : [EVENTS_STORE, META_STORE],
      'readwrite'
    );
    const eventStore = transaction.objectStore(EVENTS_STORE);
    const metaStore = transaction.objectStore(META_STORE);
    const ledgerStore = hasEventPuts ? transaction.objectStore(ROOM_LEDGER_STORE) : undefined;
    const metaKey = buildMetaKey(roomId, threadId);
    const normalizedExpectedReplyCount = normalizeExpectedReplyCount(expectedReplyCount);
    const ledger = hasEventPuts ? createLedgerTracker(roomId) : undefined;

    const scheduleEventPuts = (
      eventsToConsider: CachedThreadEvent[],
      knownRedactedEventIds: ReadonlySet<string>,
      onComplete: (earliestPersistedEventId: string | undefined) => void
    ): void => {
      const persistedEventIds: Array<string | undefined> = new Array(eventsToConsider.length);
      let pendingPuts = eventsToConsider.length;
      if (pendingPuts === 0) {
        if (ledger && ledgerStore) ledger.finalize(ledgerStore);
        onComplete(undefined);
        return;
      }
      const maybeFinalizeLedger = (): void => {
        pendingPuts -= 1;
        if (pendingPuts !== 0) return;
        if (ledger && ledgerStore) ledger.finalize(ledgerStore);
        onComplete(persistedEventIds.find((eventId) => eventId !== undefined));
      };
      eventsToConsider.forEach((rawEvent, index) => {
        const cacheKey = buildEventCacheKey(roomId, threadId, rawEvent.event_id);
        const previousRequest = eventStore.get(cacheKey);
        previousRequest.onsuccess = () => {
          const previous = previousRequest.result as CachedEventRecord | undefined;
          if (!canPersistMarkedEvent(rawEvent, previous?.rawEvent, knownRedactedEventIds)) {
            maybeFinalizeLedger();
            return;
          }
          const eventRecord = buildMergedEventRecord(
            roomId,
            threadId,
            rawEvent,
            previous,
            relationSnapshotMode
          );
          countCacheProbe('threadEventPuts');
          if (ledger) ledger.notePut(eventRecord, previous);
          eventStore.put(eventRecord);
          persistedEventIds[index] = rawEvent.event_id;
          maybeFinalizeLedger();
        };
        previousRequest.onerror = () => reject(previousRequest.error);
      });
    };

    loadKnownRedactedRelationEventIds(
      metaStore,
      roomId,
      collectRedactionMarkerCandidateIds(
        rootEvent ? [...normalizedEvents, rootEvent] : normalizedEvents
      ),
      redactedEventIds,
      (knownRedactedEventIds) => {
        const eventsToConsider = stripKnownRedactedRelations(
          normalizedEvents,
          knownRedactedEventIds
        );
        const incomingRootEvent = rootEvent
          ? stripKnownRedactedRelations([rootEvent], knownRedactedEventIds)[0]
          : undefined;

        const scheduleMetaPut = (earliestPersistedEventId: string | undefined): void => {
          // Thread meta is always written (legacy asymmetry preserved).
          const metaRequest = metaStore.get(metaKey);
          metaRequest.onsuccess = () => {
            const currentMeta = metaRequest.result as CachedMetaRecord | undefined;
            const cacheableRootEvent =
              incomingRootEvent &&
              !isRawLocalEchoEventPublic(incomingRootEvent) &&
              canPersistMarkedEvent(
                incomingRootEvent,
                currentMeta?.rootEvent,
                knownRedactedEventIds
              )
                ? incomingRootEvent
                : undefined;
            const nextMeta: CachedMetaRecord = {
              metaKey,
              roomId,
              scope: threadId,
              beforeTokens: mergeCachedPaginationTokens(
                currentMeta?.beforeTokens,
                earliestPersistedEventId,
                beforeTokenForEarliest
              ),
              rootEvent: cacheableRootEvent
                ? mergeRawEventRevisions(
                    currentMeta?.rootEvent,
                    cacheableRootEvent,
                    relationSnapshotMode
                  )
                : currentMeta?.rootEvent,
              expectedReplyCount: mergeThreadExpectedReplyCount(
                currentMeta?.expectedReplyCount,
                normalizedExpectedReplyCount,
                snapshotComplete
              ),
              snapshotComplete: mergeThreadCacheFlag(
                currentMeta?.snapshotComplete,
                snapshotComplete
              ),
              relationSnapshotComplete: mergeThreadCacheFlag(
                currentMeta?.relationSnapshotComplete,
                relationSnapshotComplete
              ),
              tailLoaded: mergeThreadCacheFlag(currentMeta?.tailLoaded, tailLoaded),
              threadReconcileContinuation: currentMeta?.threadReconcileContinuation,
              updatedAt: Date.now(),
              lastOpenedTs: currentMeta?.lastOpenedTs,
            };
            metaStore.put(nextMeta);
          };
          metaRequest.onerror = () => reject(metaRequest.error);
        };

        const scheduleWrites = (): void =>
          scheduleEventPuts(eventsToConsider, knownRedactedEventIds, scheduleMetaPut);
        if (ledger && ledgerStore) {
          ledger.readBaseline(ledgerStore, eventStore, scheduleWrites);
        } else {
          scheduleWrites();
        }
      },
      reject
    );

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

/** Best-effort compatibility API used by fire-and-forget cleanup paths. */
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

  try {
    const db = await openCacheStore(sessionId);
    if (!db) return;

    countCacheProbe('eventDeletes', uniqueEventIds.length);

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([EVENTS_STORE, ROOM_LEDGER_STORE], 'readwrite');
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
    // Best-effort — see rationale on deleteRoomEventsFromCache.
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
const noteScopeOpened = async (sessionId: string, roomId: string, scope: string): Promise<void> => {
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

export const noteRoomOpened = (sessionId: string, roomId: string): Promise<void> =>
  noteScopeOpened(sessionId, roomId, ROOM_SCOPE);

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
      const transaction = db.transaction([EVENTS_STORE, ROOM_LEDGER_STORE], 'readwrite');
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
