/**
 * `window.__MINDROOM_CACHE_PROBE__`: the cache counters that `cacheProbe.ts` installs as it loads,
 * which end-to-end specs read and reset inside the page. Specs look counters up by name, so the
 * snapshot is typed as a record of numbers; `CacheProbeCounters` lists the names.
 */
declare global {
  interface Window {
    __MINDROOM_CACHE_PROBE__?: {
      snapshot: () => Record<string, number>;
      reset: () => void;
      hydrateMeasures: () => { name: string; duration: number }[];
    };
  }
}

export {};
