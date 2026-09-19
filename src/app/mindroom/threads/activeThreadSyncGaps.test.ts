import { createClient, Direction, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushThreadSyncGap, observeActiveThreadSyncGaps } from './activeThreadSyncGaps';
import { runThreadOpenCacheFirst } from './threadOpenCacheFirst';
import { runThreadOpenSdkBootstrap } from './threadOpenSdkBootstrap';

const settle = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};
const fixture = () => {
  const client = createClient({
    baseUrl: 'https://example.org',
    userId: '@alice:example.org',
    timelineSupport: true,
  });
  const room = new Room('!room:example.org', client, '@alice:example.org', {
    timelineSupport: true,
  });
  vi.spyOn(client, 'createMessagesRequest').mockImplementation(async (_room, token) => ({
    chunk: [],
    start: 'converted:' + token,
    end: 'converted:' + token,
  }));
  const threads = [0, 1].map((i) => room.createThread('$root-' + i, undefined, [], false));
  return { client, room, threads };
};
describe('active thread sync gaps', () => {
  let support: FeatureSupport;
  beforeEach(() => {
    support = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.None;
  });
  afterEach(() => {
    Thread.hasServerSideSupport = support;
    vi.restoreAllMocks();
  });

  it('opens only the selected thread and waits for tokens before capturing its live chain', async () => {
    const { room, threads, client } = fixture();
    let finish!: (value: any) => void;
    vi.mocked(client.createMessagesRequest).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const old = threads.map((t) => t.liveTimeline);
    room.resetLiveTimeline('back', 'forward');
    let captured = false;
    const opening = flushThreadSyncGap(threads[0])!.then(() => {
      captured = true;
      expect(threads[0].liveTimeline.getPaginationToken(Direction.Backward)).toBe('converted-back');
    });
    await settle();
    expect(captured).toBe(false);
    expect(threads[0].liveTimeline === old[0]).toBe(false);
    expect(threads[1].liveTimeline === old[1]).toBe(true);
    finish({ chunk: [], start: 'converted-forward', end: 'converted-back' });
    await opening;
    expect(captured).toBe(true);
  });

  it('flushes active room gaps after the reset loop and leaves the old selection dormant after switching', async () => {
    const { room, threads } = fixture();
    const changed = vi.fn();
    const stop = observeActiveThreadSyncGaps(room, threads[0], changed);
    await settle();
    room.resetLiveTimeline('back', 'forward');
    await settle();
    expect(threads.map((t) => t.timelineSet.getTimelines().length)).toEqual([2, 1]);
    stop();
    const next = observeActiveThreadSyncGaps(room, threads[1], changed);
    await settle();
    room.resetLiveTimeline('back-2', 'forward-2');
    await settle();
    expect(threads.map((t) => t.timelineSet.getTimelines().length)).toEqual([2, 3]);
    next();
    const calls = changed.mock.calls.length;
    room.resetLiveTimeline('back-3', 'forward-3');
    await settle();
    expect(changed).toHaveBeenCalledTimes(calls);
    expect(threads.map((t) => t.timelineSet.getTimelines().length)).toEqual([2, 3]);
  });

  it('unmounts during conversion without publishing a stale callback', async () => {
    const { room, threads, client } = fixture();
    let finish!: (value: any) => void;
    vi.mocked(client.createMessagesRequest).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    room.resetLiveTimeline('back', 'forward');
    const changed = vi.fn();
    const stop = observeActiveThreadSyncGaps(room, threads[0], changed);
    stop();
    finish({ chunk: [], start: 'converted-forward', end: 'converted-back' });
    await settle();
    expect(changed).not.toHaveBeenCalled();
  });
  it('does not publish or defer opening when the selected thread has no pending gap', async () => {
    const { room, threads } = fixture();
    expect(flushThreadSyncGap(threads[0])).toBeUndefined();
    const changed = vi.fn();
    const stop = observeActiveThreadSyncGaps(room, threads[0], changed);
    await settle();
    expect(changed).not.toHaveBeenCalled();
    stop();
  });
  it('leaves later gaps dormant after switching away during an earlier conversion', async () => {
    const { room, threads, client } = fixture();
    let finish!: (value: any) => void;
    const conversion = new Promise<any>((resolve) => {
      finish = resolve;
    });
    vi.mocked(client.createMessagesRequest)
      .mockReturnValueOnce(conversion)
      .mockReturnValueOnce(conversion);
    room.resetLiveTimeline('back', 'forward');
    const changed = vi.fn();
    const stop = observeActiveThreadSyncGaps(room, threads[0], changed);
    await settle();
    expect(threads[0].timelineSet.getTimelines()).toHaveLength(2);
    stop();
    const stopNext = observeActiveThreadSyncGaps(room, threads[1], vi.fn());
    room.resetLiveTimeline('back-2', 'forward-2');
    expect(threads[0].timelineSet.getTimelines()).toHaveLength(2);
    finish({ chunk: [], start: 'converted-forward', end: 'converted-back' });
    await settle();
    expect(threads[0].timelineSet.getTimelines()).toHaveLength(2);
    expect(changed).not.toHaveBeenCalled();
    stopNext();
    await flushThreadSyncGap(threads[0]);
    expect(threads[0].timelineSet.getTimelines()).toHaveLength(3);
    expect(threads[0].liveTimeline.getPaginationToken(Direction.Backward)).toBe('converted:back-2');
  });

  it.each(['cache', 'sdk'])(
    'stops draining later gaps when an explicit %s open closes during conversion',
    async (mode) => {
      const { room, threads, client } = fixture();
      let finish!: (value: any) => void;
      const conversion = new Promise<any>((resolve) => {
        finish = resolve;
      });
      vi.mocked(client.createMessagesRequest)
        .mockReturnValueOnce(conversion)
        .mockReturnValueOnce(conversion);
      room.resetLiveTimeline('back', 'forward');
      let current = true;
      const hydrate = vi.fn();
      const getThreadTimeline = vi.spyOn(client, 'getThreadTimeline').mockResolvedValue(undefined);
      const notify = vi.fn();
      const opening =
        mode === 'cache'
          ? runThreadOpenCacheFirst({
              room,
              threadId: threads[0].id,
              isCurrentThreadOpen: () => current,
              debugTraceId: undefined,
              hydrateThreadFromCache: hydrate,
              notifyEventsChanged: notify,
              onCacheHydrated: vi.fn(),
              pinThreadToBottomOnOpen: vi.fn(),
              scheduleReconcile: vi.fn(),
              setSupplementalThreadEvents: vi.fn(),
              shouldScrollToLatestOnOpen: false,
              threadOpenSeedSession: { applyInitialUntargetedThreadSeed: vi.fn() },
            })
          : runThreadOpenSdkBootstrap({
              room,
              mx: client,
              threadId: threads[0].id,
              isMounted: () => current,
              debugTraceId: undefined,
              onBootstrap: notify,
              persistThreadEventCache: vi.fn(),
              pinThreadToBottomOnOpen: vi.fn(),
              setSupplementalThreadEvents: vi.fn(),
              shouldScrollToLatestOnOpen: false,
            });
      expect(threads[0].timelineSet.getTimelines()).toHaveLength(2);
      current = false;
      room.resetLiveTimeline('back-2', 'forward-2');
      finish({ chunk: [], start: 'converted-forward', end: 'converted-back' });
      await opening;
      expect(threads[0].timelineSet.getTimelines()).toHaveLength(2);
      expect(hydrate).not.toHaveBeenCalled();
      expect(getThreadTimeline).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
      await flushThreadSyncGap(threads[0]);
      expect(threads[0].timelineSet.getTimelines()).toHaveLength(3);
    }
  );
});
