import { EventEmitter } from 'events';
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  ClientEvent,
  createClient,
  MatrixEvent,
  Room,
  type IEvent,
  type MatrixClient,
  type Thread,
} from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import {
  createBackfillScheduler,
  SyncEngineProvider,
  type BackfillScheduler,
  type SyncEngine,
} from '../../event-store/engine';
import { threadForkContent } from '../../event-store/threads/threadFork';
import { useThreadForkPrefix } from './useThreadForkPrefix';

const session = vi.hoisted(() => ({ value: undefined as { sessionId: string } | undefined }));
vi.mock('../../matrix/session/useSessionStore', () => ({ useActiveSession: () => session.value }));
// The event cache: the whole parent thread when `events` is set.
const cache = vi.hoisted(() => ({
  events: undefined as MatrixEvent[] | undefined,
  load: vi.fn(),
}));
vi.mock('../../event-store/cache/eventRepository', async (original) => ({
  ...(await original<typeof import('../../event-store/cache/eventRepository')>()),
  loadThreadCachedSnapshot: cache.load.mockImplementation(async () =>
    cache.events ? { events: cache.events } : undefined
  ),
}));
vi.mock('../../event-store/cache/threadCacheSnapshot', () => ({
  isCompleteCachedThreadSnapshot: () => true,
}));

const roomId = '!room:example.org';
const bob = '@bob:example.org';

const raw = (eventId: string, ts: number, threadRoot?: string, content = {}): IEvent =>
  ({
    event_id: eventId,
    room_id: roomId,
    sender: bob,
    type: 'm.room.message',
    origin_server_ts: ts,
    unsigned: {},
    content: {
      msgtype: 'm.text',
      body: eventId,
      ...(threadRoot ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadRoot } } : {}),
      ...content,
    },
  }) as IEvent;

const message = (...args: Parameters<typeof raw>) => new MatrixEvent(raw(...args));

/** A new instance of the fork's root each call: it forks `$p` at `$b`. */
const forkRoot = () =>
  message('$f', 10, undefined, threadForkContent({ threadId: '$p', eventId: '$b' }));

const ids = (events: MatrixEvent[]) => events.map((event) => event.getId());

/** An SDK thread for `$p` loaded from its start, holding `events`, and `rootEvent` as its root. */
const sdkThreadOf = (events: MatrixEvent[], rootEvent: MatrixEvent | undefined) => {
  const timeline = {
    getEvents: () => events,
    getNeighbouringTimeline: () => null,
    getPaginationToken: () => null,
  };
  return {
    id: '$p',
    rootEvent,
    initialEventsFetched: true,
    events,
    getUnfilteredTimelineSet: () => ({ getLiveTimeline: () => timeline }),
  } as unknown as Thread;
};

/** A room holding `$p`'s events, with `thread` as the SDK's thread of `$p`. */
const makeRoom = (parentEvents: MatrixEvent[], thread: Thread | null = null) =>
  ({
    roomId,
    getThread: (threadId: string) => (threadId === '$p' ? thread : null),
    findEventById: (eventId: string) => parentEvents.find((event) => event.getId() === eventId),
  }) as unknown as Room;

/** The event cache holds all of `$p`: the events, which the prefix takes. */
const cacheParent = (events: MatrixEvent[]) => {
  session.value = { sessionId: 'session' };
  cache.events = events;
  return events;
};

afterEach(() => {
  session.value = undefined;
  cache.events = undefined;
});

const newClient = () => createClient({ baseUrl: 'https://example.org', userId: '@me:example.org' });

/** Renders the hook for `root`; `setRoot` renders the same component with another root. */
const renderPrefix = async (
  room: Room,
  mx: MatrixClient,
  scheduler: BackfillScheduler,
  root: MatrixEvent
) => {
  const results: ReturnType<typeof useThreadForkPrefix>[] = [];
  let mounts = 0;
  const Probe = ({ shownRoot }: { shownRoot: MatrixEvent }) => {
    results.push(useThreadForkPrefix(room, shownRoot));
    useEffect(() => {
      mounts += 1;
    }, []);
    return null;
  };
  const engine = { scheduler } as unknown as SyncEngine;
  const tree = (shownRoot: MatrixEvent) => (
    <MatrixClientProvider value={mx}>
      <SyncEngineProvider engine={engine}>
        <Probe shownRoot={shownRoot} />
      </SyncEngineProvider>
    </MatrixClientProvider>
  );
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(tree(root));
  });
  return {
    results,
    mounts: () => mounts,
    setRoot: (next: MatrixEvent) =>
      act(async () => {
        renderer?.update(tree(next));
      }),
    unmount: () =>
      act(async () => {
        renderer?.unmount();
      }),
  };
};

