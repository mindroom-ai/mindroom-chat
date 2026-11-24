// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { KnownMembership, type MatrixClient, type Room, type RoomMember } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { clearRecentRoomsStore, getRecentRoomsAtom } from '../../navigation/recentRooms';
import { ROOM_THREAD_MODE_EVENT } from '../../matrix/protocol/roomThreadMode';
import { StateEvent } from '../../matrix/types/room';
import { ForkToRoomDialog, targetHasUnsharedAgents } from './ForkToRoomDialog';

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
});
