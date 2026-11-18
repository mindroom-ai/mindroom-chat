// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import {
  createClient,
  MatrixEvent,
  ReceiptType,
  Room,
  RoomEvent,
  RoomMemberEvent,
  ThreadEvent,
  type IRoomTimelineData,
  type MatrixClient,
  type RoomMember,
  type Thread,
} from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createThreadRecordChanges } from '../../event-store/threads/threadRecord';
import { DIRECT_ROOM_TIMELINE_FILTER_STATE } from '../../event-store/timeline/roomTimelineViewState';

const state = vi.hoisted(() => ({
  list: {
    threads: [] as unknown[],
    loading: true,
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
vi.mock('./threadIndexRecords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./threadIndexRecords')>();
  return { buildThreadIndexRecordMaps: vi.fn(actual.buildThreadIndexRecordMaps) };
});

// eslint-disable-next-line import/first
import { buildThreadIndexRecordMaps } from './threadIndexRecords';
// eslint-disable-next-line import/first
import { useThreadIndex, type UseThreadIndexOptions } from './useThreadIndex';
// eslint-disable-next-line import/first
import { useThreadOverviewRefreshCounter } from './threadOverviewRefreshCounter';

let mx: MatrixClient;
let room: Room;

const root = (eventId: string) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: room.roomId,
    event_id: eventId,
    sender: '@alice:server',
    origin_server_ts: 1000,
    content: { msgtype: 'm.text', body: 'Anyone?' },
  });

beforeEach(() => {
  vi.mocked(buildThreadIndexRecordMaps).mockClear();
  mx = createClient({ baseUrl: 'https://matrix.example', userId: '@me:server' });
  room = new Room('!room:server', mx, '@me:server');
  // The room's thread list is live, so its zero-reply roots count once it has loaded.
  Object.assign(room, { threadsTimelineSets: [{ getLiveTimeline: () => ({}) }] });
  // A pinned root nobody answered: a zero-reply root of the Compact list.
  state.pinnedEvents = [root('$root')];
  state.list = { ...state.list, loading: true };
});

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
  currentUserId: '@me:server',
  requestedThreadFilterState: DIRECT_ROOM_TIMELINE_FILTER_STATE,
  threadSortFreezeState: null,
  overviewRefreshCounter: 0,
  overviewChanges: createThreadRecordChanges(),
  sessionId: 'session',
  mx,
  onStoreThreadSummary: () => undefined,
});

