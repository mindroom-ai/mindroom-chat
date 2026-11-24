// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { ClientEvent, Direction, EventTimeline, SyncState } from 'matrix-js-sdk';
import { MINDROOM_THREAD_TAGS_EVENT } from '../event-store/threads/threadTags';
import { matchesEnum } from '../lib/matchesEnum';
import { StateEvent } from '../matrix/types/room';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { createSessionId } from '../matrix/session/sessions';
import { helpMenuOpenAtom, tourAtom, tourOfferAnsweredAtom } from '../navigation/tourState';
import { useSelectedRoom } from '../navigation/useSelectedRoom';
import { MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE } from '../preferences/accountSettings';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../threads/cross-room/crossRoomThreadIndex';
import { listNoticeSlotAtom, NOTICE_LEAVE_MS, pageNoticeSlotAtom } from '../ui/noticeSlots';
import { RESOLVE_TIP_ID, RESOLVE_TIP_MIN_OPEN } from './contextualTips';
import { ContextualTipNotice } from './ContextualTipNotice';

vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: vi.fn() }));
vi.mock('../navigation/useSelectedRoom', () => ({ useSelectedRoom: vi.fn(() => undefined) }));

const makeEntry = (
  id: string,
  overrides: Partial<CrossRoomThreadIndexEntry> = {}
): CrossRoomThreadIndexEntry =>
  ({
    key: `${overrides.roomId ?? '!room:example.org'}\u0000$${id}`,
    roomId: '!room:example.org',
    roomName: 'General',
    threadRootId: `$${id}`,
    indexedEventIds: [`$${id}`],
    lastActivityTs: Date.now() - 60_000,
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

const makeRoom = (powerLevels: Record<string, unknown>) => ({
  getLiveTimeline: () => ({
    getState: (direction: Direction) =>
      direction === EventTimeline.FORWARDS
        ? {
            getStateEvents: (type: string, stateKey?: string) => {
              if (stateKey !== '') return null;
              if (matchesEnum(type, StateEvent.RoomCreate)) {
                return {
                  getType: () => StateEvent.RoomCreate,
                  getSender: () => '@creator:example.org',
                  getContent: () => ({ room_version: '11' }),
                };
              }
              if (matchesEnum(type, StateEvent.RoomPowerLevels)) {
                return {
                  getType: () => StateEvent.RoomPowerLevels,
                  getContent: () => powerLevels,
                };
              }
              return null;
            },
          }
        : null,
  }),
});

const makeAccount = (
  stored?: unknown,
  synced = true,
  roomPowerLevels: Record<string, unknown> = {
    users_default: 0,
    state_default: 50,
    events: { [MINDROOM_THREAD_TAGS_EVENT]: 0 },
  }
) => {
  const settingsEvent = (content: unknown) => ({
    getType: () => MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
    getContent: () => content,
  });
  let held = stored === undefined ? undefined : settingsEvent(stored);
  const setAccountData = vi.fn(async (_type: string, _content: unknown): Promise<void> => {});
  let syncState: SyncState = synced ? SyncState.Syncing : SyncState.Prepared;
  const client = Object.assign(new EventEmitter(), {
    getSafeUserId: () => '@alice:example.org',
    getHomeserverUrl: () => 'https://example.org',
    getSyncState: () => syncState,
    getSyncStateData: () => (syncState === SyncState.Prepared ? { fromCache: true } : undefined),
    getRoom: (roomId: string) =>
      roomId === '!room:example.org' ? makeRoom(roomPowerLevels) : null,
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
    deliver: (content: unknown) => {
      held = settingsEvent(content);
      act(() => {
        client.emit(ClientEvent.AccountData, held);
      });
    },
  };
};

const setup = ({
  stored = { tourOffered: true },
  synced = true,
  bootstrapped = true,
  entries = Array.from({ length: RESOLVE_TIP_MIN_OPEN }, (_, i) => makeEntry(`t${i}`)),
  config = {},
  selectedRoom,
  roomPowerLevels,
}: {
  stored?: unknown;
  synced?: boolean;
  bootstrapped?: boolean;
  entries?: CrossRoomThreadIndexEntry[];
  config?: ClientConfig;
  selectedRoom?: string;
  roomPowerLevels?: Record<string, unknown>;
} = {}) => {
  const acct = makeAccount(stored, synced, roomPowerLevels);
  vi.mocked(useMatrixClient).mockReturnValue(
    acct.client as unknown as ReturnType<typeof useMatrixClient>
  );
  vi.mocked(useSelectedRoom).mockReturnValue(selectedRoom);

  const store = createStore();
  const listSlot = document.body.appendChild(document.createElement('div'));
  const pageSlot = document.body.appendChild(document.createElement('div'));
  store.set(listNoticeSlotAtom, listSlot);
  store.set(pageNoticeSlotAtom, pageSlot);
  store.set(crossRoomThreadIndexAtom, {
    entries: new Map(entries.map((entry) => [entry.key, entry])),
    eventIdToThreadRoots: new Map(),
    version: 1,
    bootstrapped,
  });

  render(
    <Provider store={store}>
      <ClientConfigProvider value={config}>
        <ContextualTipNotice />
      </ClientConfigProvider>
    </Provider>
  );

  return { acct, store };
};

const card = () => document.querySelector<HTMLElement>('[data-contextual-tip]');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('ContextualTipNotice', () => {
  it('waits for sync and TourOffer, and respects tour.offerAtStart: false', () => {
    const first = setup({ stored: {}, synced: false });
    expect(card()).toBeNull();
    first.acct.sync();
    expect(card()).toBeNull();

    // Answering the tour offer lets the contextual tip appear.
    act(() =>
      first.store.set(
        tourOfferAnsweredAtom,
        new Set([createSessionId('https://example.org', '@alice:example.org')])
      )
    );
    expect(card()).toBeTruthy();

    // Opening the Help menu hides the floating card so the same tip is never shown twice.
    act(() => first.store.set(helpMenuOpenAtom, true));
    expect(card()).toBeNull();
    act(() => first.store.set(helpMenuOpenAtom, false));
    expect(card()).toBeTruthy();

    // Opening a tour hides the card.
    act(() => first.store.set(tourAtom, { level: 'quick' }));
    expect(card()).toBeNull();
    cleanup();

    // Config tour.offerAtStart: false suppresses automatic floating tip cards.
    setup({ config: { tour: { offerAtStart: false } } });
    expect(card()).toBeNull();
  });

  it('opens the tour on resolve and persists dismissal on Show how', async () => {
    vi.useFakeTimers();
    const { acct, store } = setup({ selectedRoom: '!room:example.org' });
    expect(card()).toBeTruthy();
    expect(screen.getByText(/8 open threads here, none resolved yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show how' }));
    expect(store.get(tourAtom)).toEqual({ level: 'full', initialStep: 'resolve' });
    expect(card()?.hasAttribute('data-leaving')).toBe(true);

    await vi.waitFor(() =>
      expect(acct.setAccountData).toHaveBeenCalledWith(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE, {
        tourOffered: true,
        dismissedTips: [RESOLVE_TIP_ID],
      })
    );

    act(() => {
      vi.advanceTimersByTime(NOTICE_LEAVE_MS);
    });
    expect(card()).toBeNull();
  });

  it('persists dismissal on Dismiss and hides automatically when any thread is resolved', async () => {
    const first = setup();
    expect(card()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }));
    await vi.waitFor(() =>
      expect(first.acct.setAccountData).toHaveBeenCalledWith(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE, {
        tourOffered: true,
        dismissedTips: [RESOLVE_TIP_ID],
      })
    );
    cleanup();

    const second = setup();
    expect(card()).toBeTruthy();
    const resolved = makeEntry('done', { isResolved: true });
    act(() => {
      const current = second.store.get(crossRoomThreadIndexAtom);
      const nextEntries = new Map(current.entries);
      nextEntries.set(resolved.key, resolved);
      second.store.set(crossRoomThreadIndexAtom, {
        ...current,
        entries: nextEntries,
        version: current.version + 1,
      });
    });
    expect(card()).toBeNull();
  });
  it('does not render when room power levels forbid writing com.mindroom.thread.tags', () => {
    setup({ roomPowerLevels: { users_default: 0, state_default: 50 } });
    expect(card()).toBeNull();
  });
});
