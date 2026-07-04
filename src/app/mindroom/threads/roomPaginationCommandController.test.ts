import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Direction } from 'matrix-js-sdk';
import { useRoomPaginationCommandController } from './roomPaginationCommandController';
import type { Timeline } from './timelinePagination';

const { loadRoomCachedPaginationSnapshotMock, hydrateCachedEventsMock, reconcileMock } = vi.hoisted(
  () => ({
    loadRoomCachedPaginationSnapshotMock: vi.fn(),
    hydrateCachedEventsMock: vi.fn(() => []),
    reconcileMock: vi.fn(),
  })
);

vi.mock('./eventRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./eventRepository')>();
  return {
    ...actual,
    loadRoomCachedPaginationSnapshot: loadRoomCachedPaginationSnapshotMock,
  };
});

vi.mock('./eventCacheEditUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./eventCacheEditUtils')>();
  return {
    ...actual,
    hydrateCachedEvents: hydrateCachedEventsMock,
    reconcileRelationEventsWithAggregation: reconcileMock,
  };
});

const makeRoomEvent = (eventId: string, threadRootId?: string) =>
  ({
    event: { event_id: eventId, origin_server_ts: 1 },
    getId: () => eventId,
    getSender: () => '@sender:server',
    getType: () => 'm.room.message',
    getContent: () => ({ msgtype: 'm.text', body: eventId }),
    getStateKey: () => undefined,
    getRelation: () => undefined,
    getServerAggregatedRelation: () => undefined,
    getTs: () => 1,
    isRedacted: () => false,
    isRedaction: () => false,
    threadRootId,
  } as never);

const makeTimeline = (events: unknown[]) =>
  ({
    getEvents: () => events,
    getPaginationToken: (direction: Direction) =>
      direction === Direction.Backward ? 'before-token' : undefined,
    setPaginationToken: vi.fn(),
    getNeighbouringTimeline: () => null,
  } as never);

