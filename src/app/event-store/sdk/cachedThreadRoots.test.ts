import { ThreadEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adoptCachedThreadRoot,
  requestCachedThreadRoot,
  saveThreadRoot,
} from './cachedThreadRoots';
import type { EnginePersistFacade } from '../engine/enginePersistFacade';

const cache = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('../cache/eventCacheEditUtils', () => ({ hydrateCachedEvents: vi.fn() }));
vi.mock('../cache/eventRepository', () => ({
  loadCachedThreadRootsForRoom: cache.load,
  createPreferLiveEventMapper:
    (_room: Room, map: (raw: { event_id?: string }) => MatrixEvent) =>
    (raw: { event_id?: string }) =>
      map(raw),
}));

type FakeThread = {
  rootEvent?: MatrixEvent;
  setEventMetadata: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
};

const fakeEvent = (eventId: string) =>
  ({
    getId: () => eventId,
    isSending: () => false,
    isDecryptionFailure: () => false,
    isBeingDecrypted: () => false,
  } as unknown as MatrixEvent);

const makeRoom = (threads: Record<string, FakeThread>) =>
  ({
    roomId: '!room:example.org',
    getThread: (id: string) => threads[id] ?? null,
  } as unknown as Room);

const makeThread = (rootEvent?: MatrixEvent): FakeThread => ({
  rootEvent,
  setEventMetadata: vi.fn(),
  emit: vi.fn(),
});

const mx = {
  getEventMapper: () => (raw: { event_id?: string }) => fakeEvent(raw.event_id ?? ''),
} as unknown as MatrixClient;

describe('cached thread roots', () => {
  beforeEach(() => {
    cache.load.mockReset();
  });

  it('gives a rootless thread its cached root and announces the change', () => {
    const thread = makeThread();
    const root = fakeEvent('$root');
    adoptCachedThreadRoot(makeRoom({ $root: thread }), root);

    expect(thread.rootEvent).toBe(root);
    expect(thread.setEventMetadata).toHaveBeenCalledWith(root);
    expect(thread.emit).toHaveBeenCalledWith(ThreadEvent.Update, thread);
  });

  it('leaves a thread that already has its root alone', () => {
    const live = fakeEvent('$root');
    const thread = makeThread(live);
    adoptCachedThreadRoot(makeRoom({ $root: thread }), fakeEvent('$root'));

    expect(thread.rootEvent).toBe(live);
    expect(thread.emit).not.toHaveBeenCalled();
  });

  it('reads a room once for the rows that ask together and adopts every rootless thread', async () => {
    const first = makeThread();
    const second = makeThread();
    const rooted = makeThread(fakeEvent('$rooted'));
    const room = makeRoom({ $first: first, $second: second, $rooted: rooted });
    cache.load.mockResolvedValue([
      { rootEvent: { event_id: '$first' } },
      { rootEvent: { event_id: '$second' } },
      { rootEvent: { event_id: '$rooted' } },
      { rootEvent: { event_id: '$unknown' } },
    ]);

    requestCachedThreadRoot(mx, 'session', room, '$first');
    requestCachedThreadRoot(mx, 'session', room, '$second');
    await vi.waitFor(() => expect(second.rootEvent?.getId()).toBe('$second'));

    expect(cache.load).toHaveBeenCalledOnce();
    expect(cache.load).toHaveBeenCalledWith('session', '!room:example.org');
    expect(first.rootEvent?.getId()).toBe('$first');
    expect(rooted.emit).not.toHaveBeenCalled();

    // A thread asked about before is not read again on this page.
    requestCachedThreadRoot(mx, 'session', room, '$first');
    await Promise.resolve();
    expect(cache.load).toHaveBeenCalledOnce();
  });

  it('saves a root once and never writes back a root it took from the cache', () => {
    const persist = { persistThreadEventCache: vi.fn() } as unknown as EnginePersistFacade;
    const room = makeRoom({ $root: makeThread() });
    const live = fakeEvent('$live');
    saveThreadRoot(persist, room, '$live', live);
    saveThreadRoot(persist, room, '$live', live);
    expect(persist.persistThreadEventCache).toHaveBeenCalledOnce();
    expect(persist.persistThreadEventCache).toHaveBeenCalledWith(room, '$live', [], live);

    const cached = fakeEvent('$root');
    adoptCachedThreadRoot(room, cached);
    saveThreadRoot(persist, room, '$root', cached);
    expect(persist.persistThreadEventCache).toHaveBeenCalledOnce();
  });
});
