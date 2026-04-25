import { describe, expect, it, vi } from 'vitest';
import {
  makeEvent,
  makeRoom,
  makeTimeline,
} from '../../features/room/RoomTimeline.test.shared';
import { runThreadOpenPostBootstrapRefresh } from './threadOpenPostBootstrapRefresh';

describe('runThreadOpenPostBootstrapRefresh', () => {
  it('refreshes targeted opens from latest relations and reconciles the backward token', async () => {
    const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
    const reply = makeEvent('$reply', { threadRootId: '$root', ts: 2 });
    const threadTimeline = makeTimeline([], { backwardToken: 'stale', forwardToken: null });
    const thread = {
      id: '$root',
      rootEvent: root,
      events: [] as ReturnType<typeof makeEvent>[],
      addEvents: vi.fn((events: ReturnType<typeof makeEvent>[]) => {
        thread.events.push(...events);
      }),
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => threadTimeline,
      }),
    };
    const room = makeRoom({ liveEvents: [root], threads: [thread as never] });
    const mx = {
      fetchRelations: vi.fn(async () => ({
        chunk: [{ event_id: '$reply', origin_server_ts: 2 }],
        next_batch: null,
      })),
      getEventMapper: vi.fn(
        () => (rawEvent: { event_id: string; origin_server_ts?: number }) =>
          rawEvent.event_id === '$reply' ? reply : makeEvent(rawEvent.event_id)
      ),
    };
    const persistThreadEventCache = vi.fn();
    const setSupplementalThreadEvents = vi.fn();
    const setThreadHasMoreCachedBack = vi.fn();
    const setThreadTailLoaded = vi.fn();

    const shouldContinue = await runThreadOpenPostBootstrapRefresh({
      debugTraceId: 'test',
      isCurrentThreadOpen: () => true,
      mx: mx as never,
      persistThreadEventCache,
      refreshLatestThreadSlice: vi.fn(),
      room: room as never,
      setSupplementalThreadEvents,
      setThreadHasMoreCachedBack,
      setThreadTailLoaded,
      shouldScrollToLatestOnOpen: false,
      threadId: '$root',
    });

    expect(shouldContinue).toBe(true);
    expect(thread.addEvents).toHaveBeenCalledWith([reply], false);
    expect(setSupplementalThreadEvents).toHaveBeenCalledWith('$root', [reply]);
    expect(persistThreadEventCache).toHaveBeenCalledWith('$root', [reply], root, null);
    expect(mx.fetchRelations).toHaveBeenCalledWith(
      '!room:example.org',
      '$root',
      'm.thread',
      null,
      expect.objectContaining({ limit: 200 })
    );
    expect(setThreadTailLoaded).toHaveBeenCalledWith(true);
  });

  it('delegates untargeted opens to the latest thread-slice refresh command', async () => {
    const refreshLatestThreadSlice = vi.fn(async () => true);
    const room = makeRoom();

    const shouldContinue = await runThreadOpenPostBootstrapRefresh({
      debugTraceId: 'test',
      isCurrentThreadOpen: () => true,
      mx: {} as never,
      persistThreadEventCache: vi.fn(),
      refreshLatestThreadSlice,
      room: room as never,
      setSupplementalThreadEvents: vi.fn(),
      setThreadHasMoreCachedBack: vi.fn(),
      setThreadTailLoaded: vi.fn(),
      shouldScrollToLatestOnOpen: true,
      threadId: '$root',
    });

    expect(shouldContinue).toBe(true);
    expect(refreshLatestThreadSlice).toHaveBeenCalledWith('$root');
  });
});
