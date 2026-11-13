// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { Space } from './Space';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { getSpaceRoomPath } from '../../routes/pathUtils';

// The space's navigation lists the rooms the user is in. The client also holds rooms the user
// is only invited to or has left; those are not rows of the list.

const { passthrough, rooms, screen, subRooms } = vi.hoisted(() => {
  const roomIds = {
    space: '!garden:example.org',
    joined: '!seedlings:example.org',
    invited: '!compost:example.org',
    left: '!orchard:example.org',
  };
  const roomOf = (roomId: string) => {
    const type = roomId === roomIds.space ? 'm.space' : undefined;
    return {
      roomId,
      name: roomId.slice(1, roomId.indexOf(':')),
      getCanonicalAlias: () => null,
      isSpaceRoom: () => roomId === roomIds.space,
      currentState: { getStateEvents: () => [] },
      getLiveTimeline: () => ({
        getState: () => ({ getStateEvents: () => ({ getContent: () => ({ type }) }) }),
      }),
    };
  };
  return {
    rooms: { ids: roomIds, of: roomOf },
    subRooms: { renderRoom: undefined as ((room: unknown) => React.ReactNode) | undefined },
    screen: { size: 'Desktop' },
    passthrough: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  };
});

const client = {
  getRoom: (roomId: string) => rooms.of(roomId),
  getRooms: () => Object.values(rooms.ids).map(rooms.of),
  getUserId: () => '@alice:example.org',
  getSafeUserId: () => '@alice:example.org',
  // No room order saved: the list is A to Z.
  getAccountData: () => undefined,
  on: () => undefined,
  off: () => undefined,
};

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
  useMatch: () => null,
}));
vi.mock('focus-trap-react', () => ({ default: passthrough }));
vi.mock('../../ui/page/Page', () => ({
  PageNav: passthrough,
  PageNavContent: ({
    header,
    children,
  }: {
    header: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      {header}
      {children}
    </div>
  ),
  PageNavHeader: passthrough,
}));
vi.mock('../../ui/nav/NavItem', () => ({
  NavButton: passthrough,
  NavCategory: passthrough,
  NavItem: passthrough,
  NavItemContent: passthrough,
  NavLink: passthrough,
}));
vi.mock('../../ui/nav/NavCategoryHeader', () => ({
  NavCategoryHeader: passthrough,
}));
vi.mock('../room-nav/RoomNavCategoryButton', () => ({ RoomNavCategoryButton: passthrough }));
// The rows under a room read its state, which these rooms do not have; how Space draws them is kept.
vi.mock('../room-nav/SubRoomRows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../room-nav/SubRoomRows')>()),
  SubRoomRows: ({ renderRoom }: { renderRoom: (room: unknown) => React.ReactNode }) => {
    subRooms.renderRoom = renderRoom;
    return null;
  },
}));
vi.mock('../room-nav/SortableRoomList', () => ({
  SortableRoomList: passthrough,
  SortableRoomRow: ({
    room,
    linkPath,
    spaceId,
    subRoom,
  }: {
    room: { roomId: string };
    linkPath: string;
    spaceId: string;
    subRoom?: boolean;
  }) => (
    <div
      data-row-room={room.roomId}
      data-link={linkPath}
      data-space={spaceId}
      data-sub-room={subRoom}
    />
  ),
}));
vi.mock('../../rooms/join/JoinBeforeNavigate', () => ({
  JoinBeforeNavigate: () => null,
}));
vi.mock('../../room/RoomRoute', () => ({ RouteResolving: () => null }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client }));
vi.mock('../../matrix/hooks/useSpace', () => ({
  useSpace: () => rooms.of(rooms.ids.space),
  SpaceProvider: passthrough,
}));
vi.mock('../../matrix/hooks/useRoomMeta', () => ({ useRoomName: () => 'garden' }));
vi.mock('../../navigation/useSelectedRoom', () => ({ useSelectedRoom: () => undefined }));
vi.mock('../../routes/useNavToActivePathMapper', () => ({
  useNavToActivePathMapper: () => undefined,
}));
vi.mock('../../matrix/hooks/usePowerLevels', () => ({ usePowerLevels: () => ({}) }));
vi.mock('../../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({ action: () => false }),
}));
vi.mock('../../matrix/hooks/useRoomsNotificationPreferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/hooks/useRoomsNotificationPreferences')>()),
  getRoomNotificationMode: () => undefined,
  useRoomsNotificationPreferencesContext: () => ({}),
}));
vi.mock('../../navigation/useRoomSettingsState', () => ({ useOpenRoomSettings: () => vi.fn() }));
vi.mock('../../matrix/state/archivedRooms', () => ({
  useVisibleRooms: (roomIds: string[]) => roomIds,
}));
vi.mock('../threads/ThreadNavCategory', () => ({
  ThreadNavCategory: () => null,
}));
vi.mock('../threads/RecentlyOpenedNavCategory', () => ({
  RecentlyOpenedNavCategory: () => null,
}));
vi.mock('../../lib/hooks/useScreenSize', () => ({
  ScreenSize: { Desktop: 'Desktop', Tablet: 'Tablet', Mobile: 'Mobile' },
  useScreenSizeContext: () => screen.size,
}));
vi.mock('../../command-palette/CommandPaletteSearchField', () => ({
  CommandPaletteSearchField: () => <div data-find-anything />,
}));
vi.mock('../../notifications/MarkRoomsReadMenuItem', () => ({
  MarkRoomsReadMenuItem: () => null,
}));

describe('Space navigation', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    screen.size = 'Desktop';
  });

  const renderSpace = () => {
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [rooms.ids.space] });
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
    store.set(roomToParentsAtom, { type: 'INITIALIZE', roomToParents: new Map() });
    act(() => {
      renderer = create(
        <Provider store={store}>
          <Space />
        </Provider>
      );
    });
    return renderer!.root.findAll(
      (node) => typeof node.type === 'string' && 'data-find-anything' in node.props
    );
  };

  it('puts the Find anything field atop the list, and leaves it to the top bar on a phone', () => {
    expect(renderSpace()).toHaveLength(1);
    act(() => renderer?.unmount());
    screen.size = 'Mobile';
    expect(renderSpace()).toHaveLength(0);
  });

  it('lists the joined rooms of the space, not the ones the user is invited to or left', () => {
    const { space, joined, invited, left } = rooms.ids;
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [space, joined] });
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([joined, invited, left].map((roomId) => [roomId, new Set([space])])),
    });

    act(() => {
      renderer = create(
        <Provider store={store}>
          <Space />
        </Provider>
      );
    });

    const rows = renderer!.root.findAll(
      (node) => typeof node.type === 'string' && 'data-row-room' in node.props
    );
    expect(rows.map((node) => node.props['data-row-room'] as string)).toEqual([joined]);
    // The row opens the room in the space, whose settings and search it stays in.
    expect(rows[0]?.props['data-link']).toBe(getSpaceRoomPath(space, joined));
    expect(rows[0]?.props['data-space']).toBe(space);
    // Only a row under a room frames its hash.
    expect(rows[0]?.props['data-sub-room']).toBeUndefined();
    const under = subRooms.renderRoom?.(rooms.of('!seedlings-trays:example.org'));
    expect(React.isValidElement<{ subRoom?: boolean }>(under) && under.props.subRoom).toBe(true);
  });
});
