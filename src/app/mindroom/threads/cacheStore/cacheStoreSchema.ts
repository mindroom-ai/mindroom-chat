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
// v4 (2026-07-07): + thread_heights (persisted measured tile heights).
export const CACHE_STORE_DB_VERSION = 4;

export const EVENTS_STORE = 'events';
export const META_STORE = 'meta';
export const ROOM_LEDGER_STORE = 'room_ledger';
export const THREAD_SUMMARIES_STORE = 'thread_summaries';
export const THREAD_HEIGHTS_STORE = 'thread_heights';

// Index over the events store: [roomId, scope, ts, eventId]. `scope` is
// the empty string for room-timeline records and the thread id for thread
// records. This mirrors the two legacy `by_room_ts` / `by_thread_ts`
// indexes with a single shared shape so both cursors reuse the same core.
export const EVENTS_BY_SCOPE_TS_INDEX = 'by_scope_ts';
export const THREAD_SUMMARIES_BY_ROOM_INDEX = 'by_room';
export const THREAD_HEIGHTS_BY_ROOM_INDEX = 'by_room';

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

// CINNY-207 P2.2 commit 3 (D9/AC7): eviction tunables.
//
// - `EVICTION_TARGET_UTILIZATION` — the eviction pass runs until
//   `sum(approxBytes) <= budget * this`. 0.9 gives a 10% headroom
//   so save-time bursts don't immediately re-trigger eviction.
// - `EVICTION_RECENT_OPEN_WINDOW_MS` — rooms with any meta row whose
//   `lastOpenedTs` is inside this window are protected from
//   eviction (D9's "never evict recently opened threads" — v1
//   interpretation: whole-room granularity, any thread scope
//   counting).
// - `EVICTION_CHECK_MIN_INTERVAL_MS` — the save-time auto-trigger
//   dedupes back-to-back checks; a check is scheduled at most this
//   often per session.
export const EVICTION_TARGET_UTILIZATION = 0.9;
export const EVICTION_RECENT_OPEN_WINDOW_MS = 24 * 60 * 60 * 1000;
export const EVICTION_CHECK_MIN_INTERVAL_MS = 60_000;

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
  // CINNY-207 P3.2: marks a room whose latest sync came back
  // `limited: true`, meaning events between our last sync token and
  // the server's current state may have been dropped. The engine
  // records this on the room-timeline meta row (scope=='') alongside
  // the SDK's live-timeline pagination token at the moment of the
  // reset; the Phase 4 backfill scheduler consumes it via the
  // gap-fill executor. Optional additive field — no schema bump
  // needed because IndexedDB records are JSON blobs and older
  // readers ignore unknown fields.
  tailDiscontinuity?: {
    markedAt: number;
    prevBatch?: string | null;
  };
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

// Measured tile heights persisted per thread (schema v4). Seeded into the
// virtualizer's initialMeasurementsCache on reopen so revisited rows are
// priced exactly instead of estimated — device trace
// ride-trace-1783444824925 measured +6327px of estimate error over one
// ride through real agent-thread content, and every boundary settle that
// repays such debt is a momentum interruption. Heights are only valid for
// the layout they were measured under; `layoutKey` mismatches discard the
// record wholesale (a stale height self-heals via remeasure + ledger, but
// a whole-record layout change would seed thousands of wrong prices).
export type CachedThreadHeightsRecord = {
  cacheKey: string;
  roomId: string;
  threadId: string;
  layoutKey: string;
  heights: Record<string, number>;
  updatedAt: number;
};

// Entry cap per thread-heights record: ~50 bytes/entry keeps the record
// under ~200KB for pathological threads; oldest-measured entries are the
// least likely to be revisited, but we have no per-entry timestamps —
// the cap drops arbitrary surplus, which the estimator covers anyway.
export const MAX_THREAD_HEIGHT_ENTRIES = 4_000;

// --- Key builders ---

export const buildEventCacheKey = (roomId: string, scope: string, eventId: string): string =>
  `${roomId}|${scope}|${eventId}`;

export const buildMetaKey = (roomId: string, scope: string): string => `${roomId}|${scope}`;

export const buildSummaryCacheKey = (roomId: string, threadRootId: string): string =>
  `${roomId}|${threadRootId}`;

export const buildThreadHeightsCacheKey = (roomId: string, threadId: string): string =>
  `${roomId}|${threadId}`;

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
