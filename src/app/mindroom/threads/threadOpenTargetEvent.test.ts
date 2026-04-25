import { describe, expect, it, vi } from 'vitest';
import {
  makeEvent,
  makeRoom,
  makeTimeline,
} from '../../features/room/RoomTimeline.test.shared';
import { runThreadOpenTargetEvent } from './threadOpenTargetEvent';

describe('runThreadOpenTargetEvent', () => {
  it('loads targeted event context into the thread timeline and queues pending scroll', async () => {
    const root = makeEvent('$root', { isThreadRoot: true });
    const threadTimeline = makeTimeline([]);
    const threadTimelineSet = {
      getLiveTimeline: () => threadTimeline,
    };
    const thread = {
      id: '$root',
      rootEvent: root,
      getUnfilteredTimelineSet: () => threadTimelineSet,
    };
    const room = makeRoom({ liveEvents: [root], threads: [thread as never] });
    const pending = vi.fn();
    const setPendingThreadOpenTick = vi.fn((updater: (value: number) => number) => updater(0));
    const setThreadTimelineTick = vi.fn((updater: (value: number) => number) => updater(0));
    const forceTimelineUpdate = vi.fn();
    const mx = {
      getEventTimeline: vi.fn(async () => threadTimeline),
    };

    const shouldContinue = await runThreadOpenTargetEvent({
      eventId: '$reply',
      forceTimelineUpdate,
      isCurrentThreadOpen: () => true,
      mx: mx as never,
      room: room as never,
      setPendingThreadOpen: pending,
      setPendingThreadOpenTick,
      setThreadTimelineTick,
      shouldScrollToLatestOnOpen: false,
      threadId: '$root',
    });

    expect(shouldContinue).toBe(true);
    expect(mx.getEventTimeline).toHaveBeenCalledWith(threadTimelineSet, '$reply');
    expect(forceTimelineUpdate).toHaveBeenCalledTimes(1);
    expect(setThreadTimelineTick).toHaveBeenCalledTimes(1);
    expect(pending).toHaveBeenCalledWith({
      threadId: '$root',
      eventId: '$reply',
      highlight: true,
      onScroll: undefined,
      attempts: 0,
    });
    expect(setPendingThreadOpenTick).toHaveBeenCalledTimes(1);
  });

  it('does not queue target scroll for latest opens or root-event opens', async () => {
    const room = makeRoom();
    const pending = vi.fn();
    const mx = { getEventTimeline: vi.fn() };

    await expect(
      runThreadOpenTargetEvent({
        eventId: undefined,
        forceTimelineUpdate: vi.fn(),
        isCurrentThreadOpen: () => true,
        mx: mx as never,
        room: room as never,
        setPendingThreadOpen: pending,
        setPendingThreadOpenTick: vi.fn(),
        setThreadTimelineTick: vi.fn(),
        shouldScrollToLatestOnOpen: true,
        threadId: '$root',
      })
    ).resolves.toBe(true);

    await expect(
      runThreadOpenTargetEvent({
        eventId: '$root',
        forceTimelineUpdate: vi.fn(),
        isCurrentThreadOpen: () => true,
        mx: mx as never,
        room: room as never,
        setPendingThreadOpen: pending,
        setPendingThreadOpenTick: vi.fn(),
        setThreadTimelineTick: vi.fn(),
        shouldScrollToLatestOnOpen: false,
        threadId: '$root',
      })
    ).resolves.toBe(true);

    expect(mx.getEventTimeline).not.toHaveBeenCalled();
    expect(pending).not.toHaveBeenCalled();
  });

  it('aborts without queuing scroll when the thread route changes during context load', async () => {
    const root = makeEvent('$root', { isThreadRoot: true });
    const thread = {
      id: '$root',
      rootEvent: root,
      getUnfilteredTimelineSet: () => ({
        getLiveTimeline: () => makeTimeline([]),
      }),
    };
    const room = makeRoom({ liveEvents: [root], threads: [thread as never] });
    const pending = vi.fn();
    const mx = {
      getEventTimeline: vi.fn(async () => makeTimeline([])),
    };

    const shouldContinue = await runThreadOpenTargetEvent({
      eventId: '$reply',
      forceTimelineUpdate: vi.fn(),
      isCurrentThreadOpen: () => false,
      mx: mx as never,
      room: room as never,
      setPendingThreadOpen: pending,
      setPendingThreadOpenTick: vi.fn(),
      setThreadTimelineTick: vi.fn(),
      shouldScrollToLatestOnOpen: false,
      threadId: '$root',
    });

    expect(shouldContinue).toBe(false);
    expect(pending).not.toHaveBeenCalled();
  });
});
