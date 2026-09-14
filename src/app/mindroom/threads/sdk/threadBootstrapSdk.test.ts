import {
  createClient,
  Direction,
  MatrixClient,
  MatrixEvent,
  Room,
  type IEvent,
} from 'matrix-js-sdk';
import { FeatureSupport, Thread, ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { describe, expect, it, vi } from 'vitest';
import {
  appendThreadBootstrapRelations,
  createInitializedThreadForRoot,
  fetchThreadBootstrapRelations,
} from './threadBootstrapSdk';

const makeEvent = (id: string, ts: number, reply = false): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
      body: id,
      ...(reply ? { 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } } : {}),
    },
  });

class ThreadEnabledClient extends MatrixClient {
  constructor() {
    super({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
    // Configure real thread routing without starting a network sync loop.
    this.clientOpts = { threadSupport: true };
  }
}

const makeDeferredThread = () => {
  const mx = new ThreadEnabledClient();
  const room = new Room('!room:example.org', mx, '@alice:example.org', {
    timelineSupport: true,
  });
  const root = makeEvent('$root', 1);
  let finishRootFetch!: (event: IEvent) => void;
  const rootFetch = new Promise<IEvent>((resolve) => {
    finishRootFetch = resolve;
  });
  vi.spyOn(mx, 'fetchRoomEvent').mockReturnValue(rootFetch);
  const thread = createInitializedThreadForRoot(room, root);
  const finishDeferredMetadata = async () => {
    const updated = new Promise<void>((resolve) => {
      thread.once(ThreadEvent.Update, () => resolve());
    });
    finishRootFetch(root.event);
    await updated;
  };
  return { mx, room, root, thread, finishDeferredMetadata };
};

describe('threadBootstrapSdk', () => {
  it('preserves a racing reply when constructor-started SDK metadata completes', async () => {
    const previousSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    try {
      const { mx, room, root, thread, finishDeferredMetadata } = makeDeferredThread();
      const paginate = vi.spyOn(mx, 'paginateEventTimeline');
      const reply = makeEvent('$reply', 2, true);
      expect(thread.rootEvent).toBe(root);
      expect(room.getThread('$root')).toBe(thread);

      await thread.addEvent(reply, false);
      await finishDeferredMetadata();

      expect(thread.events).toContain(reply);
      expect(thread.findEventById('$reply')).toBe(reply);
      expect(thread.getUnfilteredTimelineSet().eventIdToTimeline('$reply')).toBe(
        thread.liveTimeline
      );
      expect(paginate).not.toHaveBeenCalled();
      expect(thread.initialEventsFetched).toBe(true);
      expect(thread.replayEvents).toBeNull();
    } finally {
      Thread.hasServerSideSupport = previousSupport;
      vi.restoreAllMocks();
    }
  });

  it('requests one backward thread relation page with limit 50 through the real SDK', async () => {
    const requests: URL[] = [];
    const chunk = [makeEvent('$reply', 2, true).event];
    const mx = createClient({
      baseUrl: 'https://example.org',
      userId: '@alice:example.org',
      fetchFn: async (url) => {
        requests.push(new URL(String(url)));
        return new Response(JSON.stringify({ chunk, next_batch: 'older' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const result = await fetchThreadBootstrapRelations(mx, '!room:example.org', '$root');

    expect(result.chunk).toEqual(chunk);
    expect(result.next_batch).toBe('older');
    expect(requests).toHaveLength(1);
    expect(decodeURIComponent(requests[0].pathname)).toBe(
      '/_matrix/client/v1/rooms/!room:example.org/relations/$root/m.thread'
    );
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({ dir: 'b', limit: '50' });
  });

  it.each(['older', undefined])(
    'adds indexed replies and applies next_batch=%s',
    async (nextBatch) => {
      const previousSupport = Thread.hasServerSideSupport;
      Thread.hasServerSideSupport = FeatureSupport.Stable;
      try {
        const { thread, finishDeferredMetadata } = makeDeferredThread();
        const firstTimeline = thread.liveTimeline;
        firstTimeline.setPaginationToken('previous', Direction.Backward);
        const reply = makeEvent('$reply', 2, true);
        const newerReply = makeEvent('$newer-reply', 3, true);

        appendThreadBootstrapRelations({
          thread,
          events: [reply, newerReply],
          firstTimeline,
          nextBatch,
        });
        await finishDeferredMetadata();

        // addEvents(..., true) prepends each supplied event; the adapter must not sort or reverse them.
        expect(thread.events).toEqual([newerReply, reply]);
        expect(thread.findEventById('$reply')).toBe(reply);
        expect(firstTimeline.getPaginationToken(Direction.Backward)).toBe(nextBatch ?? null);
      } finally {
        Thread.hasServerSideSupport = previousSupport;
        vi.restoreAllMocks();
      }
    }
  );

  it('adds relations without requiring a first timeline', async () => {
    const previousSupport = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    try {
      const { thread, finishDeferredMetadata } = makeDeferredThread();
      const reply = makeEvent('$reply', 2, true);
      appendThreadBootstrapRelations({
        thread,
        events: [reply],
        firstTimeline: undefined,
        nextBatch: undefined,
      });
      await finishDeferredMetadata();

      expect(thread.events).toContain(reply);
      expect(thread.findEventById('$reply')).toBe(reply);
    } finally {
      Thread.hasServerSideSupport = previousSupport;
      vi.restoreAllMocks();
    }
  });
});
