// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { createElement } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { ClientEvent, Direction, EventTimeline, RoomStateEvent, SyncState } from 'matrix-js-sdk';
import { MINDROOM_THREAD_TAGS_EVENT } from '../event-store/threads/threadTags';
import { matchesEnum } from '../lib/matchesEnum';
import { StateEvent } from '../matrix/types/room';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { archivedRoomsAtom } from '../matrix/state/archivedRooms';
import { tourAtom } from '../navigation/tourState';
import { useSelectedRoom } from '../navigation/useSelectedRoom';
import { MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE } from '../preferences/accountSettings';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import {
  RESOLVE_TIP_ID,
  RESOLVE_TIP_MIN_OLD,
  RESOLVE_TIP_MIN_OPEN,
  RESOLVE_TIP_OLD_AGE_MS,
  evaluateContextualTip,
} from './contextualTips';
import { useContextualTip } from './useContextualTip';

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: vi.fn() }));
vi.mock('../navigation/useSelectedRoom', () => ({ useSelectedRoom: vi.fn(() => undefined) }));

const NOW = 1_700_000_000_000;
const RECENT = NOW - 60_000;
const OLD = NOW - RESOLVE_TIP_OLD_AGE_MS;
const ALMOST_OLD = NOW - RESOLVE_TIP_OLD_AGE_MS + 1;

const makeEntry = (
  id: string,
  overrides: Partial<CrossRoomThreadIndexEntry> = {}
): CrossRoomThreadIndexEntry =>
  ({
    key: `${overrides.roomId ?? '!room-a:example.org'}\u0000$${id}`,
    roomId: '!room-a:example.org',
    roomName: 'Room A',
    threadRootId: `$${id}`,
    indexedEventIds: [`$${id}`],
    lastActivityTs: RECENT,
    isUnread: false,
    isResolved: false,
    hasAttention: false,
    isInvolved: false,
    summaryText: id,
    rootPreviewText: id,
    searchableText: id,
    tags: [],
    generation: 1,
    ...overrides,
  }) as CrossRoomThreadIndexEntry;

