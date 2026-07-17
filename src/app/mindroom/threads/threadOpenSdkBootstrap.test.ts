import { describe, expect, it, vi } from 'vitest';
import { makeEvent, makeRoom } from './test-utils/RoomTimeline.test.shared';
import { runThreadOpenSdkBootstrap } from './threadOpenSdkBootstrap';

describe('runThreadOpenSdkBootstrap', () => {
  it('creates an SDK thread for zero-reply standalone roots without network bootstrap', async () => {
    const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
    const room = makeRoom({ liveEvents: [root] });
    const setThreadTailLoaded = vi.fn();
    const setThreadTimelineTick = vi.fn((updater: (value: number) => number) => updater(0));
    let timeline = { range: { start: 0, end: 1 } };
    const setTimeline = vi.fn((updater: (current: typeof timeline) => typeof timeline) => {
      timeline = updater(timeline);
    });
    const pinThreadToBottomOnOpen = vi.fn();
    const mx = {
      fetchRelations: vi.fn().mockResolvedValue(undefined),
      getEventMapper: vi.fn(),
      getEventTimeline: vi.fn(),
      getThreadTimeline: vi.fn().mockResolvedValue(undefined),
    };

    const options = {
      debugTraceId: 'test',
      isMounted: () => true,
      mx: mx as never,
      persistThreadEventCache: vi.fn(),
      pinThreadToBottomOnOpen,
      room: room as never,
      setSupplementalThreadEvents: vi.fn(),
      setThreadHasMoreCachedBack: vi.fn(),
      setThreadLoadError: vi.fn(),
      setThreadTailLoaded,
      setThreadTimelineTick,
      setTimeline,
      shouldScrollToLatestOnOpen: true,
      threadId: '$root',
    };
    const shouldContinue = await runThreadOpenSdkBootstrap(options);

    expect(shouldContinue).toBe(false);
    expect(room.createThread).toHaveBeenCalledOnce();
    expect(room.createThread).toHaveBeenCalledWith('$root', root, [], false);
    expect(setThreadTailLoaded).toHaveBeenCalledWith(true);
    expect(setTimeline).toHaveBeenCalledTimes(1);
    expect(setThreadTimelineTick).toHaveBeenCalledTimes(1);
    expect(pinThreadToBottomOnOpen).toHaveBeenCalledTimes(1);
    expect(mx.getEventTimeline).not.toHaveBeenCalled();
    expect(mx.fetchRelations).not.toHaveBeenCalled();

    const createdThread = room.createThread.mock.results[0]?.value;
    expect(createdThread).toBeDefined();
    expect(room.getThread('$root')).toBe(createdThread);

    const secondShouldContinue = await runThreadOpenSdkBootstrap(options);

    expect(secondShouldContinue).toBe(true);
    expect(room.getThread('$root')).toBe(createdThread);
    expect(room.createThread).toHaveBeenCalledOnce();
  });

  it('does not create another SDK thread when the root already has one', async () => {
    const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
    const reply = makeEvent('$reply', {
      relation: { rel_type: 'm.thread', event_id: '$root' },
      threadRootId: '$root',
      ts: 2,
    });
    const threadTimeline = {
      getEvents: () => [],
      getNeighbouringTimeline: () => null,
      getPaginationToken: () => null,
      setPaginationToken: vi.fn(),
    };
    const thread = {
      id: '$root',
      events: [reply],
      rootEvent: root,
      addEvents: vi.fn(),
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => threadTimeline,
      }),
    };
    const room = makeRoom({ liveEvents: [root], threads: [thread as never] });
    const mx = {
      fetchRelations: vi.fn(),
      getEventMapper: vi.fn(),
      getEventTimeline: vi.fn(),
      getThreadTimeline: vi.fn().mockResolvedValue(undefined),
    };

    const shouldContinue = await runThreadOpenSdkBootstrap({
      debugTraceId: 'test',
      isMounted: () => true,
      mx: mx as never,
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
    });

    expect(shouldContinue).toBe(true);
    expect(room.createThread).not.toHaveBeenCalled();
  });
});
