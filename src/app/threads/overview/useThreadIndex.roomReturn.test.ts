// @vitest-environment jsdom
import { act, render, renderHook } from '@testing-library/react';
import {
  createElement,
  Fragment,
  StrictMode,
  Suspense,
  startTransition,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import {
  createClient,
  MatrixEvent,
  MatrixEventEvent,
  ReceiptType,
  Room,
  RoomEvent,
  RoomMemberEvent,
  ThreadEvent,
  type MatrixClient,
  type RoomMember,
  type Thread,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadRecord } from '../../event-store/threads/types';
import { DIRECT_ROOM_TIMELINE_FILTER_STATE } from '../../event-store/timeline/roomTimelineViewState';

const state = vi.hoisted(() => ({
  list: {
    threads: [] as unknown[],
    loading: false,
    loadedSuccessfully: true,
    fullyLoaded: true,
    retry: () => Promise.resolve(),
  },
  pinnedEvents: [] as unknown[],
  noWriters: new Map(),
  noEvents: [] as unknown[],
  noIds: [] as string[],
  forgotten: new Set<(messageId: string) => void>(),
}));

vi.mock('./useRoomThreadList', () => ({ useRoomThreadList: () => state.list }));
vi.mock('../usePinnedThreadEvents', () => ({ usePinnedThreadEvents: () => state.pinnedEvents }));
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
vi.mock('../../matrix/client/syncedEdits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/client/syncedEdits')>()),
  onSyncedEditForgotten: (listener: (messageId: string) => void) => {
    state.forgotten.add(listener);
    return () => state.forgotten.delete(listener);
  },
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
// eslint-disable-next-line import/first
import { createThreadRecordChanges } from '../../event-store/threads/threadRecord';

let mx: MatrixClient;
let room: Room;

const root = (eventId: string, body: string) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: room.roomId,
    event_id: eventId,
    sender: '@alice:server',
    origin_server_ts: 1000,
    content: { msgtype: 'm.text', body },
  });

const options = (viewMode: 'compact' | 'threaded' = 'compact'): UseThreadIndexOptions => ({
  room,
  threadId: undefined,
  eventId: undefined,
  focusedRoomOverviewRequested: false,
  compactViewRequested: viewMode === 'compact',
  effectiveViewMode: viewMode,
  linkedTimelines: [],
  renderableEventEntries: [],
  ignoredUsersSet: new Set(),
  hideMembershipEvents: false,
  hideNickAvatarEvents: false,
  showHiddenEvents: false,
  summaryMap: new Map(),
  threadResolutionMap: new Map(),
  currentUserId: '@me:server',
  requestedThreadFilterState: DIRECT_ROOM_TIMELINE_FILTER_STATE,
  threadSortFreezeState: null,
  overviewRefreshCounter: 0,
  overviewChanges: createThreadRecordChanges(),
  sessionId: 'session',
  mx,
  onStoreThreadSummary: () => undefined,
});

const receiptOf = (userId: string) =>
  new MatrixEvent({
    type: 'm.receipt',
    room_id: room.roomId,
    content: { $other: { [ReceiptType.Read]: { [userId]: { ts: 2000 } } } },
  });

/**
 * The room's Compact list as the room page mounts it: the page's keeper, the room's events
 * raising the count. `firstBuild` is the record map of the list's first render, the one its first
 * commit shows.
 */
const mountList = (keeper: ThreadRecordKeeper | undefined, viewMode?: 'compact' | 'threaded') => {
  const fixed = options(viewMode);
  const builds: Map<string, ThreadRecord>[] = [];
  const hook = renderHook(() => {
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
    builds.push(index.compactThreadRecordMap);
    return index;
  });
  return {
    firstBuild: builds[0]!,
    records: () => hook.result.current.compactThreadRecordMap,
    unmount: hook.unmount,
  };
};

/** A list that has shown its room a while: its records were built after it listened. */
const shownList = (keeper: ThreadRecordKeeper | undefined) => {
  const list = mountList(keeper);
  act(() => {
    room.emit(RoomEvent.Receipt, receiptOf('@alice:server'), room);
  });
  return list;
};

const editRoot = (event: MatrixEvent, body: string) => {
  const edit = new MatrixEvent({
    type: 'm.room.message',
    room_id: room.roomId,
    event_id: `${event.getId()!}-edit`,
    sender: '@alice:server',
    origin_server_ts: 2000,
    content: {
      msgtype: 'm.text',
      body: `* ${body}`,
      'm.new_content': { msgtype: 'm.text', body },
      'm.relates_to': { rel_type: 'm.replace', event_id: event.getId() },
    },
  });
  event.makeReplaced(edit);
  mx.emit(MatrixEventEvent.Replaced, event);
};

