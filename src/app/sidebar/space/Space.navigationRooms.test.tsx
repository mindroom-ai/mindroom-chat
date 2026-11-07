// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { Space } from './Space';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';

// The space's navigation lists the rooms the user is in. The client also holds rooms the user
// is only invited to or has left; those are not rows of the list.

const { passthrough, rooms } = vi.hoisted(() => {
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
// The rows under a room read its state, which these rooms do not have.
vi.mock('../room-nav/SubRoomRows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../room-nav/SubRoomRows')>()),
  SubRoomRows: () => null,
}));
vi.mock('../room-nav/SortableRoomList', () => ({
  SortableRoomList: passthrough,
  SortableRoomRow: ({ room }: { room: { roomId: string } }) => <div data-row-room={room.roomId} />,
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
vi.mock('../../navigation/useSpaceSettingsState', () => ({ useOpenSpaceSettings: () => vi.fn() }));
vi.mock('../../matrix/state/archivedRooms', () => ({
  useVisibleRooms: (roomIds: string[]) => roomIds,
}));
vi.mock('../threads/ThreadNavCategory', () => ({
  ThreadNavCategory: () => null,
}));
vi.mock('../threads/RecentlyOpenedNavCategory', () => ({
  RecentlyOpenedNavCategory: () => null,
}));
vi.mock('../../notifications/MarkRoomsReadMenuItem', () => ({
  MarkRoomsReadMenuItem: () => null,
}));

describe('Space navigation', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
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

    const listed = renderer!.root
      .findAll((node) => typeof node.type === 'string' && 'data-row-room' in node.props)
      .map((node) => node.props['data-row-room'] as string);
    expect(listed).toEqual([joined]);
  });
});
