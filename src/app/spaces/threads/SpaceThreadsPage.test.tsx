// @vitest-environment jsdom
import { useEffect, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  ClientEvent,
  MatrixEventEvent,
  RelationType,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composerUploadItemsAtom,
  getRoomInputDraftKey,
  roomIdToMsgDraftAtomFamily,
} from '../../composer/roomInputDrafts';
import { ScreenSize, ScreenSizeProvider } from '../../lib/hooks/useScreenSize';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { SpaceProvider } from '../../matrix/hooks/useSpace';
import { ROOM_THREAD_MODE_EVENT, type RoomThreadMode } from '../../matrix/protocol/roomThreadMode';
import { archivedRoomsAtom } from '../../matrix/state/archivedRooms';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { AccountDataEvent } from '../../matrix/types/accountData';
import { StateEvent } from '../../matrix/types/room';
import { QUIET_AFTER_MS } from '../../event-store/threads/threadWorkflow';
import { settingsAtom } from '../../preferences/settings';
import { useHistoryStackRecorder } from '../../routes/historyStack';
import {
  crossRoomThreadIndexAtom,
  getCrossRoomThreadIndexKey,
  normalizeThreadSearchText,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import {
  clearCompactRoomSectionsStore,
  getCompactRoomSectionsAtom,
} from '../../threads/overview/compactRoomSections';
import { clearRoomThreadFiltersStore } from '../../threads/overview/roomThreadFilterState';
import { SpaceRoomFilter } from './SpaceRoomFilter';
import { SpaceThreadsPage } from './SpaceThreadsPage';
import { makeSpaceThreadEntry, SPACE_THREADS_TEST_NOW as NOW } from './spaceThreads.test.shared';

const mocks = vi.hoisted(() => ({
  navigateRoom: vi.fn(),
  navigateRoomThread: vi.fn(),
  threadListsSettled: true,
  threadListCalls: [] as Array<{ allPages: boolean; roomIds?: readonly string[] }>,
  threadCardBadgesCalls: [] as string[],
}));

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({
    children,
    focusTrapOptions,
  }: {
    children: ReactNode;
    focusTrapOptions?: { initialFocus?: (() => HTMLElement | false) | false };
  }) => {
    useEffect(() => {
      if (typeof focusTrapOptions?.initialFocus === 'function') {
        const target = focusTrapOptions.initialFocus();
        if (target instanceof HTMLElement) target.focus();
      }
    }, [focusTrapOptions]);
    return children;
  },
}));

vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: mocks.navigateRoom,
    navigateRoomThread: mocks.navigateRoomThread,
  }),
}));

vi.mock('../../threads/page/useJoinedRoomThreadLists', () => ({
  useJoinedRoomThreadLists: (allPages = false, roomIds?: readonly string[]) => {
    mocks.threadListCalls.push({ allPages, roomIds });
    return mocks.threadListsSettled;
  },
}));

vi.mock('../../composer/RoomInput', () => ({
  RoomInput: (props: { roomId: string; onRoomMessageSent?: (id: string) => boolean | void }) => (
    <div data-testid="mock-room-input" data-room-id={props.roomId}>
      <button
        type="button"
        data-testid="mock-send-message"
        onClick={() => props.onRoomMessageSent?.('$sent-root')}
      >
        Send
      </button>
      <button
        type="button"
        data-testid="mock-send-local-echo"
        onClick={() => props.onRoomMessageSent?.('~local-root')}
      >
        Send local echo
      </button>
    </div>
  ),
}));

vi.mock('../../threads/overview/ThreadCardBadges', () => ({
  ThreadCardBadges: (props: { threadId: string }) => {
    mocks.threadCardBadgesCalls.push(props.threadId);
    return null;
  },
}));

const ME = '@me:example.org';
const BLOCKED_USER = '@blocked:example.org';
const SPACE_ID = '!space:example.org';
const ROOM_ENG = '!eng:example.org';
const ROOM_DES = '!des:example.org';
const ROOM_OPS = '!ops:example.org';

type Listener = (...args: unknown[]) => void;

const createEmitter = () => {
  const map = new Map<string, Set<Listener>>();
  const remove = vi.fn((event: string, fn: Listener) => {
    map.get(event)?.delete(fn);
  });
  return {
    on: vi.fn((event: string, fn: Listener) => {
      const set = map.get(event) ?? new Set<Listener>();
      set.add(fn);
      map.set(event, set);
    }),
    off: remove,
    removeListener: remove,
    emit: (event: string, ...args: unknown[]) => {
      map.get(event)?.forEach((fn) => fn(...args));
    },
  };
};

type FakeMemberInput = {
  userId: string;
  membership: string;
  name: string;
  rawDisplayName?: string;
  avatarMxc?: string;
};

const toFakeMember = (member: FakeMemberInput) => ({
  ...member,
  rawDisplayName: member.rawDisplayName ?? member.name,
  getMxcAvatarUrl: () => member.avatarMxc ?? null,
});

type FakeRoom = Room & {
  emit: (event: string, ...args: unknown[]) => void;
  setName: (next: string) => void;
  setMembers: (next: FakeMemberInput[]) => void;
  setPinnedEventIds: (next: string[]) => void;
  setTimelineEvents: (next: unknown[]) => void;
  setReadReceipt: (next: { eventId: string; ts: number } | null) => void;
};

const makeRoom = (
  roomId: string,
  initialName: string,
  opts: {
    isSpace?: boolean;
    canSend?: boolean;
    hasAgent?: boolean;
    canonicalAlias?: string | null;
    threadMode?: RoomThreadMode;
    timelineEvents?: unknown[];
    pinnedEventIds?: string[];
    membersLoaded?: boolean;
    loadMembersIfNeeded?: () => Promise<boolean>;
    members?: FakeMemberInput[];
    avatarMxc?: string;
    joinRule?: string;
    directPartner?: { userId: string; avatarMxc?: string };
  } = {}
): FakeRoom => {
  const emitter = createEmitter();
  const canSend = opts.canSend ?? true;
  let name = initialName;
  let membersLoaded = opts.membersLoaded ?? true;
  let members = (
    opts.members ??
    (opts.hasAgent
      ? [{ userId: '@mindroom_code:example.org', membership: 'join', name: 'Code' }]
      : [{ userId: ME, membership: 'join', name: 'Me' }])
  ).map(toFakeMember);
  let pinnedEventIds = opts.pinnedEventIds ?? [];
  let timelineEvents = opts.timelineEvents ?? [];
  let readReceipt: { eventId: string; data: { ts: number } } | null = null;

  const powerEvent = {
    getContent: () => ({ users_default: 0, events_default: canSend ? 0 : 50 }),
  };
  const threadModeEvent = opts.threadMode
    ? { getContent: () => ({ mode: opts.threadMode }) }
    : null;
  const state = {
    getStateEvents: (type: string) => {
      if (type === 'm.room.power_levels') return powerEvent;
      if (type === (StateEvent.RoomCreate as string)) {
        return { getContent: () => (opts.isSpace ? { type: 'm.space' } : {}), getTs: () => 0 };
      }
      if (type === (StateEvent.RoomPinnedEvents as string)) {
        return { getContent: () => ({ pinned: pinnedEventIds }) };
      }
      return null;
    },
  };

  return {
    roomId,
    get name() {
      return name;
    },
    isSpaceRoom: () => opts.isSpace === true,
    getType: () => (opts.isSpace ? 'm.space' : undefined),
    getMyMembership: () => 'join',
    getCanonicalAlias: () => opts.canonicalAlias ?? null,
    getMxcAvatarUrl: () => opts.avatarMxc ?? null,
    getJoinRule: () => opts.joinRule ?? 'invite',
    getAvatarFallbackMember: () =>
      opts.directPartner
        ? {
            userId: opts.directPartner.userId,
            getMxcAvatarUrl: () => opts.directPartner?.avatarMxc ?? null,
          }
        : null,
    membersLoaded: () => membersLoaded,
    loadMembersIfNeeded: () =>
      (opts.loadMembersIfNeeded?.() ?? Promise.resolve(true)).then((loaded) => {
        membersLoaded = true;
        return loaded;
      }),
    getMembers: () => members,
    getMember: (userId: string) => members.find((member) => member.userId === userId) ?? null,
    getThread: () => undefined,
    findEventById: (eventId: string) =>
      (timelineEvents as Array<{ getId?: () => string }>).find((e) => e.getId?.() === eventId),
    getOldestThreadedReceiptTs: () => 0,
    getThreadUnreadNotificationCount: () => 0,
    getEventReadUpTo: () => null,
    getReadReceiptForUserId: (userId: string) => (userId === ME ? readReceipt : null),
    getUnfilteredTimelineSet: () => ({ findEventById: () => undefined }),
    currentState: {
      getStateEvents: (type?: string, stateKey?: string) => {
        if (type === ROOM_THREAD_MODE_EVENT && stateKey === '') return threadModeEvent;
        return stateKey === undefined ? [] : null;
      },
    },
    getLiveTimeline: () => ({
      getEvents: () => timelineEvents,
      getState: () => state,
    }),
    on: emitter.on,
    off: emitter.off,
    removeListener: emitter.removeListener,
    emit: emitter.emit,
    setName: (next: string) => {
      name = next;
    },
    setMembers: (next: FakeMemberInput[]) => {
      members = next.map(toFakeMember);
    },
    setPinnedEventIds: (next: string[]) => {
      pinnedEventIds = next;
    },
    setTimelineEvents: (next: unknown[]) => {
      timelineEvents = next;
    },
    setReadReceipt: (next: { eventId: string; ts: number } | null) => {
      readReceipt = next ? { eventId: next.eventId, data: { ts: next.ts } } : null;
    },
    client: {
      on: vi.fn(),
      removeListener: vi.fn(),
    },
  } as unknown as FakeRoom;
};