const listened = () =>
  room.listenerCount(ThreadEvent.Update) + mx.listenerCount(MatrixEventEvent.Replaced);

let roots: MatrixEvent[];

beforeEach(() => {
  mx = createClient({ baseUrl: 'https://matrix.example', userId: '@me:server' });
  room = new Room('!room:server', mx, '@me:server');
  Object.assign(room, { threadsTimelineSets: [{ getLiveTimeline: () => ({}) }] });
  roots = [root('$a', 'First A'), root('$b', 'B'), root('$c', 'C'), root('$d', 'D')];
  state.pinnedEvents = roots;
  // Keepers some tests leave behind listen to the rooms of those tests.
  state.forgotten.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Compact list back under its room page', () => {
  it('builds on its first render only the record of the thread edited while it was gone', () => {
    const keeper = createThreadRecordKeeper(room);
    const shown = shownList(keeper);
    const before = shown.records();
    expect([...before.keys()].sort()).toEqual(['$a', '$b', '$c', '$d']);
    expect(before.get('$a')?.presentation.rootPreviewText).toBe('First A');
    shown.unmount();

    editRoot(roots[0]!, 'New A');
    const back = mountList(keeper);

    expect(back.firstBuild.get('$a')).not.toBe(before.get('$a'));
    expect(back.firstBuild.get('$a')?.presentation.rootPreviewText).toBe('New A');
    expect(back.firstBuild.get('$b')).toBe(before.get('$b'));
    expect(back.firstBuild.get('$c')).toBe(before.get('$c'));
    expect(back.firstBuild.get('$d')).toBe(before.get('$d'));
    // Nothing changed between the build and its commit: the paint keeps them too.
    expect(back.records().get('$b')).toBe(before.get('$b'));
    back.unmount();
  });

  it("counts once when the page's first list starts the room's listener, not when a list comes back", () => {
    const keeper = createThreadRecordKeeper(room);
    // The start: every record is built again, for what the room heard before the listener.
    const first = mountList(keeper);
    expect(first.records().get('$a')).not.toBe(first.firstBuild.get('$a'));
    first.unmount();

    // The listener heard the room all along: the list that comes back builds once.
    const back = mountList(keeper);
    expect(back.records()).toBe(back.firstBuild);
    expect(back.firstBuild.get('$a')).toBe(first.records().get('$a'));
    back.unmount();
    disposeThreadRecordKeeper(keeper);
  });

  it('builds again the record of a thread the SDK changed while the list was gone', () => {
    const keeper = createThreadRecordKeeper(room);
    const shown = shownList(keeper);
    const before = shown.records();
    shown.unmount();

    // Nothing the build is given changes: only the mark heard while away tells of it.
    room.emit(ThreadEvent.Update, { id: '$b' } as Thread);
    const back = mountList(keeper);

    expect(back.firstBuild.get('$b')).not.toBe(before.get('$b'));
    expect(back.firstBuild.get('$a')).toBe(before.get('$a'));
    expect(back.firstBuild.get('$c')).toBe(before.get('$c'));
    back.unmount();
  });

  it('hears through the trip what no event tells of, and builds no more by the clock', () => {
    const keeper = createThreadRecordKeeper(room);
    const shown = shownList(keeper);
    const before = shown.records();
    shown.unmount();

    // While away: the kept edits of C's root are dropped, which while away stands for the whole
    // room (the next test), and D's reply stops streaming by the clock, which comes as an update
    // of its thread (streamingReplies.ts).
    state.forgotten.forEach((listener) => listener('$c'));
    room.emit(ThreadEvent.Update, { id: '$d' } as Thread);
    const builds: Records[] = [];
    const painted: { current?: Records } = {};
    const view = render(createElement(ListProbe, { keeper, builds, shown: painted }));

    ['$a', '$b', '$c', '$d'].forEach((id) => expect(builds[0]!.get(id)).not.toBe(before.get(id)));
    // A quiet room rests: no check a second later builds the kept records again.
    const shownBuild = painted.current;
    const rendered = builds.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(builds).toHaveLength(rendered);
    expect(painted.current).toBe(shownBuild);
    view.unmount();
    expect(state.forgotten.size).toBe(1);
    disposeThreadRecordKeeper(keeper);
    expect(state.forgotten.size).toBe(0);
  });

  it('while gone, takes a dropped edit of any room as a change of its own, without a scan', () => {
    const keeper = createThreadRecordKeeper(room);
    const shown = shownList(keeper);
    const before = shown.records();
    shown.unmount();

    // The store of kept edits is shared by every room: the message may be another room's, or the
    // reply an unopened thread of this room names, which only a look through its threads finds.
    const threads = vi.spyOn(room, 'getThreads');
    const found = vi.spyOn(room, 'findEventById');
    state.forgotten.forEach((listener) => listener('$summary-reply'));
    expect(threads).not.toHaveBeenCalled();
    expect(found).not.toHaveBeenCalled();

    const back = mountList(keeper);
    ['$a', '$b', '$c', '$d'].forEach((id) =>
      expect(back.firstBuild.get(id)).not.toBe(before.get(id))
    );
    back.unmount();
    disposeThreadRecordKeeper(keeper);
  });

  it('builds every record after a change of the whole room while the list was gone', () => {
    const keeper = createThreadRecordKeeper(room);
    const shown = shownList(keeper);
    const before = shown.records();
    shown.unmount();

    const member = new MatrixEvent({
      type: 'm.room.member',
      room_id: room.roomId,
      state_key: '@alice:server',
      content: { membership: 'join', displayname: 'Alice B' },
    });
    mx.emit(RoomMemberEvent.Name, member, { roomId: room.roomId } as RoomMember, 'Alice');
    const back = mountList(keeper);

    ['$a', '$b', '$c', '$d'].forEach((id) =>
      expect(back.firstBuild.get(id)).not.toBe(before.get(id))
    );
    back.unmount();
  });

  it('keeps nothing for the room once the page left it, and stops listening', () => {
    const keeper = createThreadRecordKeeper(room);
    const shown = shownList(keeper);
    const before = shown.records();
    shown.unmount();
    expect(listened()).toBeGreaterThan(0);

    // Another room: the page lets its keeper go. Back in this room, a new one.
    disposeThreadRecordKeeper(keeper);
    expect(listened()).toBe(0);
    expect(keeper.maps).toBeUndefined();
    const next = createThreadRecordKeeper(room);
    const back = mountList(next);

    ['$a', '$b', '$c', '$d'].forEach((id) =>
      expect(back.firstBuild.get(id)).not.toBe(before.get(id))
    );
    back.unmount();
    disposeThreadRecordKeeper(next);
    expect(listened()).toBe(0);
  });

  it('only marks while gone: no timer and no count', () => {
    const keeper = createThreadRecordKeeper(room);
    shownList(keeper).unmount();
    expect(keeper.stop).toBeDefined();
    const timers = vi.getTimerCount();

    const reply = new MatrixEvent({
      type: 'm.room.message',
      room_id: room.roomId,
      event_id: '$reply',
      sender: '@alice:server',
      content: {
        msgtype: 'm.text',
        body: 'Reply',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$a' },
      },
    });
    mx.emit(MatrixEventEvent.Decrypted, reply);
    room.emit(ThreadEvent.NewReply, { id: '$a' } as Thread, reply);
    room.emit(RoomEvent.Receipt, receiptOf('@me:server'), room);
    expect(vi.getTimerCount()).toBe(timers);
    disposeThreadRecordKeeper(keeper);
  });

  it('keeps no records and does not listen after a list outside Compact, or before any list', () => {
    const unseen = createThreadRecordKeeper(room);
    // A thread opened straight from its address: no list mounted, nothing kept or heard.
    expect(unseen.maps).toBeUndefined();
    expect(listened()).toBe(0);

    const keeper = createThreadRecordKeeper(room);
    const threaded = mountList(keeper, 'threaded');
    expect(keeper.maps).toBeUndefined();
    threaded.unmount();
    expect(keeper.stop).toBeUndefined();
    expect(listened()).toBe(0);
  });

  it('builds every record on its first render without the keeper, as before', () => {
    const shown = shownList(undefined);
    const before = shown.records();
    shown.unmount();
    const back = mountList(undefined);
    ['$a', '$b', '$c', '$d'].forEach((id) =>
      expect(back.firstBuild.get(id)).not.toBe(before.get(id))
    );
    back.unmount();
  });
});

