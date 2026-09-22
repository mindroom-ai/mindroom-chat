import React, { useEffect, useMemo } from 'react';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
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

it('renders a deep-linked server reply through the real render hook while storage stays pending', async () => {
  const support = Thread.hasServerSideSupport;
  Thread.hasServerSideSupport = FeatureSupport.None;
  const mx = createClient({
    baseUrl: 'https://example.org',
    userId: '@alice:example.org',
  });
  const room = new Room('!room:example.org', mx, '@alice:example.org');
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  const root = new MatrixEvent({
    event_id: '$root',
    room_id: room.roomId,
    sender: '@alice:example.org',
    type: 'm.room.message',
    origin_server_ts: 1,
    content: { body: 'Root', msgtype: 'm.text' },
  });
  const reply = new MatrixEvent({
    ...root.event,
    event_id: '$reply',
    origin_server_ts: 2,
    content: {
      body: 'Fetched reply',
      msgtype: 'm.text',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    },
  });
  const thread = room.createThread('$root', root, [], false);
  vi.spyOn(mx, 'getThreadTimeline').mockImplementation(async () => {
    // getThreadTimeline fills the timeline directly, without Thread.NewReply.
    thread.timelineSet.addEventsToTimeline([reply], true, false, thread.liveTimeline, null);
    return thread.liveTimeline;
  });
  vi.spyOn(mx, 'getEventTimeline').mockResolvedValue(thread.liveTimeline);
  const persist = vi.fn();
  let renderer!: ReactTestRenderer;
  function Harness() {
    const session = useThreadSession({ roomId: room.roomId, threadId: '$root', eventId: '$reply' });
    const timeline = useThreadTimelineState({
      room,
      threadId: '$root',
      threadInitialCacheHydrated: session.snapshot.open.initialCacheHydrated,
      threadInitialSdkLoaded: session.snapshot.open.sdkReady,
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
    expect(thread.events).toContain(reply);
    expect(renderer.root.findAllByType('span').map((node) => node.children.join(''))).toContain(
      'Fetched reply'
    );
  } finally {
    if (renderer) act(() => renderer.unmount());
    Thread.hasServerSideSupport = support;
  }
});