describe('useThreadForkPrefix', () => {
  it('shows an edit a prefix message gets in the parent without remounting', async () => {
    const parentEvents = [
      message('$p', 1),
      message('$a', 2, '$p'),
      message('$b', 3, '$p'),
      message('$c', 4, '$p'),
    ];
    const mx = newClient();
    const view = await renderPrefix(
      makeRoom(cacheParent(parentEvents)),
      mx,
      {} as BackfillScheduler,
      forkRoot()
    );
    const loaded = view.results.at(-1)!;
    expect(ids(loaded.events)).toEqual(['$p', '$a', '$b']);
    expect(loaded.parent).toEqual({ threadId: '$p', eventId: '$b' });

    const edit = message('$edit', 20, undefined, {
      body: '* edited',
      'm.new_content': { msgtype: 'm.text', body: 'edited' },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$a' },
    });
    await act(async () => {
      mx.emit(ClientEvent.Event, edit);
    });

    const edited = view.results.at(-1)!;
    expect(edited.events).not.toBe(loaded.events);
    expect(ids(edited.events)).toEqual(['$p', '$a', '$b']);
    expect(edited.events[1]!.getContent().body).toBe('edited');
    expect(view.mounts()).toBe(1);
    await view.unmount();
  });

  it('keeps the prefix through a new copy of the root, also one waiting to be decrypted', async () => {
    const parentEvents = [message('$p', 1), message('$a', 2, '$p'), message('$b', 3, '$p')];
    const view = await renderPrefix(
      makeRoom(cacheParent(parentEvents)),
      newClient(),
      {} as BackfillScheduler,
      forkRoot()
    );
    const loadedAt = view.results.findIndex((result) => result.events.length > 0);
    expect(loadedAt).toBeGreaterThanOrEqual(0);

    // The SDK's copy replaces the cache's, first still encrypted, then readable.
    await view.setRoot(
      new MatrixEvent({
        event_id: '$f',
        room_id: roomId,
        sender: bob,
        type: 'm.room.encrypted',
        origin_server_ts: 10,
        content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'opaque' },
      })
    );
    await view.setRoot(forkRoot());

    const after = view.results.slice(loadedAt);
    expect(after.length).toBeGreaterThan(2);
    after.forEach((result) => {
      expect(ids(result.events)).toEqual(['$p', '$a', '$b']);
      expect(result.parent).toEqual({ threadId: '$p', eventId: '$b' });
    });
    await view.unmount();
  });

  it('gets the prefix when a new root instance joins the backfill still running', async () => {
    const mx = newClient();
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchRelations = vi.spyOn(mx, 'fetchRelations').mockImplementation(async () => {
      await released;
      return { chunk: [raw('$c', 4, '$p'), raw('$b', 3, '$p'), raw('$a', 2, '$p')] };
    });
    const view = await renderPrefix(
      makeRoom([message('$p', 1)]),
      mx,
      createBackfillScheduler(),
      forkRoot()
    );
    expect(fetchRelations).toHaveBeenCalledTimes(1);

    await view.setRoot(forkRoot());
    await act(async () => {
      release();
    });

    expect(fetchRelations).toHaveBeenCalledTimes(1);
    expect(ids(view.results.at(-1)!.events)).toEqual(['$p', '$a', '$b']);
    await view.unmount();
  });
  it("reads the parent from the cache, not the SDK's thread, which can lack older replies", async () => {
    const parentEvents = cacheParent([
      message('$p', 1),
      message('$a', 2, '$p'),
      message('$b', 3, '$p'),
      message('$c', 4, '$p'),
    ]);
    // Opened from the cache: the SDK's thread starts at `$b` and says nothing is before it.
    const partial = sdkThreadOf([parentEvents[0]!, ...parentEvents.slice(2)], parentEvents[0]);
    const view = await renderPrefix(
      makeRoom(parentEvents, partial),
      newClient(),
      {} as BackfillScheduler,
      forkRoot()
    );
    expect(ids(view.results.at(-1)!.events)).toEqual(['$p', '$a', '$b']);
    await view.unmount();
  });

  it('keeps showing the prefix while the root gets its server ID', async () => {
    const parentEvents = cacheParent([
      message('$p', 1),
      message('$a', 2, '$p'),
      message('$b', 3, '$p'),
    ]);
    const echo = message(
      '~!room:example.org:m1.1',
      10,
      undefined,
      threadForkContent({ threadId: '$p', eventId: '$b' })
    );
    const view = await renderPrefix(
      makeRoom(parentEvents),
      newClient(),
      {} as BackfillScheduler,
      echo
    );
    const loadedAt = view.results.findIndex((result) => result.events.length > 0);
    expect(loadedAt).toBeGreaterThanOrEqual(0);

    await view.setRoot(forkRoot());

    view.results.slice(loadedAt).forEach((result) => {
      expect(ids(result.events)).toEqual(['$p', '$a', '$b']);
    });
    await view.unmount();
  });

  it('takes no parent reply that comes after it loaded, and a later edit of its message', async () => {
    const parentEvents = [message('$p', 1), message('$a', 2, '$p'), message('$b', 3, '$p')];
    const mx = newClient();
    const view = await renderPrefix(
      makeRoom(cacheParent(parentEvents)),
      mx,
      {} as BackfillScheduler,
      forkRoot()
    );
    const loaded = view.results.at(-1)!;
    expect(ids(loaded.events)).toEqual(['$p', '$a', '$b']);

    // The parent goes on after the fork point.
    const reply = message('$d', 5, '$p');
    parentEvents.push(reply);
    await act(async () => {
      mx.emit(ClientEvent.Event, reply);
    });
    expect(ids(view.results.at(-1)!.events)).toEqual(['$p', '$a', '$b']);

    const edit = message('$edit', 20, undefined, {
      body: '* edited',
      'm.new_content': { msgtype: 'm.text', body: 'edited' },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$b' },
    });
    await act(async () => {
      mx.emit(ClientEvent.Event, edit);
    });
    const edited = view.results.at(-1)!;
    expect(ids(edited.events)).toEqual(['$p', '$a', '$b']);
    expect(edited.events[2]!.getContent().body).toBe('edited');
    await view.unmount();
  });
});

