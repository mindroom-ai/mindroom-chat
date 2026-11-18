// @vitest-environment jsdom
import { StrictMode, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { act, cleanup, render } from '@testing-library/react';
import {
  createClient,
  MatrixEvent,
  RelationType,
  Room,
  RoomEvent,
  ThreadEvent,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIRECT_ROOM_TIMELINE_FILTER_STATE } from '../../event-store/timeline/roomTimelineViewState';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { SyncEngineProvider } from '../../event-store/engine/engineContext';
import { createSyncEngine } from '../../event-store/engine/syncEngine';
import { createPreferLiveEventMapper } from '../../event-store/cache/eventRepository';
import { createThreadRecordChanges } from '../../event-store/threads/threadRecord';

// The Compact list as the room page mounts it when a thread that filled the page closes: with
// the room's own thread list (`useRoomThreadList`) and the index of its records, neither a
// stand-in. The list waits for its listeners, then builds once, before the paint.
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
vi.mock('./threadIndexRecords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./threadIndexRecords')>();
  return { buildThreadIndexRecordMaps: vi.fn(actual.buildThreadIndexRecordMaps) };
});

// eslint-disable-next-line import/first
import { buildThreadIndexRecordMaps } from './threadIndexRecords';
// eslint-disable-next-line import/first
import { useThreadIndex, type UseThreadIndexOptions } from './useThreadIndex';
// eslint-disable-next-line import/first
import {
  useThreadOverviewListenedFirst,
  useThreadOverviewRefreshCounter,
  type ThreadOverviewRefresh,
} from './threadOverviewRefreshCounter';

const ROOM_ID = '!list:example.org';
const ME = '@me:example.org';
const BOB = '@bob:example.org';

let mx: MatrixClient;
let room: Room;
const listSupport = Thread.hasServerSideListSupport;
const threadSupport = Thread.hasServerSideSupport;

const raw = (id: string, ts: number, body: string, threadRootId?: string): Partial<IEvent> => ({
  event_id: id,
  room_id: ROOM_ID,
  sender: BOB,
  type: 'm.room.message',
  origin_server_ts: ts,
  content: {
    msgtype: 'm.text',
    body,
    ...(threadRootId
      ? { 'm.relates_to': { rel_type: RelationType.Thread, event_id: threadRootId } }
      : {}),
  },
});
const message = (id: string, ts: number, body: string, threadRootId?: string) =>
  new MatrixEvent(raw(id, ts, body, threadRootId));

/** A thread of the room with one reply. Without `loaded`, the room's timeline lacks its root. */
const addThread = (id: string, ts: number, loaded = true): Thread => {
  const root = message(id, ts, `root of ${id}`);
  if (loaded) room.getUnfilteredTimelineSet().addLiveEvent(root, { addToState: false });
  const thread = room.createThread(id, root, [], false);
  thread.addEvents([message(`${id}-reply`, ts + 500, `reply in ${id}`, id)], false);
  return thread;
};

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

/** What one commit of the list shows: its cards in order, each with its latest reply. */
type Shown = Array<[id: string, latestReply: string | undefined]>;
type Probe = { commits: Shown[]; mounts: number; unmounts: number };
const newProbe = (): Probe => ({ commits: [], mounts: 0, unmounts: 0 });

/** The index and the cards under it, which `RoomTimeline` renders once the list may build. */
function Cards({ listened, probe }: { listened?: ThreadOverviewRefresh; probe: Probe }) {
  const fixed = useMemo(options, []);
  const overview = useThreadOverviewRefreshCounter(room, undefined, listened);
  const index = useThreadIndex({
    ...fixed,
    overviewRefreshCounter: overview.overviewRefreshCounter,
    overviewChanges: overview.overviewChanges,
  });
  useLayoutEffect(() => {
    probe.commits.push(
      index.compactOverviewOrdering.displayOrderedIds.map((id) => [
        id,
        index.compactThreadRecordMap.get(id)?.presentation.latestReplyPreviewText,
      ])
    );
  });
  // As the cards' scroll memory, which puts the list where the reader left it as it mounts.
  useLayoutEffect(() => {
    probe.mounts += 1;
    return () => {
      probe.unmounts += 1;
    };
  }, [probe]);
  return null;
}

