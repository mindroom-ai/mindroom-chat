// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { KnownMembership, type MatrixClient, type Room, type RoomMember } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { clearRecentRoomsStore, getRecentRoomsAtom } from '../../navigation/recentRooms';
import { ROOM_THREAD_MODE_EVENT } from '../../matrix/protocol/roomThreadMode';
import { StateEvent } from '../../matrix/types/room';
import {
  ForkToRoomDialog,
  MAX_MEMBER_LOAD_CANDIDATES,
  targetHasUnsharedAgents,
} from './ForkToRoomDialog';

vi.mock('../../ui/ActionDialog', () => ({
  ActionDialog: ({
    label,
    children,
  }: {
    label: string;
    onClose: () => void;
    busy: boolean;
    children: React.ReactNode;
  }) => (
    <div role="dialog" aria-label={label}>
      <h2>{label}</h2>
      {children}
    </div>
  ),
}));

vi.mock('../../avatars/RoomAvatar', () => ({
  RoomIcon: () => <span data-testid="room-icon" />,
}));

vi.mock('./ForkToRoomDialog.css', () => ({
  SearchInput: 'SearchInput',
  List: 'List',
  RoomRow: 'RoomRow',
  RoomRowActive: 'RoomRowActive',
  RoomTitle: 'RoomTitle',
  AgentWarning: 'AgentWarning',
  EmptyState: 'EmptyState',
}));

const MY_USER = '@alice:example.org';

type MockRoomOpts = {
  roomId: string;
  name: string;
  alias?: string;
  space?: boolean;
  membership?: string;
  tombstoned?: boolean;
  encrypted?: boolean;
  threadMode?: 'room' | 'thread' | 'mixed';
  eventsDefaultPower?: number;
  userPower?: number;
  lastActiveTs?: number;
  members?: Array<{ userId: string; membership: string }>;
  membersLoaded?: () => boolean;
  loadMembersIfNeeded?: () => Promise<boolean>;
};

const makeRoom = ({
  roomId,
  name,
  alias,
  space = false,
  membership = KnownMembership.Join,
  tombstoned = false,
  encrypted = false,
  threadMode,
  eventsDefaultPower = 0,
  userPower = 0,
  lastActiveTs = 1000,
  members = [{ userId: MY_USER, membership: KnownMembership.Join }],
  membersLoaded,
  loadMembersIfNeeded,
}: MockRoomOpts): Room => {
  const stateEvents: Record<
    string,
    { getContent: () => Record<string, unknown>; getSender?: () => string }
  > = {
    [StateEvent.RoomPowerLevels]: {
      getContent: () => ({
        events_default: eventsDefaultPower,
        users_default: 0,
        users: { [MY_USER]: userPower },
      }),
    },
  };
  if (tombstoned) {
    stateEvents[StateEvent.RoomTombstone] = {
      getContent: () => ({ replacement_room: '!new:example.org' }),
    };
  }
  if (threadMode) {
    stateEvents[ROOM_THREAD_MODE_EVENT] = { getContent: () => ({ mode: threadMode }) };
  }
  const state = {
    getStateEvents: (type: string) => stateEvents[type] ?? null,
  };
  return {
    roomId,
    name,
    getCanonicalAlias: () => alias ?? null,
    isSpaceRoom: () => space,
    getMyMembership: () => membership,
    hasEncryptionStateEvent: () => encrypted,
    getJoinRule: () => 'invite',
    getLastActiveTimestamp: () => lastActiveTs,
    getMembers: () => members as unknown as RoomMember[],
    ...(membersLoaded ? { membersLoaded } : {}),
    ...(loadMembersIfNeeded ? { loadMembersIfNeeded } : {}),
    currentState: state,
    getLiveTimeline: () => ({ getState: () => state }),
  } as unknown as Room;
};

afterEach(() => {
  cleanup();
  clearRecentRoomsStore(MY_USER);
  localStorage.clear();
});