const makeEntry = (
  roomId: string,
  roomName: string,
  threadRootId: string,
  summaryText: string,
  lastActivityTs: number,
  rootSenderId = ME,
  replyCount = 1
): CrossRoomThreadIndexEntry =>
  makeSpaceThreadEntry({
    roomId,
    roomName,
    threadRootId,
    summaryText,
    rootPreviewText: `Root: ${summaryText}`,
    latestReplyPreviewText: `Reply: ${summaryText}`,
    lastSenderDisplayName: 'Me',
    lastActivityTs,
    rootSenderId,
    replyCount,
    isForUser: true,
    searchableText: normalizeThreadSearchText(summaryText),
  });

const makeIgnoredAccountDataEvent = (userIds: string[]) => ({
  getType: () => AccountDataEvent.IgnoredUserList,
  getContent: () => ({
    ignored_users: Object.fromEntries(userIds.map((id) => [id, {}])),
  }),
});

const renderSpaceThreads = ({
  rooms,
  entries,
  extraSpaces = [],
  parentOverrides,
  bootstrapped = true,
  threadListsSettled = true,
  ignoredUsers = [],
  screenSize = ScreenSize.Desktop,
  store = createStore(),
}: {
  rooms: FakeRoom[];
  entries: CrossRoomThreadIndexEntry[];
  extraSpaces?: FakeRoom[];
  parentOverrides?: ReadonlyMap<string, Set<string>>;
  bootstrapped?: boolean;
  threadListsSettled?: boolean;
  ignoredUsers?: string[];
  screenSize?: ScreenSize;
  store?: ReturnType<typeof createStore>;
}) => {
  mocks.threadListsSettled = threadListsSettled;
  const space = makeRoom(SPACE_ID, 'Product', { isSpace: true });
  const roomMap = new Map<string, FakeRoom>([
    [SPACE_ID, space],
    ...extraSpaces.map((r) => [r.roomId, r] as const),
    ...rooms.map((r) => [r.roomId, r] as const),
  ]);
  const clientEmitter = createEmitter();
  let ignoredEvent =
    ignoredUsers.length > 0 ? makeIgnoredAccountDataEvent(ignoredUsers) : undefined;
  const client = {
    getSafeUserId: () => ME,
    getUserId: () => ME,
    getHomeserverUrl: () => 'https://example.org',
    getUser: () => null,
    getRoom: (id: string) => roomMap.get(id) ?? null,
    getRooms: () => [...roomMap.values()],
    getAccountData: (type: string) =>
      type === (AccountDataEvent.IgnoredUserList as string) ? ignoredEvent : undefined,
    on: clientEmitter.on,
    off: clientEmitter.off,
    removeListener: clientEmitter.removeListener,
    mxcUrlToHttp: (mxc: string) =>
      mxc ? mxc.replace('mxc://', 'https://example.org/_matrix/media/v3/download/') : null,
  } as unknown as MatrixClient;

  store.set(allRoomsAtom, {
    type: 'INITIALIZE',
    rooms: [SPACE_ID, ...extraSpaces.map((r) => r.roomId), ...rooms.map((r) => r.roomId)],
  });
  store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
  const roomToParents = new Map<string, Set<string>>(
    rooms.map((r) => [r.roomId, new Set([SPACE_ID])] as const)
  );
  parentOverrides?.forEach((parents, id) => roomToParents.set(id, parents));
  store.set(roomToParentsAtom, { type: 'INITIALIZE', roomToParents });
  store.set(crossRoomThreadIndexAtom, {
    entries: new Map(entries.map((entry) => [entry.key, entry] as const)),
    eventIdToThreadRoots: new Map(),
    version: 1,
    bootstrapped,
  });

  const view = render(
    <Provider store={store}>
      <ScreenSizeProvider value={screenSize}>
        <MatrixClientProvider value={client}>
          <MemoryRouter initialEntries={[`/${encodeURIComponent(SPACE_ID)}/threads/`]}>
            <SpaceProvider value={space}>
              <SpaceThreadsPage />
            </SpaceProvider>
          </MemoryRouter>
        </MatrixClientProvider>
      </ScreenSizeProvider>
    </Provider>
  );
  const setIgnoredUsers = (nextUserIds: string[]) => {
    ignoredEvent = makeIgnoredAccountDataEvent(nextUserIds);
    clientEmitter.emit(ClientEvent.AccountData, ignoredEvent);
  };
  return { ...view, store, emitClient: clientEmitter.emit, setIgnoredUsers };
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.navigateRoom.mockReset();
  mocks.navigateRoomThread.mockReset();
  mocks.threadListsSettled = true;
  mocks.threadListCalls.length = 0;
  mocks.threadCardBadgesCalls.length = 0;
  clearCompactRoomSectionsStore(ME);
  clearRoomThreadFiltersStore(ME);
  localStorage.clear();
});

const openRoomsDropdown = (container: HTMLElement) => {
  if (!container.querySelector('[data-room-filter-panel]')) {
    fireEvent.click(container.querySelector('[data-room-filter-button]')!);
  }
};

const toggleRoomOption = (container: HTMLElement, roomId: string) => {
  openRoomsDropdown(container);
  const row = container.querySelector<HTMLElement>(`[data-room-option="${roomId}"]`)!;
  fireEvent.click(within(row).getByRole('checkbox'));
};

