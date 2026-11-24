// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import {
  ClientEvent,
  MatrixEventEvent,
  RelationType,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
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
import { settingsAtom } from '../../preferences/settings';
import {
  crossRoomThreadIndexAtom,
  getCrossRoomThreadIndexKey,
  normalizeThreadSearchText,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import { SpaceThreadsPage } from './SpaceThreadsPage';

const mocks = vi.hoisted(() => ({
  navigateRoom: vi.fn(),
  navigateRoomThread: vi.fn(),
  threadListsSettled: true,
  threadListCalls: [] as Array<{ allPages: boolean; roomIds?: readonly string[] }>,
}));

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children: ReactNode }) => children,
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
  ThreadCardBadges: () => null,
}));

const ME = '@me:example.org';
const BLOCKED_USER = '@blocked:example.org';
const SPACE_ID = '!space:example.org';
const ROOM_ENG = '!eng:example.org';
const ROOM_DES = '!des:example.org';
const ROOM_OPS = '!ops:example.org';
const NOW = 1_700_000_000_000;

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

type FakeRoom = Room & {
  emit: (event: string, ...args: unknown[]) => void;
  setName: (next: string) => void;
  setMembers: (next: Array<{ userId: string; membership: string; name: string }>) => void;
  setTimelineEvents: (next: unknown[]) => void;
};

const makeRoom = (
  roomId: string,
  initialName: string,
  opts: {
    isSpace?: boolean;
    canSend?: boolean;
    hasAgent?: boolean;
    threadMode?: RoomThreadMode;
    timelineEvents?: unknown[];
  } = {}
): FakeRoom => {
  const emitter = createEmitter();
  const canSend = opts.canSend ?? true;
  let name = initialName;
  let members = opts.hasAgent
    ? [{ userId: '@mindroom_code:example.org', membership: 'join', name: 'Code' }]
    : [{ userId: ME, membership: 'join', name: 'Me' }];
  let timelineEvents = opts.timelineEvents ?? [];

  const powerEvent = {
    getContent: () => ({ users_default: 0, events_default: canSend ? 0 : 50 }),
  };
  const threadModeEvent = opts.threadMode
    ? { getContent: () => ({ mode: opts.threadMode }) }
    : null;
  const state = {
    getStateEvents: (type: string) => (type === 'm.room.power_levels' ? powerEvent : null),
  };

  return {
    roomId,
    get name() {
      return name;
    },
    isSpaceRoom: () => opts.isSpace === true,
    getType: () => (opts.isSpace ? 'm.space' : undefined),
    getMyMembership: () => 'join',
    getCanonicalAlias: () => null,
    membersLoaded: () => true,
    loadMembersIfNeeded: () => Promise.resolve(true),
    getMembers: () => members,
    getMember: () => null,
    getThread: () => undefined,
    findEventById: (eventId: string) =>
      (timelineEvents as Array<{ getId?: () => string }>).find((e) => e.getId?.() === eventId),
    getOldestThreadedReceiptTs: () => 0,
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
    setMembers: (next: Array<{ userId: string; membership: string; name: string }>) => {
      members = next;
    },
    setTimelineEvents: (next: unknown[]) => {
      timelineEvents = next;
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
  rootSenderId = ME
): CrossRoomThreadIndexEntry => ({
  key: getCrossRoomThreadIndexKey(roomId, threadRootId),
  roomId,
  roomName,
  threadRootId,
  indexedEventIds: [threadRootId],
  threadRecord: {
    roomId,
    threadRootId,
    rootEventId: threadRootId,
    absoluteIndex: 0,
    presentation: {
      summaryInfo: undefined,
      summaryText,
      primarySummaryText: summaryText,
      recentThreadSummaryText: summaryText,
      rootPreviewText: `Root: ${summaryText}`,
      latestReplyPreviewText: `Reply: ${summaryText}`,
      lastSenderId: rootSenderId,
      lastSenderDisplayName: 'Me',
      messageCount: 1,
      participantIds: [rootSenderId],
      replyParticipantIds: [rootSenderId],
      peopleIds: [rootSenderId],
    },
    status: {
      isKnownThreadRoot: true,
      replyCount: 1,
      lastActivityTs,
      isUnread: false,
      isResolved: false,
      isStreaming: false,
      scheduledTaskCount: 0,
      tags: [],
    },
    cache: { eventCount: 2, relationSnapshotComplete: true, tailLoaded: true },
  },
  rootSenderId,
  lastActivityTs,
  isUnread: false,
  isResolved: false,
  hasAttention: false,
  isInvolved: true,
  isForUser: true,
  summaryText,
  rootPreviewText: summaryText,
  searchableText: normalizeThreadSearchText(summaryText),
  tags: [],
  generation: 1,
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
  bootstrapped = true,
  threadListsSettled = true,
  ignoredUsers = [],
  screenSize = ScreenSize.Desktop,
  store = createStore(),
}: {
  rooms: FakeRoom[];
  entries: CrossRoomThreadIndexEntry[];
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
    ...rooms.map((r) => [r.roomId, r] as const),
  ]);
  const clientEmitter = createEmitter();
  let ignoredEvent =
    ignoredUsers.length > 0 ? makeIgnoredAccountDataEvent(ignoredUsers) : undefined;
  const client = {
    getSafeUserId: () => ME,
    getUserId: () => ME,
    getRoom: (id: string) => roomMap.get(id) ?? null,
    getRooms: () => [...roomMap.values()],
    getAccountData: (type: string) =>
      type === (AccountDataEvent.IgnoredUserList as string) ? ignoredEvent : undefined,
    on: clientEmitter.on,
    off: clientEmitter.off,
    removeListener: clientEmitter.removeListener,
    mxcUrlToHttp: () => null,
  } as unknown as MatrixClient;

  store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [SPACE_ID, ...rooms.map((r) => r.roomId)] });
  store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
  store.set(roomToParentsAtom, {
    type: 'INITIALIZE',
    roomToParents: new Map(rooms.map((r) => [r.roomId, new Set([SPACE_ID])] as const)),
  });
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
});