describe('targetHasUnsharedAgents', () => {
  it('warns only when target has MindRoom agents and none of them are joined to source', () => {
    const human = { userId: MY_USER, membership: KnownMembership.Join };
    const agentA = { userId: '@mindroom_coder:example.org', membership: KnownMembership.Join };
    const agentB = { userId: '@mindroom_writer:example.org', membership: KnownMembership.Join };

    expect(targetHasUnsharedAgents([human], [human])).toBe(false);
    expect(targetHasUnsharedAgents([human], [human, agentA])).toBe(true);
    expect(targetHasUnsharedAgents([human, agentA], [human, agentA, agentB])).toBe(false);
    expect(
      targetHasUnsharedAgents(
        [human, { userId: agentA.userId, membership: KnownMembership.Leave }],
        [human, agentA]
      )
    ).toBe(true);
  });

  it('excludes @mindroom_router when computing target-room and shared responders', () => {
    const human = { userId: MY_USER, membership: KnownMembership.Join };
    const router = { userId: '@mindroom_router:example.org', membership: KnownMembership.Join };
    const coder = { userId: '@mindroom_coder:example.org', membership: KnownMembership.Join };
    const writer = { userId: '@mindroom_writer:example.org', membership: KnownMembership.Join };

    // Shared router must not hide an unshared responding agent in the target room.
    expect(targetHasUnsharedAgents([human, router], [human, router, coder])).toBe(true);
    // Router alone is not counted as a responding agent in the target room.
    expect(targetHasUnsharedAgents([human], [human, router])).toBe(false);
    expect(targetHasUnsharedAgents([human, router], [human, router])).toBe(false);
    // A shared actual responder suppresses the warning even when router is present.
    expect(targetHasUnsharedAgents([human, router, coder], [human, router, coder, writer])).toBe(
      false
    );
  });
});