describe('useThreadIndex record builds', () => {
  it('builds no record again when only the thread list stops loading', () => {
    const fixed = options();
    const { result, rerender } = renderHook(useThreadIndex, { initialProps: fixed });
    expect(result.current.compactThreadRootData.ids).toEqual(['$root']);
    expect(result.current.hasZeroReplyRootCoverage).toBe(false);
    const builds = vi.mocked(buildThreadIndexRecordMaps).mock.calls.length;
    const records = result.current.compactThreadRecordMap;

    state.list = { ...state.list, loading: false };
    rerender(fixed);

    expect(result.current.hasZeroReplyRootCoverage).toBe(true);
    expect(vi.mocked(buildThreadIndexRecordMaps).mock.calls.length).toBe(builds);
    expect(result.current.compactThreadRecordMap).toBe(records);
  });

  it('counts are not settled on the render that turns the thread list off', () => {
    state.list = { ...state.list, loading: false, loadedSuccessfully: true };
    const { result, rerender } = renderHook(useThreadIndex, { initialProps: options() });
    expect(result.current.threadListSettled).toBe(true);
    // The unfiltered Threads view lists no thread list. Its first render still reads the list's
    // last load, which the list resets only after that render.
    rerender({ ...options(), compactViewRequested: false, effectiveViewMode: 'threaded' });
    expect(result.current.threadListSettled).toBe(false);
  });

  it('keeps no record from before a thread was open', () => {
    const fixed = options();
    const { result, rerender } = renderHook(useThreadIndex, { initialProps: fixed });
    const before = result.current.compactThreadRecordMap.get('$root');
    expect(before).toBeDefined();

    rerender({ ...fixed, threadId: '$root' });
    expect(result.current.compactThreadRecordMap.size).toBe(0);
    rerender(fixed);

    expect(result.current.compactThreadRecordMap.get('$root')).toBeDefined();
    expect(result.current.compactThreadRecordMap.get('$root')).not.toBe(before);
  });

  // The index as the room view runs it: the room's events raise the count and say what changed.
  const renderListeningIndex = () => {
    state.pinnedEvents = [root('$a'), root('$b')];
    const fixed = options();
    let first: ReadonlyMap<string, unknown> | undefined;
    const hook = renderHook(() => {
      const { overviewRefreshCounter, overviewChanges } = useThreadOverviewRefreshCounter(
        room,
        undefined
      );
      const index = useThreadIndex({ ...fixed, overviewRefreshCounter, overviewChanges });
      first ??= index.compactThreadRecordMap;
      return index;
    });
    const records = () => hook.result.current.compactThreadRecordMap;
    expect([...records().keys()]).toEqual(['$b', '$a']);
    // The listeners count once when they start, which builds every record again: the room may
    // have changed between the first build and the listeners.
    expect(first?.get('$b')).toBeDefined();
    expect(records().get('$b')).not.toBe(first?.get('$b'));
    return records;
  };
  const receiptOf = (userId: string) =>
    new MatrixEvent({
      type: 'm.receipt',
      room_id: room.roomId,
      content: { $other: { [ReceiptType.Read]: { [userId]: { ts: 2000 } } } },
    });

  it('builds the record of the thread an update is for, and keeps the others', () => {
    const records = renderListeningIndex();
    const before = records();

    act(() => {
      room.emit(ThreadEvent.Update, { id: '$a' } as Thread);
    });

    expect(records()).not.toBe(before);
    expect(records().get('$a')).not.toBe(before.get('$a'));
    expect(records().get('$b')).toBe(before.get('$b'));
  });

  it("keeps every record on someone else's receipt, and builds each on the reader's", () => {
    const records = renderListeningIndex();
    const before = records();

    act(() => {
      room.emit(RoomEvent.Receipt, receiptOf('@alice:server'), room);
    });

    expect(records()).not.toBe(before);
    expect(records().get('$a')).toBe(before.get('$a'));
    expect(records().get('$b')).toBe(before.get('$b'));

    act(() => {
      room.emit(RoomEvent.Receipt, receiptOf('@me:server'), room);
    });

    expect(records().get('$a')).not.toBe(before.get('$a'));
    expect(records().get('$b')).not.toBe(before.get('$b'));
  });

  it('builds every record when a member of the room took a new name, in a room where nothing more happens', () => {
    const records = renderListeningIndex();
    const before = records();
    const member = new MatrixEvent({
      type: 'm.room.member',
      room_id: room.roomId,
      state_key: '@alice:server',
      content: { membership: 'join', displayname: 'Alice B' },
    });

    act(() => {
      mx.emit(RoomMemberEvent.Name, member, { roomId: room.roomId } as RoomMember, 'Alice');
    });

    expect(records().get('$a')).not.toBe(before.get('$a'));
    expect(records().get('$b')).not.toBe(before.get('$b'));
  });

  it('builds every record when a page of history brings a member event, in a room where nothing more happens', () => {
    const records = renderListeningIndex();
    const before = records();
    // The name a member had before they left, which their records show from then on.
    const joined = new MatrixEvent({
      type: 'm.room.member',
      room_id: room.roomId,
      event_id: '$joined',
      state_key: '@alice:server',
      content: { membership: 'join', displayname: 'Alice' },
    });

    act(() => {
      room.emit(RoomEvent.Timeline, joined, room, true, false, {} as IRoomTimelineData);
    });

    expect(records().get('$a')).not.toBe(before.get('$a'));
    expect(records().get('$b')).not.toBe(before.get('$b'));
  });
});
