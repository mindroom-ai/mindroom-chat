import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  ClientEvent,
  createClient,
  EventType,
  MatrixEvent,
  RelationType,
  SyncState,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { IndexedDBStore } from 'matrix-js-sdk/lib/store/indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeCachedSpecVersions } from '../../matrix/cachedSpecVersions';
import { startClient } from '../../matrix/client/clientSyncPolicy';
import { createSessionId } from '../../matrix/session/sessions';
import { resetCacheHealthForTesting } from '../cache/cacheHealth';
import { resetCacheStoreForTesting } from '../cache/db';
import {
  saveRoomEventsToCacheCommitted,
  saveThreadEventsToCacheCommitted,
} from '../cache/db/cacheStoreEvents';
import {
  findSavedStreamingReplies,
  restoreStreamingRepliesFromCache,
} from './restoredStreamingReplies';

const BASE_URL = 'https://matrix.example';
const USER_ID = '@reader:example';
const AGENT_ID = '@agent:example';
const ROOM_ID = '!room:example';
const STATUS = 'io.mindroom.stream_status';

const event = (
  eventId: string,
  content: IEvent['content'],
  { sender = AGENT_ID, ts = 1, type = EventType.RoomMessage as string } = {}
): IEvent =>
  ({
    event_id: eventId,
    room_id: ROOM_ID,
    sender,
    origin_server_ts: ts,
    type,
    content,
    unsigned: {},
  } as IEvent);

const inThread = { rel_type: RelationType.Thread, event_id: '$root', is_falling_back: true };
const root = event('$root', { msgtype: 'm.text', body: 'Question' }, { sender: USER_ID });
const placeholder = event(
  '$reply',
  { msgtype: 'm.text', body: 'Thinking...', [STATUS]: 'pending', 'm.relates_to': inThread },
  { ts: 2 }
);
const editOf = (eventId: string, body: string, status: string, ts: number) =>
  event(
    `$edit-${ts}`,
    {
      msgtype: 'm.text',
      body: `* ${body}`,
      [STATUS]: status,
      'm.new_content': { msgtype: 'm.text', body, [STATUS]: status },
      'm.relates_to': { rel_type: RelationType.Replace, event_id: eventId },
    },
    { ts }
  );