describe('useThreadForkPrefix and a redaction of a prefix message', () => {
  const redaction = () =>
    new MatrixEvent({
      event_id: '$redaction',
      room_id: roomId,
      sender: bob,
      type: 'm.room.redaction',
      redacts: '$a',
      origin_server_ts: 30,
      content: { redacts: '$a' },
    });
  /** A room the client knows, whose main timeline shows whether anything was put there. */
  const realRoom = (mx: MatrixClient, thread?: Thread) => {
    const room = new Room(roomId, mx, '@me:example.org');
    vi.spyOn(room, 'getThread').mockImplementation((threadId) =>
      thread && threadId === '$p' ? thread : null
    );
    return room;
  };
  const mainTimeline = (room: Room) =>
    room
      .getLiveTimeline()
      .getEvents()
      .map((e) => e.getId());

  it('loads a cached prefix again, and leaves the main timeline of the room alone', async () => {
    session.value = { sessionId: 'session' };
    cache.load.mockClear();
    const mx = newClient();
    // The parent's SDK thread has not loaded its replies, so the prefix comes from the cache.
    const unloadedThread = Object.assign(new EventEmitter(), {
      id: '$p',
      initialEventsFetched: false,
      events: [],
      timelineSet: { removeEvent: vi.fn() },
    }) as unknown as Thread;
    const room = realRoom(mx, unloadedThread);
    /** A cached copy as the SDK's event mapper makes it: in the parent's SDK thread. */
    const cachedCopy = (...args: Parameters<typeof raw>) => {
      const copy = message(...args);
      copy.setThread(unloadedThread);
      return copy;
    };
    cache.events = [
      message('$p', 1),
      cachedCopy('$a', 2, '$p'),
      cachedCopy('$b', 3, '$p'),
      cachedCopy('$c', 4, '$p'),
    ];
    const view = await renderPrefix(room, mx, {} as BackfillScheduler, forkRoot());
    expect(ids(view.results.at(-1)!.events)).toEqual(['$p', '$a', '$b']);
    expect(cache.load).toHaveBeenCalledTimes(1);

    // The cache as the engine keeps it once the redaction came: `$a` pruned, in no thread.
    const redacted = new MatrixEvent({
      ...raw('$a', 2),
      content: {},
      unsigned: { redacted_because: redaction().event as IEvent },
    });
    cache.events = [message('$p', 1), redacted, message('$b', 3, '$p'), message('$c', 4, '$p')];
    await act(async () => {
      mx.emit(ClientEvent.Event, redaction());
    });

    expect(mainTimeline(room)).toEqual([]);
    expect(cache.load).toHaveBeenCalledTimes(2);
    expect(ids(view.results.at(-1)!.events)).toEqual(['$p', '$b']);
    await view.unmount();
  });
});
