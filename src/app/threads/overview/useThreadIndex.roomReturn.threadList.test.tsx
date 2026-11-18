// @vitest-environment jsdom
import { useLayoutEffect, useMemo } from 'react';
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
import { clearSeenThreadRoots } from '../../matrix/seenThreadRoots';
import { markThreadAsRead } from '../../notifications/readReceipts';

// The list back under its room page, with the room's own thread list (`useRoomThreadList`), the
// roots opened on this device and the reader's receipts as the app has them: nothing of those is
// a stand-in here.
const state = vi.hoisted(() => ({
  noWriters: new Map(),
  noEvents: [] as unknown[],
  noIds: [] as string[],
}));

vi.mock('../../event-store/threads/roomThreadList', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../event-store/threads/roomThreadList')>()),
  loadRoomThreads: vi.fn(async () => undefined),
}));
vi.mock('../../event-store/cache/eventRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../event-store/cache/eventRepository')>()),
  loadCachedThreadRootsForRoom: vi.fn(async () => []),
}));
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

afterEach(() => {
  cleanup();
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
