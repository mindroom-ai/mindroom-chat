import { MatrixEvent, Room, type MatrixClient } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { describe, expect, it, vi } from 'vitest';
import { makeEvent, makeRoom } from './test-utils/RoomTimeline.test.shared';
import { runThreadOpenSdkBootstrap } from './threadOpenSdkBootstrap';

const flushAsyncWork = async (cycles = 5) => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
};

describe('runThreadOpenSdkBootstrap', () => {
  it('creates an initialized SDK thread and runs first-open timeline bootstrap', async () => {
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
    expect(mx.getThreadTimeline).toHaveBeenCalledOnce();
    expect(mx.fetchRelations).toHaveBeenCalledOnce();

    const createdThread = room.createThread.mock.results[0]?.value;
    expect(createdThread).toBeDefined();
    expect(room.getThread('$root')).toBe(createdThread);
    expect(createdThread?.initialEventsFetched).toBe(true);
    expect(createdThread?.replayEvents).toBeNull();

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

  it('keeps first-open backfill and a racing reply when SDK metadata initialization completes', async () => {
    const previousThreadSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;

    let resolveRootFetch: ((event: Record<string, unknown>) => void) | undefined;
    const rootFetch = new Promise<Record<string, unknown>>((resolve) => {
      resolveRootFetch = resolve;
    });
    const paginateEventTimeline = vi.fn().mockRejectedValue(new Error('pagination failed'));
    let room: Room;
    const getThreadTimeline = vi.fn(async () => {
      const existingReply = new MatrixEvent({
        content: {
          body: 'Existing reply',
          msgtype: 'm.text',
          'm.relates_to': { event_id: '$root', rel_type: 'm.thread' },
        },
        event_id: '$existing-reply',
        origin_server_ts: 2,
        room_id: room.roomId,
        sender: '@bob:example.org',
        type: 'm.room.message',
      });
      room.getThread('$root')?.addEvent(existingReply, false);
    });
    const client = {
      canSupport: new Map(),
      fetchRoomEvent: vi.fn(() => rootFetch),
      fetchRelations: vi.fn().mockResolvedValue(undefined),
      getEventMapper:
        () =>
        (event: Record<string, unknown>): MatrixEvent =>
          event instanceof MatrixEvent ? event : new MatrixEvent(event),
      getUserId: () => '@alice:example.org',
      getThreadTimeline,
      paginateEventTimeline,
      supportsThreads: () => true,
    } as unknown as MatrixClient;
    room = new Room('!room:example.org', client, '@alice:example.org');
    const root = new MatrixEvent({
      content: { body: 'Root', msgtype: 'm.text' },
      event_id: '$root',
      origin_server_ts: 1,
      room_id: room.roomId,
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    room.getUnfilteredTimelineSet().addEventToTimeline(root, room.getLiveTimeline(), {
      addToState: false,
      roomState: room.currentState,
      toStartOfTimeline: false,
    });

    try {
      await runThreadOpenSdkBootstrap({
        debugTraceId: 'test',
        isMounted: () => true,
        mx: client,
        persistThreadEventCache: vi.fn(),
        pinThreadToBottomOnOpen: vi.fn(),
        room,
        setSupplementalThreadEvents: vi.fn(),
        setThreadHasMoreCachedBack: vi.fn(),
        setThreadLoadError: vi.fn(),
        setThreadTailLoaded: vi.fn(),
        setThreadTimelineTick: vi.fn(),
        setTimeline: vi.fn(),
        shouldScrollToLatestOnOpen: true,
        threadId: '$root',
      });

      const thread = room.getThread('$root');
      expect(thread).not.toBeNull();
      expect(thread?.events.map((event) => event.getId())).toContain('$existing-reply');

      const reply = new MatrixEvent({
        content: {
          body: 'Reply',
          msgtype: 'm.text',
          'm.relates_to': { event_id: '$root', rel_type: 'm.thread' },
        },
        event_id: '$reply',
        origin_server_ts: 2,
        room_id: room.roomId,
        sender: '@alice:example.org',
        type: 'm.room.message',
      });
      thread?.addEvent(reply, false);
      expect(thread?.events).toContain(reply);

      resolveRootFetch?.(root.event as unknown as Record<string, unknown>);
      await flushAsyncWork();

      expect(thread?.events).toContain(reply);
      expect(thread?.events.map((event) => event.getId())).toContain('$existing-reply');
      expect(paginateEventTimeline).not.toHaveBeenCalled();
      expect(getThreadTimeline).toHaveBeenCalledOnce();
    } finally {
      Thread.hasServerSideSupport = previousThreadSupport;
    }
  });
});
