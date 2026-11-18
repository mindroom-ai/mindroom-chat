// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
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
    firstBuild: builds[0],
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

    editRoot(roots[0], 'New A');
    const back = mountList(keeper);

    expect(back.firstBuild.get('$a')).not.toBe(before.get('$a'));
    expect(back.firstBuild.get('$a')?.presentation.rootPreviewText).toBe('New A');
    expect(back.firstBuild.get('$b')).toBe(before.get('$b'));
    expect(back.firstBuild.get('$c')).toBe(before.get('$c'));
    expect(back.firstBuild.get('$d')).toBe(before.get('$d'));
    back.unmount();
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
    expect(keeper.stopAway).toBeDefined();
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
    expect(keeper.stopAway).toBeUndefined();
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
