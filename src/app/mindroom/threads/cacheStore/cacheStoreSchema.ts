import type { IEvent } from 'matrix-js-sdk';
import type { CachedPaginationTokenMap } from '../eventCacheTokenUtils';

// CINNY-207 P2.1: single-DB schema v3 for the unified CacheStore. The
// per-domain caches (`roomEventCache`, `threadEventCache`,
// `threadSummaryCache`) collapse into one IDB database with three data
// stores plus a per-room ledger store prepared for P2.2 eviction.
//
// The base DB name is unsuffixed here; session scoping is applied by
// `getCacheStoreDbName` in `cacheStoreDb.ts` via `getSessionScopedStorageKey`.

export const MINDROOM_CACHE_DB_BASE_NAME = 'mindroom-cache';
export const CACHE_STORE_DB_VERSION = 3;

export const EVENTS_STORE = 'events';
export const META_STORE = 'meta';
export const ROOM_LEDGER_STORE = 'room_ledger';
export const THREAD_SUMMARIES_STORE = 'thread_summaries';

// Index over the events store: [roomId, scope, ts, eventId]. `scope` is
// the empty string for room-timeline records and the thread id for thread
// records. This mirrors the two legacy `by_room_ts` / `by_thread_ts`
// indexes with a single shared shape so both cursors reuse the same core.
export const EVENTS_BY_SCOPE_TS_INDEX = 'by_scope_ts';
export const THREAD_SUMMARIES_BY_ROOM_INDEX = 'by_room';

// Scope constant used by the room timeline (empty string sorts before any
// thread id). Callers pass a threadId (which starts with `$` in Matrix
// event ids) for thread records.
export const ROOM_SCOPE = '' as const;

export const MAX_EVENT_TS = Number.MAX_SAFE_INTEGER;
export const MAX_EVENT_ID = '￿';

// Meta key reserved for internal state (currently: the D8 legacy-wipe
// marker). Uses a `__cacheStore` prefix that no real roomId can collide
// with (roomIds start with `!`).
export const INTERNAL_META_ROOM_ID = '__cacheStore';
export const LEGACY_WIPE_MARKER_META_KEY = '__cacheStore|migration';

// CINNY-207 P2.2 preparation: the eviction ledger enforces a per-session
// storage budget of 1 GB (decision D9). This constant lives here so the
// P2.2 ledger + a synthetic overfill test can override it via a mockable
// accessor (see `getCacheStoreByteBudget`) the same way
// `THREAD_EDIT_COMPACTION_DEBOUNCE_MS` is mocked in P1.4.
export const CACHE_BYTE_BUDGET_BYTES = 1_073_741_824;

// CINNY-207 P2.2 commit 2 (F3): cap on beforeTokens map size per meta
// record. Re-exported from `eventCacheTokenUtils` so the CacheStore's
// schema constants module is the single source of truth for tunables.
export { MAX_CACHE_BEFORE_TOKENS } from '../eventCacheTokenUtils';

let cacheByteBudgetOverride: number | undefined;
export const getCacheStoreByteBudget = (): number =>
  cacheByteBudgetOverride ?? CACHE_BYTE_BUDGET_BYTES;
export const __setCacheStoreByteBudgetForTests = (bytes: number | undefined): void => {
  cacheByteBudgetOverride = bytes;
};

// --- Record types ---

export type CachedEventRecord = {
  // `${roomId}|${scope}|${eventId}` — matches the legacy per-domain
  // key shapes minus the two-store split.
  cacheKey: string;
  roomId: string;
  scope: string;
  eventId: string;
  ts: number;
  rawEvent: Partial<IEvent>;
  // CINNY-207 P2.2 preparation: approximate serialized size in bytes,
  // computed once at write time. Used by the eviction ledger in P2.2.
  approxBytes: number;
};

export type CachedMetaRecord = {
  // `${roomId}|${scope}` — one meta row per (room, scope). Room-timeline
  // rows use scope=='' and thread rows use scope==threadId.
  metaKey: string;
  roomId: string;
  scope: string;
  beforeTokens?: CachedPaginationTokenMap;
  rootEvent?: Partial<IEvent>;
  expectedReplyCount?: number;
  snapshotComplete?: boolean;
  relationSnapshotComplete?: boolean;
  tailLoaded?: boolean;
  updatedAt: number;
  // CINNY-207 P2.2 preparation: last user-observable activity ts. Written
  // by future thread-open / room-open paths; unused today.
  lastOpenedTs?: number;
  // The D8 wipe marker record carries this field; regular records leave
  // it undefined.
  legacyWipeCompletedAt?: number;
};

// CINNY-207 P2.2: per-room byte + activity ledger used by the eviction
// job (decision D9). Maintained transactionally with event puts/deletes in
// `cacheStoreEvents`; whole-DB deletes drop the store implicitly.
//
// `approxBytes` and `eventCount` are the sum across ALL scopes for the
// room (room-timeline + every thread scope), because eviction is
// whole-room granularity. `lastActivityTs` tracks the newest event
// timestamp seen; the meta store's `lastOpenedTs` is the separate
// user-opened signal read by the eviction "never evict recently opened
// threads" guard.
//
// `federated` is optional and populated by the Phase 3/4 sync engine via
// D3 homeserver detection. Left absent today; the eviction policy treats
// `undefined` as "not federated" so nothing gets an artificial boost
// before the engine lands.
export type CachedRoomLedgerRecord = {
  roomId: string;
  approxBytes: number;
  eventCount: number;
  lastActivityTs: number;
  federated?: boolean;
};

export type CachedThreadSummaryRecord = {
  cacheKey: string;
  roomId: string;
  threadRootId: string;
  summaryText: string;
  generatedTs?: number;
  messageCount?: number;
  updatedAt: number;
};

// --- Key builders ---

export const buildEventCacheKey = (roomId: string, scope: string, eventId: string): string =>
  `${roomId}|${scope}|${eventId}`;

export const buildMetaKey = (roomId: string, scope: string): string => `${roomId}|${scope}`;

export const buildSummaryCacheKey = (roomId: string, threadRootId: string): string =>
  `${roomId}|${threadRootId}`;

// Approximate size of an event's on-disk footprint. Uses JSON serialization
// length as a fast, deterministic proxy; the ledger's job in P2.2 is
// eviction ordering, not byte-perfect accounting.
export const estimateRawEventBytes = (rawEvent: Partial<IEvent>): number => {
  try {
    return JSON.stringify(rawEvent).length;
  } catch {
    // Circular or otherwise unserializable — conservative fallback.
    return 0;
  }
};
