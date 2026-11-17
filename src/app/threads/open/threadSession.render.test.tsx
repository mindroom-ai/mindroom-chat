import { useEffect, useMemo } from 'react';
import { createClient, Direction, MatrixEvent, Room } from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useThreadSession } from './useThreadSession';
import { useThreadTimelineState } from '../../timeline/useThreadTimelineState';
import type { ThreadOpenRuntime } from './threadSessionTypes';
import { loadThreadCachedSnapshot } from '../../event-store/cache/eventRepository';
import { hydrateCachedLongText } from '../../event-store/cache/attachmentRepository';

vi.mock('../../event-store/cache/eventRepository', async (original) => ({
  ...(await original<typeof import('../../event-store/cache/eventRepository')>()),
  loadThreadCachedSnapshot: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../../event-store/cache/attachmentRepository', async (original) => ({
  ...(await original<typeof import('../../event-store/cache/attachmentRepository')>()),
  hydrateCachedLongText: vi.fn(async () => ({})),
}));
afterEach(() => vi.restoreAllMocks());

const mountThreadSession = async ({
  mx,
  room,
  eventId,
}: {
  mx: ReturnType<typeof createClient>;
  room: Room;
  eventId?: string;
}) => {
  let renderer!: ReactTestRenderer;
  function Harness({ threadId }: { threadId: string }) {
    const session = useThreadSession({ roomId: room.roomId, threadId, eventId });
    const timeline = useThreadTimelineState({
      room,
      threadId,
      threadInitialCacheHydrated: session.snapshot.open.initialCacheHydrated,
      threadInitialSdkLoaded: session.snapshot.open.sdkReady,
      threadFirstPaintHeld: session.snapshot.open.firstPaintHeld,
      timelineRevision: session.snapshot.timelineRevision,
    });
    const runtime = useMemo<ThreadOpenRuntime>(
      () => ({
        mx,
        room,
        sessionId: 'pending-storage',
        beginCacheWrite: () => vi.fn(),
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
          getEvents: timeline.getThreadRenderEvents,
          invalidateTimeline: () => undefined,
        },
        viewport: {
          resetForOpen: () => undefined,
          resetAfterLeave: () => undefined,
          requestLatestPin: () => undefined,
        },
      }),
      [
        timeline.resetThreadRenderState,
        timeline.setSupplementalThreadEvents,
        timeline.getThreadRenderEvents,
      ]
    );
    useEffect(() => session.commands.startOpen(runtime), [session.commands, runtime, threadId]);
    return (
      <>
        {timeline.threadEvents.map((event) => (
          <span key={event.getId()}>{event.getContent().body}</span>
        ))}
      </>
    );
  }
  await act(async () => {
    renderer = create(<Harness threadId="$root" />);
  });
  return {
    bodies: () => renderer.root.findAllByType('span').map((node) => node.children.join('')),
    switchTo: (threadId: string) => act(() => renderer.update(<Harness threadId={threadId} />)),
    unmount: () => act(() => renderer.unmount()),
  };
};

it.each(['pending', 'missed'] as const)(
  "renders SDK-loaded replies while the open's history refresh stalls and storage is %s",
  async (storage) => {
    const support = Thread.hasServerSideSupport;
    const forwardSupport = Thread.hasServerSideFwdPaginationSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    Thread.hasServerSideFwdPaginationSupport = FeatureSupport.Stable;
    let view: Awaited<ReturnType<typeof mountThreadSession>> | undefined;
    try {
      const mx = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
      const room = new Room('!room:example.org', mx, '@alice:example.org', {
        timelineSupport: true,
      });
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
      const rawReplies = [2, 3].map((index) => ({
        ...rawRoot,
        event_id: `$reply-${index}`,
        origin_server_ts: index,
        content: {
          body: `Reply ${index}`,
          msgtype: 'm.text',
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
        },
      }));
      rawRoot.unsigned = {
        'm.relations': {
          'm.thread': { count: 2, current_user_participated: true, latest_event: rawReplies[1] },
        },
      };
      const root = new MatrixEvent(rawRoot);
      vi.spyOn(room, 'findEventById').mockImplementation((id) =>
        id === '$root' ? root : undefined
      );
      const thread = room.createThread('$root', root, [], false);
      thread.initialEventsFetched = true;
      thread.replayEvents = null;
      thread.timelineSet.addEventsToTimeline([root], true, false, thread.liveTimeline, null);
      // Cold start on iOS: the reply page arrives late, the SDK then indexes every reply,
      // and the open's next history page stays queued behind background thread fetches.
      let finishReplies!: () => void;
      const replyPage = new Promise<object>((resolve) => {
        finishReplies = () => resolve({ chunk: [...rawReplies].reverse(), next_batch: 'older' });
      });
      vi.spyOn(mx, 'fetchRelations').mockImplementation(((
        _roomId: string,
        _eventId: string,
        _rel: unknown,
        _type: unknown,
        opts?: { dir?: Direction; from?: string }
      ) =>
        opts?.dir === Direction.Backward && !opts.from
          ? replyPage
          : new Promise(() => {})) as never);
      if (storage === 'missed')
        vi.mocked(loadThreadCachedSnapshot).mockResolvedValueOnce(undefined);

      view = await mountThreadSession({ mx, room });
      expect(view.bodies()).not.toContain('Reply 2');
      await act(async () => finishReplies());

      expect(thread.events.map((event) => event.getId()).sort()).toEqual([
        '$reply-2',
        '$reply-3',
        '$root',
      ]);
      expect(view.bodies()).toEqual(['Root', 'Reply 2', 'Reply 3']);
    } finally {
      await view?.unmount();
      Thread.hasServerSideSupport = support;
      Thread.hasServerSideFwdPaginationSupport = forwardSupport;
    }
  }
);

