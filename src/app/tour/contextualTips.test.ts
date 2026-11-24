// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { createElement } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { ClientEvent, SyncState } from 'matrix-js-sdk';
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
  } as CrossRoomThreadIndexEntry);

describe('evaluateContextualTip', () => {
  const empty = new Set<string>();

  it('triggers at 5 recent open threads, not at 4', () => {
    const four = Array.from({ length: RESOLVE_TIP_MIN_OPEN - 1 }, (_, i) => makeEntry(`t${i}`));
    expect(
      evaluateContextualTip({ entries: four, archivedRooms: empty, dismissedTips: empty, now: NOW })
    ).toBeUndefined();

    const five = [...four, makeEntry('t4')];
    expect(
      evaluateContextualTip({ entries: five, archivedRooms: empty, dismissedTips: empty, now: NOW })
    ).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'all',
      openCount: 5,
    });
  });

  it('triggers at 3 threads at least 24 hours old, not at 2 or 1ms under 24h', () => {
    const twoOld = Array.from({ length: RESOLVE_TIP_MIN_OLD - 1 }, (_, i) =>
      makeEntry(`old-${i}`, { lastActivityTs: OLD })
    );
    expect(
      evaluateContextualTip({
        entries: twoOld,
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
      })
    ).toBeUndefined();

    const threeAlmostOld = Array.from({ length: RESOLVE_TIP_MIN_OLD }, (_, i) =>
      makeEntry(`almost-${i}`, { lastActivityTs: ALMOST_OLD })
    );
    expect(
      evaluateContextualTip({
        entries: threeAlmostOld,
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
      })
    ).toBeUndefined();

    const threeOldPlusOneRecent = [
      ...twoOld,
      makeEntry('old-2', { lastActivityTs: OLD }),
      makeEntry('recent', { lastActivityTs: RECENT }),
    ];
    expect(
      evaluateContextualTip({
        entries: threeOldPlusOneRecent,
        archivedRooms: empty,
        dismissedTips: empty,
        now: NOW,
      })
    ).toEqual({
      id: RESOLVE_TIP_ID,
      tourStep: 'resolve',
      scope: 'all',
      openCount: 4,
    });
  });

  it('suppresses the tip when any visible thread is already resolved', () => {
    const entries = [
      ...Array.from({ length: 6 }, (_, i) =>
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
      ...Array.from({ length: 4 }, (_, i) => makeEntry(`open-${i}`)),
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
      ...Array.from({ length: 4 }, (_, i) => makeEntry(`open-${i}`)),
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
      openCount: 5,
    });
  });

  it('excludes archived rooms from open counts', () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
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
    const entries = Array.from({ length: 6 }, (_, i) => makeEntry(`open-${i}`));
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
      ...Array.from({ length: 3 }, (_, i) =>
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
      openCount: 4,
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
      openCount: 6,
    });
  });
});

const makeClient = (userId: string, stored?: unknown, synced = true) => {
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
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry(`t${i}`));
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
      openCount: 5,
    });
  });

  it('isolates session dismissals per account when a write fails and opens the tour on resolve', async () => {
    const alice = makeClient('@alice:example.org', { showThreadsInSidebar: true }, true);
    alice.setAccountData.mockRejectedValueOnce(new Error('offline'));
    const bob = makeClient('@bob:example.org', {}, true);
    const store = createStore();
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry(`t${i}`));
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
      openCount: 5,
    });

    // Switching back to Alice keeps Alice's tip dismissed for this page load.
    vi.mocked(useMatrixClient).mockReturnValue(
      alice.client as unknown as ReturnType<typeof useMatrixClient>
    );
    view.rerender();
    expect(view.result.current.tip).toBeUndefined();
  });
});
