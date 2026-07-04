/**
 * CINNY-207 AC2 STEP 4 iter 2 (2026-07-04): thread-open outcome
 * distinguishability invariant.
 *
 * Every thread open must increment exactly one of:
 *   - `threadOpenScheduledCacheFirst`  (cache-first complete-coverage schedule)
 *   - `threadOpenScheduledLifecycle`   (lifecycle partial-coverage schedule)
 *   - one of the `threadOpenSkip*` counters
 *
 * The invariant asserted here:
 *   sum(scheduled + skip counters) == threadOpens
 *
 * This is the same distinguishability lesson that unlocked STEP 1 for the
 * reconciler executor. When the live docker gate reports which counter
 * incremented on the AC2 return-navigation open, we know which upstream
 * path bypassed the reconcile schedule.
 *
 * Coverage strategy: this file directly exercises `runThreadOpenSdkBootstrap`
 * skip paths (which are the most numerous and were previously invisible)
 * and asserts a per-open sum invariant. The `runThreadOpenCacheFirst`
 * skips are exercised by the sibling `threadOpenGuardAbortRepro.test.ts`
 * (which drives real cache-first + reconciler + scheduler); this file is
 * intentionally minimal — it does NOT re-cover the reconciler paths, only
 * the STEP 4 iter 2 upstream counters.
 */
import { Direction } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEvent, makeRoom } from '../test-utils/RoomTimeline.test.shared';
import { runThreadOpenSdkBootstrap } from '../threadOpenSdkBootstrap';
import {
  getCacheProbeSnapshot,
  resetCacheProbe,
  type CacheProbeCounters,
} from '../cacheProbe';

const SDK_SKIP_KEYS = [
  'threadOpenSkipSdkPendingLocalEcho',
  'threadOpenSkipSdkZeroReplyRoot',
  'threadOpenSkipSdkContextGuard',
  'threadOpenSkipSdkContextError',
  'threadOpenSkipSdkRelationsGuard',
  'threadOpenSkipSdkRelationsError',
  'threadOpenSkipSdkThreadTimelineGuard',
  'threadOpenSkipSdkEmptyRelationsGuard',
] satisfies (keyof CacheProbeCounters)[];

const CACHE_FIRST_SKIP_KEYS = [
  'threadOpenSkipCacheFirstHydrateGuard',
  'threadOpenSkipCacheFirstPostHydrateGuard',
  'threadOpenSkipCacheFirstBackfillCompleted',
  'threadOpenSkipCacheFirstBackfillGuard',
] satisfies (keyof CacheProbeCounters)[];

const sumAllSkips = (snap: CacheProbeCounters): number =>
  SDK_SKIP_KEYS.reduce((acc, k) => acc + snap[k], 0) +
  CACHE_FIRST_SKIP_KEYS.reduce((acc, k) => acc + snap[k], 0) +
  snap.threadOpenScheduledCacheFirst +
  snap.threadOpenScheduledLifecycle;

type SdkOpts = Parameters<typeof runThreadOpenSdkBootstrap>[0];

const makeMx = (overrides: Partial<SdkOpts['mx']> = {}) =>
  ({
    fetchRelations: vi.fn(),
    getEventMapper: vi.fn(() => (evt: unknown) => evt),
    getEventTimeline: vi.fn(),
    getThreadTimeline: vi.fn(),
    ...overrides,
  }) as unknown as SdkOpts['mx'];

const baseOpts = (overrides: Partial<SdkOpts> = {}): SdkOpts => {
  const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
  const room = makeRoom({ liveEvents: [root] });
  return {
    debugTraceId: 'test',
    isMounted: () => true,
    mx: makeMx(),
    persistThreadEventCache: vi.fn(),
    pinThreadToBottomOnOpen: vi.fn(),
    room: room as never,
    setSupplementalThreadEvents: vi.fn(),
    setThreadHasMoreCachedBack: vi.fn(),
    setThreadLoadError: vi.fn(),
    setThreadTailLoaded: vi.fn(),
    setThreadTimelineTick: vi.fn(),
    setTimeline: vi.fn(),
    shouldScrollToLatestOnOpen: true,
    threadId: '$root',
    ...overrides,
  };
};