describe('streaming replies restored from the saved sync', () => {
  let syncDb: IDBFactory;
  let storage: Storage;
  const clients: MatrixClient[] = [];
  const stores: IndexedDBStore[] = [];

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    syncDb = new IDBFactory();
    resetCacheStoreForTesting();
    resetCacheHealthForTesting();
    const values = new Map<string, string>();
    storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };
    vi.stubGlobal('localStorage', storage);
    writeCachedSpecVersions(BASE_URL, USER_ID, { versions: ['v1.4', 'v1.11'] });
  });

  afterEach(async () => {
    clients.splice(0).forEach((client) => client.stopClient());
    await Promise.all(stores.splice(0).map((store) => store.destroy()));
    resetCacheStoreForTesting();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // The server never answers: what shows comes from the saved sync and the event cache.
  const stalled = vi.fn<typeof fetch>(
    () =>
      new Promise(() => {
        // never settles
      })
  );

  const openClient = async () => {
    const store = new IndexedDBStore({ indexedDB: syncDb, localStorage: storage, dbName: 'sync' });
    stores.push(store);
    const client = createClient({
      baseUrl: BASE_URL,
      userId: USER_ID,
      accessToken: 'token',
      store,
      timelineSupport: true,
      fetchFn: stalled,
    });
    clients.push(client);
    await store.startup();
    return client;
  };

  /** A page that saved its sync with `timeline`, then reloaded; reads the cache unless told not to. */
  const reload = async (timeline: IEvent[], { readCache = true } = {}) => {
    const previous = await openClient();
    await previous.store.setSyncData({
      next_batch: 'saved',
      rooms: {
        join: {
          [ROOM_ID]: {
            state: {
              events: [
                {
                  ...event('$member', { membership: 'join' }, { type: EventType.RoomMember }),
                  sender: USER_ID,
                  state_key: USER_ID,
                },
              ],
            },
            timeline: { events: timeline, prev_batch: 'older', limited: false },
          },
        },
      },
    } as never);
    await previous.store.save(true);
    await previous.store.destroy();
    stores.splice(stores.indexOf(previous.store as IndexedDBStore), 1);

    const client = await openClient();
    if (readCache) await restoreStreamingRepliesFromCache(client);
    // What the app's first screen would show: the reply at the client's first sync state.
    const firstShown: unknown[] = [];
    client.once(ClientEvent.Sync, () => {
      firstShown.push(client.getRoom(ROOM_ID)?.findEventById('$reply')?.getContent().body);
    });
    await startClient(client);
    await vi.waitFor(() => expect(client.getSyncState()).toBe(SyncState.Prepared));
    return { client, firstShown };
  };

  const saveToCache = (reply: IEvent) =>
    saveThreadEventsToCacheCommitted(
      createSessionId(BASE_URL, USER_ID),
      ROOM_ID,
      '$root',
      [reply],
      root
    );

  const withBundledEdit = (reply: IEvent, edit: IEvent): IEvent => ({
    ...reply,
    unsigned: { 'm.relations': { [RelationType.Replace]: edit } },
  });

  it('first shows the newer text the event cache saved for a reply restored as a placeholder', async () => {
    await saveToCache(
      withBundledEdit(placeholder, editOf('$reply', 'word1 word2 word3', 'streaming', 9))
    );

    const { firstShown } = await reload([root, placeholder]);

    expect(firstShown).toEqual(['word1 word2 word3']);
  });

  it('takes the newest copy when the room scope holds a newer one than the thread scope', async () => {
    await saveToCache(withBundledEdit(placeholder, editOf('$reply', 'word1', 'streaming', 3)));
    await saveRoomEventsToCacheCommitted(createSessionId(BASE_URL, USER_ID), ROOM_ID, [
      withBundledEdit(placeholder, editOf('$reply', 'word1 word2 word3', 'streaming', 9)),
    ]);

    const { firstShown } = await reload([root, placeholder]);

    expect(firstShown).toEqual(['word1 word2 word3']);
  });

  it('keeps the cached text when the SDK maps an older summary of the reply again', async () => {
    await saveToCache(
      withBundledEdit(placeholder, editOf('$reply', 'word1 word2 word3', 'streaming', 9))
    );
    const { client } = await reload([root, placeholder]);
    const room = client.getRoom(ROOM_ID)!;
    const reply = room.findEventById('$reply')!;
    const applied: (string | undefined)[] = [];
    const makeReplaced = reply.makeReplaced.bind(reply);
    vi.spyOn(reply, 'makeReplaced').mockImplementation((edit) => {
      applied.push(edit?.getId());
      makeReplaced(edit);
    });

    // A thread list read mid-stream: the root's summary bundles the reply with an older edit,
    // which the SDK's event mapper puts back on the live reply.
    const olderSummary = withBundledEdit(placeholder, editOf('$reply', 'word1', 'streaming', 3));
    room.getThread('$root')!.refreshListedRoot(
      new MatrixEvent({
        ...root,
        unsigned: {
          'm.relations': {
            [RelationType.Thread]: {
              count: 1,
              current_user_participated: false,
              latest_event: olderSummary,
            },
          },
        },
      })
    );

    await vi.waitFor(() => expect(applied).toContain('$edit-3'));
    await vi.waitFor(() => expect(reply.getContent().body).toBe('word1 word2 word3'));
    expect(applied.at(-1)).toBe('$edit-9');
  });

  it('keeps a newer edit the saved sync holds over an older cached one', async () => {
    await saveToCache(withBundledEdit(placeholder, editOf('$reply', 'word1', 'streaming', 3)));

    const { client, firstShown } = await reload([
      root,
      placeholder,
      editOf('$reply', 'word1 word2', 'streaming', 5),
    ]);

    expect(firstShown).not.toEqual(['Thinking...']);
    await vi.waitFor(() =>
      expect(client.getRoom(ROOM_ID)?.findEventById('$reply')?.getContent().body).toBe(
        'word1 word2'
      )
    );
  });

  it('shows the placeholder without the cache read (the defect this fixes)', async () => {
    await saveToCache(
      withBundledEdit(placeholder, editOf('$reply', 'word1 word2 word3', 'streaming', 9))
    );

    const { firstShown } = await reload([root, placeholder], { readCache: false });

    expect(firstShown).toEqual(['Thinking...']);
  });

  it('reads only the replies that the saved sync holds as still streaming', () => {
    const finished = event('$done', { body: 'Thinking...', [STATUS]: 'pending' }, { ts: 3 });
    const plain = event('$plain', { body: 'Hello' }, { sender: USER_ID, ts: 4 });
    const bundledDone = withBundledEdit(
      event('$bundled', { body: 'Thinking...', [STATUS]: 'pending' }, { ts: 5 }),
      editOf('$bundled', 'Done', 'completed', 6)
    );
    const timeline = [
      root,
      placeholder,
      editOf('$reply', 'word1', 'streaming', 7),
      finished,
      editOf('$done', 'Answer', 'completed', 8),
      plain,
      bundledDone,
    ];

    expect(
      findSavedStreamingReplies({
        joinRooms: { [ROOM_ID]: { _timeline: timeline.map((item) => ({ event: item })) } },
      })
    ).toEqual([{ roomId: ROOM_ID, eventId: '$reply', threadId: '$root' }]);
  });

  it('does not take another sender’s bundled edit as the end of a reply', () => {
    const othersDone = withBundledEdit(placeholder, {
      ...editOf('$reply', 'Done', 'completed', 6),
      sender: USER_ID,
    });

    expect(
      findSavedStreamingReplies({
        joinRooms: { [ROOM_ID]: { _timeline: [{ event: root }, { event: othersDone }] } },
      })
    ).toEqual([{ roomId: ROOM_ID, eventId: '$reply', threadId: '$root' }]);
  });
});
