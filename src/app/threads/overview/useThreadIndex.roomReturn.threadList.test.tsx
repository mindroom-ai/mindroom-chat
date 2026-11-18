// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import {
  createClient,
  MatrixEvent,
  ReceiptType,
  RelationType,
  Room,
  RoomEvent,
  ThreadEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadRecord } from '../../event-store/threads/types';
import { DIRECT_ROOM_TIMELINE_FILTER_STATE } from '../../event-store/timeline/roomTimelineViewState';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { SyncEngineProvider } from '../../event-store/engine/engineContext';
import { createSyncEngine } from '../../event-store/engine/syncEngine';
import { createThreadRecordChanges } from '../../event-store/threads/threadRecord';
import { deleteCacheStoreDb, saveThreadEventsToCache } from '../../event-store/cache/db';
import { hydrateThreadFromCache } from '../open/threadOpenCacheController';
import { useThreadSeedPrewarmController } from '../open/threadSeedPrewarmController';
import { clearSeenThreadRoots } from '../../matrix/seenThreadRoots';
import { markThreadAsRead } from '../../notifications/readReceipts';

// The list back under its room page, with the room's own thread list (`useRoomThreadList`), the
// roots opened on this device and the reader's receipts as the app has them: nothing of those is
// a stand-in here.
const state = vi.hoisted(() => ({
  noWriters: new Map(),
  noEvents: [] as unknown[],
  noIds: [] as string[],
  /** The cached events of a thread are read once this settles: a test holds a read back. */
  cacheRead: Promise.resolve(),
  /** Whether the room's thread list loads, so that a record takes its count from the SDK's thread. */
  listed: false,
}));

vi.mock('../../event-store/threads/roomThreadList', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../event-store/threads/roomThreadList')>();
  const loadRoomThreads: typeof actual.loadRoomThreads = async (...args) =>
    state.listed ? actual.loadRoomThreads(...args) : undefined;
  return { ...actual, loadRoomThreads };
});
vi.mock('../../event-store/cache/eventRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../event-store/cache/eventRepository')>();
  const loadThreadCachedSnapshot: typeof actual.loadThreadCachedSnapshot = async (options) => {
    await state.cacheRead;
    return actual.loadThreadCachedSnapshot(options);
  };
  return {
    ...actual,
    loadCachedThreadRootsForRoom: vi.fn(async () => []),
    loadThreadCachedSnapshot,
  };
});
vi.mock('../usePinnedThreadEvents', () => ({ usePinnedThreadEvents: () => state.noEvents }));
vi.mock('../../event-store/threads/useThreadPinning', () => ({
  usePinnedEventIds: () => state.noIds,
}));
vi.mock('../../schedules/useScheduledTaskEvents', () => ({
  useScheduledTaskEvents: () => state.noEvents,
}));
vi.mock('../../event-store/threads/threadWriters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../event-store/threads/threadWriters')>()),
  useThreadWriters: () => state.noWriters,
}));
vi.mock('./threadOverviewCacheHydration', () => ({
  useThreadOverviewCacheHydration: () => undefined,
  useThreadOverviewRelationUpdates: () => () => undefined,
}));

// eslint-disable-next-line import/first
import { useThreadIndex, type UseThreadIndexOptions } from './useThreadIndex';
// eslint-disable-next-line import/first
import { useThreadOverviewRefreshCounter } from './threadOverviewRefreshCounter';
// eslint-disable-next-line import/first
import {
  createThreadRecordKeeper,
  disposeThreadRecordKeeper,
  useThreadRecordKeeper,
  type ThreadRecordKeeper,
} from './threadRecordKeeper';

const ROOM_ID = '!list:example.org';
const ME = '@me:example.org';
const BOB = '@bob:example.org';

let mx: MatrixClient;
let room: Room;
const listSupport = Thread.hasServerSideListSupport;
const threadSupport = Thread.hasServerSideSupport;

const message = (id: string, ts: number, threadRootId?: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: BOB,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
      body: id,
      ...(threadRootId
        ? { 'm.relates_to': { rel_type: RelationType.Thread, event_id: threadRootId } }
        : {}),
    },
  });

/** A thread of the room with one reply. Without `loaded`, the room's timeline lacks its root. */
const addThread = (id: string, ts: number, loaded = true): Thread => {
  const root = message(id, ts);
  if (loaded) room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
  const thread = room.createThread(id, root, [], false);
  thread.addEvents([message(`${id}-reply`, ts + 500, id)], false);
  return thread;
};

