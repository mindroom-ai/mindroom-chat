import 'fake-indexeddb/auto';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Direction, MatrixClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import type { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { createSyncEngine } from '../../event-store/engine/syncEngine';
import { SyncEngineProvider } from '../../event-store/engine/engineContext';
import {
  clearRoomCachedContent,
  deleteCacheStoreDb,
  loadLatestCachedThreadEvents,
  saveRoomEventsToCache,
  saveThreadEventsToCache,
} from '../../event-store/cache/db';
import { useRoomThreadList } from './useRoomThreadList';
import { buildCompactThreadRootData } from '../../event-store/threads/compactThreadRootData';

/** Roots whose revision the hook computed, in order. */
const revisedRoots: string[] = [];
/** Makes the next revision throw. */
let failNextRevision = false;
vi.mock('../../event-store/cache/eventRepository', async (original) => {
  const actual = await original<typeof import('../../event-store/cache/eventRepository')>();
  return {
    ...actual,
    serializeThreadCacheEvents: (...args: Parameters<typeof actual.serializeThreadCacheEvents>) => {
      revisedRoots.push(args[2]?.getId() ?? '');
      if (failNextRevision) {
        failNextRevision = false;
        throw new Error('Unreadable root');
      }
      return actual.serializeThreadCacheEvents(...args);
    },
  };
});

const userId = '@alice:example.org';
const roomId = '!offline:example.org';
let renderer: ReactTestRenderer | undefined;
let sessionId: string;
const originalListSupport = Thread.hasServerSideListSupport;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  if (sessionId) await deleteCacheStoreDb(sessionId);
  Thread.hasServerSideListSupport = originalListSupport;
  vi.restoreAllMocks();
});

// Saving 400 threads through fake-indexeddb and restoring them takes about 2 s alone; on a busy
// machine it passed the 5 s default, and the timed-out run kept working into the next tests.
it('restores 400 cached threads while only one is in the SDK and discovery is pending', async () => {
  const fetchFn = vi.fn(() => Promise.reject(new TypeError('Offline')));
  class OfflineClient extends MatrixClient {
    constructor() {
      super({ baseUrl: 'https://example.org', userId, fetchFn });
      this.clientOpts = { threadSupport: true };
    }
  }
  const mx = new OfflineClient();
  mx.threadSupportPending = new Promise(() => {});
  const room = new Room(roomId, mx, userId, { timelineSupport: true });
  room.setMaxListeners(500);
  mx.store.storeRoom(room);
  const engine = createSyncEngine({ mx });
  sessionId = engine.sessionId;
  const roots = Array.from({ length: 400 }, (_, index): Partial<IEvent> => {
    const reply = {
      event_id: `$reply-${index}`,
      room_id: roomId,
      sender: userId,
      origin_server_ts: 2000 + index,
      type: 'm.room.message',
      content: {
        msgtype: 'm.text',
        body: `Reply ${index}`,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: `$root-${index}`,
        },
      },
    };
    return {
      event_id: `$root-${index}`,
      room_id: roomId,
      sender: userId,
      origin_server_ts: 1000 + index,
      type: 'm.room.message',
      content: { msgtype: 'm.text', body: `Thread ${index}` },
      unsigned: {
        'm.relations': {
          'm.thread': { count: 1, current_user_participated: true, latest_event: reply },
        },
      },
    };
  });
  await Promise.all(
    roots.map(async (root, index) => {
      // Historical pagination can save the reply before encountering the root.
      if (index % 2 === 0) {
        const reply = root.unsigned!['m.relations']!['m.thread']!.latest_event as IEvent;
        // A root cached before its first reply has no server thread bundle.
        root.unsigned = {};
        await saveRoomEventsToCache(sessionId, roomId, [root]);
        await saveThreadEventsToCache(sessionId, roomId, root.event_id!, [
          reply,
          {
            event_id: `$reaction-${index}`,
            room_id: roomId,
            sender: userId,
            origin_server_ts: 3000 + index,
            type: 'm.reaction',
            content: {
              'm.relates_to': { rel_type: 'm.annotation', event_id: reply.event_id, key: '👍' },
            },
          },
        ]);
      } else {
        await saveThreadEventsToCache(sessionId, roomId, root.event_id!, [], root);
      }
    })
  );
  await saveThreadEventsToCache(sessionId, '!another:example.org', '$foreign', [], {
    ...roots[0],
    event_id: '$foreign',
    room_id: '!another:example.org',
  });
  const liveRoot = new MatrixEvent({
    ...roots[399],
    content: { msgtype: 'm.text', body: 'Newer live title' },
  });
  room.processThreadRoots([liveRoot], false);
  expect(room.getThreads()).toHaveLength(1);
  let ids: string[] = [];
  function Harness() {
    const { threads } = useRoomThreadList(room);
    ids = buildCompactThreadRootData({
      room,
      threads,
      visibleIds: [],
      visibleIndexMap: new Map(),
      visibleBodyMap: new Map(),
    }).ids;
    return null;
  }
  await act(async () => {
    renderer = create(
      <MatrixClientProvider value={mx}>
        <SyncEngineProvider engine={engine}>
          <Harness />
        </SyncEngineProvider>
      </MatrixClientProvider>
    );
  });
  await act(async () => {
    await vi.waitFor(() => expect(ids).toHaveLength(400), { timeout: 20_000 });
  });
  expect(new Set(ids)).toEqual(new Set(roots.map((root) => root.event_id)));
  expect(fetchFn).not.toHaveBeenCalled();
  expect(room.getLiveTimeline().getEvents()).toHaveLength(0);
  expect(room.getThread('$root-399')?.rootEvent).toBe(liveRoot);
  expect(liveRoot.getContent().body).toBe('Newer live title');
  expect(room.getThread('$root-0')?.replyToEvent?.getId()).toBe('$reply-0');
  expect(room.getThread('$root-0')?.initialEventsFetched).toBe(false);
  expect(room.getThread('$root-1')?.events).toHaveLength(0);
}, 30_000);

