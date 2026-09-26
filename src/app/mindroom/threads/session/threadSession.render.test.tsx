import React, { useEffect, useMemo } from 'react';
import { createClient, Direction, MatrixEvent, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useThreadSession } from './useThreadSession';
import { useThreadTimelineState } from '../useThreadTimelineState';
import type { ThreadOpenRuntime } from './threadSessionTypes';
import { loadThreadCachedSnapshot } from '../eventRepository';

vi.mock('../eventRepository', async (original) => ({
  ...(await original<typeof import('../eventRepository')>()),
  loadThreadCachedSnapshot: vi.fn(() => new Promise(() => {})),
}));
afterEach(() => vi.restoreAllMocks());

it.each(['reply', 'root', 'joined-reply', 'pending-bootstrap'] as const)(
  'renders the available %s through the real render hook while storage stays pending',
  async (mode) => {
    const support = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport =
      mode === 'joined-reply' || mode === 'pending-bootstrap'
        ? FeatureSupport.Stable
        : FeatureSupport.None;
    const mx = createClient({
      baseUrl: 'https://example.org',
      userId: '@alice:example.org',
    });
    const room = new Room('!room:example.org', mx, '@alice:example.org', { timelineSupport: true });
    vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
    const rawRoot = {
      unsigned: {},
      event_id: '$root',
      room_id: room.roomId,
      sender: '@alice:example.org',
      type: 'm.room.message',
      origin_server_ts: 1,
      content: { body: 'Root', msgtype: 'm.text' },
    };
    const root = new MatrixEvent(rawRoot);
    const rawReply = {
      ...rawRoot,
      event_id: '$reply',
      origin_server_ts: 2,
      content: {
        body: 'Fetched reply',
        msgtype: 'm.text',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      },
    };
    const reply = new MatrixEvent(rawReply);
    vi.spyOn(mx, 'fetchRoomEvent').mockImplementation(() =>
      mode === 'pending-bootstrap' ? new Promise(() => {}) : Promise.resolve(rawRoot)
    );
    let finishFallback!: () => void;
    const fallback = new Promise<{ chunk: typeof rawReply[] }>((resolve) => {
      finishFallback = () => resolve({ chunk: [rawReply] });
    });
    vi.spyOn(mx, 'fetchRelations').mockImplementation(() => fallback);
    vi.spyOn(room, 'findEventById').mockImplementation((id) => (id === '$root' ? root : undefined));
    const thread =
      mode === 'reply' || mode === 'pending-bootstrap'
        ? room.createThread('$root', root, [], false)
        : undefined;
    vi.spyOn(mx, 'getThreadTimeline').mockImplementation(async () => {
      if (mode === 'joined-reply') {
        const createdThread = room.getThread('$root')!;
        const existing = createdThread.timelineSet.getTimelineForEvent('$root');
        if (existing) return existing;
        const detached = createdThread.timelineSet.addTimeline();
        createdThread.timelineSet.addEventsToTimeline([reply, root], true, false, detached, null);
        return detached;
      }
      if (!thread) return new Promise(() => {});
      // getThreadTimeline fills the timeline directly, without Thread.NewReply.
      thread.timelineSet.addEventsToTimeline([reply], true, false, thread.liveTimeline, null);
      if (mode === 'pending-bootstrap') return new Promise(() => {});
      return thread.liveTimeline;
    });
    vi.spyOn(mx, 'getEventTimeline').mockResolvedValue(room.getLiveTimeline());
    const persist = vi.fn();
    let renderer!: ReactTestRenderer;
    let sdkReady = false;
    let cacheHydrated = false;
    function Harness() {
      const session = useThreadSession({
        roomId: room.roomId,
        threadId: '$root',
        eventId: mode !== 'root' ? '$reply' : undefined,
      });
      sdkReady = session.snapshot.open.sdkReady;
      cacheHydrated = session.snapshot.open.initialCacheHydrated;
      const timeline = useThreadTimelineState({
        room,
        threadId: '$root',
        threadInitialCacheHydrated: session.snapshot.open.initialCacheHydrated,
        threadInitialSdkLoaded: session.snapshot.open.sdkReady,
        timelineRevision: session.snapshot.timelineRevision,
      });
      const runtime = useMemo<ThreadOpenRuntime>(
        () => ({
          mx,
          room,
          sessionId: 'pending-storage',
          beginCacheWrite: () => persist,
          reconcile: vi.fn(async () => ({
            repaired: false,
            fetchedCount: 0,
            iterations: 0,
            aborted: false,
          })),
          seed: { waitForExistingOrQueued: () => undefined },
          render: {
            reset: timeline.resetThreadRenderState,
            append: timeline.setSupplementalThreadEvents,
            invalidateTimeline: () => undefined,
          },
          viewport: {
            resetForOpen: () => undefined,
            resetAfterLeave: () => undefined,
            requestLatestPin: () => undefined,
          },
        }),
        [timeline.resetThreadRenderState, timeline.setSupplementalThreadEvents]
      );
      useEffect(() => session.commands.startOpen(runtime), [session.commands, runtime]);
      return (
        <>
          {timeline.threadEvents.map((event) => (
            <span key={event.getId()}>{event.getContent().body}</span>
          ))}
        </>
      );
    }
    try {
      await act(async () => {
        renderer = create(<Harness />);
      });
      expect(vi.mocked(loadThreadCachedSnapshot)).toHaveBeenCalled();
      if (mode === 'joined-reply') {
        expect(renderer.root.findAllByType('span').map((node) => node.children.join(''))).toEqual([
          'Root',
        ]);
        expect(mx.fetchRelations).toHaveBeenCalled();
        await act(async () => finishFallback());
        expect(
          room
            .getThread('$root')!
            .timelineSet.getLiveTimeline()
            .getNeighbouringTimeline(Direction.Backward)
        ).toBeTruthy();
      }
      if (mode === 'pending-bootstrap') {
        expect(sdkReady).toBe(false);
        expect(cacheHydrated).toBe(false);
      }
      if (thread) expect(thread.events).toContain(reply);
      expect(renderer.root.findAllByType('span').map((node) => node.children.join(''))).toContain(
        mode !== 'root' ? 'Fetched reply' : 'Root'
      );
    } finally {
      if (renderer) act(() => renderer.unmount());
      Thread.hasServerSideSupport = support;
    }
  }
);