/** A receipt of `userId` on `eventId`, in thread `threadId` or, without one, unthreaded. */
const receipt = (userId: string, eventId: string, ts: number, threadId?: string) =>
  new MatrixEvent({
    type: 'm.receipt',
    room_id: ROOM_ID,
    content: {
      [eventId]: {
        [ReceiptType.Read]: { [userId]: { ts, ...(threadId ? { thread_id: threadId } : {}) } },
      },
    },
  });

/** Lets the threads announce what they changed, which they do after a few promises. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const options = (): UseThreadIndexOptions => ({
  room,
  threadId: undefined,
  eventId: undefined,
  focusedRoomOverviewRequested: false,
  compactViewRequested: true,
  effectiveViewMode: 'compact',
  linkedTimelines: [],
  renderableEventEntries: [],
  ignoredUsersSet: new Set(),
  hideMembershipEvents: false,
  hideNickAvatarEvents: false,
  showHiddenEvents: false,
  summaryMap: new Map(),
  threadResolutionMap: new Map(),
  currentUserId: ME,
  requestedThreadFilterState: DIRECT_ROOM_TIMELINE_FILTER_STATE,
  threadSortFreezeState: null,
  overviewRefreshCounter: 0,
  overviewChanges: createThreadRecordChanges(),
  sessionId: 'session',
  mx,
  onStoreThreadSummary: () => undefined,
});

type Records = Map<string, ThreadRecord>;
type Probe = { builds: Records[]; painted?: Records };

/** Runs `run` in its layout effect, which comes before those of the list after it. */
function BeforeListCommits({ run }: { run: () => void }) {
  useLayoutEffect(run, [run]);
  return null;
}

/** The list as the room page mounts it: each build it renders, and the records its commit shows. */
function List({
  keeper,
  probe,
  onceListening,
}: {
  keeper: ThreadRecordKeeper;
  probe: Probe;
  onceListening?: () => void;
}) {
  const fixed = useMemo(options, []);
  const { overviewRefreshCounter, overviewChanges } = useThreadOverviewRefreshCounter(
    room,
    undefined,
    keeper
  );
  const index = useThreadIndex({
    ...fixed,
    overviewRefreshCounter,
    overviewChanges,
    threadRecordKeeper: keeper,
  });
  probe.builds.push(index.compactThreadRecordMap);
  // After the list's own layout effects: what the paint shows.
  useLayoutEffect(() => {
    probe.painted = index.compactThreadRecordMap;
  });
  // Once, after the list's layout effects and before its passive ones.
  useLayoutEffect(() => {
    onceListening?.();
  }, [onceListening]);
  return null;
}

/**
 * Mounts the list. `beforeCommit` runs between its first render and its commit, `onceListening`
 * between its layout effects and its passive ones. The records are read with no wait after the
 * mount: what the first paint shows.
 */
const mountList = (
  keeper: ThreadRecordKeeper,
  during: { beforeCommit?: () => void; onceListening?: () => void } = {}
) => {
  const probe: Probe = { builds: [] };
  const engine = createSyncEngine({ mx });
  const view = render(
    <MatrixClientProvider value={mx}>
      <SyncEngineProvider engine={engine}>
        {during.beforeCommit && <BeforeListCommits run={during.beforeCommit} />}
        <List keeper={keeper} probe={probe} onceListening={during.onceListening} />
      </SyncEngineProvider>
    </MatrixClientProvider>
  );
  return {
    firstBuild: probe.builds[0]!,
    painted: () => probe.painted!,
    unmount: view.unmount,
  };
};

/** The list's read of the cached events of the threads of its cards, as the room's timeline runs it. */
function Prewarm({ threads }: { threads: string[] }) {
  useThreadSeedPrewarmController({
    room,
    mx,
    sessionId: 'session',
    prefetchDepthRef: useRef(50),
    activeThreadId: undefined,
    priorityTargets: useMemo(
      () => threads.map((threadId) => ({ threadId, replyCount: 1, visible: true })),
      [threads]
    ),
    debugTraceId: 'test',
  });
  return null;
}

/** The room page: its list, or the thread that fills it in the list's place. */
function Page({ thread, probe, prewarm }: { thread?: string; probe: Probe; prewarm: string[] }) {
  const keeper = useThreadRecordKeeper(room);
  if (thread) return null;
  return (
    <>
      <List keeper={keeper} probe={probe} />
      <Prewarm threads={prewarm} />
    </>
  );
}

