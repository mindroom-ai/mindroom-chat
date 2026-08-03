import React from 'react';
import { Direction, MatrixEvent } from 'matrix-js-sdk';
import type { EventTimeline, MatrixClient, Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveThreadOpenExpectedReplyCount,
  useThreadOpenCacheController,
  type ThreadOpenCacheController,
} from './threadOpenCacheController';
import type { BackfillScheduler } from '../engine';

const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-root:example.org';

const makeMessageEvent = (eventId: string, ts: number, threadRootId?: string) =>
  new MatrixEvent({
    content: {
      body: eventId,
      msgtype: 'm.text',
      ...(threadRootId ? { 'm.relates_to': { event_id: threadRootId, rel_type: 'm.thread' } } : {}),
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: ROOM_ID,
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

/**
 * Minimal EventTimeline stand-in: single timeline (no neighbours) with a
 * mutable backward pagination token, so getLinkedTimelines resolves to
 * exactly this timeline.
 */
const makeTimeline = (initialBackwardToken: string | null) => {
  let backwardToken = initialBackwardToken;
  const timeline = {
    getPaginationToken: vi.fn((dir: Direction) =>
      dir === Direction.Backward ? backwardToken : null
    ),
    setPaginationToken: vi.fn((token: string | null, dir: Direction) => {
      if (dir === Direction.Backward) backwardToken = token;
    }),
    getNeighbouringTimeline: vi.fn(() => null),
  };
  return timeline as unknown as EventTimeline & typeof timeline;
};

type HarnessProps = {
  mx: MatrixClient;
  room: Room;
  overrides?: Partial<Parameters<typeof useThreadOpenCacheController>[0]>;
  onRender: (controller: ThreadOpenCacheController) => void;
};

function Harness({ mx, room, overrides, onRender }: HarnessProps) {
  const controller = useThreadOpenCacheController({
    alive: () => true,
    debugTraceId: undefined,
    forceTimelineUpdate: () => undefined,
    mx,
    persistThreadEventCache: () => undefined,
    room,
    roomIdRef: { current: ROOM_ID },
    scheduler: { enqueue: vi.fn() } as unknown as BackfillScheduler,
    sessionId: 'session',
    setSupplementalThreadEvents: () => undefined,
    setThreadHasMoreCachedBack: () => undefined,
    setThreadTailLoaded: () => undefined,
    setThreadTimelineTick: () => undefined,
    threadIdRef: { current: THREAD_ID },
    ...overrides,
  });
  onRender(controller);
  return null;
}

const renderController = async (
  mx: MatrixClient,
  room: Room,
  overrides?: HarnessProps['overrides']
): Promise<{ controller: ThreadOpenCacheController; renderer: ReactTestRenderer }> => {
  let controller: ThreadOpenCacheController | undefined;
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      React.createElement(Harness, {
        mx,
        room,
        overrides,
        onRender: (value) => {
          controller = value;
        },
      })
    );
  });
  if (!controller || !renderer) throw new Error('controller not rendered');
  return { controller, renderer };
};

describe('resolveThreadOpenExpectedReplyCount', () => {
  it('keeps a relation-complete durable decrease over stale live-root metadata', () => {
    const replyEventIds = Array.from({ length: 23 }, (_, index) => `$reply-${index}`);
    const liveRootEvent = new MatrixEvent({
      content: { body: 'root', msgtype: 'm.text' },
      event_id: THREAD_ID,
      origin_server_ts: 1_000,
      room_id: ROOM_ID,
      sender: '@alice:example.org',
      type: 'm.room.message',
      unsigned: { 'm.relations': { 'm.thread': { count: 24 } } },
    });

    expect(
      resolveThreadOpenExpectedReplyCount({
        liveRootEvent,
        cachedPage: {
          expectedReplyCount: 23,
          expectedReplyCountEvidence: {
            knownEventIds: replyEventIds,
            visibleEventIds: replyEventIds,
          },
          relationSnapshotComplete: true,
        },
      })
    ).toBe(23);
  });

  it('still prefers live-root metadata over an unproven cached lower bound', () => {
    const liveRootEvent = new MatrixEvent({
      content: { body: 'root', msgtype: 'm.text' },
      event_id: THREAD_ID,
      origin_server_ts: 1_000,
      room_id: ROOM_ID,
      sender: '@alice:example.org',
      type: 'm.room.message',
      unsigned: { 'm.relations': { 'm.thread': { count: 25 } } },
    });

    expect(
      resolveThreadOpenExpectedReplyCount({
        liveRootEvent,
        cachedPage: {
          expectedReplyCount: 23,
          relationSnapshotComplete: false,
        },
      })
    ).toBe(25);
  });

  it('keeps an evidenced partial durable total above stale live-root metadata', () => {
    const liveRootEvent = new MatrixEvent({
      content: { body: 'root', msgtype: 'm.text' },
      event_id: THREAD_ID,
      origin_server_ts: 1_000,
      room_id: ROOM_ID,
      sender: '@alice:example.org',
      type: 'm.room.message',
      unsigned: { 'm.relations': { 'm.thread': { count: 282 } } },
    });

    expect(
      resolveThreadOpenExpectedReplyCount({
        liveRootEvent,
        cachedPage: {
          expectedReplyCount: 322,
          expectedReplyCountEvidence: {
            knownEventIds: ['$known'],
            visibleEventIds: ['$known'],
          },
          relationSnapshotComplete: false,
        },
      })
    ).toBe(322);
  });
});

