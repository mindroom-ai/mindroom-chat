import { describe, expect, it, vi } from 'vitest';
import { makeEvent, makeRoom } from '../../features/room/RoomTimeline.test.shared';
import { runThreadOpenSdkBootstrap } from './threadOpenSdkBootstrap';

describe('runThreadOpenSdkBootstrap', () => {
  it('completes zero-reply standalone roots without forcing SDK thread creation', async () => {
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
      fetchRelations: vi.fn(),
      getEventMapper: vi.fn(),
      getEventTimeline: vi.fn(),
      getThreadTimeline: vi.fn(),
    };

    const shouldContinue = await runThreadOpenSdkBootstrap({
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
    });

    expect(shouldContinue).toBe(false);
    expect(setThreadTailLoaded).toHaveBeenCalledWith(true);
    expect(setTimeline).toHaveBeenCalledTimes(1);
    expect(setThreadTimelineTick).toHaveBeenCalledTimes(1);
    expect(pinThreadToBottomOnOpen).toHaveBeenCalledTimes(1);
    expect(mx.getEventTimeline).not.toHaveBeenCalled();
    expect(mx.fetchRelations).not.toHaveBeenCalled();
  });
});