/**
 * The room page with its list, shown a while. `open` puts a thread in the list's place, and
 * `back` brings the list again and gives the records of its first build. The list reads the
 * cached events of the threads of `prewarm`.
 */
const shownPage = async (prewarm: string[] = []) => {
  const probe: Probe = { builds: [] };
  const engine = createSyncEngine({ mx });
  const tree = (thread?: string) => (
    <MatrixClientProvider value={mx}>
      <SyncEngineProvider engine={engine}>
        <Page thread={thread} probe={probe} prewarm={prewarm} />
      </SyncEngineProvider>
    </MatrixClientProvider>
  );
  const view = render(tree());
  await settle();
  act(() => {
    room.emit(RoomEvent.Receipt, receipt(BOB, '$other', 1), room);
  });
  return {
    records: () => probe.painted!,
    open: (thread: string) => view.rerender(tree(thread)),
    back: () => {
      probe.builds = [];
      view.rerender(tree());
      return probe.builds[0]!;
    },
  };
};

/** A list that has shown its room a while: its records were built after it listened. */
const shownList = async (keeper: ThreadRecordKeeper) => {
  const list = mountList(keeper);
  await settle();
  act(() => {
    room.emit(RoomEvent.Receipt, receipt(BOB, '$other', 1), room);
  });
  return list;
};

const ids = (records: Records) => [...records.keys()].sort();

beforeEach(async () => {
  mx = createClient({ baseUrl: 'https://example.org', userId: ME });
  vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
  vi.spyOn(mx.http, 'authedRequest').mockResolvedValue({ chunk: [] });
  room = new Room(ROOM_ID, mx, ME);
  mx.store.storeRoom(room);
  // The room's thread list is in, so the room drops a thread that goes.
  Thread.hasServerSideSupport = FeatureSupport.Stable;
  Thread.hasServerSideListSupport = FeatureSupport.Stable;
  vi.spyOn(
    room as unknown as { fetchRoomThreadList: () => Promise<void> },
    'fetchRoomThreadList'
  ).mockResolvedValue();
  await room.fetchRoomThreads();
});

afterEach(async () => {
  cleanup();
  await deleteCacheStoreDb('session');
  state.cacheRead = Promise.resolve();
  state.listed = false;
  clearSeenThreadRoots(ME);
  vi.restoreAllMocks();
  Thread.hasServerSideSupport = threadSupport;
  Thread.hasServerSideListSupport = listSupport;
});

describe("the Compact list back under its room page, with the room's thread list", () => {
  beforeEach(async () => {
    addThread('$a', 1000);
    addThread('$b', 2000);
    await settle();
  });

  it('shows before paint the threads the room came to list or lost during the hand-off', async () => {
    const keeper = createThreadRecordKeeper(room);
    const shown = await shownList(keeper);
    expect(ids(shown.painted())).toEqual(['$a', '$b']);
    shown.unmount();

    // Between the render of the list that comes back and its commit: a thread whose root the
    // room's timeline does not hold is listed, and B is deleted.
    const back = mountList(keeper, {
      beforeCommit: () => {
        addThread('$new', 3000, false);
        const gone = room.getThread('$b')!;
        gone.emit(ThreadEvent.Delete, gone);
      },
    });

    expect(ids(back.firstBuild)).toEqual(['$a', '$b']);
    expect(ids(back.painted())).toEqual(['$a', '$new']);
    back.unmount();
    disposeThreadRecordKeeper(keeper);
  });

  it('shows before paint a thread listed once the list listens, before its passive effects', async () => {
    const keeper = createThreadRecordKeeper(room);
    const shown = await shownList(keeper);
    shown.unmount();

    const back = mountList(keeper, {
      onceListening: () => {
        addThread('$new', 3000, false);
      },
    });

    expect(ids(back.firstBuild)).toEqual(['$a', '$b']);
    expect(ids(back.painted())).toEqual(['$a', '$b', '$new']);
    back.unmount();
    disposeThreadRecordKeeper(keeper);
  });

  it("reads the room's threads again for a thread's change, not for a receipt", async () => {
    const keeper = createThreadRecordKeeper(room);
    const shown = await shownList(keeper);
    const getThreads = vi.spyOn(room, 'getThreads');

    act(() => {
      room.emit(RoomEvent.Receipt, receipt(BOB, '$other', 2), room);
      room.addReceipt(receipt(ME, '$a-reply', 3, '$a'));
    });
    expect(getThreads).not.toHaveBeenCalled();

    act(() => {
      addThread('$new', 3000, false);
    });
    expect(getThreads).toHaveBeenCalled();
    expect(ids(shown.painted())).toEqual(['$a', '$b', '$new']);
    shown.unmount();
    disposeThreadRecordKeeper(keeper);
  });
});

