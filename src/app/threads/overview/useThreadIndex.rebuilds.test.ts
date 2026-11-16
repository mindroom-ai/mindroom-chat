// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { createClient, MatrixEvent, Room, type MatrixClient } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

let mx: MatrixClient;
let room: Room;

beforeEach(() => {
  vi.mocked(buildThreadIndexRecordMaps).mockClear();
  mx = createClient({ baseUrl: 'https://matrix.example', userId: '@me:server' });
  room = new Room('!room:server', mx, '@me:server');
  // The room's thread list is live, so its zero-reply roots count once it has loaded.
  Object.assign(room, { threadsTimelineSets: [{ getLiveTimeline: () => ({}) }] });
  // A pinned root nobody answered: a zero-reply root of the Compact list.
  state.pinnedEvents = [
    new MatrixEvent({
      type: 'm.room.message',
      room_id: room.roomId,
      event_id: '$root',
      sender: '@alice:server',
      origin_server_ts: 1000,
      content: { msgtype: 'm.text', body: 'Anyone?' },
    }),
  ];
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
});
