import { createClient, Direction, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushThreadSyncGap, observeActiveThreadSyncGaps } from './activeThreadSyncGaps';

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
});