describe('evaluateContextualTip', () => {
  const empty = new Set<string>();

  it('triggers at 8 recent open threads, not at 7', () => {
    const belowMin = Array.from({ length: RESOLVE_TIP_MIN_OPEN - 1 }, (_, i) => makeEntry(`t${i}`));
    expect(
      evaluateContextualTip({
        entries: belowMin,
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
      })
    ).toBeUndefined();

    const atMin = [...belowMin, makeEntry(`t${RESOLVE_TIP_MIN_OPEN - 1}`)];
    expect(
      evaluateContextualTip({
        entries: atMin,
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
      })
    ).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'all',
      openCount: RESOLVE_TIP_MIN_OPEN,
    });
  });

  it('triggers at 5 threads at least 24 hours old, not at 4 or 1ms under 24h', () => {
    const belowOld = Array.from({ length: RESOLVE_TIP_MIN_OLD - 1 }, (_, i) =>
      makeEntry(`old-${i}`, { lastActivityTs: OLD })
    );
    expect(
      evaluateContextualTip({
        entries: belowOld,
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
      })
    ).toBeUndefined();

    const almostOld = Array.from({ length: RESOLVE_TIP_MIN_OLD }, (_, i) =>
      makeEntry(`almost-${i}`, { lastActivityTs: ALMOST_OLD })
    );
    expect(
      evaluateContextualTip({
        entries: almostOld,
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
      })
    ).toBeUndefined();

    const atOldPlusOneRecent = [
      ...belowOld,
      makeEntry(`old-${RESOLVE_TIP_MIN_OLD - 1}`, { lastActivityTs: OLD }),
      makeEntry('recent', { lastActivityTs: RECENT }),
    ];
    expect(
      evaluateContextualTip({
        entries: atOldPlusOneRecent,
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
      })
    ).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'all',
      openCount: RESOLVE_TIP_MIN_OLD + 1,
    });
  });

  it('suppresses the tip when any visible thread is already resolved', () => {
    const entries = [
      ...Array.from({ length: RESOLVE_TIP_MIN_OPEN + 1 }, (_, i) =>
        makeEntry(`open-${i}`, { roomId: '!room-a:example.org' })
      ),
      makeEntry('done', { roomId: '!room-b:example.org', isResolved: true }),
    ];
    expect(
      evaluateContextualTip({
        entries,
        selectedRoomId: '!room-a:example.org',
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
      })
    ).toBeUndefined();
  });

  it('excludes currently snoozed threads while counting expired snoozes', () => {
    const snoozed = [
      ...Array.from({ length: RESOLVE_TIP_MIN_OPEN - 1 }, (_, i) => makeEntry(`open-${i}`)),
      makeEntry('snoozed', { snoozedUntilTs: NOW + 60_000 }),
    ];
    expect(
      evaluateContextualTip({
        entries: snoozed,
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
      })
    ).toBeUndefined();

    const expiredSnooze = [
      ...Array.from({ length: RESOLVE_TIP_MIN_OPEN - 1 }, (_, i) => makeEntry(`open-${i}`)),
      makeEntry('expired', { snoozedUntilTs: NOW }),
    ];
    expect(
      evaluateContextualTip({
        entries: expiredSnooze,
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
      })
    ).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'all',
      openCount: RESOLVE_TIP_MIN_OPEN,
    });
  });

  it('excludes archived rooms from open counts', () => {
    const entries = Array.from({ length: RESOLVE_TIP_MIN_OPEN + 1 }, (_, i) =>
      makeEntry(`archived-${i}`, { roomId: '!archived:example.org' })
    );
    expect(
      evaluateContextualTip({
        entries,
        selectedRoomId: '!archived:example.org',
        archivedRooms: new Set(['!archived:example.org']),
        dismissedTips: empty,
        now: NOW,
      })
    ).toBeUndefined();
  });

  it('returns undefined when the resolve tip is already dismissed', () => {
    const entries = Array.from({ length: RESOLVE_TIP_MIN_OPEN + 1 }, (_, i) =>
      makeEntry(`open-${i}`)
    );
    expect(
      evaluateContextualTip({
        entries,
        archivedRooms: empty,
        dismissedTips: new Set([RESOLVE_TIP_ID]),
        now: NOW,
      })
    ).toBeUndefined();
  });

  it('prefers room scope when the selected room meets the threshold, else falls back to all rooms', () => {
    const entries = [
      ...Array.from({ length: RESOLVE_TIP_MIN_OLD }, (_, i) =>
        makeEntry(`a-${i}`, { roomId: '!room-a:example.org', lastActivityTs: OLD })
      ),
      makeEntry('a-recent', { roomId: '!room-a:example.org', lastActivityTs: RECENT }),
      ...Array.from({ length: 2 }, (_, i) =>
        makeEntry(`b-${i}`, { roomId: '!room-b:example.org', lastActivityTs: RECENT })
      ),
    ];

    expect(
      evaluateContextualTip({
        entries,
        selectedRoomId: '!room-a:example.org',
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
      })
    ).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'room',
      openCount: RESOLVE_TIP_MIN_OLD + 1,
    });

    expect(
      evaluateContextualTip({
        entries,
        selectedRoomId: '!room-b:example.org',
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
      })
    ).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'all',
      openCount: RESOLVE_TIP_MIN_OLD + 3,
    });
  });

  it('ignores rooms where canResolveRoom returns false and caches per room ID', () => {
    const entries = Array.from({ length: RESOLVE_TIP_MIN_OPEN }, (_, i) =>
      makeEntry(`locked-${i}`, { roomId: '!locked:example.org' })
    );
    const canResolveRoom = vi.fn(() => false);
    expect(
      evaluateContextualTip({
        entries,
        selectedRoomId: '!locked:example.org',
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
        canResolveRoom,
      })
    ).toBeUndefined();
    expect(canResolveRoom).toHaveBeenCalledTimes(1);
    expect(canResolveRoom).toHaveBeenCalledWith('!locked:example.org');
  });

  it('counts only resolvable rooms when mixed with restricted rooms, while still suppressing on any resolved thread', () => {
    const mixed = [
      ...Array.from({ length: 4 }, (_, i) =>
        makeEntry(`locked-${i}`, { roomId: '!locked:example.org', lastActivityTs: OLD })
      ),
      ...Array.from({ length: RESOLVE_TIP_MIN_OLD }, (_, i) =>
        makeEntry(`ok-${i}`, { roomId: '!ok:example.org', lastActivityTs: OLD })
      ),
    ];
    const canResolveRoom = vi.fn((roomId: string) => roomId === '!ok:example.org');

    // Viewing the restricted room falls back to all resolvable rooms (5, not 9).
    expect(
      evaluateContextualTip({
        entries: mixed,
        selectedRoomId: '!locked:example.org',
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
        canResolveRoom,
      })
    ).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'all',
      openCount: RESOLVE_TIP_MIN_OLD,
    });
    expect(canResolveRoom).toHaveBeenCalledTimes(2);

    // Viewing the resolvable room scopes to that room with only its open count.
    expect(
      evaluateContextualTip({
        entries: mixed,
        selectedRoomId: '!ok:example.org',
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
        canResolveRoom,
      })
    ).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'room',
      openCount: RESOLVE_TIP_MIN_OLD,
    });

    // Any resolved thread in a visible room still suppresses the tip even if that room is now locked.
    expect(
      evaluateContextualTip({
        entries: [...mixed, makeEntry('done', { roomId: '!locked:example.org', isResolved: true })],
        selectedRoomId: '!ok:example.org',
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
        canResolveRoom,
      })
    ).toBeUndefined();
  });
});

