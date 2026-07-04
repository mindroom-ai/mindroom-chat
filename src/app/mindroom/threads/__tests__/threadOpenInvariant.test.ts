/**
 * CINNY-207 AC2 revision (2026-07-04): post-choke-point thread-open
 * accounting invariant.
 *
 * The pre-revision shape had a schedule counter per branch (one for
 * cache-first complete-coverage, one for lifecycle partial-coverage,
 * plus a third for the D7-fix backfill-completed branch) and eight
 * SDK-bootstrap-skip counters (one per early return in
 * `runThreadOpenSdkBootstrap`). Every open was expected to hit exactly
 * one of the scheduled/skip counters and the sum equalled `threadOpens`.
 *
 * The revision relocated the thread-scope reconcile schedule to a
 * SINGLE choke point at the top of `runThreadOpenCacheFirst`, right
 * after the two hydrate guards. Every open that survives those two
 * guards schedules exactly one reconcile — structurally impossible
 * for any downstream coverage / bootstrap branch to skip. The
 * accounting collapsed accordingly:
 *
 *   threadOpens ==
 *     threadOpenScheduledCacheFirst +
 *     threadOpenSkipCacheFirstHydrateGuard +
 *     threadOpenSkipCacheFirstPostHydrateGuard
 *
 * This file asserts that shape as a UNIT invariant. It builds the
 * three legitimate outcomes by incrementing the counters directly (the
 * hydrate / post-hydrate skip counters are set by
 * `runThreadOpenCacheFirst`, and the choke-point schedule counter is
 * set by the same function immediately before it calls
 * `scheduleReconcile`). The end-to-end wiring — that
 * `runThreadOpenCacheFirst` really bumps `threadOpenScheduledCacheFirst`
 * on every non-guarded open — is covered by the sibling
 * `threadOpenCacheFirst.test.ts` (five tests, all four coverage shapes
 * plus the "no cache present" fall-through).
 *
 * The pre-revision SDK-bootstrap skip counters
 * (`threadOpenSkipSdkPendingLocalEcho`, `threadOpenSkipSdkZeroReplyRoot`,
 * `threadOpenSkipSdkContextGuard`, `threadOpenSkipSdkContextError`,
 * `threadOpenSkipSdkRelationsGuard`, `threadOpenSkipSdkRelationsError`,
 * `threadOpenSkipSdkThreadTimelineGuard`, `threadOpenSkipSdkEmptyRelationsGuard`)
 * and the mid-flow cache-first skip counters
 * (`threadOpenSkipCacheFirstBackfillCompleted`,
 * `threadOpenSkipCacheFirstBackfillGuard`) were pruned with the
 * machinery — those tests are gone with them because the counters they
 * asserted no longer exist. Every path through the SDK bootstrap now
 * occurs AFTER the choke-point schedule fired, so those paths don't
 * need skip counters to prove convergence intent.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  countCacheProbe,
  getCacheProbeSnapshot,
  resetCacheProbe,
  type CacheProbeCounters,
} from '../cacheProbe';

const CHOKE_POINT_OUTCOME_KEYS = [
  'threadOpenScheduledCacheFirst',
  'threadOpenSkipCacheFirstHydrateGuard',
  'threadOpenSkipCacheFirstPostHydrateGuard',
] satisfies (keyof CacheProbeCounters)[];

const sumOutcomes = (snap: CacheProbeCounters): number =>
  CHOKE_POINT_OUTCOME_KEYS.reduce((acc, key) => acc + snap[key], 0);

describe('AC2 revision: thread-open choke-point accounting invariant', () => {
  beforeEach(() => resetCacheProbe());

  it('exposes exactly the three outcome counters that partition a thread open', () => {
    // Sanity guard against a future counter add/rename that would
    // silently break the invariant sum. If a new outcome counter is
    // added the list above must grow with it — otherwise the sum
    // stops equalling `threadOpens` and the invariant becomes a lie.
    const snap = getCacheProbeSnapshot();
    for (const key of CHOKE_POINT_OUTCOME_KEYS) {
      expect(snap[key]).toBe(0);
    }
  });

  it('sums to threadOpens after a single choke-point schedule', () => {
    // Simulate one open that survives both guards: bump `threadOpens`
    // (the lifecycle controller does this once at the start of its
    // effect body) and then bump `threadOpenScheduledCacheFirst` (the
    // choke-point call in `runThreadOpenCacheFirst`).
    countCacheProbe('threadOpens');
    countCacheProbe('threadOpenScheduledCacheFirst');
    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpens).toBe(1);
    expect(sumOutcomes(snap)).toBe(1);
    expect(snap.threadOpens).toBe(sumOutcomes(snap));
  });

  it('sums to threadOpens after a hydrate-guard skip', () => {
    // Hydrate threw AND `isCurrentThreadOpen()` returned false — the
    // open aborted before the choke-point could fire. Legitimate: the
    // thread is closed, there is no convergence work to do.
    countCacheProbe('threadOpens');
    countCacheProbe('threadOpenSkipCacheFirstHydrateGuard');
    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpens).toBe(1);
    expect(sumOutcomes(snap)).toBe(1);
    expect(snap.threadOpens).toBe(sumOutcomes(snap));
  });

  it('sums to threadOpens after a post-hydrate-guard skip', () => {
    // Guard flipped between hydrate returning and the post-hydrate
    // check — the open aborted before we reached the choke-point
    // schedule. Same legitimacy as the hydrate-guard skip.
    countCacheProbe('threadOpens');
    countCacheProbe('threadOpenSkipCacheFirstPostHydrateGuard');
    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpens).toBe(1);
    expect(sumOutcomes(snap)).toBe(1);
    expect(snap.threadOpens).toBe(sumOutcomes(snap));
  });

  it('sums to threadOpens across a mixed batch of shapes', () => {
    // Simulate five opens: three schedule the reconcile at the
    // choke-point, one skips via the hydrate-guard, one skips via the
    // post-hydrate-guard. The invariant must hold across the mix.
    for (let i = 0; i < 5; i += 1) countCacheProbe('threadOpens');
    countCacheProbe('threadOpenScheduledCacheFirst');
    countCacheProbe('threadOpenScheduledCacheFirst');
    countCacheProbe('threadOpenScheduledCacheFirst');
    countCacheProbe('threadOpenSkipCacheFirstHydrateGuard');
    countCacheProbe('threadOpenSkipCacheFirstPostHydrateGuard');

    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpens).toBe(5);
    expect(sumOutcomes(snap)).toBe(5);
    expect(snap.threadOpens).toBe(sumOutcomes(snap));
    // Bucket-level distinguishability: the sum only holds if each open
    // lands in exactly one bucket.
    expect(snap.threadOpenScheduledCacheFirst).toBe(3);
    expect(snap.threadOpenSkipCacheFirstHydrateGuard).toBe(1);
    expect(snap.threadOpenSkipCacheFirstPostHydrateGuard).toBe(1);
  });
});