class ListingClient extends MatrixClient {
  constructor() {
    super({ baseUrl: 'https://example.org', userId });
    this.clientOpts = { threadSupport: true };
    this.threadSupportPending = Promise.resolve();
  }
}

type Engine = ReturnType<typeof createSyncEngine>;
type RootSave = Parameters<ReturnType<Engine['persist']['forRoom']>['persistThreadEventCache']>;

const setUpRoom = () => {
  const mx = new ListingClient();
  const room = new Room(roomId, mx, userId, { timelineSupport: true });
  mx.store.storeRoom(room);
  const engine = createSyncEngine({ mx });
  sessionId = engine.sessionId;
  return { mx, room, engine };
};

/** Calls `record` with each root save as it starts, then saves. */
const recordSaves = (engine: Engine, record: (...args: RootSave) => void) => {
  const forRoom = engine.persist.forRoom.bind(engine.persist);
  vi.spyOn(engine.persist, 'forRoom').mockImplementation((target) => {
    const persist = forRoom(target);
    return {
      ...persist,
      persistThreadEventCache: (...args) => {
        record(...args);
        return persist.persistThreadEventCache(...args);
      },
    };
  });
};

/** The room lists its threads in pages, starting with one more page before its first. */
const listInPages = (room: Room) => {
  Thread.hasServerSideListSupport = FeatureSupport.Stable;
  const list = room.getUnfilteredTimelineSet();
  room.threadsTimelineSets[0] = list;
  room.threadsTimelineSets[1] = list;
  const timeline = list.getLiveTimeline();
  timeline.setPaginationToken('older-roots', Direction.Backward);
  return timeline;
};

const listedRoot = (eventId: string, body = eventId) =>
  new MatrixEvent({
    event_id: eventId,
    room_id: roomId,
    sender: userId,
    origin_server_ts: 1000,
    type: 'm.room.message',
    content: { msgtype: 'm.text', body },
  });