type StubRoomOptions = {
  powerLevels?: Record<string, unknown> | null;
  roomVersion?: string;
  creator?: string;
  pinned?: string[];
};

const makeRoom = ({
  powerLevels = {
    users_default: 0,
    state_default: 50,
    events: { [MINDROOM_THREAD_TAGS_EVENT]: 0 },
  },
  roomVersion = '11',
  creator = '@creator:example.org',
  pinned,
}: StubRoomOptions = {}) => {
  const createEvent = {
    getType: () => StateEvent.RoomCreate,
    getSender: () => creator,
    getContent: () => ({ room_version: roomVersion }),
  };
  let powerLevelsEvent =
    powerLevels === null
      ? null
      : {
          getType: () => StateEvent.RoomPowerLevels,
          getContent: () => powerLevels,
        };
  let pinnedEvent =
    pinned === undefined
      ? null
      : {
          getType: () => StateEvent.RoomPinnedEvents,
          getContent: () => ({ pinned }),
        };
  const room = {
    getLiveTimeline: () => ({
      getState: (direction: Direction) =>
        direction === EventTimeline.FORWARDS
          ? {
              getStateEvents: (type: string, stateKey?: string) => {
                if (stateKey !== '') return null;
                if (matchesEnum(type, StateEvent.RoomCreate)) return createEvent;
                if (matchesEnum(type, StateEvent.RoomPowerLevels)) return powerLevelsEvent;
                if (matchesEnum(type, StateEvent.RoomPinnedEvents)) return pinnedEvent;
                return null;
              },
            }
          : null,
    }),
  };
  return {
    room,
    setPowerLevels: (next: Record<string, unknown> | null) => {
      powerLevelsEvent =
        next === null
          ? null
          : {
              getType: () => StateEvent.RoomPowerLevels,
              getContent: () => next,
            };
      return powerLevelsEvent;
    },
    setPinned: (next: string[]) => {
      pinnedEvent = {
        getType: () => StateEvent.RoomPinnedEvents,
        getContent: () => ({ pinned: next }),
      };
      return pinnedEvent;
    },
  };
};

const makeClient = (
  userId: string,
  stored?: unknown,
  synced = true,
  rooms: ReadonlyMap<string, ReturnType<typeof makeRoom>['room'] | null> = new Map([
    ['!room-a:example.org', makeRoom().room],
  ])
) => {
  const settingsEvent = (content: unknown) => ({
    getType: () => MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
    getContent: () => content,
  });
  const held = stored === undefined ? undefined : settingsEvent(stored);
  const setAccountData = vi.fn(async (_type: string, _content: unknown): Promise<void> => {});
  let syncState: SyncState = synced ? SyncState.Syncing : SyncState.Prepared;
  const client = Object.assign(new EventEmitter(), {
    getSafeUserId: () => userId,
    getHomeserverUrl: () => 'https://example.org',
    getSyncState: () => syncState,
    getSyncStateData: () => (syncState === SyncState.Prepared ? { fromCache: true } : undefined),
    getRoom: (roomId: string) => rooms.get(roomId) ?? null,
    getAccountData: (type: string) =>
      type === MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE ? held : undefined,
    setAccountData,
  });
  return {
    client,
    setAccountData,
    sync: () => {
      const before = syncState;
      syncState = SyncState.Syncing;
      act(() => {
        client.emit(ClientEvent.Sync, syncState, before);
      });
    },
  };
};