describe('SpaceThreadsPage', () => {
  it('filters via the Rooms dropdown (1 room, 2 rooms, search, Clear), updates badges and composer', () => {
    const rooms = [
      makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true }),
      makeRoom(ROOM_DES, 'Design', { hasAgent: true }),
      makeRoom(ROOM_OPS, 'Ops', { hasAgent: true }),
    ];
    const entries = [
      makeEntry(ROOM_ENG, 'Engineering', '$t-eng', 'Build failure', NOW),
      makeEntry(ROOM_DES, 'Design', '$t-des', 'New button spec', NOW - 1000),
      makeEntry(ROOM_OPS, 'Ops', '$t-ops', 'Cluster upgrade', NOW - 2000),
    ];

    const { container } = renderSpaceThreads({ rooms, entries });

    expect(mocks.threadListCalls.at(-1)).toEqual({
      allPages: true,
      roomIds: [ROOM_ENG, ROOM_DES, ROOM_OPS],
    });
    expect(screen.getByText('Build failure')).toBeTruthy();
    expect(screen.getByText('New button spec')).toBeTruthy();
    expect(screen.getByText('Cluster upgrade')).toBeTruthy();
    expect(container.querySelectorAll('[data-space-thread-room-badge]').length).toBe(3);
    expect(
      container.querySelector('[data-thread-root-id="$t-eng"]')?.getAttribute('aria-label')
    ).toContain('Engineering');
    expect(container.querySelector('[data-space-rooms-badge]')?.textContent).toBe('3 rooms');
    expect(container.querySelector('[data-room-filter-button]')?.textContent).toBe('Rooms');
    expect(screen.getByTestId('mock-room-input').getAttribute('data-room-id')).toBe(ROOM_ENG);

    // Open Rooms dropdown, test search, then downselect to Design (1 room).
    openRoomsDropdown(container);
    const search = container.querySelector<HTMLInputElement>('[data-room-filter-search]')!;
    fireEvent.change(search, { target: { value: 'des' } });
    expect(container.querySelectorAll('[data-room-option]').length).toBe(1);
    fireEvent.change(search, { target: { value: '' } });
    expect(container.querySelectorAll('[data-room-option]').length).toBe(3);

    toggleRoomOption(container, ROOM_DES);
    expect(screen.queryByText('Build failure')).toBeNull();
    expect(screen.getByText('New button spec')).toBeTruthy();
    expect(screen.queryByText('Cluster upgrade')).toBeNull();
    expect(container.querySelectorAll('[data-space-thread-room-badge]').length).toBe(0);
    expect(container.querySelector('[data-space-rooms-badge]')?.textContent).toBe('1 of 3 rooms');
    expect(container.querySelector('[data-room-filter-button]')?.textContent).toBe('Design');
    expect(screen.getByRole('button', { name: 'Rooms: Design' })).toBeTruthy();
    expect(
      container.querySelector('[data-room-filter-button]')?.getAttribute('data-room-filter-count')
    ).toBe('1');
    expect(screen.getByTestId('mock-room-input').getAttribute('data-room-id')).toBe(ROOM_DES);

    fireEvent.click(screen.getByTestId('mock-send-message'));
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith(ROOM_DES, '$sent-root');

    // Check a 2nd room: room badges reappear and trigger shows "Rooms 2".
    toggleRoomOption(container, ROOM_OPS);
    expect(screen.queryByText('Build failure')).toBeNull();
    expect(screen.getByText('New button spec')).toBeTruthy();
    expect(screen.getByText('Cluster upgrade')).toBeTruthy();
    expect(container.querySelectorAll('[data-space-thread-room-badge]').length).toBe(2);
    expect(container.querySelector('[data-space-rooms-badge]')?.textContent).toBe('2 of 3 rooms');
    expect(container.querySelector('[data-room-filter-button]')?.textContent).toBe('Rooms2');

    // Click Clear inside the dropdown: restores all 3 rooms and resets trigger to "Rooms".
    fireEvent.click(container.querySelector('[data-room-filter-clear]')!);
    expect(screen.getByText('Build failure')).toBeTruthy();
    expect(screen.getByText('New button spec')).toBeTruthy();
    expect(screen.getByText('Cluster upgrade')).toBeTruthy();
    expect(container.querySelectorAll('[data-space-thread-room-badge]').length).toBe(3);
    expect(container.querySelector('[data-space-rooms-badge]')?.textContent).toBe('3 rooms');
    expect(container.querySelector('[data-room-filter-button]')?.textContent).toBe('Rooms');

    fireEvent.click(container.querySelector('[data-thread-root-id="$t-eng"]')!);
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith(ROOM_ENG, '$t-eng');
  });

  it('navigates room-mode sends with confirmed IDs and omits local-echo IDs, while thread mode keeps local echoes', () => {
    const rooms = [
      makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true, threadMode: 'room' }),
      makeRoom(ROOM_DES, 'Design', { hasAgent: true, threadMode: 'thread' }),
    ];
    const { container } = renderSpaceThreads({ rooms, entries: [] });

    // Room mode with local-echo ~... ID opens the room without putting ~... in the URL.
    fireEvent.click(screen.getByTestId('mock-send-local-echo'));
    expect(mocks.navigateRoom).toHaveBeenCalledWith(ROOM_ENG);
    expect(mocks.navigateRoomThread).not.toHaveBeenCalled();

    // Room mode with confirmed $... ID passes eventId to navigateRoom.
    fireEvent.click(screen.getByTestId('mock-send-message'));
    expect(mocks.navigateRoom).toHaveBeenCalledWith(ROOM_ENG, '$sent-root');

    // Thread mode still preserves local-echo navigation via navigateRoomThread.
    fireEvent.click(container.querySelector(`[data-space-composer-target="${ROOM_DES}"]`)!);
    fireEvent.click(screen.getByTestId('mock-send-local-echo'));
    expect(mocks.navigateRoomThread).toHaveBeenCalledWith(ROOM_DES, '~local-root');
  });

  it('hides blocked/ignored users threads and updates live when ignored users change', () => {
    const rooms = [makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true })];
    const entries = [
      makeEntry(ROOM_ENG, 'Engineering', '$t-ok', 'Allowed thread', NOW, ME),
      makeEntry(ROOM_ENG, 'Engineering', '$t-blocked', 'Spam thread', NOW - 500, BLOCKED_USER),
    ];

    const { container, setIgnoredUsers } = renderSpaceThreads({
      rooms,
      entries,
      ignoredUsers: [BLOCKED_USER],
    });
    expect(screen.getByText('Allowed thread')).toBeTruthy();
    expect(screen.queryByText('Spam thread')).toBeNull();
    expect(container.querySelector('[data-room-filter-button]')).toBeNull();
    expect(container.querySelector('[data-thread-count="true"]')?.textContent).toContain('1');

    // Unblocking brings it back; blocking again removes it immediately.
    act(() => setIgnoredUsers([]));
    expect(screen.getByText('Spam thread')).toBeTruthy();
    act(() => setIgnoredUsers([BLOCKED_USER]));
    expect(screen.queryByText('Spam thread')).toBeNull();
  });

  it('holds the composer target room for text or staged uploads and shows Draft for #room', () => {
    const rooms = [
      makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true }),
      makeRoom(ROOM_DES, 'Design', { hasAgent: true }),
    ];
    const entries = [
      makeEntry(ROOM_ENG, 'Engineering', '$t-eng', 'Build failure', NOW),
      makeEntry(ROOM_DES, 'Design', '$t-des', 'New button spec', NOW - 1000),
    ];
    const store = createStore();
    store.set(roomIdToMsgDraftAtomFamily(getRoomInputDraftKey(ME, ROOM_ENG)), [
      { type: 'paragraph', children: [{ text: 'WIP deploy note' }] } as never,
    ]);

    const { container } = renderSpaceThreads({ rooms, entries, store });
    expect(screen.getByTestId('mock-room-input').getAttribute('data-room-id')).toBe(ROOM_ENG);

    toggleRoomOption(container, ROOM_DES);
    expect(screen.getByTestId('mock-room-input').getAttribute('data-room-id')).toBe(ROOM_ENG);
    const note = container.querySelector(`[data-space-composer-draft-pinned="${ROOM_ENG}"]`);
    expect(note?.textContent).toContain('Engineering');

    cleanup();
    clearRoomThreadFiltersStore(ME);
    const uploadStore = createStore();
    uploadStore.set(composerUploadItemsAtom(ROOM_ENG, undefined), {
      type: 'PUT',
      item: { file: {} as File, originalFile: { name: 'spec.png' } as File, metadata: {} } as never,
    });
    const { container: c2 } = renderSpaceThreads({ rooms, entries, store: uploadStore });
    toggleRoomOption(c2, ROOM_DES);
    expect(screen.getByTestId('mock-room-input').getAttribute('data-room-id')).toBe(ROOM_ENG);
  });

  it('reopens the composer room picker menu without throwing and lists only eligible rooms', () => {
    const sevenRooms = Array.from({ length: 7 }, (_, i) =>
      makeRoom(`!room${i}:example.org`, `Room ${i}`)
    );
    const { container } = renderSpaceThreads({ rooms: sevenRooms, entries: [] });
    expect(container.querySelector('[data-room-filter-button]')).toBeTruthy();

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-space-composer-picker="true"] button'
    )!;
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Room 3' }));
    expect(screen.getByTestId('mock-room-input').getAttribute('data-room-id')).toBe(
      '!room3:example.org'
    );

    // Filter to 5 rooms (Room 1..Room 5) so composer keeps its picker menu while excluding Room 0.
    for (const id of [
      '!room1:example.org',
      '!room2:example.org',
      '!room3:example.org',
      '!room4:example.org',
      '!room5:example.org',
    ]) {
      toggleRoomOption(container, id);
    }
    fireEvent.click(
      container.querySelector<HTMLButtonElement>('[data-space-composer-picker="true"] button')!
    );
    expect(screen.queryByRole('menuitemradio', { name: 'Room 0' })).toBeNull();
    expect(screen.getByRole('menuitemradio', { name: 'Room 1' })).toBeTruthy();
  });

  it('disables a hidden sort lock in Simple mode and clears freeze on explicit sort direction toggle', () => {
    const rooms = [makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true })];
    const entries = [
      makeEntry(ROOM_ENG, 'Engineering', '$first', 'First thread', NOW),
      makeEntry(ROOM_ENG, 'Engineering', '$second', 'Second thread', NOW - 5_000),
    ];
    const store = createStore();
    store.set(settingsAtom, { ...store.get(settingsAtom), simpleThreadFilters: false });
    const { container } = renderSpaceThreads({ rooms, entries, store });

    const cardOrder = () =>
      [...container.querySelectorAll('[data-thread-root-id]')].map((el) =>
        el.getAttribute('data-thread-root-id')
      );
    expect(cardOrder()).toEqual(['$first', '$second']);

    // Freeze sort order in Advanced mode.
    fireEvent.click(container.querySelector('[data-thread-sort-freeze="true"]')!);

    // Explicit sort-direction toggle while frozen immediately reverses order and clears freeze.
    fireEvent.click(container.querySelector('[data-sort-direction]')!);
    expect(cardOrder()).toEqual(['$second', '$first']);
    expect(
      container.querySelector('[data-thread-sort-freeze="true"]')?.getAttribute('aria-pressed')
    ).toBe('false');

    // Toggle back to newest-first, re-freeze, then make $second newer.
    fireEvent.click(container.querySelector('[data-sort-direction]')!);
    expect(cardOrder()).toEqual(['$first', '$second']);
    fireEvent.click(container.querySelector('[data-thread-sort-freeze="true"]')!);

    act(() => {
      store.set(crossRoomThreadIndexAtom, {
        entries: new Map([
          [
            getCrossRoomThreadIndexKey(ROOM_ENG, '$first'),
            makeEntry(ROOM_ENG, 'Engineering', '$first', 'First thread', NOW),
          ],
          [
            getCrossRoomThreadIndexKey(ROOM_ENG, '$second'),
            makeEntry(ROOM_ENG, 'Engineering', '$second', 'Second thread', NOW + 10_000),
          ],
        ]),
        eventIdToThreadRoots: new Map(),
        version: 2,
        bootstrapped: true,
      });
    });
    expect(cardOrder()).toEqual(['$first', '$second']);

    // Switching into Simple mode disables the hidden sort lock so live order applies immediately.
    act(() => {
      store.set(settingsAtom, { ...store.get(settingsAtom), simpleThreadFilters: true });
    });
    expect(cardOrder()).toEqual(['$second', '$first']);
  });

  it('refreshes decrypted and edited standalone roots (debounced) while ignoring streaming edits', () => {
    vi.useFakeTimers();
    let decrypted = false;
    let body = 'Decrypted standalone root';
    const standaloneEvent = {
      getId: () => '$enc-root',
      getRoomId: () => ROOM_ENG,
      getType: () => (decrypted ? 'm.room.message' : 'm.room.encrypted'),
      getContent: () => (decrypted ? { msgtype: 'm.text', body } : {}),
      getSender: () => ME,
      getTs: () => NOW,
      getRelation: () => undefined,
      getUnsigned: () => ({}),
      replacingEvent: () => null,
      isRedacted: () => false,
    };
    const eng = makeRoom(ROOM_ENG, 'Engineering', {
      hasAgent: true,
      timelineEvents: [standaloneEvent],
    });
    const { emitClient } = renderSpaceThreads({ rooms: [eng], entries: [] });
    expect(screen.queryByText('Decrypted standalone root')).toBeNull();

    // Streaming m.replace edits do not trigger a fallback rescan.
    decrypted = true;
    const streamingEdit = {
      getId: () => '$stream-edit-1',
      getRoomId: () => ROOM_ENG,
      getContent: () => ({
        msgtype: 'm.text',
        body: '* streaming',
        'm.new_content': {
          msgtype: 'm.text',
          body: 'streaming',
          'io.mindroom.stream_status': 'streaming',
        },
      }),
      getRelation: () => ({ rel_type: RelationType.Replace, event_id: '$enc-root' }),
    };
    act(() => {
      eng.emit(RoomEvent.Timeline, streamingEdit);
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText('Decrypted standalone root')).toBeNull();

    // Decryption of the standalone root schedules a debounced rescan and reveals its decrypted body.
    act(() => {
      emitClient(MatrixEventEvent.Decrypted, standaloneEvent);
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByText('Decrypted standalone root')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText('Decrypted standalone root')).toBeTruthy();

    // A non-streaming m.replace edit targeting the standalone zero-reply root updates the card text.
    body = 'Edited standalone root';
    const userEdit = {
      getId: () => '$user-edit-1',
      getRoomId: () => ROOM_ENG,
      getContent: () => ({
        msgtype: 'm.text',
        body: '* Edited standalone root',
        'm.new_content': { msgtype: 'm.text', body: 'Edited standalone root' },
      }),
      getRelation: () => ({ rel_type: RelationType.Replace, event_id: '$enc-root' }),
    };
    act(() => {
      eng.emit(RoomEvent.Timeline, userEdit);
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText('Edited standalone root')).toBeTruthy();
  });

  it('refreshes unread standalone roots on main-timeline and unthreaded read receipts while ignoring other users and threaded receipts', () => {
    vi.useFakeTimers();
    const makeStandalone = (id: string, body: string, ts: number) => ({
      getId: () => id,
      getRoomId: () => ROOM_ENG,
      getType: () => 'm.room.message',
      getContent: () => ({ msgtype: 'm.text', body }),
      getSender: () => '@bob:example.org',
      getTs: () => ts,
      getRelation: () => undefined,
      getUnsigned: () => ({}),
      replacingEvent: () => null,
      isRedacted: () => false,
    });
    const eng = makeRoom(ROOM_ENG, 'Engineering', {
      hasAgent: true,
      timelineEvents: [
        makeStandalone('$unread-root', 'Unread standalone root', NOW),
        makeStandalone('$unread-root-2', 'Second unread standalone root', NOW + 1000),
      ],
    });
    const { container } = renderSpaceThreads({ rooms: [eng], entries: [] });
    const cardOf = (id: string) => container.querySelector(`[data-thread-root-id="${id}"]`);
    expect(cardOf('$unread-root')?.getAttribute('data-thread-unread')).toBe('true');
    expect(cardOf('$unread-root-2')?.getAttribute('data-thread-unread')).toBe('true');

    // Update underlying room receipt first so only events that schedule a rescan refresh the card.
    eng.setReadReceipt({ eventId: '$unread-root', ts: NOW });

    // Another user's receipt does not trigger a rescan.
    act(() => {
      eng.emit(RoomEvent.Receipt, {
        getContent: () => ({
          '$unread-root': { 'm.read': { '@bob:example.org': { ts: NOW } } },
        }),
      });
      vi.advanceTimersByTime(200);
    });
    expect(cardOf('$unread-root')?.getAttribute('data-thread-unread')).toBe('true');

    // Current user's threaded receipt does not trigger a rescan.
    act(() => {
      eng.emit(RoomEvent.Receipt, {
        getContent: () => ({
          '$reply-1': { 'm.read': { [ME]: { ts: NOW, thread_id: '$other-thread' } } },
        }),
      });
      vi.advanceTimersByTime(200);
    });
    expect(cardOf('$unread-root')?.getAttribute('data-thread-unread')).toBe('true');

    // Current user's unthreaded receipt schedules a debounced rescan and clears the unread state.
    act(() => {
      eng.emit(RoomEvent.Receipt, {
        getContent: () => ({
          '$unread-root': { 'm.read': { [ME]: { ts: NOW } } },
        }),
      });
      vi.advanceTimersByTime(100);
    });
    expect(cardOf('$unread-root')?.getAttribute('data-thread-unread')).toBe('true');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(cardOf('$unread-root')?.getAttribute('data-thread-unread')).toBeNull();
    expect(cardOf('$unread-root-2')?.getAttribute('data-thread-unread')).toBe('true');

    // Current user's MAIN_ROOM_TIMELINE receipt also schedules a rescan and clears remaining unread.
    eng.setReadReceipt({ eventId: '$unread-root-2', ts: NOW + 1000 });
    act(() => {
      eng.emit(RoomEvent.Receipt, {
        getContent: () => ({
          '$unread-root-2': {
            'm.read': { [ME]: { ts: NOW + 1000, thread_id: MAIN_ROOM_TIMELINE } },
          },
        }),
      });
      vi.advanceTimersByTime(200);
    });
    expect(cardOf('$unread-root-2')?.getAttribute('data-thread-unread')).toBeNull();
  });

  it('prunes room selection when a room leaves, hides archived rooms, and updates on renames/members', () => {
    const eng = makeRoom(ROOM_ENG, 'Engineering');
    const des = makeRoom(ROOM_DES, 'Design');
    const ops = makeRoom(ROOM_OPS, 'Ops');
    const entries = [
      makeEntry(ROOM_ENG, 'Engineering', '$t-eng', 'Build failure', NOW),
      makeEntry(ROOM_DES, 'Design', '$t-des', 'New button spec', NOW - 1000),
    ];
    const store = createStore();
    const { container } = renderSpaceThreads({ rooms: [eng, des, ops], entries, store });

    act(() => {
      store.set(archivedRoomsAtom, new Set([ROOM_OPS]));
    });
    openRoomsDropdown(container);
    expect(container.querySelector(`[data-room-option="${ROOM_OPS}"]`)).toBeNull();
    expect(container.querySelector('[data-space-rooms-badge]')?.textContent).toBe('2 rooms');

    toggleRoomOption(container, ROOM_DES);
    expect(screen.queryByText('Build failure')).toBeNull();
    act(() => {
      store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [SPACE_ID, ROOM_ENG] });
    });
    expect(screen.getByText('Build failure')).toBeTruthy();
    expect(container.querySelector('[data-space-rooms-badge]')?.textContent).toBe('1 room');
    expect(container.querySelector('[data-room-filter-button]')).toBeNull();

    const timelineOnCountBefore = (eng.on as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([eventName]) => eventName === RoomEvent.Timeline
    ).length;
    expect(container.querySelector('[data-thread-count="true"]')).toBeNull();
    act(() => {
      eng.setName('Platform');
      eng.emit(RoomEvent.Name);
      eng.setMembers([{ userId: '@mindroom_code:example.org', membership: 'join', name: 'Code' }]);
      eng.emit(RoomStateEvent.Members);
    });
    expect(
      container.querySelector(`[data-space-composer-target="${ROOM_ENG}"]`)?.textContent
    ).toContain('Platform');
    expect(container.querySelector('[data-thread-count="true"]')).toBeTruthy();
    const timelineOnCountAfter = (eng.on as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([eventName]) => eventName === RoomEvent.Timeline
    ).length;
    expect(timelineOnCountAfter).toBe(timelineOnCountBefore);
  });

  it('shows empty states for filtered-out threads, loading while unsettled, and read-only spaces', () => {
    const eng = makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true });
    const des = makeRoom(ROOM_DES, 'Design', { hasAgent: true });
    const entries = [makeEntry(ROOM_ENG, 'Engineering', '$t-eng', 'Build failure', NOW)];

    const { container } = renderSpaceThreads({ rooms: [eng, des], entries });
    toggleRoomOption(container, ROOM_DES);
    expect(container.querySelector('[data-space-threads-empty="no-matching"]')).toBeTruthy();

    // Unsettled thread lists keep loading visible instead of flashing "No threads in this space yet."
    cleanup();
    clearRoomThreadFiltersStore(ME);
    const { container: cUnsettled } = renderSpaceThreads({
      rooms: [eng],
      entries: [],
      bootstrapped: true,
      threadListsSettled: false,
    });
    expect(cUnsettled.querySelector('[data-space-threads-loading="true"]')).toBeTruthy();
    expect(cUnsettled.querySelector('[data-space-threads-empty]')).toBeNull();

    cleanup();
    const { container: cLoading } = renderSpaceThreads({
      rooms: [eng],
      entries: [],
      bootstrapped: false,
    });
    expect(cLoading.querySelector('[data-space-threads-loading="true"]')).toBeTruthy();

    cleanup();
    const readOnlyRooms = [makeRoom(ROOM_ENG, 'Read only', { canSend: false })];
    renderSpaceThreads({ rooms: readOnlyRooms, entries: [] });
    expect(screen.queryByTestId('mock-room-input')).toBeNull();
    expect(screen.getByText('No rooms in this space allow posting.')).toBeTruthy();
  });

  it('keeps loading visible when downselecting to an empty room while thread lists are still settling', () => {
    const eng = makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true });
    const des = makeRoom(ROOM_DES, 'Design', { hasAgent: true });
    const entries = [makeEntry(ROOM_ENG, 'Engineering', '$t-eng', 'Build failure', NOW)];

    const { container } = renderSpaceThreads({
      rooms: [eng, des],
      entries,
      bootstrapped: true,
      threadListsSettled: false,
    });
    expect(screen.getByText('Build failure')).toBeTruthy();
    expect(container.querySelector('[data-space-threads-loading="true"]')).toBeNull();

    // Selecting Design (0 entries yet) while lists are unsettled shows loading, not empty-match.
    toggleRoomOption(container, ROOM_DES);
    expect(container.querySelector('[data-space-threads-loading="true"]')).toBeTruthy();
    expect(container.querySelector('[data-space-threads-empty]')).toBeNull();
  });

  it('renders local-echo root cards and room badges without passing unconfirmed IDs to ThreadCardBadges', () => {
    const eng = makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true });
    const des = makeRoom(ROOM_DES, 'Design', { hasAgent: true });
    const entries = [
      makeEntry(ROOM_ENG, 'Engineering', '~local-root', 'Unsent local root', NOW),
      makeEntry(ROOM_DES, 'Design', '$confirmed-root', 'Confirmed thread', NOW - 1000),
    ];

    const { container } = renderSpaceThreads({ rooms: [eng, des], entries });
    expect(screen.getByText('Unsent local root')).toBeTruthy();
    expect(screen.getByText('Confirmed thread')).toBeTruthy();
    expect(container.querySelectorAll('[data-space-thread-room-badge]').length).toBe(2);
    expect(mocks.threadCardBadgesCalls).toContain('$confirmed-root');
    expect(mocks.threadCardBadgesCalls).not.toContain('~local-root');
  });

  it('folds inactive read Needs you threads into a collapsible Quiet section when Sections are enabled', () => {
    const now = Date.now();
    const eng = makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true });
    const entries = [
      makeEntry(ROOM_ENG, 'Engineering', '$fresh', 'Fresh thread', now - 10_000, ME, 0),
      makeEntry(
        ROOM_ENG,
        'Engineering',
        '$stale',
        'Quiet thread',
        now - QUIET_AFTER_MS - 60_000,
        ME,
        0
      ),
    ];
    const store = createStore();
    store.set(getCompactRoomSectionsAtom(ME), { type: 'SET_ON', on: true });

    const { container } = renderSpaceThreads({ rooms: [eng], entries, store });
    expect(container.querySelector('[data-compact-section="needsYou"]')).toBeTruthy();
    const quietSection = container.querySelector('[data-compact-section="quiet"]');
    expect(quietSection).toBeTruthy();
    expect(screen.getByText('Fresh thread')).toBeTruthy();
    // Quiet starts collapsed by default.
    expect(screen.queryByText('Quiet thread')).toBeNull();

    fireEvent.click(within(quietSection as HTMLElement).getByRole('button'));
    expect(screen.getByText('Quiet thread')).toBeTruthy();
  });

  it('keeps pinned >5-day-old unresolved threads in needsYou and updates live when room pins change', () => {
    const now = Date.now();
    const staleTs = now - QUIET_AFTER_MS - 60_000;
    const eng = makeRoom(ROOM_ENG, 'Engineering', {
      hasAgent: true,
      pinnedEventIds: ['$pinned-stale'],
    });
    const des = makeRoom(ROOM_DES, 'Design', { hasAgent: true });
    const entries = [
      makeEntry(ROOM_ENG, 'Engineering', '$pinned-stale', 'Pinned stale thread', staleTs, ME, 0),
      makeEntry(ROOM_DES, 'Design', '$quiet-stale', 'Unpinned stale thread', staleTs, ME, 0),
    ];
    const store = createStore();
    store.set(getCompactRoomSectionsAtom(ME), { type: 'SET_ON', on: true });

    const { container } = renderSpaceThreads({ rooms: [eng, des], entries, store });
    expect(container.querySelector('[data-compact-section="needsYou"]')).toBeTruthy();
    expect(container.querySelector('[data-compact-section="quiet"]')).toBeTruthy();
    expect(screen.getByText('Pinned stale thread')).toBeTruthy();
    expect(screen.queryByText('Unpinned stale thread')).toBeNull();

    act(() => {
      eng.setPinnedEventIds([]);
      eng.emit(RoomStateEvent.Events, {
        getType: () => StateEvent.RoomPinnedEvents,
        getStateKey: () => '',
      });
    });
    expect(container.querySelector('[data-compact-section="needsYou"]')).toBeNull();
    expect(screen.queryByText('Pinned stale thread')).toBeNull();

    act(() => {
      des.setPinnedEventIds(['$quiet-stale']);
      des.emit(RoomStateEvent.Events, {
        getType: () => StateEvent.RoomPinnedEvents,
        getStateKey: () => '',
      });
    });
    expect(container.querySelector('[data-compact-section="needsYou"]')).toBeTruthy();
    expect(screen.getByText('Unpinned stale thread')).toBeTruthy();
  });

  it('updates memoized card sender display name when child room members load or change without changing entry', async () => {
    const bobId = '@bob:example.org';
    let resolveLoadMembers!: (loaded: boolean) => void;
    const loadMembersPromise = new Promise<boolean>((resolve) => {
      resolveLoadMembers = resolve;
    });
    const eng = makeRoom(ROOM_ENG, 'Engineering', {
      hasAgent: true,
      membersLoaded: false,
      loadMembersIfNeeded: () => loadMembersPromise,
    });
    const entry = makeSpaceThreadEntry({
      roomId: ROOM_ENG,
      roomName: 'Engineering',
      threadRootId: '$member-update',
      summaryText: 'Deploy status',
      rootPreviewText: 'Root: Deploy status',
      latestReplyPreviewText: 'Checking in',
      rootSenderId: bobId,
      participantIds: [bobId],
      lastActivityTs: NOW,
      isForUser: true,
    });

    const { store } = renderSpaceThreads({ rooms: [eng], entries: [entry] });
    expect(screen.getByText('bob: Checking in')).toBeTruthy();

    await act(async () => {
      eng.setMembers([
        { userId: '@mindroom_code:example.org', membership: 'join', name: 'Code' },
        { userId: bobId, membership: 'join', name: 'Bob Builder' },
      ]);
      resolveLoadMembers(true);
      await loadMembersPromise;
    });
    expect(screen.getByText('Bob Builder: Checking in')).toBeTruthy();
    expect(store.get(crossRoomThreadIndexAtom).entries.get(entry.key)).toBe(entry);

    act(() => {
      eng.setMembers([
        { userId: '@mindroom_code:example.org', membership: 'join', name: 'Code' },
        { userId: bobId, membership: 'join', name: 'Robert Builder' },
      ]);
      eng.emit(RoomStateEvent.Members);
    });
    expect(screen.getByText('Robert Builder: Checking in')).toBeTruthy();
    expect(store.get(crossRoomThreadIndexAtom).entries.get(entry.key)).toBe(entry);
  });

  it('steps back on mobile when opened from the room-ID lobby path for a space with a canonical alias', () => {
    const alias = '#product:example.org';
    const space = makeRoom(SPACE_ID, 'Product', { isSpace: true, canonicalAlias: alias });
    const eng = makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true });
    const roomMap = new Map<string, FakeRoom>([
      [SPACE_ID, space],
      [ROOM_ENG, eng],
    ]);
    const clientEmitter = createEmitter();
    const client = {
      getSafeUserId: () => ME,
      getUserId: () => ME,
      getRoom: (id: string) => roomMap.get(id) ?? null,
      getRooms: () => [...roomMap.values()],
      getAccountData: () => undefined,
      on: clientEmitter.on,
      off: clientEmitter.off,
      removeListener: clientEmitter.removeListener,
      mxcUrlToHttp: () => null,
    } as unknown as MatrixClient;

    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [SPACE_ID, ROOM_ENG] });
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([[ROOM_ENG, new Set([SPACE_ID])]]),
    });
    store.set(crossRoomThreadIndexAtom, {
      entries: new Map(),
      eventIdToThreadRoots: new Map(),
      version: 1,
      bootstrapped: true,
    });

    const roomIdLobbyPath = `/${encodeURIComponent(SPACE_ID)}/lobby`;
    const aliasThreadsPath = `/${encodeURIComponent(alias)}/threads`;

    function Harness() {
      useHistoryStackRecorder('phone-back-test');
      const location = useLocation();
      const navigate = useNavigate();
      return (
        <>
          <div data-testid="current-pathname">{location.pathname}</div>
          <Routes>
            <Route
              path="/:spaceIdOrAlias/lobby"
              element={
                <button type="button" onClick={() => void navigate(aliasThreadsPath)}>
                  Open threads
                </button>
              }
            />
            <Route path="/:spaceIdOrAlias/threads" element={<SpaceThreadsPage />} />
            <Route path="/:spaceIdOrAlias/*" element={<div data-testid="fallback-space" />} />
          </Routes>
        </>
      );
    }

    render(
      <Provider store={store}>
        <ScreenSizeProvider value={ScreenSize.Mobile}>
          <MatrixClientProvider value={client}>
            <MemoryRouter initialEntries={[roomIdLobbyPath]}>
              <SpaceProvider value={space}>
                <Harness />
              </SpaceProvider>
            </MemoryRouter>
          </MatrixClientProvider>
        </ScreenSizeProvider>
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open threads' }));
    expect(screen.getByTestId('current-pathname').textContent).toBe(aliasThreadsPath);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('current-pathname').textContent).toBe(roomIdLobbyPath);
  });

  it('renders room avatar images, DM partner avatars/initials, and RoomIcon fallbacks in the Rooms dropdown', () => {
    const eng = makeRoom(ROOM_ENG, 'Engineering', { avatarMxc: 'mxc://example.org/eng-avatar' });
    const des = makeRoom(ROOM_DES, 'Design', { joinRule: 'public' });
    const { container } = renderSpaceThreads({ rooms: [eng, des], entries: [] });
    openRoomsDropdown(container);

    const engRow = container.querySelector<HTMLElement>(`[data-room-option="${ROOM_ENG}"]`)!;
    expect(engRow.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.org/_matrix/media/v3/download/example.org/eng-avatar'
    );
    const desRow = container.querySelector<HTMLElement>(`[data-room-option="${ROOM_DES}"]`)!;
    expect(desRow.querySelector('img')).toBeNull();
    expect(desRow.querySelector(`[data-avatar-fallback-id="${ROOM_DES}"] svg`)).toBeTruthy();

    cleanup();
    const dmWithAvatarId = '!dm-avatar:example.org';
    const dmInitialsId = '!dm-initials:example.org';
    const dmRooms = [
      {
        room: makeRoom(dmWithAvatarId, 'Alice', {
          directPartner: { userId: '@alice:example.org', avatarMxc: 'mxc://example.org/alice' },
        }),
        name: 'Alice',
        accentColor: '#4f8ff7',
      },
      {
        room: makeRoom(dmInitialsId, 'Bob Builder', {
          directPartner: { userId: '@bob:example.org' },
        }),
        name: 'Bob Builder',
        accentColor: '#2aa89b',
      },
    ];
    const store = createStore();
    store.set(mDirectAtom, {
      type: 'INITIALIZE',
      rooms: new Set([dmWithAvatarId, dmInitialsId]),
    });
    const dmClient = {
      getHomeserverUrl: () => 'https://example.org',
      mxcUrlToHttp: (mxc: string) =>
        mxc ? mxc.replace('mxc://', 'https://example.org/_matrix/media/v3/download/') : null,
    } as unknown as MatrixClient;
    const { container: dmContainer } = render(
      <Provider store={store}>
        <MatrixClientProvider value={dmClient}>
          <SpaceRoomFilter
            rooms={dmRooms}
            roomCounts={new Map()}
            selectedRoomIds={undefined}
            onToggleRoom={vi.fn()}
            onSelectAll={vi.fn()}
          />
        </MatrixClientProvider>
      </Provider>
    );
    openRoomsDropdown(dmContainer);

    const dmAvatarRow = dmContainer.querySelector<HTMLElement>(
      `[data-room-option="${dmWithAvatarId}"]`
    )!;
    expect(dmAvatarRow.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.org/_matrix/media/v3/download/example.org/alice'
    );
    const dmInitRow = dmContainer.querySelector<HTMLElement>(
      `[data-room-option="${dmInitialsId}"]`
    )!;
    expect(dmInitRow.querySelector('img')).toBeNull();
    expect(
      dmInitRow.querySelector('[data-avatar-fallback-id="@bob:example.org"]')?.textContent
    ).toBe('B');
  });

  it('shows the People dropdown in advanced mode, scopes counts to selected rooms, filters/clears, and hides in simple mode', () => {
    const alice = '@alice:example.org';
    const bob = '@bob:example.org';
    const agent = { userId: '@mindroom_code:example.org', membership: 'join', name: 'Code' };
    const rooms = [
      makeRoom(ROOM_ENG, 'Engineering', {
        members: [
          agent,
          {
            userId: alice,
            membership: 'join',
            name: 'Alice',
            avatarMxc: 'mxc://example.org/alice',
          },
        ],
      }),
      makeRoom(ROOM_DES, 'Design', {
        members: [agent, { userId: bob, membership: 'join', name: 'Bob' }],
      }),
    ];
    const entries = [
      makeEntry(ROOM_ENG, 'Engineering', '$t-a1', 'API migration', NOW, alice),
      makeEntry(ROOM_ENG, 'Engineering', '$t-a2', 'Cache tuning', NOW - 1000, alice),
      makeEntry(ROOM_DES, 'Design', '$t-b1', 'Color tokens', NOW - 2000, bob),
    ];

    const { container } = renderSpaceThreads({ rooms, entries });
    expect(container.querySelector('[data-people-filter-button]')).toBeNull();

    fireEvent.click(container.querySelector('[data-thread-filter-mode-switch="true"]')!);
    fireEvent.click(container.querySelector('[data-people-filter-button]')!);

    const aliceRow = container.querySelector<HTMLElement>(`[data-person-option="${alice}"]`)!;
    const bobRow = container.querySelector<HTMLElement>(`[data-person-option="${bob}"]`)!;
    expect(aliceRow.textContent).toContain('Alice');
    expect(aliceRow.textContent).toContain('2');
    expect(aliceRow.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.org/_matrix/media/v3/download/example.org/alice'
    );
    expect(bobRow.textContent).toContain('Bob');
    expect(bobRow.textContent).toContain('1');

    fireEvent.click(within(bobRow).getByRole('checkbox'));
    expect(screen.getByText('Color tokens')).toBeTruthy();
    expect(screen.queryByText('API migration')).toBeNull();
    expect(screen.queryByText('Cache tuning')).toBeNull();

    fireEvent.click(container.querySelector('[data-people-filter-clear]')!);
    expect(screen.getByText('API migration')).toBeTruthy();
    expect(screen.getByText('Color tokens')).toBeTruthy();

    // Selecting a room prefers that room's display name for shared participants.
    rooms[1]!.setMembers([
      agent,
      { userId: bob, membership: 'join', name: 'Bob' },
      { userId: alice, membership: 'join', name: 'Alice Design' },
    ]);
    act(() => rooms[1]!.emit(RoomStateEvent.Members));
    fireEvent.click(
      within(container.querySelector<HTMLElement>(`[data-person-option="${alice}"]`)!).getByRole(
        'checkbox'
      )
    );
    fireEvent.click(container.querySelector('[data-people-filter-button]')!);
    toggleRoomOption(container, ROOM_DES);
    fireEvent.click(container.querySelector('[data-people-filter-button]')!);
    expect(container.querySelector(`[data-person-option="${alice}"]`)?.textContent).toContain(
      'Alice Design'
    );
    fireEvent.click(container.querySelector('[data-people-filter-clear]')!);
    fireEvent.click(container.querySelector('[data-people-filter-button]')!);

    // Scoping to Engineering limits People options to Engineering's participants.
    toggleRoomOption(container, ROOM_DES);
    toggleRoomOption(container, ROOM_ENG);
    fireEvent.click(container.querySelector('[data-people-filter-button]')!);
    expect(container.querySelector(`[data-person-option="${alice}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-person-option="${bob}"]`)).toBeNull();

    // Returning to simple mode hides People again.
    fireEvent.click(container.querySelector('[data-thread-filter-mode-switch="true"]')!);
    expect(container.querySelector('[data-people-filter-button]')).toBeNull();
  });

  it('persists selected rooms and people across remounts, survives a transient empty room list, and clears on Reset', () => {
    const alice = '@alice:example.org';
    const bob = '@bob:example.org';
    const agent = { userId: '@mindroom_code:example.org', membership: 'join', name: 'Code' };
    const makeFixtureRooms = () => [
      makeRoom(ROOM_ENG, 'Engineering', {
        members: [agent, { userId: alice, membership: 'join', name: 'Alice' }],
      }),
      makeRoom(ROOM_DES, 'Design', {
        members: [agent, { userId: bob, membership: 'join', name: 'Bob' }],
      }),
      makeRoom(ROOM_OPS, 'Ops', {
        members: [agent, { userId: alice, membership: 'join', name: 'Alice' }],
      }),
    ];
    const entries = [
      makeEntry(ROOM_ENG, 'Engineering', '$t-eng', 'API migration', NOW, alice),
      makeEntry(ROOM_DES, 'Design', '$t-des', 'Color tokens', NOW - 1000, bob),
      makeEntry(ROOM_OPS, 'Ops', '$t-ops', 'Deploy script', NOW - 2000, alice),
    ];
    const advancedStore = () => {
      const store = createStore();
      store.set(settingsAtom, { ...store.get(settingsAtom), simpleThreadFilters: false });
      return store;
    };

    const first = renderSpaceThreads({
      rooms: makeFixtureRooms(),
      entries,
      store: advancedStore(),
    });
    toggleRoomOption(first.container, ROOM_ENG);
    toggleRoomOption(first.container, ROOM_DES);
    fireEvent.click(first.container.querySelector('[data-people-filter-button]')!);
    fireEvent.click(
      within(
        first.container.querySelector<HTMLElement>(`[data-person-option="${alice}"]`)!
      ).getByRole('checkbox')
    );
    expect(screen.getByText('API migration')).toBeTruthy();
    expect(screen.queryByText('Color tokens')).toBeNull();
    expect(screen.queryByText('Deploy script')).toBeNull();

    // Unmount and transiently remount with an empty room list before hydration.
    cleanup();
    const transient = renderSpaceThreads({ rooms: [], entries: [], store: advancedStore() });
    expect(transient.container.querySelector('[data-space-threads-empty="no-rooms"]')).toBeTruthy();
    cleanup();

    // Remounting with rooms hydrated restores both the 2 selected rooms and selected person.
    const restored = renderSpaceThreads({
      rooms: makeFixtureRooms(),
      entries,
      store: advancedStore(),
    });
    expect(
      restored.container
        .querySelector('[data-room-filter-button]')
        ?.getAttribute('data-room-filter-count')
    ).toBe('2');
    expect(
      restored.container
        .querySelector('[data-people-filter-button]')
        ?.getAttribute('data-people-filter-count')
    ).toBe('1');
    expect(screen.getByText('API migration')).toBeTruthy();
    expect(screen.queryByText('Color tokens')).toBeNull();
    expect(screen.queryByText('Deploy script')).toBeNull();

    // Uncheck Engineering (leaving Design + Alice -> 0 matching threads) and click Reset.
    toggleRoomOption(restored.container, ROOM_ENG);
    fireEvent.click(screen.getByRole('button', { name: 'Reset all thread filters' }));
    expect(screen.getByText('API migration')).toBeTruthy();
    expect(screen.getByText('Color tokens')).toBeTruthy();
    expect(screen.getByText('Deploy script')).toBeTruthy();
    expect(
      restored.container
        .querySelector('[data-room-filter-button]')
        ?.getAttribute('data-room-filter-count')
    ).toBe('0');
    expect(
      restored.container
        .querySelector('[data-people-filter-button]')
        ?.getAttribute('data-people-filter-count')
    ).toBe('0');

    // Confirm Reset persisted across another remount.
    cleanup();
    const afterReset = renderSpaceThreads({
      rooms: makeFixtureRooms(),
      entries,
      store: advancedStore(),
    });
    expect(
      afterReset.container
        .querySelector('[data-room-filter-button]')
        ?.getAttribute('data-room-filter-count')
    ).toBe('0');
    expect(screen.getByText('Deploy script')).toBeTruthy();
  });

  it('shows the header space switcher for multiple spaces/subspaces, indents subspaces, and navigates', () => {
    const subId = '!sub-platform:example.org';
    const otherSpaceId = '!space-design:example.org';
    const eng = makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true });

    // Single space hides the switcher button.
    const single = renderSpaceThreads({ rooms: [eng], entries: [] });
    expect(single.container.querySelector('[data-space-switcher-button]')).toBeNull();
    cleanup();

    const space = makeRoom(SPACE_ID, 'Product', { isSpace: true });
    const subSpace = makeRoom(subId, 'Platform', { isSpace: true });
    const otherSpace = makeRoom(otherSpaceId, 'Design Studio', { isSpace: true });
    const roomMap = new Map<string, FakeRoom>([
      [SPACE_ID, space],
      [subId, subSpace],
      [otherSpaceId, otherSpace],
      [ROOM_ENG, eng],
    ]);
    const emitter = createEmitter();
    const client = {
      getSafeUserId: () => ME,
      getUserId: () => ME,
      getHomeserverUrl: () => 'https://example.org',
      getUser: () => null,
      getRoom: (id: string) => roomMap.get(id) ?? null,
      getRooms: () => [...roomMap.values()],
      getAccountData: () => undefined,
      on: emitter.on,
      off: emitter.off,
      removeListener: emitter.removeListener,
      mxcUrlToHttp: () => null,
    } as unknown as MatrixClient;
    const store = createStore();
    store.set(allRoomsAtom, {
      type: 'INITIALIZE',
      rooms: [SPACE_ID, subId, otherSpaceId, ROOM_ENG],
    });
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([
        [subId, new Set([SPACE_ID])],
        [ROOM_ENG, new Set([SPACE_ID])],
      ]),
    });
    store.set(crossRoomThreadIndexAtom, {
      entries: new Map(),
      eventIdToThreadRoots: new Map(),
      version: 1,
      bootstrapped: true,
    });

    function SwitcherHarness() {
      const location = useLocation();
      return (
        <>
          <div data-testid="switcher-path">{location.pathname}</div>
          <SpaceThreadsPage />
        </>
      );
    }

    const { container } = render(
      <Provider store={store}>
        <ScreenSizeProvider value={ScreenSize.Desktop}>
          <MatrixClientProvider value={client}>
            <MemoryRouter initialEntries={[`/${encodeURIComponent(SPACE_ID)}/threads`]}>
              <SpaceProvider value={space}>
                <SwitcherHarness />
              </SpaceProvider>
            </MemoryRouter>
          </MatrixClientProvider>
        </ScreenSizeProvider>
      </Provider>
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-space-switcher-button="true"]'
    )!;
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('aria-label')).toBe('Product, Switch space');
    fireEvent.click(trigger);

    const menu = document.querySelector<HTMLElement>('[data-space-switcher-menu="true"]')!;
    const options = [...document.querySelectorAll<HTMLElement>('[data-space-switcher-option]')];
    expect(options.map((el) => el.getAttribute('data-space-switcher-option'))).toEqual([
      otherSpaceId,
      SPACE_ID,
      subId,
    ]);
    expect(options[1]?.getAttribute('aria-checked')).toBe('true');
    expect(options[2]?.style.paddingInlineStart).toContain('16px');

    // initialFocus prefers the checked item even when it is not first in DOM order.
    expect(document.activeElement).toBe(options[1]);

    // ArrowDown / ArrowUp / Home / End move focus across menuitemradio options.
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[2]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(options[2]);

    // Selecting the current space closes the menu and returns focus to the trigger button.
    fireEvent.click(options[1]!);
    expect(document.querySelector('[data-space-switcher-menu]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // Renaming a space/subspace updates the switcher options on reopen.
    act(() => {
      subSpace.setName('Core Platform');
      space.setName('Product HQ');
      space.emit(RoomEvent.Name, space);
    });
    expect(trigger.getAttribute('aria-label')).toBe('Product HQ, Switch space');
    fireEvent.click(trigger);
    const renamedSub = document.querySelector<HTMLElement>(
      `[data-space-switcher-option="${subId}"]`
    )!;
    expect(renamedSub.textContent).toContain('Core Platform');

    fireEvent.click(renamedSub);
    expect(screen.getByTestId('switcher-path').textContent).toBe(
      `/${encodeURIComponent(subId)}/threads`
    );
    expect(document.querySelector('[data-space-switcher-menu]')).toBeNull();
  });

  it('supports subspace group checkboxes, indeterminate state, trigger label, and search in Rooms dropdown', () => {
    const subId = '!sub-platform:example.org';
    const subSpace = makeRoom(subId, 'Platform', { isSpace: true });
    const eng = makeRoom(ROOM_ENG, 'Engineering', { hasAgent: true });
    const des = makeRoom(ROOM_DES, 'Design', { hasAgent: true });
    const ops = makeRoom(ROOM_OPS, 'Ops', { hasAgent: true });
    const entries = [
      makeEntry(ROOM_ENG, 'Engineering', '$t-eng', 'Build failure', NOW),
      makeEntry(ROOM_DES, 'Design', '$t-des', 'New button spec', NOW - 1000),
      makeEntry(ROOM_OPS, 'Ops', '$t-ops', 'Cluster upgrade', NOW - 2000),
    ];

    const { container } = renderSpaceThreads({
      rooms: [eng, des, ops],
      entries,
      extraSpaces: [subSpace],
      parentOverrides: new Map([
        [subId, new Set([SPACE_ID])],
        [ROOM_ENG, new Set([SPACE_ID])],
        [ROOM_DES, new Set([subId])],
        [ROOM_OPS, new Set([subId])],
      ]),
    });

    openRoomsDropdown(container);
    const getSubspaceCheckbox = () =>
      within(
        container.querySelector<HTMLElement>(`[data-subspace-option="${subId}"]`)!
      ).getByRole<HTMLInputElement>('checkbox');

    expect(container.querySelector(`[data-subspace-option="${subId}"]`)?.textContent).toContain(
      'Platform'
    );
    expect(getSubspaceCheckbox().getAttribute('aria-checked')).toBe('false');

    // Checking Platform selects Design + Ops and labels the trigger "Platform".
    fireEvent.click(getSubspaceCheckbox());
    expect(screen.queryByText('Build failure')).toBeNull();
    expect(screen.getByText('New button spec')).toBeTruthy();
    expect(screen.getByText('Cluster upgrade')).toBeTruthy();
    expect(container.querySelector('[data-room-filter-button]')?.textContent).toBe('Platform');
    expect(getSubspaceCheckbox().getAttribute('aria-checked')).toBe('true');

    // Unchecking one room makes Platform indeterminate (aria-checked="mixed").
    toggleRoomOption(container, ROOM_DES);
    expect(screen.queryByText('New button spec')).toBeNull();
    expect(screen.getByText('Cluster upgrade')).toBeTruthy();
    expect(getSubspaceCheckbox().getAttribute('aria-checked')).toBe('mixed');
    expect(getSubspaceCheckbox().indeterminate).toBe(true);

    // Clicking indeterminate Platform re-checks all rooms in Platform.
    fireEvent.click(getSubspaceCheckbox());
    expect(screen.getByText('New button spec')).toBeTruthy();
    expect(screen.getByText('Cluster upgrade')).toBeTruthy();
    expect(getSubspaceCheckbox().getAttribute('aria-checked')).toBe('true');

    // Clicking checked Platform unchecks its rooms and restores all rooms.
    fireEvent.click(getSubspaceCheckbox());
    expect(screen.getByText('Build failure')).toBeTruthy();
    expect(container.querySelector('[data-room-filter-button]')?.textContent).toBe('Rooms');

    // Search matches subspace name (shows subspace + its rooms) and room name (keeps ancestor header).
    const search = container.querySelector<HTMLInputElement>('[data-room-filter-search]')!;
    fireEvent.change(search, { target: { value: 'plat' } });
    expect(container.querySelector(`[data-subspace-option="${subId}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-room-option="${ROOM_DES}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-room-option="${ROOM_OPS}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-room-option="${ROOM_ENG}"]`)).toBeNull();

    fireEvent.change(search, { target: { value: 'ops' } });
    expect(container.querySelector(`[data-subspace-option="${subId}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-room-option="${ROOM_OPS}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-room-option="${ROOM_DES}"]`)).toBeNull();

    // Renaming the subspace updates its label and search match when reopening the Rooms dropdown.
    fireEvent.click(container.querySelector('[data-room-filter-button]')!);
    subSpace.setName('Infrastructure');
    openRoomsDropdown(container);
    expect(container.querySelector(`[data-subspace-option="${subId}"]`)?.textContent).toContain(
      'Infrastructure'
    );
    fireEvent.change(container.querySelector<HTMLInputElement>('[data-room-filter-search]')!, {
      target: { value: 'infra' },
    });
    expect(container.querySelector(`[data-subspace-option="${subId}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-room-option="${ROOM_OPS}"]`)).toBeTruthy();
  });
});