/** The list as `RoomTimeline` mounts it: nothing until its first build may start. */
function List({ probe, wait = true }: { probe: Probe; wait?: boolean }) {
  const listened = useThreadOverviewListenedFirst(room, undefined, wait);
  if (listened === 'waiting') return null;
  return <Cards listened={listened} probe={probe} />;
}

/** Runs its effects before those of the list after it: a part of the page that mounts with it. */
function BesideList({ inLayout, inPassive }: { inLayout?: () => void; inPassive?: () => void }) {
  useLayoutEffect(() => {
    inLayout?.();
  }, [inLayout]);
  useEffect(() => {
    inPassive?.();
  }, [inPassive]);
  return null;
}

const page = (children: ReactNode) => (
  <MatrixClientProvider value={mx}>
    <SyncEngineProvider engine={createSyncEngine({ mx })}>{children}</SyncEngineProvider>
  </MatrixClientProvider>
);

/**
 * Mounts the list as a click on Back does, in one task. `beforeListeners` runs after the render
 * that brings the list back and before its listeners start, `onceListening` after they started
 * and before the list builds.
 */
const comeBack = (during: { beforeListeners?: () => void; onceListening?: () => void } = {}) => {
  const probe = newProbe();
  vi.mocked(buildThreadIndexRecordMaps).mockClear();
  const view = render(
    page(
      <>
        <BesideList inLayout={during.beforeListeners} inPassive={during.onceListening} />
        <List probe={probe} />
      </>
    )
  );
  return {
    commits: probe.commits,
    probe,
    builds: () => vi.mocked(buildThreadIndexRecordMaps).mock.calls,
    unmount: view.unmount,
  };
};

const listeners = () => [
  room.listenerCount(ThreadEvent.New),
  room.listenerCount(ThreadEvent.Update),
  room.listenerCount(RoomEvent.Timeline),
  room.listenerCount(RoomEvent.Redaction),
];

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
  addThread('$a', 1000);
  addThread('$b', 2000);
  await settle();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Thread.hasServerSideSupport = threadSupport;
  Thread.hasServerSideListSupport = listSupport;
});

