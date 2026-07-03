export const DEFAULT_PAGINATION_LIMIT = 10000;
export const MIN_PAGINATION_LIMIT = 50;
export const THREAD_BATCH_SIZE = 200;
export const ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE = 200;

// CINNY-207 P1.1: trailing debounce for the room-cache persist sweep. Live
// events are persisted incrementally by roomLiveEventController, so the sweep
// only needs to catch pagination batches and drift; coalescing it keeps
// streaming m.replace bursts from re-triggering timeline-wide persistence.
// Lives in this leaf module so tests can import it without loading the
// controller module graph ahead of their mocks.
export const ROOM_CACHE_PERSIST_DEBOUNCE_MS = 250;

export const sanitizePaginationLimit = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PAGINATION_LIMIT;
  return Math.max(Math.trunc(value), MIN_PAGINATION_LIMIT);
};