const encryptedListedRoot = (eventId: string) =>
  new MatrixEvent({
    event_id: eventId,
    room_id: roomId,
    sender: userId,
    origin_server_ts: 1000,
    type: 'm.room.encrypted',
    content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: eventId },
  });

const rootEdit = (eventId: string, body: string) =>
  new MatrixEvent({
    event_id: '$edit',
    room_id: roomId,
    sender: userId,
    origin_server_ts: 2000,
    type: 'm.room.message',
    content: {
      msgtype: 'm.text',
      body: `* ${body}`,
      'm.new_content': { msgtype: 'm.text', body },
      'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
    },
  });

/** Decrypts `event` to a message with `content` once it settles; a rejected one fails it. */
const decryptEvent = (event: MatrixEvent, content: Promise<object>) =>
  event.attemptDecryption({
    decryptEvent: async () => ({
      clearEvent: { room_id: roomId, type: 'm.room.message', content: await content },
    }),
  } as unknown as CryptoBackend);

/** Shows the room's thread list; `list.current` is the hook's latest result. */
const showList = (mx: MatrixClient, engine: Engine, room: Room) => {
  const list: { current?: ReturnType<typeof useRoomThreadList> } = {};
  function Harness() {
    list.current = useRoomThreadList(room);
    return null;
  }
  renderer = create(
    <MatrixClientProvider value={mx}>
      <SyncEngineProvider engine={engine}>
        <Harness />
      </SyncEngineProvider>
    </MatrixClientProvider>
  );
  return list;
};

const closeList = async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
};

const bundledReply = (eventId: string) => ({
  'm.relations': {
    'm.thread': {
      count: 1,
      current_user_participated: true,
      latest_event: {
        event_id: eventId,
        room_id: roomId,
        sender: userId,
        origin_server_ts: 1500,
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          body: eventId,
          'm.relates_to': { rel_type: 'm.thread', event_id: '$listed' },
        },
      },
    },
  },
});

/** Whether a saved root and its edit were readable when saved. */
const describeSave = (root: MatrixEvent | null | undefined) => {
  const edit = root?.replacingEvent();
  const state = (event: MatrixEvent) => (event.isDecryptionFailure() ? 'undecrypted' : 'readable');
  return root ? [state(root), ...(edit ? [`${state(edit)} edit`] : [])].join(', ') : '';
};

/** Each change made between the list's first and second page, and the saves it leads to. */
const changesBeforeLaterPage = {
  none: ['readable'],
  edit: ['readable', 'readable, readable edit'],
  redaction: ['readable', 'readable'],
  decryption: ['undecrypted', 'readable'],
  'bundled reply': ['readable', 'readable'],
  'edit decryption': ['readable, undecrypted edit', 'readable, readable edit'],
};