describe('the Compact list back after the reader opened one of two unread threads', () => {
  const unread = (records: Records) =>
    Object.fromEntries([...records].map(([id, record]) => [id, record.status.isUnread]));

  /** Two threads with unread roots; with `repliesRead`, the reader read A's reply before. */
  const twoUnreadRoots = async (repliesRead: boolean) => {
    // A thread receipt from before, so the reader's next one is not their oldest, which would
    // change how every thread reads.
    room.addReceipt(receipt(ME, '$old', 1, '$old'));
    addThread('$a', 1000);
    addThread('$b', 2000);
    await settle();
    if (repliesRead) room.addReceipt(receipt(ME, '$a-reply', 1500, '$a'));
  };

  it.each([
    ['its reply read by a receipt and its root on this device', false],
    ['only its root on this device, which no event tells of', true],
  ])('builds only the record of the opened thread: %s', async (_name, repliesRead) => {
    await twoUnreadRoots(repliesRead);
    const keeper = createThreadRecordKeeper(room);
    const shown = await shownList(keeper);
    const before = shown.painted();
    expect(unread(before)).toEqual({ $a: true, $b: true });
    shown.unmount();

    // The reader opens A: B's root is still unread, so A's is read on this device only.
    const requests = vi.mocked(mx.http.authedRequest);
    requests.mockClear();
    await act(() => markThreadAsRead(mx, ROOM_ID, '$a', false));
    const sent = requests.mock.calls.filter(([, path]) => String(path).includes('/receipt/'));
    expect(sent).toHaveLength(repliesRead ? 0 : 1);

    const back = mountList(keeper);

    expect(unread(back.firstBuild)).toEqual({ $a: false, $b: true });
    expect(back.firstBuild.get('$b')).toBe(before.get('$b'));
    expect(back.painted().get('$b')).toBe(before.get('$b'));
    expect(unread(back.painted())).toEqual({ $a: false, $b: true });
    back.unmount();
    disposeThreadRecordKeeper(keeper);
  });
});

describe('the Compact list of a room without threads', () => {
  it('leaves no records to keep, so nothing listens while it is gone', async () => {
    const listeners = () => room.listenerCount(ThreadEvent.Update);
    const withoutList = listeners();
    const keeper = createThreadRecordKeeper(room);
    const shown = await shownList(keeper);
    expect(shown.painted().size).toBe(0);
    expect(listeners()).toBe(withoutList + 1);

    shown.unmount();

    expect(keeper.maps).toBeUndefined();
    expect(keeper.stop).toBeUndefined();
    expect(listeners()).toBe(withoutList);
  });
});