describe('refreshLatestThreadSlice', () => {
  const setup = (initialBackwardToken: string | null, exhaustAfterPaginateCall?: number) => {
    const timeline = makeTimeline(initialBackwardToken);
    const rootEvent = makeMessageEvent(THREAD_ID, 1_000);
    const replyEvent = makeMessageEvent('$reply-1:example.org', 2_000, THREAD_ID);
    const thread = {
      getUnfilteredTimelineSet: () => ({ getLiveTimeline: () => timeline }),
      events: [replyEvent],
      rootEvent,
    };
    const room = {
      roomId: ROOM_ID,
      getThread: vi.fn((threadId: string) => (threadId === THREAD_ID ? thread : null)),
      findEventById: vi.fn((eventId: string) => (eventId === THREAD_ID ? rootEvent : undefined)),
    } as unknown as Room;
    const paginateEventTimeline = vi.fn(async () => {
      if (
        exhaustAfterPaginateCall !== undefined &&
        paginateEventTimeline.mock.calls.length >= exhaustAfterPaginateCall
      ) {
        timeline.setPaginationToken(null, Direction.Backward);
      }
      return true;
    });
    const mx = {
      getEventMapper: () => (rawEvent: Record<string, unknown>) =>
        new MatrixEvent(rawEvent as ConstructorParameters<typeof MatrixEvent>[0]),
      paginateEventTimeline,
    } as unknown as MatrixClient;
    return { mx, room, thread, timeline, rootEvent, replyEvent, paginateEventTimeline };
  };

  it('drains backward history to exhaustion so the open leaves a complete snapshot', async () => {
    // The eager-cache contract (2026-07-06): a thread open is the fallback
    // downloader when the background prefetch has not covered this thread
    // yet — it MUST finish with the full history cached, not a partial
    // window. Token exhausts after 3 pages; expect exactly 3 paginations.
    const { mx, room, paginateEventTimeline } = setup('token-deep-history', 3);
    const persistThreadEventCache = vi.fn();
    const setThreadHasMoreCachedBack = vi.fn();
    const setThreadTailLoaded = vi.fn();
    const { controller } = await renderController(mx, room, {
      persistThreadEventCache,
      setThreadHasMoreCachedBack,
      setThreadTailLoaded,
    });

    let result: boolean | undefined;
    await act(async () => {
      result = await controller.refreshLatestThreadSlice(THREAD_ID);
    });

    expect(result).toBe(true);
    expect(paginateEventTimeline).toHaveBeenCalledTimes(3);
    expect(persistThreadEventCache).toHaveBeenCalledTimes(1);
    const [threadId, , , beforeToken, tailLoaded, snapshotComplete] =
      persistThreadEventCache.mock.calls[0];
    expect(threadId).toBe(THREAD_ID);
    expect(beforeToken).toBeNull();
    expect(tailLoaded).toBe(true);
    expect(snapshotComplete).toBe(true);
    expect(setThreadHasMoreCachedBack).toHaveBeenLastCalledWith(false);
    expect(setThreadTailLoaded).toHaveBeenLastCalledWith(true);
  });

  it('records a complete snapshot when a single page exhausts the token', async () => {
    const { mx, room, paginateEventTimeline } = setup('token-last-page', 1);
    const persistThreadEventCache = vi.fn();
    const setThreadHasMoreCachedBack = vi.fn();
    const { controller } = await renderController(mx, room, {
      persistThreadEventCache,
      setThreadHasMoreCachedBack,
    });

    await act(async () => {
      await controller.refreshLatestThreadSlice(THREAD_ID);
    });

    expect(paginateEventTimeline).toHaveBeenCalledTimes(1);
    expect(persistThreadEventCache).toHaveBeenCalledTimes(1);
    const [, , , beforeToken, tailLoaded, snapshotComplete] = persistThreadEventCache.mock.calls[0];
    expect(beforeToken).toBeNull();
    expect(tailLoaded).toBe(true);
    expect(snapshotComplete).toBe(true);
    expect(setThreadHasMoreCachedBack).toHaveBeenLastCalledWith(false);
  });

  it('skips pagination entirely when the SDK has no backward token', async () => {
    const { mx, room, paginateEventTimeline } = setup(null);
    const persistThreadEventCache = vi.fn();
    const { controller } = await renderController(mx, room, { persistThreadEventCache });

    await act(async () => {
      await controller.refreshLatestThreadSlice(THREAD_ID);
    });

    expect(paginateEventTimeline).not.toHaveBeenCalled();
    expect(persistThreadEventCache).toHaveBeenCalledTimes(1);
  });
});