it.each(Object.keys(changesBeforeLaterPage) as (keyof typeof changesBeforeLaterPage)[])(
  'saves server-listed roots, and again when one changes before a later page, without claiming replies downloaded (change: %s)',
  async (change) => {
    const { mx, room, engine } = setUpRoom();
    const saves: string[] = [];
    recordSaves(engine, (_threadId, _replies, root) => saves.push(describeSave(root)));
    const root =
      change === 'decryption'
        ? encryptedListedRoot('$listed')
        : listedRoot('$listed', 'Listed by server');
    if (change === 'decryption') {
      await decryptEvent(root, Promise.reject(new Error('Missing key')));
    }
    if (change === 'bundled reply') root.setUnsigned(bundledReply('$reply-1'));
    const encryptedEdit =
      change === 'edit decryption'
        ? new MatrixEvent({
            event_id: '$edit',
            room_id: roomId,
            sender: userId,
            origin_server_ts: 2000,
            type: 'm.room.encrypted',
            content: {
              algorithm: 'm.megolm.v1.aes-sha2',
              ciphertext: 'edit',
              'm.relates_to': { rel_type: 'm.replace', event_id: '$listed' },
            },
          })
        : undefined;
    if (encryptedEdit) {
      await decryptEvent(encryptedEdit, Promise.reject(new Error('Missing key')));
      root.makeReplaced(encryptedEdit);
    }
    if (change !== 'none') {
      const timeline = listInPages(room);
      let changed = false;
      vi.spyOn(mx, 'paginateEventTimeline').mockImplementation(async () => {
        if (changed) {
          // A further unchanged page must not rewrite all restored roots.
          timeline.setPaginationToken(null, Direction.Backward);
          return false;
        }
        // First progress callback has already saved this same root.
        await vi.waitFor(() => expect(saves).toHaveLength(1));
        // What the first save holds, so that the later one is seen to replace it.
        await vi.waitFor(async () => {
          const first = await loadLatestCachedThreadEvents(sessionId, roomId, '$listed', 1);
          if (change === 'bundled reply')
            expect(first.events.map((event) => event.event_id)).toEqual(['$reply-1']);
          if (change === 'edit decryption')
            expect(JSON.stringify(first.rootEvent)).toContain('$edit');
        });
        changed = true;
        if (change === 'edit') {
          root.makeReplaced(rootEdit('$listed', 'Newer server title'));
        } else if (change === 'redaction') {
          root.makeRedacted(
            new MatrixEvent({
              event_id: '$redaction',
              room_id: roomId,
              sender: userId,
              origin_server_ts: 2000,
              type: 'm.room.redaction',
              redacts: '$listed',
              content: { redacts: '$listed' },
            }),
            room
          );
        } else if (change === 'decryption') {
          await decryptEvent(root, Promise.resolve({ body: 'Clear title' }));
        } else if (change === 'bundled reply') {
          // The list's later page carries the root again, with a newer reply in its summary.
          root.setUnsigned(bundledReply('$reply-2'));
        } else {
          await decryptEvent(
            encryptedEdit!,
            Promise.resolve(rootEdit('$listed', 'Newer title').getContent())
          );
        }
        timeline.setPaginationToken('unchanged-page', Direction.Backward);
        return true;
      });
    }
    vi.spyOn(room, 'fetchRoomThreads').mockImplementation(async () => {
      room.processThreadRoots([root], false);
    });
    await act(async () => {
      const list = showList(mx, engine, room);
      await vi.waitFor(async () => {
        const cached = await loadLatestCachedThreadEvents(sessionId, roomId, '$listed', 1);
        expect(cached.rootEvent).toBeDefined();
        const saved = JSON.stringify(cached.rootEvent);
        if (change === 'edit') expect(saved).toContain('Newer server title');
        else if (change === 'redaction')
          expect(cached.rootEvent?.unsigned?.redacted_because).toBeTruthy();
        else if (change === 'bundled reply') expect(saved).toContain('$reply-2');
        else if (change === 'edit decryption') expect(saved).toContain('$edit');
        else if (change === 'none')
          expect(cached.rootEvent?.content?.body).toBe('Listed by server');
        // The listed reply is kept as an edit target, not as downloaded history.
        expect(cached.events.map((event) => event.event_id)).toEqual(
          change === 'bundled reply' ? ['$reply-2'] : []
        );
        expect(cached.tailLoaded).toBe(false);
        expect(cached.snapshotComplete).toBe(false);
        expect(list.current?.loading).toBe(false);
      });
    });
    expect(saves).toEqual(changesBeforeLaterPage[change]);
    // The decrypted edit is one the root shows.
    if (change === 'edit decryption') expect(root.getContent().body).toBe('Newer title');
  }
);

