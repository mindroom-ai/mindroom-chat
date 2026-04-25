import { Direction } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  makeEvent,
  makeRoom,
  makeTimeline,
} from './test-utils/RoomTimeline.test.shared';
import { buildThreadCacheCoverage } from './threadCacheCoverage';
import { runThreadOpenCacheFirst } from './threadOpenCacheFirst';

const makeDefaultOptions = () => {
  const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
  const reply = makeEvent('$reply', { threadRootId: '$root', ts: 2 });
  const threadTimeline = makeTimeline([], { backwardToken: 'stale', forwardToken: null });
  const thread = {
    id: '$root',
    rootEvent: root,
    events: [reply],
    getUnfilteredTimelineSet: () => ({
      getLiveTimeline: () => threadTimeline,
    }),
  };
  const room = makeRoom({ liveEvents: [root], threads: [thread as never] });
  const mx = {
    getEventMapper: vi.fn(
      () => (rawEvent: { event_id?: string; origin_server_ts?: number }) => {
        if (rawEvent.event_id === '$root') return root;
        if (rawEvent.event_id === '$reply') return reply;
        return makeEvent(rawEvent.event_id ?? '$unknown');
      }
    ),
  };
  const threadOpenSeedSession = {
    applyInitialUntargetedThreadSeed: vi.fn(),
    mergeWithInitialRoomThreadSeedEvents: vi.fn((events: ReturnType<typeof makeEvent>[]) => events),
  };

  return {
    backfillThreadRelationsIntoCache: vi.fn(),
    debugTraceId: 'test',
    forceTimelineUpdate: vi.fn(),
    hydrateThreadFromCache: vi.fn(),
    isCurrentThreadOpen: vi.fn(() => true),
    mx,
    pinThreadToBottomOnOpen: vi.fn(),
    refreshLatestThreadRelationsTail: vi.fn(async () => true),
    room,
    setThreadHasMoreCachedBack: vi.fn(),
    setThreadInitialCacheHydrated: vi.fn(),
    setThreadTailLoaded: vi.fn(),
    setThreadTimelineTick: vi.fn((updater: (value: number) => number) => updater(0)),
    shouldScrollToLatestOnOpen: true,
    threadId: '$root',
    threadOpenSeedSession,
    threadTimeline,
  };
};

describe('runThreadOpenCacheFirst', () => {
  it('short-circuits network bootstrap when cached thread coverage is complete', async () => {
    const opts = makeDefaultOptions();
    const cachedPage = {
      cacheCoverage: buildThreadCacheCoverage({
        eventCount: 2,
        backwardToken: null,
        hasMoreBackward: false,
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      }),
      events: [{ event_id: '$reply', origin_server_ts: 2 }],
      hasMoreBefore: false,
      relationSnapshotComplete: true,
      rootEvent: { event_id: '$root', origin_server_ts: 1 },
      snapshotComplete: true,
      tailLoaded: true,
    };
    opts.hydrateThreadFromCache.mockResolvedValue(cachedPage);

    const result = await runThreadOpenCacheFirst(opts as never);

    expect(result).toEqual({ hydratedCachedPage: cachedPage, shouldContinue: false });
    expect(opts.threadOpenSeedSession.applyInitialUntargetedThreadSeed).not.toHaveBeenCalled();
    expect(opts.setThreadInitialCacheHydrated).toHaveBeenCalledWith(true);
    expect(opts.threadTimeline.setPaginationToken).toHaveBeenCalledWith(null, Direction.Backward);
    expect(opts.setThreadHasMoreCachedBack).toHaveBeenCalledWith(false);
    expect(opts.setThreadTailLoaded).toHaveBeenCalledWith(true);
    expect(opts.forceTimelineUpdate).toHaveBeenCalledTimes(1);
    expect(opts.refreshLatestThreadRelationsTail).toHaveBeenCalledWith('$root', cachedPage);
    expect(opts.pinThreadToBottomOnOpen).toHaveBeenCalledTimes(1);
    expect(opts.backfillThreadRelationsIntoCache).not.toHaveBeenCalled();
  });

  it('backfills incomplete cached thread relations before falling through to SDK bootstrap', async () => {
    const opts = makeDefaultOptions();
    const cachedPage = {
      cacheCoverage: buildThreadCacheCoverage({
        eventCount: 2,
        backwardToken: 'next',
        hasMoreBackward: true,
        relationSnapshotComplete: false,
        snapshotComplete: false,
        tailLoaded: true,
      }),
      events: [{ event_id: '$reply', origin_server_ts: 2 }],
      expectedReplyCount: 1,
      hasMoreBefore: true,
      relationSnapshotComplete: false,
      rootEvent: { event_id: '$root', origin_server_ts: 1 },
      snapshotComplete: false,
      tailLoaded: true,
    };
    opts.hydrateThreadFromCache.mockResolvedValue(cachedPage);
    opts.backfillThreadRelationsIntoCache.mockResolvedValue({ completed: true, fetchedCount: 0 });

    const result = await runThreadOpenCacheFirst(opts as never);

    expect(result).toEqual({ hydratedCachedPage: cachedPage, shouldContinue: false });
    expect(opts.threadOpenSeedSession.mergeWithInitialRoomThreadSeedEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          getId: expect.any(Function),
        }),
      ])
    );
    expect(opts.backfillThreadRelationsIntoCache).toHaveBeenCalledWith(
      '$root',
      cachedPage.rootEvent,
      expect.arrayContaining([
        expect.objectContaining({
          getId: expect.any(Function),
        }),
      ]),
      1
    );
    expect(opts.pinThreadToBottomOnOpen).toHaveBeenCalledTimes(1);
    expect(opts.refreshLatestThreadRelationsTail).not.toHaveBeenCalled();
  });

  it('applies the initial seed and continues when no usable cache exists', async () => {
    const opts = makeDefaultOptions();
    opts.hydrateThreadFromCache.mockResolvedValue(undefined);

    const result = await runThreadOpenCacheFirst(opts as never);

    expect(result).toEqual({ hydratedCachedPage: undefined, shouldContinue: true });
    expect(opts.threadOpenSeedSession.applyInitialUntargetedThreadSeed).toHaveBeenCalledTimes(1);
    expect(opts.setThreadInitialCacheHydrated).toHaveBeenCalledWith(true);
    expect(opts.backfillThreadRelationsIntoCache).not.toHaveBeenCalled();
    expect(opts.refreshLatestThreadRelationsTail).not.toHaveBeenCalled();
  });
});