it.each(['reply', 'root', 'first-page-reply', 'pending-bootstrap'] as const)(
  'renders the available %s through the real render hook while storage stays pending',
  async (mode) => {
    const support = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport =
      mode === 'first-page-reply' || mode === 'pending-bootstrap'
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
    // The fallback page never answers, so a rendered reply comes from the SDK's timeline.
    vi.spyOn(mx, 'fetchRelations').mockImplementation(() => new Promise(() => {}));
    vi.spyOn(room, 'findEventById').mockImplementation((id) => (id === '$root' ? root : undefined));
    const thread =
      mode === 'reply' || mode === 'pending-bootstrap'
        ? room.createThread('$root', root, [], false)
        : undefined;
    vi.spyOn(mx, 'paginateEventTimeline').mockImplementation(async (timeline) => {
      if (mode === 'first-page-reply') {
        // The open's first page goes into the live timeline of the thread it created, root first.
        timeline.getTimelineSet().addEventsToTimeline([reply, root], true, false, timeline, null);
        return false;
      }
      if (!thread) return new Promise<boolean>(() => {});
      // The first page fills the timeline directly, without Thread.NewReply.
      thread.timelineSet.addEventsToTimeline([reply], true, false, thread.liveTimeline, null);
      return false;
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
        threadFirstPaintHeld: session.snapshot.open.firstPaintHeld,
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
            getEvents: timeline.getThreadRenderEvents,
            invalidateTimeline: () => undefined,
          },
          viewport: {
            resetForOpen: () => undefined,
            resetAfterLeave: () => undefined,
            requestLatestPin: () => undefined,
          },
        }),
        [
          timeline.resetThreadRenderState,
          timeline.setSupplementalThreadEvents,
          timeline.getThreadRenderEvents,
        ]
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
      if (mode === 'first-page-reply') {
        expect(room.getThread('$root')!.events).toEqual([root, reply]);
        // The live timeline holds a reply, so no fallback page is needed.
        expect(mx.fetchRelations).not.toHaveBeenCalled();
      }
      if (mode === 'pending-bootstrap') {
        // The open waits for the SDK's own initialization, whose root request never returns.
        expect(mx.paginateEventTimeline).not.toHaveBeenCalled();
        await act(async () => {
          thread!.timelineSet.addEventsToTimeline([reply], true, false, thread!.liveTimeline, null);
        });
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

describe('a first open without a thread model', () => {
  // Roots the client knows only from their cards: two replies each on the server, none here. As
  // notices they are no standalone roots, so the SDK bootstrap renders the relations fallback.
  const setup = () => {
    const mx = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
    const room = new Room('!room:example.org', mx, '@alice:example.org', { timelineSupport: true });
    const makeRoot = (id: string) =>
      new MatrixEvent({
        event_id: id,
        room_id: room.roomId,
        sender: '@alice:example.org',
        type: 'm.room.message',
        origin_server_ts: 1,
        content: { body: `Root ${id}`, msgtype: 'm.notice' },
        unsigned: { 'm.relations': { 'm.thread': { count: 2 } } },
      });
    const roots = new Map(['$root', '$other'].map((id) => [id, makeRoot(id)]));
    vi.spyOn(room, 'findEventById').mockImplementation((id) => roots.get(id));
    vi.spyOn(mx, 'getEventTimeline').mockResolvedValue(room.getLiveTimeline());
    vi.mocked(loadThreadCachedSnapshot).mockResolvedValue(undefined);
    let answer!: () => void;
    const page = new Promise<object>((resolve) => {
      answer = () =>
        resolve({
          chunk: [3, 2].map((ts) => ({
            event_id: `$reply-${ts}`,
            room_id: room.roomId,
            sender: '@mindroom_dev:example.org',
            type: 'm.room.message',
            origin_server_ts: ts,
            content: {
              body: `Reply ${ts}`,
              msgtype: 'm.text',
              'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
              ...(ts === 2
                ? {
                    url: 'mxc://example.org/long',
                    info: { mimetype: 'application/json' },
                    'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
                  }
                : {}),
            },
          })),
        });
    });
    vi.spyOn(mx, 'fetchRelations').mockImplementation(((_roomId: string, eventId: string) =>
      eventId === '$root' ? page : new Promise(() => {})) as never);
    let finishSidecar!: () => void;
    vi.mocked(hydrateCachedLongText).mockReturnValue(
      new Promise((resolve) => {
        finishSidecar = () => resolve({});
      })
    );
    return { mx, room, answer, finishSidecar: () => finishSidecar() };
  };

  it('holds the paint until the relations page is in and its long reply has loaded', async () => {
    const { mx, room, answer, finishSidecar } = setup();
    const view = await mountThreadSession({ mx, room });
    try {
      expect(view.bodies()).toEqual([]);
      await act(async () => answer());
      expect(view.bodies()).toEqual([]);
      expect(vi.mocked(hydrateCachedLongText).mock.calls[0]?.[1].mxcUri).toBe(
        'mxc://example.org/long'
      );
      await act(async () => finishSidecar());
      expect(view.bodies()).toEqual(['Root $root', 'Reply 2', 'Reply 3']);
    } finally {
      await view.unmount();
    }
  });

  it('does not let the thread it left release the hold of the thread it switched to', async () => {
    const { mx, room, answer, finishSidecar } = setup();
    const view = await mountThreadSession({ mx, room });
    try {
      await view.switchTo('$other');
      await act(async () => {
        answer();
        finishSidecar();
      });
      expect(view.bodies()).toEqual([]);
      // Its own cap lets it paint what it has.
      await act(() => new Promise((resolve) => setTimeout(resolve, 650)));
      expect(view.bodies()).toEqual(['Root $other']);
    } finally {
      await view.unmount();
    }
  });
});