it('saves a root that changed before a later page when the overview closes before the list ends', async () => {
  const { mx, room, engine } = setUpRoom();
  let saves = 0;
  recordSaves(engine, () => (saves += 1));
  const root = listedRoot('$listed', 'Cached title');
  const timeline = listInPages(room);
  let finishLastPage!: (more: boolean) => void;
  let pages = 0;
  vi.spyOn(mx, 'paginateEventTimeline').mockImplementation(async () => {
    pages += 1;
    if (pages > 1) return new Promise<boolean>((resolve) => (finishLastPage = resolve));
    await vi.waitFor(() => expect(saves).toBe(1));
    // This page lists the root with a newer title.
    root.makeReplaced(rootEdit('$listed', 'Listed title'));
    timeline.setPaginationToken('older-page', Direction.Backward);
    return true;
  });
  vi.spyOn(room, 'fetchRoomThreads').mockImplementation(async () => {
    room.processThreadRoots([root], false);
  });
  await act(async () => {
    showList(mx, engine, room);
    await vi.waitFor(() => expect(pages).toBe(2));
  });
  // The reader leaves the room while its list still loads.
  await closeList();
  expect(saves).toBe(2);
  await vi.waitFor(async () => {
    const cached = await loadLatestCachedThreadEvents(sessionId, roomId, '$listed', 1);
    expect(JSON.stringify(cached.rootEvent)).toContain('Listed title');
  });
  // The list's end, after the reader left, checks no root again.
  const revised = revisedRoots.length;
  await act(async () => {
    finishLastPage(false);
    // The load settles within the microtasks before the next task.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(revisedRoots).toHaveLength(revised);
});

it('keeps a loaded list free of errors when checking its roots at the end fails', async () => {
  const { mx, room, engine } = setUpRoom();
  const root = listedRoot('$listed');
  const timeline = listInPages(room);
  vi.spyOn(mx, 'paginateEventTimeline').mockImplementation(async () => {
    timeline.setPaginationToken(null, Direction.Backward);
    failNextRevision = true;
    return false;
  });
  vi.spyOn(room, 'fetchRoomThreads').mockImplementation(async () => {
    room.processThreadRoots([root], false);
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  let list: ReturnType<typeof showList> = {};
  await act(async () => {
    list = showList(mx, engine, room);
    await vi.waitFor(() => expect(list.current?.loading).toBe(false));
  });
  expect(failNextRevision).toBe(false);
  expect(list.current?.error).toBeUndefined();
  expect(list.current?.loadedSuccessfully).toBe(true);
  expect(warn).toHaveBeenCalledWith(
    '[threadList] checking listed roots failed:',
    expect.any(Error)
  );
});

it('checks each listed root with its page and once more as the load ends, not once per page', async () => {
  const { mx, room, engine } = setUpRoom();
  const saved: string[] = [];
  recordSaves(engine, (threadId) => saved.push(threadId));
  const firstPage = ['$first-0', '$first-1', '$first-2'].map((id) => listedRoot(id));
  const laterPages = ['$page-1', '$page-2'].map((id) => listedRoot(id));
  const timeline = listInPages(room);
  let page = 0;
  vi.spyOn(mx, 'paginateEventTimeline').mockImplementation(async () => {
    // Each page's new root is saved with its page, before the next one.
    expect(saved).toEqual([...firstPage, ...laterPages.slice(0, page)].map((r) => r.getId()));
    room.processThreadRoots([laterPages[page]!], false);
    page += 1;
    const more = page < laterPages.length;
    timeline.setPaginationToken(more ? `page-${page}` : null, Direction.Backward);
    return more;
  });
  vi.spyOn(room, 'fetchRoomThreads').mockImplementation(async () => {
    room.processThreadRoots(firstPage, false);
  });
  revisedRoots.length = 0;
  const showOverview = async () => {
    await act(async () => {
      const list = showList(mx, engine, room);
      await vi.waitFor(() => expect(list.current?.loading).toBe(false));
    });
    await closeList();
  };

  await showOverview();
  const all = [...firstPage, ...laterPages].map((r) => r.getId());
  expect(saved).toEqual(all);
  // One check per root as its page arrives, and one more of every root once the list is complete.
  expect(revisedRoots.slice(0, all.length)).toEqual(all);
  expect(revisedRoots.slice(all.length).sort()).toEqual([...all].sort());

  // A list that arrives in one page checks each root once.
  revisedRoots.length = 0;
  await showOverview();
  expect([...revisedRoots].sort()).toEqual([...all].sort());
  expect(saved).toEqual(all);
});

it('saves only changed listed roots when the overview is shown again', async () => {
  class Client extends MatrixClient {
    constructor() {
      super({ baseUrl: 'https://example.org', userId });
      this.clientOpts = { threadSupport: true };
      this.threadSupportPending = Promise.resolve();
    }
  }
  const mx = new Client();
  const room = new Room(roomId, mx, userId, { timelineSupport: true });
  mx.store.storeRoom(room);
  const engine = createSyncEngine({ mx });
  sessionId = engine.sessionId;
  const saveRoot = vi.fn();
  const forRoom = engine.persist.forRoom.bind(engine.persist);
  vi.spyOn(engine.persist, 'forRoom').mockImplementation((target) => {
    const persist = forRoom(target);
    return {
      ...persist,
      persistThreadEventCache: (...args) => {
        saveRoot(args[0]);
        return persist.persistThreadEventCache(...args);
      },
    };
  });
  const roots = Array.from(
    { length: 3 },
    (_, index) =>
      new MatrixEvent({
        event_id: `$listed-${index}`,
        room_id: roomId,
        sender: userId,
        origin_server_ts: 1000 + index,
        type: 'm.room.message',
        content: { msgtype: 'm.text', body: `Listed ${index}` },
      })
  );
  // Every mount reports the known threads to the hook again.
  vi.spyOn(room, 'fetchRoomThreads').mockImplementation(async () => {
    room.processThreadRoots(roots, false);
  });
  let loading = true;
  function Harness() {
    loading = useRoomThreadList(room).loading;
    return null;
  }
  const showOverview = async () => {
    await act(async () => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <SyncEngineProvider engine={engine}>
            <Harness />
          </SyncEngineProvider>
        </MatrixClientProvider>
      );
      await vi.waitFor(() => expect(loading).toBe(false));
    });
    await act(async () => renderer?.unmount());
    renderer = undefined;
  };

  await showOverview();
  expect(saveRoot.mock.calls.map(([threadId]) => threadId)).toEqual([
    '$listed-0',
    '$listed-1',
    '$listed-2',
  ]);

  saveRoot.mockClear();
  await showOverview();
  expect(saveRoot).not.toHaveBeenCalled();

  roots[1]!.makeReplaced(
    new MatrixEvent({
      event_id: '$edit',
      room_id: roomId,
      sender: userId,
      origin_server_ts: 2000,
      type: 'm.room.message',
      content: {
        msgtype: 'm.text',
        body: '* Edited',
        'm.new_content': { msgtype: 'm.text', body: 'Edited' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$listed-1' },
      },
    })
  );
  await showOverview();
  expect(saveRoot.mock.calls.map(([threadId]) => threadId)).toEqual(['$listed-1']);

  // A cleared room cache gets every root again.
  saveRoot.mockClear();
  await clearRoomCachedContent(sessionId, roomId);
  await showOverview();
  expect(saveRoot).toHaveBeenCalledTimes(3);
  await vi.waitFor(async () => {
    const cached = await loadLatestCachedThreadEvents(sessionId, roomId, '$listed-1', 1);
    expect(JSON.stringify(cached.rootEvent)).toContain('Edited');
  });
});

it('saves encrypted listed roots once decrypted, and again when a failed one decrypts', async () => {
  class Client extends MatrixClient {
    constructor() {
      super({ baseUrl: 'https://example.org', userId });
      this.clientOpts = { threadSupport: true };
      this.threadSupportPending = Promise.resolve();
    }
  }
  const mx = new Client();
  const room = new Room(roomId, mx, userId, { timelineSupport: true });
  mx.store.storeRoom(room);
  const engine = createSyncEngine({ mx });
  sessionId = engine.sessionId;
  const saved: string[] = [];
  const forRoom = engine.persist.forRoom.bind(engine.persist);
  vi.spyOn(engine.persist, 'forRoom').mockImplementation((target) => {
    const persist = forRoom(target);
    return {
      ...persist,
      persistThreadEventCache: (...args) => {
        const root = args[2];
        saved.push(
          `${args[0]} ${root?.getType()}${root?.isDecryptionFailure() ? ' (failed)' : ''}`
        );
        return persist.persistThreadEventCache(...args);
      },
    };
  });
  const encryptedRoot = (eventId: string) =>
    new MatrixEvent({
      event_id: eventId,
      room_id: roomId,
      sender: userId,
      origin_server_ts: 1000,
      type: 'm.room.encrypted',
      content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: eventId },
    });
  const decrypting = encryptedRoot('$decrypting');
  const lateKey = encryptedRoot('$late-key');
  const decrypt = (root: MatrixEvent, result: Promise<{ type: string; content: object }>) =>
    root.attemptDecryption({
      decryptEvent: async () => ({ clearEvent: { room_id: roomId, ...(await result) } }),
    } as unknown as CryptoBackend);
  const clear = (body: string) => Promise.resolve({ type: 'm.room.message', content: { body } });
  vi.spyOn(room, 'fetchRoomThreads').mockImplementation(async () => {
    room.processThreadRoots([decrypting, lateKey], false);
  });
  let loading = true;
  function Harness() {
    loading = useRoomThreadList(room).loading;
    return null;
  }
  const showOverview = async (whileShown?: () => Promise<void>) => {
    await act(async () => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <SyncEngineProvider engine={engine}>
            <Harness />
          </SyncEngineProvider>
        </MatrixClientProvider>
      );
      await vi.waitFor(() => expect(loading).toBe(false));
      await whileShown?.();
    });
    await act(async () => renderer?.unmount());
    renderer = undefined;
  };

  await decrypt(lateKey, Promise.reject(new Error('Missing key')));
  let releaseKey!: () => void;
  const decrypted = decrypt(
    decrypting,
    new Promise((resolve) => {
      releaseKey = () => resolve(clear('Clear title'));
    })
  );
  await showOverview(async () => {
    // A root listed while its decryption runs is saved once, with its clear content.
    expect(decrypting.isBeingDecrypted()).toBe(true);
    expect(saved).toEqual(['$late-key m.room.message (failed)']);
    releaseKey();
    await decrypted;
    await vi.waitFor(() =>
      expect(saved).toEqual(['$late-key m.room.message (failed)', '$decrypting m.room.message'])
    );
  });

  // Its ciphertext is unchanged, but a root that decrypts later is a new revision.
  saved.length = 0;
  await decrypt(lateKey, clear('Late title'));
  await showOverview();
  expect(saved).toEqual(['$late-key m.room.message']);
});

it('saves a listed root that is still being decrypted when the overview closes', async () => {
  const { mx, room, engine } = setUpRoom();
  const saved: string[] = [];
  recordSaves(engine, (threadId, _replies, root) => saved.push(`${threadId} ${root?.getType()}`));
  const root = encryptedListedRoot('$decrypting');
  let releaseKey!: () => void;
  const decrypted = decryptEvent(
    root,
    new Promise((resolve) => {
      releaseKey = () => resolve({ body: 'Clear' });
    })
  );
  vi.spyOn(room, 'fetchRoomThreads').mockImplementation(async () => {
    room.processThreadRoots([root], false);
  });
  await act(async () => {
    const list = showList(mx, engine, room);
    await vi.waitFor(() => expect(list.current?.loading).toBe(false));
  });
  await closeList();
  expect(saved).toEqual([]);
  releaseKey();
  await decrypted;
  await vi.waitFor(() => expect(saved).toEqual(['$decrypting m.room.message']));
});