describe('useRoomPaginationCommandController', () => {
  it('uses a bounded interactive cache page size when the preload target is large', async () => {
    const loaded = makeRoomEvent('$loaded');
    const timeline = makeTimeline([loaded]);
    const initialTimeline: Timeline = {
      linkedTimelines: [timeline],
      range: { start: 0, end: 1 },
    };
    let callback: ((backwards: boolean) => Promise<void>) | undefined;
    let renderer: ReactTestRenderer | undefined;

    loadRoomCachedPaginationSnapshotMock.mockResolvedValue({
      status: 'start-known',
    });

    const room = {
      roomId: '!room:server',
      partitionThreadedEvents: vi.fn((events) => [events, [], []]),
      addEventsToTimeline: vi.fn(),
      processThreadRoots: vi.fn(),
      hasEncryptionStateEvent: () => false,
      relations: {},
    } as never;
    const mx = {
      getEventMapper: () => (rawEvent: unknown) => rawEvent,
      processAggregatedTimelineEvents: vi.fn(),
    } as never;

    function Harness() {
      callback = useRoomPaginationCommandController({
        alive: () => true,
        handleTimelinePagination: vi.fn(),
        mx,
        persistRoomEventCache: vi.fn(),
        recalibrateFilterOptsRef: {
          current: {
            room,
            threadId: undefined,
            ignoredUsersSet: new Set(),
            showHiddenEvents: false,
            hideMembershipEvents: false,
            hideNickAvatarEvents: false,
            showThreadRepliesInRoom: true,
          },
        },
        room,
        roomIdRef: { current: '!room:server' },
        roomPaginatingBackRef: { current: false },
        safePaginationLimitRef: { current: 10000 },
        sessionId: 'session',
        setRoomHasMoreCachedBack: vi.fn(),
        setTimeline: vi.fn(),
        threadId: undefined,
        threadIdRef: { current: undefined },
        timeline: initialTimeline,
      });
      return null;
    }

    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    await act(async () => {
      await callback?.(true);
    });

    renderer?.unmount();

    expect(loadRoomCachedPaginationSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200 })
    );
  });

  it('preserves classic thread-reply filtering when recalibrating cached prepend range', async () => {
    const root = makeRoomEvent('$root');
    const reply = makeRoomEvent('$reply', '$root');
    const older = makeRoomEvent('$older');
    const timelineEvents = [root, reply];
    const timeline = makeTimeline(timelineEvents);
    const initialTimeline: Timeline = {
      linkedTimelines: [timeline],
      range: { start: 10, end: 20 },
    };
    let callback: ((backwards: boolean) => Promise<void>) | undefined;
    let recalibratedTimeline: Timeline | undefined;
    let renderer: ReactTestRenderer | undefined;

    loadRoomCachedPaginationSnapshotMock.mockResolvedValue({
      status: 'cache-hit',
      events: [older],
      beforeToken: 'older-before-token',
      hasMoreCachedBack: true,
    });

    const room = {
      roomId: '!room:server',
      partitionThreadedEvents: vi.fn((events) => [events, [], []]),
      addEventsToTimeline: vi.fn((events) => {
        timelineEvents.unshift(...events);
      }),
      processThreadRoots: vi.fn(),
      hasEncryptionStateEvent: () => false,
      relations: {},
    } as never;
    const mx = {
      getEventMapper: () => (rawEvent: unknown) => rawEvent,
      processAggregatedTimelineEvents: vi.fn(),
    } as never;

    function Harness() {
      callback = useRoomPaginationCommandController({
        alive: () => true,
        handleTimelinePagination: vi.fn(),
        mx,
        persistRoomEventCache: vi.fn(),
        recalibrateFilterOptsRef: {
          current: {
            room,
            threadId: undefined,
            ignoredUsersSet: new Set(),
            showHiddenEvents: false,
            hideMembershipEvents: false,
            hideNickAvatarEvents: false,
            showThreadRepliesInRoom: true,
          },
        },
        room,
        roomIdRef: { current: '!room:server' },
        roomPaginatingBackRef: { current: false },
        safePaginationLimitRef: { current: 50 },
        sessionId: 'session',
        setRoomHasMoreCachedBack: vi.fn(),
        setTimeline: (update) => {
          recalibratedTimeline = typeof update === 'function' ? update(initialTimeline) : update;
        },
        threadId: undefined,
        threadIdRef: { current: undefined },
        timeline: initialTimeline,
      });
      return null;
    }

    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    await act(async () => {
      await callback?.(true);
    });

    renderer?.unmount();

    expect(recalibratedTimeline?.range).toEqual({ start: 11, end: 21 });
  });

  it('keeps cached thread replies in the classic room timeline', async () => {
    const root = makeRoomEvent('$root');
    const olderRoot = makeRoomEvent('$older-root');
    const olderReply = makeRoomEvent('$older-reply', '$older-root');
    const timelineEvents = [root];
    const timeline = makeTimeline(timelineEvents);
    const initialTimeline: Timeline = {
      linkedTimelines: [timeline],
      range: { start: 1, end: 1 },
    };
    let callback: ((backwards: boolean) => Promise<void>) | undefined;
    let renderer: ReactTestRenderer | undefined;

    loadRoomCachedPaginationSnapshotMock.mockResolvedValue({
      status: 'cache-hit',
      events: [olderRoot, olderReply],
      beforeToken: 'older-before-token',
      hasMoreCachedBack: true,
    });

    const room = {
      roomId: '!room:server',
      partitionThreadedEvents: vi.fn(() => [[olderRoot], [], [olderReply]]),
      addEventsToTimeline: vi.fn((events) => {
        timelineEvents.unshift(...events);
      }),
      processThreadRoots: vi.fn(),
      hasEncryptionStateEvent: () => false,
      relations: {},
    } as never;
    const mx = {
      getEventMapper: () => (rawEvent: unknown) => rawEvent,
      processAggregatedTimelineEvents: vi.fn(),
    } as never;

    function Harness() {
      callback = useRoomPaginationCommandController({
        alive: () => true,
        handleTimelinePagination: vi.fn(),
        mx,
        persistRoomEventCache: vi.fn(),
        recalibrateFilterOptsRef: {
          current: {
            room,
            threadId: undefined,
            ignoredUsersSet: new Set(),
            showHiddenEvents: false,
            hideMembershipEvents: false,
            hideNickAvatarEvents: false,
            showThreadRepliesInRoom: true,
          },
        },
        room,
        roomIdRef: { current: '!room:server' },
        roomPaginatingBackRef: { current: false },
        safePaginationLimitRef: { current: 50 },
        sessionId: 'session',
        setRoomHasMoreCachedBack: vi.fn(),
        setTimeline: vi.fn(),
        threadId: undefined,
        threadIdRef: { current: undefined },
        timeline: initialTimeline,
      });
      return null;
    }

    await act(async () => {
      renderer = create(React.createElement(Harness));
    });

    await act(async () => {
      await callback?.(true);
    });

    renderer?.unmount();

    expect(room.addEventsToTimeline).toHaveBeenCalledWith(
      [olderRoot, olderReply],
      true,
      false,
      timeline,
      'older-before-token'
    );
    expect(timelineEvents).toEqual([olderRoot, olderReply, root]);
  });
});

