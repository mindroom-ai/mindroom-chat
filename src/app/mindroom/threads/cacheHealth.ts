/* eslint-disable no-console */
/**
 * CINNY-207 P1.5 (finding F4): cache write failures must never be silent.
 *
 * Every cache write failure is counted (probe `writeErrors`) and the first
 * failure per scope is logged. A `QuotaExceededError` additionally flips the
 * session into a degraded **read-only** cache state: further writes are
 * skipped at the persist entry points instead of failing one by one, reads
 * keep painting (I1), and the reconcile path keeps correcting from the
 * network (I2) — the cache simply stops claiming it can keep up. The state
 * is session-scoped; a reload retries writing (browsers may have freed
 * space, and eviction proper lands with D9 in Phase 2).
 *
 * Inspectable from DevTools via `window.__MINDROOM_CACHE_HEALTH__.get()`.
 */

import { countCacheProbe } from './cacheProbe';

export type CacheHealthState = 'healthy' | 'read-only';

export type CacheHealth = {
  state: CacheHealthState;
  /** Set when state is 'read-only'. */
  reason?: string;
};

let health: CacheHealth = { state: 'healthy' };
const loggedScopes = new Set<string>();

const isQuotaExceededError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const { name } = error as { name?: unknown };
  // Firefox legacy name kept for completeness.
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
};

export const getCacheHealth = (): CacheHealth => ({ ...health });

export const isCacheWritable = (): boolean => health.state === 'healthy';

/**
 * Count, surface, and classify a cache write failure. First failure per
 * scope logs a warning (so a persistent failure mode is visible without
 * spamming the console at streaming rates); quota errors degrade the
 * session to read-only with a one-time error log.
 */
export const reportCacheWriteError = (scope: string, error: unknown): void => {
  countCacheProbe('writeErrors');

  if (!loggedScopes.has(scope)) {
    loggedScopes.add(scope);
    console.warn(
      `[mindroom-cache:${scope}] cache write failed (further failures in this scope are counted, not logged)`,
      error
    );
  }

  if (isQuotaExceededError(error) && health.state !== 'read-only') {
    health = {
      state: 'read-only',
      reason: `QuotaExceededError in ${scope}`,
    };
    console.error(
      '[mindroom-cache] storage quota exceeded — cache degraded to read-only for this session; ' +
        'cached paint and network reconcile continue, new cache writes are skipped'
    );
  }
};

/** Test-only: restore pristine health state between cases. */
export const resetCacheHealthForTesting = (): void => {
  health = { state: 'healthy' };
  loggedScopes.clear();
};

type CacheHealthWindow = Window & {
  __MINDROOM_CACHE_HEALTH__?: { get: () => CacheHealth };
};

if (typeof window !== 'undefined') {
  (window as CacheHealthWindow).__MINDROOM_CACHE_HEALTH__ = { get: getCacheHealth };
}