const indexWith = (entries: CrossRoomThreadIndexEntry[], bootstrapped = true) => ({
  entries: new Map(entries.map((entry) => [entry.key, entry])),
  eventIdToThreadRoots: new Map(),
  version: 1,
  bootstrapped,
});

describe('useContextualTip', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('stays undefined until both server sync and thread index bootstrap complete', () => {
    const alice = makeClient('@alice:example.org', {}, false);
    vi.mocked(useMatrixClient).mockReturnValue(
      alice.client as unknown as ReturnType<typeof useMatrixClient>
    );
    const store = createStore();
    const entries = Array.from({ length: RESOLVE_TIP_MIN_OPEN }, (_, i) => makeEntry(`t${i}`));
    store.set(crossRoomThreadIndexAtom, indexWith(entries, false));

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(Provider, { store }, children);
    const { result } = renderHook(() => useContextualTip(), { wrapper });
    expect(result.current.tip).toBeUndefined();

    // Synced but not bootstrapped yet.
    alice.sync();
    expect(result.current.tip).toBeUndefined();

    // Once bootstrapped, the tip appears.
    act(() => store.set(crossRoomThreadIndexAtom, indexWith(entries, true)));
    expect(result.current.tip).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'all',
      openCount: RESOLVE_TIP_MIN_OPEN,
    });
  });

  it('isolates session dismissals per account when a write fails and opens the tour on resolve', async () => {
    const alice = makeClient('@alice:example.org', { showThreadsInSidebar: true }, true);
    alice.setAccountData.mockRejectedValueOnce(new Error('offline'));
    const bob = makeClient('@bob:example.org', {}, true);
    const store = createStore();
    const entries = Array.from({ length: RESOLVE_TIP_MIN_OPEN }, (_, i) => makeEntry(`t${i}`));
    store.set(crossRoomThreadIndexAtom, indexWith(entries, true));
    store.set(archivedRoomsAtom, new Set());
    vi.mocked(useSelectedRoom).mockReturnValue(undefined);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(Provider, { store }, children);

    vi.mocked(useMatrixClient).mockReturnValue(
      alice.client as unknown as ReturnType<typeof useMatrixClient>
    );
    const view = renderHook(() => useContextualTip(), { wrapper });
    const tip = view.result.current.tip;
    expect(tip).toBeDefined();

    act(() => {
      if (tip) view.result.current.openTipTour(tip);
    });
    expect(view.result.current.tip).toBeUndefined();
    expect(store.get(tourAtom)).toEqual({ level: 'full', initialStep: 'resolve' });
    await vi.waitFor(() =>
      expect(alice.setAccountData).toHaveBeenCalledWith(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE, {
        showThreadsInSidebar: true,
        dismissedTips: [RESOLVE_TIP_ID],
      })
    );

    // Switching to Bob does not leak Alice's failed-write session dismissal.
    vi.mocked(useMatrixClient).mockReturnValue(
      bob.client as unknown as ReturnType<typeof useMatrixClient>
    );
    view.rerender();
    expect(view.result.current.tip).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'all',
      openCount: RESOLVE_TIP_MIN_OPEN,
    });

    // Switching back to Alice keeps Alice's tip dismissed for this page load.
    vi.mocked(useMatrixClient).mockReturnValue(
      alice.client as unknown as ReturnType<typeof useMatrixClient>
    );
    view.rerender();
    expect(view.result.current.tip).toBeUndefined();
  });
  it('suppresses the tip when room power levels forbid com.mindroom.thread.tags and respects room v12 creators and live updates', () => {
    const restricted = makeRoom({ powerLevels: { users_default: 0, state_default: 50 } });
    const v12CreatorRoom = makeRoom({
      powerLevels: { users_default: 0, state_default: 50 },
      roomVersion: '12',
      creator: '@alice:example.org',
    });
    const rooms = new Map([
      ['!restricted:example.org', restricted.room],
      ['!v12:example.org', v12CreatorRoom.room],
    ]);
    const alice = makeClient('@alice:example.org', {}, true, rooms);
    vi.mocked(useMatrixClient).mockReturnValue(
      alice.client as unknown as ReturnType<typeof useMatrixClient>
    );

    const store = createStore();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(Provider, { store }, children);

    // Open threads in a restricted room -> no tip.
    const restrictedEntries = Array.from({ length: RESOLVE_TIP_MIN_OPEN }, (_, i) =>
      makeEntry(`r-${i}`, { roomId: '!restricted:example.org' })
    );
    store.set(crossRoomThreadIndexAtom, indexWith(restrictedEntries, true));
    const view = renderHook(() => useContextualTip(), { wrapper });
    expect(view.result.current.tip).toBeUndefined();

    // Missing room fails closed.
    const missingRoomEntries = Array.from({ length: RESOLVE_TIP_MIN_OPEN }, (_, i) =>
      makeEntry(`m-${i}`, { roomId: '!missing:example.org' })
    );
    act(() => store.set(crossRoomThreadIndexAtom, indexWith(missingRoomEntries, true)));
    expect(view.result.current.tip).toBeUndefined();

    // Granting permission via a live m.room.power_levels state event makes the tip appear.
    act(() => store.set(crossRoomThreadIndexAtom, indexWith(restrictedEntries, true)));
    expect(view.result.current.tip).toBeUndefined();
    const updatedPl = restricted.setPowerLevels({
      users_default: 0,
      state_default: 50,
      events: { [MINDROOM_THREAD_TAGS_EVENT]: 0 },
    });
    act(() => {
      alice.client.emit(RoomStateEvent.Events, updatedPl, {}, null);
    });
    expect(view.result.current.tip).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'all',
      openCount: RESOLVE_TIP_MIN_OPEN,
    });

    // Room version 12 creator can resolve even when state_default is 50 and users_default is 0.
    const v12Entries = Array.from({ length: RESOLVE_TIP_MIN_OPEN }, (_, i) =>
      makeEntry(`v-${i}`, { roomId: '!v12:example.org' })
    );
    act(() => store.set(crossRoomThreadIndexAtom, indexWith(v12Entries, true)));
    expect(view.result.current.tip).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'all',
      openCount: RESOLVE_TIP_MIN_OPEN,
    });
  });

  it('excludes pinned threads from the resolve tip and updates when pins change', () => {
    const oldTs = Date.now() - RESOLVE_TIP_OLD_AGE_MS - 60_000;
    const pinnedIds = Array.from({ length: RESOLVE_TIP_MIN_OLD }, (_, i) => `p-${i}`);
    const pinnedRoom = makeRoom({ pinned: pinnedIds.map((id) => `$${id}`) });
    const rooms = new Map([['!room-a:example.org', pinnedRoom.room]]);
    const alice = makeClient('@alice:example.org', {}, true, rooms);
    vi.mocked(useMatrixClient).mockReturnValue(
      alice.client as unknown as ReturnType<typeof useMatrixClient>
    );

    const store = createStore();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(Provider, { store }, children);

    const oldPinnedEntries = pinnedIds.map((id) =>
      makeEntry(id, { roomId: '!room-a:example.org', lastActivityTs: oldTs })
    );
    store.set(crossRoomThreadIndexAtom, indexWith(oldPinnedEntries, true));
    const view = renderHook(() => useContextualTip(), { wrapper });
    expect(view.result.current.tip).toBeUndefined();

    // Unpinning via m.room.pinned_events exposes them to the resolve tip.
    const unpinned = pinnedRoom.setPinned([]);
    act(() => {
      alice.client.emit(RoomStateEvent.Events, unpinned, {}, null);
    });
    expect(view.result.current.tip).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'all',
      openCount: RESOLVE_TIP_MIN_OLD,
    });
  });
});