// CINNY-207 P3.3 review (PR #69): the explicit persist point for network
// back-pagination must (a) collect the NEWLY FETCHED events — which are
// OLDER than the pre-fetch earliest and sit at the start of the timeline
// when the SDK extends in place — and (b) pass the timeline's backward
// token as the continuity proof for the new overall-earliest cached event.
describe('network back-pagination persist point (CINNY-207 P3.3)', () => {
  it('persists the newly fetched older slice with the backward token', async () => {
    const root = makeRoomEvent('$root');
    const fetchedOld1 = makeRoomEvent('$old-1');
    const fetchedOld2 = makeRoomEvent('$old-2');
    const timelineEvents: unknown[] = [root];
    const timelineObj = {
      getEvents: () => timelineEvents,
      getPaginationToken: (direction: Direction) =>
        direction === Direction.Backward ? 'deeper-before-token' : undefined,
      setPaginationToken: vi.fn(),
      getNeighbouringTimeline: () => null,
    } as never;
    const initialTimeline: Timeline = {
      linkedTimelines: [timelineObj],
      range: { start: 0, end: 1 },
    };
    let callback: ((backwards: boolean) => Promise<void>) | undefined;
    let renderer: ReactTestRenderer | undefined;

    loadRoomCachedPaginationSnapshotMock.mockResolvedValue({ status: 'cache-miss' });
    const persistRoomEventCache = vi.fn();
    const handleTimelinePagination = vi.fn(async () => {
      // SDK extends the same timeline in place: older events prepend.
      timelineEvents.unshift(fetchedOld1, fetchedOld2);
    });

    const room = {
      roomId: '!room:server',
      partitionThreadedEvents: vi.fn((events) => [events, [], []]),
      addEventsToTimeline: vi.fn(),
      processThreadRoots: vi.fn(),
      hasEncryptionStateEvent: () => false,
      relations: {},
    } as never;
    const mx = {
      getEventMapper: () => (rawEvent: unknown) => rawEvent,
      processAggregatedTimelineEvents: vi.fn(),
    } as never;

    function Harness() {
      callback = useRoomPaginationCommandController({
        alive: () => true,
        handleTimelinePagination,
        mx,
        persistRoomEventCache,
        recalibrateFilterOptsRef: { current: undefined },
        room,
        roomIdRef: { current: '!room:server' },
        roomPaginatingBackRef: { current: false },
        safePaginationLimitRef: { current: 50 },
        sessionId: 'session',
        setRoomHasMoreCachedBack: vi.fn(),
        setTimeline: vi.fn(),
        threadId: undefined,
        threadIdRef: { current: undefined },
        timeline: initialTimeline,
      });
      return null;
    }

    await act(async () => {
      renderer = create(React.createElement(Harness));
    });
    await act(async () => {
      await callback?.(true);
    });
    renderer?.unmount();

    expect(handleTimelinePagination).toHaveBeenCalledWith(true);
    expect(persistRoomEventCache).toHaveBeenCalledTimes(1);
    const [persisted, token] = persistRoomEventCache.mock.calls[0];
    // Oldest -> newest, only the newly fetched slice.
    expect((persisted as Array<{ getId: () => string }>).map((e) => e.getId())).toEqual([
      '$old-1',
      '$old-2',
    ]);
    expect(token).toBe('deeper-before-token');
  });
});