describe('ForkToRoomDialog', () => {
  const renderDialog = ({
    sourceRoom,
    rooms,
    recentRoomIds = [],
    onSelect = vi.fn(),
    onClose = vi.fn(),
  }: {
    sourceRoom: Room;
    rooms: Room[];
    recentRoomIds?: string[];
    onSelect?: (roomId: string) => void;
    onClose?: () => void;
  }) => {
    const byId = new Map(rooms.map((r) => [r.roomId, r]));
    const mx = {
      getSafeUserId: () => MY_USER,
      getUserId: () => MY_USER,
      getRoom: (id: string) => byId.get(id) ?? null,
    } as unknown as MatrixClient;
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: rooms.map((r) => r.roomId) });
    // Record visits with distinct timestamps so newest appears first.
    const recentAtom = getRecentRoomsAtom(MY_USER);
    const nowSpy = vi.spyOn(Date, 'now');
    let ts = 1_700_000_000_000;
    [...recentRoomIds].reverse().forEach((id) => {
      ts += 1000;
      nowSpy.mockReturnValue(ts);
      store.set(recentAtom, id);
    });
    nowSpy.mockRestore();
    const rendered = render(
      <Provider store={store}>
        <MatrixClientProvider value={mx}>
          <ForkToRoomDialog sourceRoom={sourceRoom} onSelect={onSelect} onClose={onClose} />
        </MatrixClientProvider>
      </Provider>
    );
    return { ...rendered, onSelect, onClose };
  };

  it('excludes spaces, source room, tombstoned, unwritable, room-thread-mode, and unencrypted rooms when source is encrypted', () => {
    const source = makeRoom({
      roomId: '!alpha:example.org',
      name: 'Project Alpha',
      encrypted: true,
    });
    const rooms = [
      source,
      makeRoom({ roomId: '!space:example.org', name: 'Eng Space', space: true, encrypted: true }),
      makeRoom({
        roomId: '!tomb:example.org',
        name: 'Old Room',
        tombstoned: true,
        encrypted: true,
      }),
      makeRoom({
        roomId: '!readonly:example.org',
        name: 'Announcements',
        eventsDefaultPower: 50,
        userPower: 0,
        encrypted: true,
      }),
      makeRoom({
        roomId: '!roommode:example.org',
        name: 'Room Mode Chat',
        threadMode: 'room',
        encrypted: true,
      }),
      makeRoom({ roomId: '!plain:example.org', name: 'Unencrypted Beta', encrypted: false }),
      makeRoom({ roomId: '!encbeta:example.org', name: 'Encrypted Beta', encrypted: true }),
    ];

    renderDialog({ sourceRoom: source, rooms });

    const options = screen.getAllByRole('option');
    expect(options.map((el) => el.getAttribute('data-fork-room-id'))).toEqual([
      '!encbeta:example.org',
    ]);
  });

  it('sorts eligible rooms recent-first, filters by search, and supports keyboard navigation', () => {
    const source = makeRoom({ roomId: '!alpha:example.org', name: 'Project Alpha' });
    const beta = makeRoom({
      roomId: '!beta:example.org',
      name: 'Project Beta',
      alias: '#beta:example.org',
      lastActiveTs: 100,
    });
    const gamma = makeRoom({
      roomId: '!gamma:example.org',
      name: 'Project Gamma',
      lastActiveTs: 500,
    });
    const delta = makeRoom({
      roomId: '!delta:example.org',
      name: 'Project Delta',
      lastActiveTs: 200,
    });
    const onSelect = vi.fn();

    renderDialog({
      sourceRoom: source,
      rooms: [source, beta, gamma, delta],
      recentRoomIds: ['!beta:example.org', '!delta:example.org'],
      onSelect,
    });

    // Recent visits first (!beta, !delta), then unvisited (!gamma).
    expect(screen.getAllByRole('option').map((el) => el.getAttribute('data-fork-room-id'))).toEqual(
      ['!beta:example.org', '!delta:example.org', '!gamma:example.org']
    );

    const search = screen.getByRole('combobox');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('!delta:example.org');

    fireEvent.change(search, { target: { value: 'gamma' } });
    expect(screen.getAllByRole('option').map((el) => el.getAttribute('data-fork-room-id'))).toEqual(
      ['!gamma:example.org']
    );

    fireEvent.change(search, { target: { value: 'does-not-exist' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No matching rooms')).toBeDefined();
  });

  it('shows an inline warning only when target has MindRoom agents and none are joined to source', () => {
    const agentCoder = { userId: '@mindroom_coder:example.org', membership: KnownMembership.Join };
    const agentWriter = {
      userId: '@mindroom_writer:example.org',
      membership: KnownMembership.Join,
    };
    const human = { userId: MY_USER, membership: KnownMembership.Join };

    const source = makeRoom({
      roomId: '!alpha:example.org',
      name: 'Project Alpha',
      members: [human, agentCoder],
    });
    const sharedTarget = makeRoom({
      roomId: '!shared:example.org',
      name: 'Shared Room',
      members: [human, agentCoder],
    });
    const unsharedTarget = makeRoom({
      roomId: '!unshared:example.org',
      name: 'Isolated Agent Room',
      members: [human, agentWriter],
    });
    const humanOnlyTarget = makeRoom({
      roomId: '!humans:example.org',
      name: 'Humans Only',
      members: [human],
    });

    renderDialog({
      sourceRoom: source,
      rooms: [source, sharedTarget, unsharedTarget, humanOnlyTarget],
    });

    const warnings = document.querySelectorAll('[data-fork-room-agent-warning]');
    expect(warnings).toHaveLength(1);
    const unsharedRow = document.querySelector('[data-fork-room-id="!unshared:example.org"]');
    expect(unsharedRow?.querySelector('[data-fork-room-agent-warning]')?.textContent).toContain(
      'Project Alpha'
    );
  });

  it('still shows the unshared-agent warning when source and target share only @mindroom_router', () => {
    const human = { userId: MY_USER, membership: KnownMembership.Join };
    const router = { userId: '@mindroom_router:example.org', membership: KnownMembership.Join };
    const coder = { userId: '@mindroom_coder:example.org', membership: KnownMembership.Join };

    const alpha = makeRoom({
      roomId: '!alpha:example.org',
      name: 'Project Alpha',
      members: [human, router],
    });
    const beta = makeRoom({
      roomId: '!beta:example.org',
      name: 'Project Beta',
      members: [human, router, coder],
    });
    const routerOnly = makeRoom({
      roomId: '!router-only:example.org',
      name: 'Router Only Room',
      members: [human, router],
    });

    renderDialog({
      sourceRoom: alpha,
      rooms: [alpha, beta, routerOnly],
    });

    const warnings = document.querySelectorAll('[data-fork-room-agent-warning]');
    expect(warnings).toHaveLength(1);
    const betaRow = document.querySelector('[data-fork-room-id="!beta:example.org"]');
    expect(betaRow?.querySelector('[data-fork-room-agent-warning]')?.textContent).toContain(
      'Project Alpha'
    );
    const routerOnlyRow = document.querySelector('[data-fork-room-id="!router-only:example.org"]');
    expect(routerOnlyRow?.querySelector('[data-fork-room-agent-warning]')).toBeNull();
  });

  it('scrolls the active option into view on ArrowDown and End keyboard navigation', () => {
    const scrollIntoView = vi.fn();
    const hadOwn = Object.prototype.hasOwnProperty.call(Element.prototype, 'scrollIntoView');
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const source = makeRoom({ roomId: '!alpha:example.org', name: 'Project Alpha' });
      const rooms = [
        source,
        makeRoom({ roomId: '!beta:example.org', name: 'Project Beta', lastActiveTs: 300 }),
        makeRoom({ roomId: '!gamma:example.org', name: 'Project Gamma', lastActiveTs: 200 }),
        makeRoom({ roomId: '!delta:example.org', name: 'Project Delta', lastActiveTs: 100 }),
      ];

      renderDialog({ sourceRoom: source, rooms });
      const options = screen.getAllByRole('option');
      const search = screen.getByRole('combobox');

      scrollIntoView.mockClear();
      fireEvent.keyDown(search, { key: 'ArrowDown' });
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(options[1]);

      fireEvent.keyDown(search, { key: 'End' });
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(options[2]);
    } finally {
      if (hadOwn) Element.prototype.scrollIntoView = original;
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('loads lazy-loaded candidate membership and reveals the unshared-agent warning once resolved', async () => {
    const human = { userId: MY_USER, membership: KnownMembership.Join };
    const unsharedAgent = {
      userId: '@mindroom_writer:example.org',
      membership: KnownMembership.Join,
    };

    const source = makeRoom({
      roomId: '!alpha:example.org',
      name: 'Project Alpha',
      members: [human],
      membersLoaded: () => true,
    });

    // Simulate a room on a fresh login before it has been visited: members are incomplete until
    // loadMembersIfNeeded() resolves.
    const lazyMembers: Array<{ userId: string; membership: string }> = [];
    let isLoaded = false;
    let resolveLoad!: (value: boolean) => void;
    const loadMembersIfNeeded = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLoad = (value) => {
            lazyMembers.push(human, unsharedAgent);
            isLoaded = true;
            resolve(value);
          };
        })
    );
    const lazyTarget = makeRoom({
      roomId: '!lazy:example.org',
      name: 'Unvisited Agent Room',
      members: lazyMembers,
      membersLoaded: () => isLoaded,
      loadMembersIfNeeded,
    });

    renderDialog({
      sourceRoom: source,
      rooms: [source, lazyTarget],
    });

    // Initially empty members -> no warning yet, but lazy load was triggered.
    expect(loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[data-fork-room-agent-warning]')).toHaveLength(0);

    await act(async () => {
      resolveLoad(true);
      await Promise.resolve();
    });

    const row = document.querySelector('[data-fork-room-id="!lazy:example.org"]');
    expect(row?.querySelector('[data-fork-room-agent-warning]')?.textContent).toContain(
      'Project Alpha'
    );
  });

  it('bounds lazy member loading to the top displayed candidates, loads newly matched rooms on search, and cleans up on unmount', async () => {
    const human = { userId: MY_USER, membership: KnownMembership.Join };
    const unsharedAgent = {
      userId: '@mindroom_writer:example.org',
      membership: KnownMembership.Join,
    };

    const source = makeRoom({
      roomId: '!alpha:example.org',
      name: 'Project Alpha',
      members: [human],
      membersLoaded: () => true,
    });

    const loaders = new Map<string, ReturnType<typeof vi.fn<() => Promise<boolean>>>>();
    let resolvePending!: (value: boolean) => void;
    const extraCount = MAX_MEMBER_LOAD_CANDIDATES + 2;
    const candidates = Array.from({ length: extraCount }, (_, index) => {
      const roomId = `!room-${index}:example.org`;
      const isLast = index === extraCount - 1;
      const roomMembers: Array<{ userId: string; membership: string }> = [human];
      let loaded = false;
      const load = vi.fn<() => Promise<boolean>>(() => {
        if (index === 0) {
          return new Promise<boolean>((resolve) => {
            resolvePending = resolve;
          });
        }
        if (isLast) roomMembers.push(unsharedAgent);
        loaded = true;
        return Promise.resolve(true);
      });
      loaders.set(roomId, load);
      return makeRoom({
        roomId,
        name: isLast ? 'Zeta Hidden Agent Room' : `Room ${String(index).padStart(2, '0')}`,
        lastActiveTs: 1000 - index,
        members: roomMembers,
        membersLoaded: () => loaded,
        loadMembersIfNeeded: load,
      });
    });

    const { unmount } = renderDialog({
      sourceRoom: source,
      rooms: [source, ...candidates],
    });

    // Only the top MAX_MEMBER_LOAD_CANDIDATES rooms are loaded initially.
    for (let i = 0; i < MAX_MEMBER_LOAD_CANDIDATES; i += 1) {
      expect(loaders.get(`!room-${i}:example.org`)).toHaveBeenCalledTimes(1);
    }
    const lastId = `!room-${extraCount - 1}:example.org`;
    expect(loaders.get(lastId)).not.toHaveBeenCalled();

    // Filtering brings the tail room into the displayed slice and loads its members.
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Zeta' } });
      await Promise.resolve();
    });
    expect(loaders.get(lastId)).toHaveBeenCalledTimes(1);
    expect(
      document
        .querySelector(`[data-fork-room-id="${lastId}"]`)
        ?.querySelector('[data-fork-room-agent-warning]')?.textContent
    ).toContain('Project Alpha');

    // Resolving an in-flight load after unmount does not throw or update unmounted state.
    unmount();
    await act(async () => {
      resolvePending(true);
      await Promise.resolve();
    });
  });
});