type Records = Map<string, ThreadRecord>;

/** The list as a component: each build it renders, and the records of the commit that shows. */
function ListProbe({
  listRoom = room,
  keeper,
  viewMode = 'compact',
  builds,
  shown,
}: {
  listRoom?: Room;
  keeper: ThreadRecordKeeper | undefined;
  viewMode?: 'compact' | 'threaded';
  builds: Records[];
  shown: { current?: Records };
}) {
  const fixed = useMemo(() => ({ ...options(viewMode), room: listRoom }), [viewMode, listRoom]);
  const { overviewRefreshCounter, overviewChanges } = useThreadOverviewRefreshCounter(
    listRoom,
    undefined,
    keeper
  );
  const index = useThreadIndex({
    ...fixed,
    overviewRefreshCounter,
    overviewChanges,
    threadRecordKeeper: keeper,
  });
  builds.push(index.compactThreadRecordMap);
  // After the list's own layout effects: what the paint shows.
  useLayoutEffect(() => {
    shown.current = index.compactThreadRecordMap;
  });
  return null;
}

/** Runs `run` in its layout effect, which comes before those of the list after it. */
function BeforeListCommits({ run }: { run: () => void }) {
  useLayoutEffect(run, [run]);
  return null;
}

const never = new Promise<never>(() => undefined);
function SuspendWhen({ suspend }: { suspend: boolean }) {
  if (suspend) throw never;
  return null;
}