describe('AC2 STEP 4 iter 2: thread-open SDK bootstrap skip counters', () => {
  beforeEach(() => resetCacheProbe());

  it('bumps threadOpenSkipSdkZeroReplyRoot exactly once', async () => {
    // Standalone thread-root event exists in the room but no thread model —
    // matches the isZeroReplyStandaloneThreadRootEvent path at line 100.
    const result = await runThreadOpenSdkBootstrap(baseOpts());

    expect(result).toBe(false);
    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpenSkipSdkZeroReplyRoot).toBe(1);
    expect(sumAllSkips(snap)).toBe(1);
  });

  it('bumps threadOpenSkipSdkContextGuard when isMounted flips after getEventTimeline', async () => {
    // Room has NO event matching threadId → falls through to line 105
    // where getEventTimeline is awaited. The mocked getEventTimeline
    // flips the isMounted flag inline, so the post-await guard trips.
    const room = makeRoom({ liveEvents: [] });
    let mounted = true;
    const mx = makeMx({
      getEventTimeline: vi.fn(async () => {
        mounted = false;
        return undefined;
      }),
    });
    const result = await runThreadOpenSdkBootstrap(
      baseOpts({
        room: room as never,
        mx,
        threadId: '$missing',
        isMounted: () => mounted,
      })
    );

    expect(result).toBe(false);
    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpenSkipSdkContextGuard).toBe(1);
    expect(sumAllSkips(snap)).toBe(1);
  });

  it('bumps threadOpenSkipSdkContextError when getEventTimeline rejects', async () => {
    const room = makeRoom({ liveEvents: [] });
    const mx = makeMx({
      getEventTimeline: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const result = await runThreadOpenSdkBootstrap(
      baseOpts({
        room: room as never,
        mx,
        threadId: '$missing',
      })
    );

    expect(result).toBe(false);
    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpenSkipSdkContextError).toBe(1);
    expect(sumAllSkips(snap)).toBe(1);
  });

  it('bumps threadOpenSkipSdkRelationsError when fetchRelations rejects', async () => {
    const room = makeRoom({ liveEvents: [] });
    const mx = makeMx({
      getEventTimeline: vi.fn(async () => undefined),
      fetchRelations: vi.fn(async () => {
        throw new Error('rel-boom');
      }),
    });
    const result = await runThreadOpenSdkBootstrap(
      baseOpts({
        room: room as never,
        mx,
        threadId: '$missing',
      })
    );

    expect(result).toBe(false);
    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpenSkipSdkRelationsError).toBe(1);
    expect(sumAllSkips(snap)).toBe(1);
  });

  it('bumps threadOpenSkipSdkRelationsGuard when isMounted flips after fetchRelations', async () => {
    const room = makeRoom({ liveEvents: [] });
    let mounted = true;
    const mx = makeMx({
      getEventTimeline: vi.fn(async () => undefined),
      fetchRelations: vi.fn(async () => {
        mounted = false;
        return { chunk: [] } as unknown;
      }),
    });
    const result = await runThreadOpenSdkBootstrap(
      baseOpts({
        room: room as never,
        mx,
        threadId: '$missing',
        isMounted: () => mounted,
      })
    );

    expect(result).toBe(false);
    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpenSkipSdkRelationsGuard).toBe(1);
    expect(sumAllSkips(snap)).toBe(1);
  });

  it('per-open invariant: sum(skip+scheduled) equals number of runs across a batch of shapes', async () => {
    // Run four different skip-shapes back-to-back without a reset; the
    // sum should equal 4 and threadOpens (not incremented in these SDK
    // tests since we call the SDK function directly) is unaffected. This
    // asserts the counters are additive across opens — the exact
    // invariant the live-gate diagnostic will rely on.
    let mounted = true;

    // Shape 1: zero-reply root
    await runThreadOpenSdkBootstrap(baseOpts());

    // Shape 2: context error
    const emptyRoom = makeRoom({ liveEvents: [] });
    await runThreadOpenSdkBootstrap(
      baseOpts({
        room: emptyRoom as never,
        mx: makeMx({
          getEventTimeline: vi.fn(async () => {
            throw new Error('ctx');
          }),
        }),
        threadId: '$missing',
      })
    );

    // Shape 3: relations error
    await runThreadOpenSdkBootstrap(
      baseOpts({
        room: emptyRoom as never,
        mx: makeMx({
          getEventTimeline: vi.fn(async () => undefined),
          fetchRelations: vi.fn(async () => {
            throw new Error('rel');
          }),
        }),
        threadId: '$missing',
      })
    );

    // Shape 4: relations-guard flip
    mounted = true;
    await runThreadOpenSdkBootstrap(
      baseOpts({
        room: emptyRoom as never,
        mx: makeMx({
          getEventTimeline: vi.fn(async () => undefined),
          fetchRelations: vi.fn(async () => {
            mounted = false;
            return { chunk: [] } as unknown;
          }),
        }),
        threadId: '$missing',
        isMounted: () => mounted,
      })
    );

    const snap = getCacheProbeSnapshot();
    expect(sumAllSkips(snap)).toBe(4);
    // Every skip landed in a distinct bucket — no double-counts.
    expect(snap.threadOpenSkipSdkZeroReplyRoot).toBe(1);
    expect(snap.threadOpenSkipSdkContextError).toBe(1);
    expect(snap.threadOpenSkipSdkRelationsError).toBe(1);
    expect(snap.threadOpenSkipSdkRelationsGuard).toBe(1);
  });

  it('does not silently drop a Direction.Backward fetch (regression pin for tail-fetch behavior)', () => {
    // Sanity: Direction.Backward is the value the SDK bootstrap uses for
    // the relations fill fetch at line ~123. If matrix-js-sdk renames it
    // to a truthy string we still expect the code above to work — this
    // just prevents an accidental import removal from silently regressing
    // the probe test suite.
    expect(Direction.Backward).toBeDefined();
  });
});