describe('the Compact list back after threads filled the page', () => {
  /**
   * A root as the server sends it, with its thread's summary: the newest reply, by Bob, which is
   * `latest` or else named by the count.
   */
  const rawRoot = (
    id: string,
    ts: number,
    count: number,
    participated: boolean,
    latest = `${id}-reply${count}`
  ) => ({
    ...message(id, ts).event,
    unsigned: {
      'm.relations': {
        [RelationType.Thread]: {
          count,
          current_user_participated: participated,
          latest_event: message(latest, ts + latest.length, id).event,
        },
      },
    },
  });

  /**
   * The server answers a request for the root of `id` with `root`, and holds the first page of
   * its replies until `arrive`.
   */
  const heldFirstPage = (id: string, root: object) => {
    let arrive = (): void => undefined;
    const firstPage = new Promise<object>((resolve) => {
      arrive = () => resolve({ chunk: [] });
    });
    const held = { asked: false, arrive: () => arrive() };
    vi.mocked(mx.http.authedRequest).mockImplementation((_method, path) => {
      if (path.endsWith(`/event/${encodeURIComponent(id)}`)) return Promise.resolve(root);
      if (path.includes(`/relations/${encodeURIComponent(id)}`)) {
        held.asked = true;
        return firstPage;
      }
      return Promise.resolve({ chunk: [] });
    });
    return held;
  };

  /** A thread the room knows by its root's summary: one reply, none of the reader's. */
  const addListedThread = (id: string, ts: number) => {
    const root = new MatrixEvent(rawRoot(id, ts, 1, false));
    room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
    return room.createThread(id, root, [], false);
  };

  /** Puts a copy of a thread's root and of its newest reply in the cache. */
  const summaryOf = (root: ReturnType<typeof rawRoot>) =>
    root.unsigned['m.relations'][RelationType.Thread];

  const cache = (id: string, ts: number, count: number, participated: boolean, latest?: string) => {
    const root = rawRoot(id, ts, count, participated, latest);
    return saveThreadEventsToCache('session', ROOM_ID, id, [summaryOf(root).latest_event], root);
  };

  /** The summary of its thread the room's root carries. */
  const summary = (id: string): unknown =>
    room.findEventById(id)?.getServerAggregatedRelation(RelationType.Thread);

  const people = (records: Records, id: string) => records.get(id)?.presentation.peopleIds;

  beforeEach(async () => {
    ['$a', '$b', '$c'].forEach((id, index) => addListedThread(id, 1000 * (index + 1)));
    await settle();
  });

  it('builds again the record of each thread opened: its cached root says the reader took part', async () => {
    // The cache holds a newer copy of A's and B's roots than the room: the reader replied since.
    await cache('$a', 1000, 1, true);
    await cache('$b', 2000, 1, true);
    const page = await shownPage();
    const before = page.records();
    expect(ids(before)).toEqual(['$a', '$b', '$c']);
    expect(people(before, '$a')).toEqual([BOB]);

    // A fills the page, then B: each thread's view reads its cached events, which writes what
    // the cached root knows into the room's own. No event tells of it.
    const runtime = { mx, room, sessionId: 'session', isCurrentThread: () => true };
    page.open('$a');
    await act(() => hydrateThreadFromCache(runtime, '$a'));
    page.open('$b');
    await act(() => hydrateThreadFromCache(runtime, '$b'));
    expect(summary('$a')).toMatchObject({ current_user_participated: true });
    const first = page.back();

    expect(people(first, '$a')).toEqual([BOB, ME]);
    expect(people(first, '$b')).toEqual([BOB, ME]);
    expect(first.get('$c')).toBe(before.get('$c'));
    expect(page.records().get('$c')).toBe(before.get('$c'));
  });

  it("builds again the record of a thread whose cached root the list's read wrote into the room's while another filled the page", async () => {
    addListedThread('$d', 4000);
    await settle();
    // The cache: B's root with a second reply and the reader among its people, and C's root as
    // the room has it. The list's read of the cached events waits.
    await cache('$b', 2000, 2, true);
    await cache('$c', 3000, 1, false);
    let read = (): void => undefined;
    state.cacheRead = new Promise((resolve) => {
      read = resolve;
    });
    const page = await shownPage(['$b', '$c']);
    const before = page.records();
    expect(people(before, '$b')).toEqual([BOB]);
    expect(before.get('$b')?.status.replyCount).toBe(1);
    const summaryOfC = summary('$c');

    // A fills the page. Only now the read the list had asked for goes on: it writes what the
    // cached roots know into the room's own, B's and C's, and no event tells of it.
    page.open('$a');
    read();
    await vi.waitFor(() => {
      expect(summary('$b')).toMatchObject({ count: 2, current_user_participated: true });
      expect(summary('$c')).not.toBe(summaryOfC);
    });
    // C's root says what it said, in another object.
    expect(summary('$c')).toEqual(summaryOfC);
    const first = page.back();

    // B's record is the one a list that kept nothing builds: people, count, preview and the rest.
    expect(people(first, '$b')).toEqual([BOB, ME]);
    expect(first.get('$b')?.status.replyCount).toBe(2);
    const coldKeeper = createThreadRecordKeeper(room);
    const cold = mountList(coldKeeper);
    expect(first.get('$b')).toEqual(cold.firstBuild.get('$b'));
    cold.unmount();
    disposeThreadRecordKeeper(coldKeeper);
    // C's root was written with what it had, and nothing wrote D's: both records are kept.
    expect(first.get('$c')).toBe(before.get('$c'));
    expect(first.get('$d')).toBe(before.get('$d'));
    expect(page.records().get('$c')).toBe(before.get('$c'));
  });

  it('builds again the record of a thread opened whose root the SDK read again, before its first page is in', async () => {
    // The server has a second reply of A. The first page of A's replies does not arrive yet.
    const firstPage = heldFirstPage('$a', rawRoot('$a', 1000, 2, false));
    const page = await shownPage();
    const before = page.records();
    expect(before.get('$a')?.status.replyCount).toBe(1);
    expect(before.get('$a')?.presentation.latestReplyPreviewText).toBe('$a-reply1');

    // A fills the page: the SDK reads its root again and asks for its first page of replies,
    // and tells of both only once the page is in.
    const heard = vi.fn();
    room.on(ThreadEvent.Update, heard);
    page.open('$a');
    const initializing = room.getThread('$a')!.initialize();
    await vi.waitFor(() => expect(firstPage.asked).toBe(true));
    expect(heard).not.toHaveBeenCalled();
    const first = page.back();

    expect(first.get('$a')?.status.replyCount).toBe(2);
    expect(first.get('$a')?.presentation.latestReplyPreviewText).toBe('$a-reply2');
    expect(first.get('$b')).toBe(before.get('$b'));
    expect(first.get('$c')).toBe(before.get('$c'));
    firstPage.arrive();
    await act(async () => {
      await initializing;
    });
  });

  it.each([
    ['another count and newest reply', 2, '$b-reply2'],
    ['the same count and another newest reply', 1, '$b-reply1b'],
    // The thread holds its newest reply, so the SDK keeps that event and changes only the count.
    ['another count and the same newest reply', 2, '$b-reply1'],
  ])(
    "builds again the record of a thread the SDK's thread caught up with its root for: %s",
    async (_name, count, latest) => {
      // The room's thread list is in: a record takes its count from the SDK's thread.
      state.listed = true;
      const thread = room.getThread('$b')!;
      if (latest === '$b-reply1') {
        thread.addEvents(
          [new MatrixEvent(summaryOf(rawRoot('$b', 2000, 1, false)).latest_event)],
          false
        );
        await settle();
      }
      // The cache and the server have the same newer root of B. The list's read of the cached
      // events writes it into the room's root before the records are built: the root's summary
      // is ahead of the SDK's thread, which still has one reply, the first.
      await cache('$b', 2000, count, false, latest);
      const firstPage = heldFirstPage('$b', rawRoot('$b', 2000, count, false, latest));
      const page = await shownPage(['$b']);
      await vi.waitFor(() =>
        expect(summary('$b')).toMatchObject({ count, latest_event: { event_id: latest } })
      );
      act(() => {
        room.emit(RoomEvent.Receipt, receipt(BOB, '$other', 2), room);
      });
      const before = page.records();
      const replyBefore = thread.replyToEvent;
      expect(replyBefore?.getId()).toBe('$b-reply1');
      expect(before.get('$b')?.status.replyCount).toBe(1);
      expect(before.get('$b')?.presentation.latestReplyPreviewText).toBe('$b-reply1');

      // A fills the page. The SDK reads B's root again, the same the room's root already says,
      // takes the count and the newest reply from it, and tells of it only once the first page
      // of B's replies is in, which waits.
      const heard = vi.fn();
      room.on(ThreadEvent.Update, heard);
      page.open('$a');
      const initializing = thread.initialize();
      await vi.waitFor(() => expect(firstPage.asked).toBe(true));
      expect(heard).not.toHaveBeenCalled();
      expect(thread.length).toBe(count);
      expect(thread.replyToEvent?.getId()).toBe(latest);
      expect(thread.replyToEvent === replyBefore).toBe(latest === '$b-reply1');
      const first = page.back();

      // B's record is the one a list that kept nothing builds; C's is kept.
      const coldKeeper = createThreadRecordKeeper(room);
      const cold = mountList(coldKeeper);
      expect(first.get('$b')).toEqual(cold.firstBuild.get('$b'));
      cold.unmount();
      disposeThreadRecordKeeper(coldKeeper);
      expect(first.get('$b')?.status.replyCount).toBe(count);
      expect(first.get('$b')?.presentation.latestReplyPreviewText).toBe(latest);
      expect(first.get('$c')).toBe(before.get('$c'));
      firstPage.arrive();
      await act(async () => {
        await initializing;
      });
    }
  );
});