describe('the lifetime of what the room page keeps', () => {
  it('shows before paint what changed between the build of the list that came back and its commit', () => {
    const keeper = createThreadRecordKeeper(room);
    const shown = shownList(keeper);
    const before = shown.records();
    shown.unmount();

    const builds: Records[] = [];
    const painted: { current?: Records } = {};
    // In the same commit, before the list listens again: an edit of B's root.
    const updateB = () => editRoot(roots[1]!, 'New B');
    const view = render(
      createElement(
        Fragment,
        null,
        createElement(BeforeListCommits, { run: updateB }),
        createElement(ListProbe, { keeper, builds, shown: painted })
      )
    );

    // The first build kept B from before; the paint shows B's new text, every record built again.
    expect(builds[0]!.get('$b')).toBe(before.get('$b'));
    expect(painted.current?.get('$b')?.presentation.rootPreviewText).toBe('New B');
    view.unmount();
    disposeThreadRecordKeeper(keeper);
  });

  it('shows before paint a reply changed in place during the hand-off, in a thread it kept no record of', async () => {
    const keeper = createThreadRecordKeeper(room);
    const shown = shownList(keeper);
    shown.unmount();

    // A thread listed since, whose reply the room already holds.
    vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
    const rootE = root('$e', 'E');
    room.getUnfilteredTimelineSet().addLiveEvent(rootE, { addToState: false });
    const thread = room.createThread('$e', rootE, [], false);
    const reply = new MatrixEvent({
      type: 'm.room.message',
      room_id: room.roomId,
      event_id: '$e-reply',
      sender: '@alice:server',
      origin_server_ts: 3000,
      content: {
        msgtype: 'm.text',
        body: 'Old reply',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$e' },
      },
    });
    thread.addEvents([reply], false);
    await vi.runAllTimersAsync();
    state.pinnedEvents = [...roots, rootE];

    const builds: Records[] = [];
    const painted: { current?: Records } = {};
    // In the same commit, before the list listens again: the reply is edited in place.
    const editReply = () => editRoot(reply, 'New reply');
    const view = render(
      createElement(
        Fragment,
        null,
        createElement(BeforeListCommits, { run: editReply }),
        createElement(ListProbe, { keeper, builds, shown: painted })
      )
    );

    expect(builds[0]!.get('$e')?.presentation.latestReplyPreviewText).toBe('Old reply');
    expect(painted.current?.get('$e')?.presentation.latestReplyPreviewText).toBe('New reply');
    view.unmount();
    disposeThreadRecordKeeper(keeper);
  });

  it('keeps the records of the commit that shows, not those of a render left unshown', () => {
    const keeper = createThreadRecordKeeper(room);
    const builds: Records[] = [];
    const painted: { current?: Records } = {};
    let setMode: (mode: 'compact' | 'threaded') => void = () => undefined;
    let setShown: (shown: boolean) => void = () => undefined;
    function Page() {
      const [mode, setModeState] = useState<'compact' | 'threaded'>('compact');
      const [listShown, setShownState] = useState(true);
      setMode = setModeState;
      setShown = setShownState;
      return createElement(
        Suspense,
        { fallback: null },
        listShown && createElement(ListProbe, { keeper, viewMode: mode, builds, shown: painted }),
        createElement(SuspendWhen, { suspend: mode === 'threaded' })
      );
    }
    const view = render(createElement(Page));
    act(() => {
      room.emit(RoomEvent.Receipt, receiptOf('@alice:server'), room);
    });
    const before = painted.current!;
    expect(keeper.maps?.compactThreadRecordMap).toBe(before);

    // A switch out of Compact that suspends: its render builds, and never shows.
    act(() => startTransition(() => setMode('threaded')));
    expect(keeper.maps?.compactThreadRecordMap).toBe(before);

    // The list goes (a thread fills the page) and comes back: it keeps the shown records.
    act(() => setShown(false));
    const firstAgain = builds.length;
    act(() => setShown(true));
    ['$a', '$b', '$c', '$d'].forEach((id) =>
      expect(builds[firstAgain]!.get(id)).toBe(before.get(id))
    );
    view.unmount();
    disposeThreadRecordKeeper(keeper);
  });

  it('lets go of the records it started from once it built its own, also in another room', async () => {
    vi.useRealTimers();
    // Node's own collector, so a test can tell what the list still holds.
    const v8 = await import('node:v8');
    const vm = await import('node:vm');
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const keeper = createThreadRecordKeeper(room);
    shownList(keeper).unmount();
    const seed = new WeakRef(keeper.maps!);

    const builds: Records[] = [];
    const painted: { current?: Records } = {};
    const probe = (listRoom: Room, listKeeper: ThreadRecordKeeper | undefined) =>
      createElement(ListProbe, { listRoom, keeper: listKeeper, builds, shown: painted });
    const view = render(probe(room, keeper));
    // A change builds new maps; then the page goes to another room in place.
    act(() => {
      room.emit(ThreadEvent.Update, { id: '$b' } as Thread);
    });
    disposeThreadRecordKeeper(keeper);
    view.rerender(probe(new Room('!other:server', mx, '@me:server'), undefined));

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    gc();
    expect(seed.deref()).toBeUndefined();
    view.unmount();
  });

  it('keeps under StrictMode, and lets go when the page goes or leaves the room', () => {
    const builds: Records[] = [];
    const painted: { current?: Records } = {};
    let keeper: ThreadRecordKeeper | undefined;
    let setShown: (shown: boolean) => void = () => undefined;
    function Page({ pageRoom }: { pageRoom: Room }) {
      keeper = useThreadRecordKeeper(pageRoom);
      const [listShown, setShownState] = useState(true);
      setShown = setShownState;
      return listShown
        ? createElement(ListProbe, { listRoom: pageRoom, keeper, builds, shown: painted })
        : null;
    }
    const page = (pageRoom: Room) =>
      createElement(StrictMode, null, createElement(Page, { pageRoom }));
    const view = render(page(room));
    act(() => {
      room.emit(RoomEvent.Receipt, receiptOf('@alice:server'), room);
    });
    const before = painted.current!;

    // The first trip into a thread and back keeps the records.
    act(() => setShown(false));
    expect(keeper?.stop).toBeDefined();
    const firstAgain = builds.length;
    act(() => setShown(true));
    ['$a', '$b', '$c', '$d'].forEach((id) =>
      expect(builds[firstAgain]!.get(id)).toBe(before.get(id))
    );

    // Another room: this room's listener stops, the list now listens to the other.
    const other = new Room('!other:server', mx, '@me:server');
    view.rerender(page(other));
    expect(room.listenerCount(ThreadEvent.Update)).toBe(0);
    expect(other.listenerCount(ThreadEvent.Update)).toBeGreaterThan(0);
    // The page goes: nothing listens.
    view.unmount();
    expect(other.listenerCount(ThreadEvent.Update)).toBe(0);
    expect(mx.listenerCount(MatrixEventEvent.Replaced)).toBe(0);
  });

  it('while no list shows, marks only the threads it keeps and the room', () => {
    const keeper = createThreadRecordKeeper(room);
    shownList(keeper).unmount();

    const reply = new MatrixEvent({
      type: 'm.room.message',
      room_id: room.roomId,
      event_id: '$reply',
      sender: '@alice:server',
      content: {
        msgtype: 'm.text',
        body: 'Reply',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$new' },
      },
    });
    room.emit(RoomEvent.Timeline, reply, room, false, false, {} as never);
    room.emit(ThreadEvent.Update, { id: '$unseen' } as Thread);
    room.emit(ThreadEvent.Update, { id: '$b' } as Thread);

    expect([...keeper.changes.threads.keys()]).toEqual(['$b']);
    disposeThreadRecordKeeper(keeper);
  });
});