describe('the Compact list that comes back when a thread that filled the page closes', () => {
  it('builds its records once, after its listeners started', () => {
    const back = comeBack();

    // No build that the start of the listeners builds over: one pass over the room's threads.
    expect(back.builds()).toHaveLength(1);
    expect(back.builds()[0]![0].previous).toBeUndefined();
    expect(back.commits).toEqual([
      [
        ['$b', 'reply in $b'],
        ['$a', 'reply in $a'],
      ],
    ]);
    // The cards mount once, with that build: no list of an earlier pass to place the scroll by.
    expect([back.probe.mounts, back.probe.unmounts]).toEqual([1, 0]);
    back.unmount();
  });

  it('first shows the threads and the order the room has once it listens', () => {
    const back = comeBack({
      // After the render that brings the list back: the room lists a thread whose root its
      // timeline lacks, loses B, and A gets a reply that sorts it first.
      beforeListeners: () => {
        addThread('$new', 3000, false);
        const gone = room.getThread('$b')!;
        gone.emit(ThreadEvent.Delete, gone);
      },
      onceListening: () => {
        room.getThread('$a')!.addEvents([message('$a-newer', 4000, 'newer in $a', '$a')], false);
      },
    });

    expect(back.commits[0]).toEqual([
      ['$a', 'newer in $a'],
      ['$new', 'reply in $new'],
    ]);
    // What the threads announce after that is a build of their own records, not of every one.
    expect(back.builds().filter(([{ previous }]) => !previous)).toHaveLength(1);
    back.unmount();
  });

  it('first shows a redaction only a cached copy knew, which no event tells of', () => {
    const back = comeBack({
      // As a read of the cache merges it into the room's events: the room emits nothing.
      beforeListeners: () => {
        createPreferLiveEventMapper(
          room,
          mx.getEventMapper()
        )({
          ...raw('$b-reply', 2500, 'reply in $b', '$b'),
          unsigned: {
            redacted_because: {
              event_id: '$redaction',
              room_id: ROOM_ID,
              sender: BOB,
              type: 'm.room.redaction',
              origin_server_ts: 2600,
              redacts: '$b-reply',
              content: {},
            } as IEvent,
          },
        });
      },
    });

    expect(room.findEventById('$b-reply')?.isRedacted()).toBe(true);
    expect(back.commits).toHaveLength(1);
    expect(back.commits[0]!.find(([id]) => id === '$b')?.[1]).not.toBe('reply in $b');
    expect(back.builds()).toHaveLength(1);
    back.unmount();
  });

  it('first shows what the SDK changed without an event once the list listens', () => {
    const back = comeBack({
      // An edit put on the reply in place: nothing re-emits this event's changes.
      onceListening: () => {
        room.findEventById('$a-reply')!.makeReplaced(
          new MatrixEvent({
            ...raw('$a-edit', 1600, '* edited in $a', '$a'),
            content: {
              msgtype: 'm.text',
              body: '* edited in $a',
              'm.new_content': { msgtype: 'm.text', body: 'edited in $a' },
              'm.relates_to': { rel_type: RelationType.Replace, event_id: '$a-reply' },
            },
          })
        );
      },
    });

    expect(back.commits).toEqual([
      [
        ['$b', 'reply in $b'],
        ['$a', 'edited in $a'],
      ],
    ]);
    expect(back.builds()).toHaveLength(1);
    back.unmount();
  });

  it('shows nothing before that build, and the build before the paint', async () => {
    const probe = newProbe();
    const atPaint: Shown[][] = [];
    const container = document.body.appendChild(document.createElement('div'));
    const root = createRoot(container);
    // Without `act`, as in the app: the render is a task of its own. What the list has shown
    // when that task's microtasks run is what the first paint shows.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    try {
      root.render(
        page(
          <>
            <BesideList
              inLayout={() => {
                room
                  .getThread('$a')!
                  .addEvents([message('$a-newer', 4000, 'newer in $a', '$a')], false);
                queueMicrotask(() => atPaint.push([...probe.commits]));
              }}
            />
            <List probe={probe} />
          </>
        )
      );
      await vi.waitFor(() => expect(atPaint).toHaveLength(1));
    } finally {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    }

    expect(atPaint[0]).toEqual([
      [
        ['$a', 'newer in $a'],
        ['$b', 'reply in $b'],
      ],
    ]);
    act(() => root.unmount());
    container.remove();
  });

  it('listens only while it shows, and builds nothing while it is gone', async () => {
    const before = listeners();
    const back = comeBack();
    expect(listeners()).not.toEqual(before);

    back.unmount();
    expect(listeners()).toEqual(before);
    vi.mocked(buildThreadIndexRecordMaps).mockClear();
    room.getThread('$a')!.addEvents([message('$a-newer', 4000, 'newer in $a', '$a')], false);
    await settle();
    expect(buildThreadIndexRecordMaps).not.toHaveBeenCalled();
  });

  it('shows nothing older under StrictMode either, and stops listening when it goes', () => {
    const before = listeners();
    const probe = newProbe();
    const newer = () => {
      room.getThread('$a')!.addEvents([message('$a-newer', 4000, 'newer in $a', '$a')], false);
    };
    const view = render(
      page(
        <StrictMode>
          <BesideList inLayout={newer} />
          <List probe={probe} />
        </StrictMode>
      )
    );

    // StrictMode runs the effect that notes a commit twice.
    expect(probe.commits.length).toBeGreaterThan(0);
    probe.commits.forEach((shown) =>
      expect(shown).toEqual([
        ['$a', 'newer in $a'],
        ['$b', 'reply in $b'],
      ])
    );
    view.unmount();
    expect(listeners()).toEqual(before);
  });
});

describe('a list that does not wait for its listeners', () => {
  it('builds in its first render and starts its listeners after the paint, as before', () => {
    const probe = newProbe();
    const before = listeners();
    const inCommit: number[][] = [];
    vi.mocked(buildThreadIndexRecordMaps).mockClear();
    const view = render(
      page(
        <>
          <List probe={probe} wait={false} />
          <BesideList inLayout={() => inCommit.push(listeners())} />
        </>
      )
    );

    // Its listeners start in a passive effect and count once: a build for what they missed.
    expect(inCommit).toEqual([before]);
    expect(probe.commits).toHaveLength(2);
    expect(buildThreadIndexRecordMaps).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});
