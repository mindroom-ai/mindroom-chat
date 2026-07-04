export const DEFAULT_PAGINATION_LIMIT = 10000;
export const MIN_PAGINATION_LIMIT = 50;
// CINNY-207 P1.6 (finding F11): interim hard upper clamp — the setting had a
// minimum but no maximum, so arbitrarily large values drove the unbounded
// eager-preload loop (F13). The whole setting is replaced by the Phase 6
// prefetch settings group (D4); until then the cap equals the default, which
// is already the design's heavy end (~50 sequential /messages calls).
export const MAX_PAGINATION_LIMIT = 10000;
export const THREAD_BATCH_SIZE = 200;
export const ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE = 200;

// CINNY-207 P1.1: trailing debounce for the room-cache persist sweep. Live
// events are persisted incrementally by roomLiveEventController, so the sweep
// only needs to catch pagination batches and drift; coalescing it keeps
// streaming m.replace bursts from re-triggering timeline-wide persistence.
// Lives in this leaf module so tests can import it without loading the
// controller module graph ahead of their mocks.
export const ROOM_CACHE_PERSIST_DEBOUNCE_MS = 250;

// CINNY-207 P1.4: per-target trailing debounce for edit-compaction upserts.
// The live path never persists standalone m.replace records; it instead
// coalesces upserts of the target's cache record with the latest bundled edit
// (finding F5 / decision D5). This IS the stream-end flush: each new edit
// resets the timer, so the trailing write always carries the final content of
// the stream, landing ≤1 s after the last edit. Unmount and
// pagehide/visibilitychange-hidden also flush pending upserts synchronously.
// Lives in this leaf module so tests can mock it the same way the P1.1
// constant is mocked.
export const THREAD_EDIT_COMPACTION_DEBOUNCE_MS = 1000;

export const sanitizePaginationLimit = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PAGINATION_LIMIT;
  return Math.min(Math.max(Math.trunc(value), MIN_PAGINATION_LIMIT), MAX_PAGINATION_LIMIT);
};
