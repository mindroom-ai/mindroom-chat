/**
 * CINNY-207 P0.1: cache write/read observability probe.
 *
 * Pure counters — no behavior change. Incremented from the IndexedDB cache
 * write paths and readable for debugging/measurement through
 * `window.__MINDROOM_CACHE_PROBE__`. Counters record *attempted* puts
 * (counted before the transaction commits, so an aborted transaction still
 * counts and additionally ticks `writeErrors`). `eventDeletes` is reserved
 * for the P1.2 delete paths. Baselines and acceptance criteria live in
 * docs/mindroom-cache-overhaul-plan.md (AC5 requires IDB writes per live
 * event to be O(1); the probe is how that claim is measured).
 */

export type CacheProbeCounters = {
  roomSaveCalls: number;
  roomEventPuts: number;
  roomMetaPuts: number;
  threadSaveCalls: number;
  threadEventPuts: number;
  threadMetaPuts: number;
  eventDeletes: number;
  writeErrors: number;
  serializedEvents: number;
};

const createEmptyCounters = (): CacheProbeCounters => ({
  roomSaveCalls: 0,
  roomEventPuts: 0,
  roomMetaPuts: 0,
  threadSaveCalls: 0,
  threadEventPuts: 0,
  threadMetaPuts: 0,
  eventDeletes: 0,
  writeErrors: 0,
  serializedEvents: 0,
});

let counters = createEmptyCounters();

export const countCacheProbe = (key: keyof CacheProbeCounters, amount = 1): void => {
  counters[key] += amount;
};

export const getCacheProbeSnapshot = (): CacheProbeCounters => ({ ...counters });

export const resetCacheProbe = (): void => {
  counters = createEmptyCounters();
};

const HYDRATE_MARK_PREFIX = 'mindroom:cache-hydrate';

export const markCacheHydrateStart = (scope: string): void => {
  if (typeof performance === 'undefined') return;
  performance.mark(`${HYDRATE_MARK_PREFIX}:${scope}:start`);
};

export const markCacheHydrateEnd = (scope: string): void => {
  if (typeof performance === 'undefined') return;
  const start = `${HYDRATE_MARK_PREFIX}:${scope}:start`;
  const end = `${HYDRATE_MARK_PREFIX}:${scope}:end`;
  performance.mark(end);
  try {
    performance.measure(`${HYDRATE_MARK_PREFIX}:${scope}`, start, end);
  } catch {
    // Start mark may be absent when hydration was skipped; measurement is
    // best-effort observability only.
  }
};

export const getCacheHydrateMeasures = (): { name: string; duration: number }[] => {
  if (typeof performance === 'undefined') return [];
  return performance
    .getEntriesByType('measure')
    .filter((entry) => entry.name.startsWith(HYDRATE_MARK_PREFIX))
    .map((entry) => ({ name: entry.name, duration: entry.duration }));
};

type CacheProbeWindow = Window & {
  __MINDROOM_CACHE_PROBE__?: {
    snapshot: () => CacheProbeCounters;
    reset: () => void;
    hydrateMeasures: () => { name: string; duration: number }[];
  };
};

if (typeof window !== 'undefined') {
  (window as CacheProbeWindow).__MINDROOM_CACHE_PROBE__ = {
    snapshot: getCacheProbeSnapshot,
    reset: resetCacheProbe,
    hydrateMeasures: getCacheHydrateMeasures,
  };
}
