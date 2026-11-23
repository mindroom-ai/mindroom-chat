// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { Space } from './Space';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { roomToUnreadAtom } from '../../matrix/state/roomToUnread';
import { makeClosedNavCategoriesAtom, makeNavCategoryId } from '../../ui/nav/closedNavCategories';
import { ClosedNavCategoriesProvider } from '../../ui/nav/useClosedNavCategories';
import { getSpaceRoomPath } from '../../routes/pathUtils';

// The space's navigation lists the rooms the user is in across the space and its joined
// sub-spaces, collapsing sections persistently and stepping across sections with one shortcut hook.

const { accountData, navOptions, passthrough, rooms, screen, selected, shortcutCalls, subRooms } =
  vi.hoisted(() => {
    const roomIds = {
      space: '!garden:example.org',
      joined: '!seedlings:example.org',
      invited: '!compost:example.org',
      left: '!orchard:example.org',
      design: '!design:example.org',
      designReview: '!design-review:example.org',
      iconSketches: '!icon-sketches:example.org',
      organizer: '!organizer:example.org',
      research: '!research:example.org',
      readingList: '!reading-list:example.org',
      interviews: '!interviews:example.org',
    };
    const spaceIds = new Set<string>([
      roomIds.space,
      roomIds.design,
      roomIds.organizer,
      roomIds.research,
    ]);
    const names: Record<string, string> = {
      [roomIds.space]: 'garden',
      [roomIds.joined]: 'seedlings',
      [roomIds.invited]: 'compost',
      [roomIds.left]: 'orchard',
      [roomIds.design]: 'Design Team',
      [roomIds.designReview]: 'Design Review',
      [roomIds.iconSketches]: 'Icon Sketches',
      [roomIds.organizer]: 'Organizer',
      [roomIds.research]: 'Research Group',
      [roomIds.readingList]: 'Reading List',
      [roomIds.interviews]: 'Field Interviews',
    };
    const roomOf = (roomId: string) => {
      const space = spaceIds.has(roomId);
      const type = space ? 'm.space' : undefined;
      return {
        roomId,
        name: names[roomId] ?? roomId.slice(1, roomId.indexOf(':')),
        getCanonicalAlias: () => null,
        isSpaceRoom: () => space,
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
      selected: { roomId: undefined as string | undefined },
      shortcutCalls: [] as Array<readonly string[]>,
      accountData: {
        content: undefined as Record<string, unknown> | undefined,
        setAccountData: vi.fn(async () => ({})),
      },
      navOptions: {
        children: undefined as ((close: () => void) => React.ReactNode) | undefined,
      },
      passthrough: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    };
  });

const client = {
  getRoom: (roomId: string) => rooms.of(roomId),
  getRooms: () => Object.values(rooms.ids).map(rooms.of),
  getUserId: () => '@alice:example.org',
  getSafeUserId: () => '@alice:example.org',
  getAccountData: (type: string) =>
    type === 'io.mindroom.room_order' && accountData.content !== undefined
      ? { getContent: () => accountData.content }
      : undefined,
  setAccountData: accountData.setAccountData,
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
vi.mock('../../ui/nav/NavOptionsMenu', () => ({
  NavOptionsMenu: ({ children }: { children: (close: () => void) => React.ReactNode }) => {
    navOptions.children = children;
    return <div data-nav-options>{children(() => undefined)}</div>;
  },
}));
vi.mock('../../ui/MenuEntry', () => ({
  MenuGroup: passthrough,
  MenuEntry: ({ label, onSelect }: { label: string; onSelect: () => void }) => (
    <button type="button" data-menu-entry={label} onClick={onSelect}>
      {label}
    </button>
  ),
}));
vi.mock('../room-nav/RoomNavCategoryButton', () => ({
  RoomNavCategoryButton: ({
    closed,
    ownDirection,
    after,
    children,
    ...props
  }: {
    closed?: boolean;
    ownDirection?: boolean;
    after?: React.ReactNode;
    children?: React.ReactNode;
  } & Record<string, unknown>) => (
    <button
      type="button"
      data-section-button
      data-closed={closed ? 'true' : 'false'}
      data-own-direction-prop={ownDirection ? 'true' : 'false'}
      {...props}
    >
      {children}
      {after}
    </button>
  ),
}));
// The rows under a room read its state, which these rooms do not have; how Space draws them is kept.
vi.mock('../room-nav/SubRoomRows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../room-nav/SubRoomRows')>()),
  SubRoomRows: ({ renderRoom }: { renderRoom: (room: unknown) => React.ReactNode }) => {
    subRooms.renderRoom = renderRoom;
    return null;
  },
}));
vi.mock('../useRoomListShortcuts', () => ({
  useRoomListShortcuts: (roomIds: readonly string[]) => {
    shortcutCalls.push(roomIds);
  },
}));
vi.mock('../room-nav/SortableRoomList', () => ({
  SortableRoomList: ({ listId, children }: { listId: string; children?: React.ReactNode }) => (
    <div data-sortable-list={listId}>{children}</div>
  ),
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
vi.mock('../../matrix/hooks/useRoomMeta', () => ({
  useRoomName: (room: { name?: string; roomId: string }) => room.name ?? room.roomId,
}));
vi.mock('../../navigation/useSelectedRoom', () => ({ useSelectedRoom: () => selected.roomId }));
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
vi.mock('../../matrix/state/archivedRooms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/state/archivedRooms')>()),
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
    selected.roomId = undefined;
    shortcutCalls.length = 0;
    accountData.content = undefined;
    accountData.setAccountData.mockReset();
    localStorage.clear();
  });

  const mountSpace = (
    store: ReturnType<typeof createStore>,
    closedAtom = makeClosedNavCategoriesAtom('@alice:example.org')
  ) => {
    act(() => {
      renderer = create(
        <Provider store={store}>
          <ClosedNavCategoriesProvider value={closedAtom}>
            <Space />
          </ClosedNavCategoriesProvider>
        </Provider>
      );
    });
    return { store, closedAtom };
  };

  const renderEmptySpace = () => {
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [rooms.ids.space] });
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
    store.set(roomToParentsAtom, { type: 'INITIALIZE', roomToParents: new Map() });
    mountSpace(store);
    return renderer!.root.findAll(
      (node) => typeof node.type === 'string' && 'data-find-anything' in node.props
    );
  };

  it('puts the Find anything field atop the list, and leaves it to the top bar on a phone', () => {
    expect(renderEmptySpace()).toHaveLength(1);
    act(() => renderer?.unmount());
    screen.size = 'Mobile';
    expect(renderEmptySpace()).toHaveLength(0);
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
    mountSpace(store);

    const rows = renderer!.root.findAll(
      (node) => typeof node.type === 'string' && 'data-row-room' in node.props
    );
    expect(rows.map((node) => node.props['data-row-room'] as string)).toEqual([joined]);
    // The row opens the room in the space, whose search it stays in.
    expect(rows[0]?.props['data-link']).toBe(getSpaceRoomPath(space, joined));
    expect(rows[0]?.props['data-space']).toBe(space);
    // Only a row under a room frames its hash.
    expect(rows[0]?.props['data-sub-room']).toBeUndefined();
    const under = subRooms.renderRoom?.(rooms.of('!seedlings-trays:example.org'));
    expect(React.isValidElement<{ subRoom?: boolean }>(under) && under.props.subRoom).toBe(true);
  });

  it('renders inline sub-space sections in DFS order, collapses with unread dot, and registers one shortcut list', () => {
    const {
      space,
      joined,
      design,
      designReview,
      iconSketches,
      organizer,
      research,
      readingList,
      interviews,
    } = rooms.ids;
    const store = createStore();
    store.set(allRoomsAtom, {
      type: 'INITIALIZE',
      rooms: [
        space,
        joined,
        design,
        designReview,
        iconSketches,
        organizer,
        research,
        readingList,
        interviews,
      ],
    });
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([
        [joined, new Set([space])],
        [design, new Set([space])],
        [organizer, new Set([space])],
        [research, new Set([organizer])],
        [designReview, new Set([design])],
        [iconSketches, new Set([design])],
        [readingList, new Set([research])],
        [interviews, new Set([research])],
      ]),
    });
    store.set(roomToUnreadAtom, {
      type: 'RESET',
      unreadInfos: [{ roomId: readingList, total: 2, highlight: 1 }],
    });

    const closedAtom = makeClosedNavCategoriesAtom('@alice:example.org');
    mountSpace(store, closedAtom);

    const sectionButtons = () =>
      renderer!.root.findAll(
        (node) => node.type === 'button' && 'data-section-button' in node.props
      );
    const rows = () =>
      renderer!.root.findAll(
        (node) => typeof node.type === 'string' && 'data-row-room' in node.props
      );

    // Empty intermediate organizer is hidden, while its populated Research Group child appears.
    expect(sectionButtons().map((node) => node.props['data-category-id'])).toEqual([
      makeNavCategoryId(space, 'room'),
      makeNavCategoryId(space, 'subspace', design),
      makeNavCategoryId(space, 'subspace', research),
    ]);
    expect(sectionButtons().map((node) => node.props['data-own-direction-prop'])).toEqual([
      'false',
      'true',
      'true',
    ]);
    // Every room row links under the active parent space and carries spaceId = space.
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      designReview,
      iconSketches,
      interviews,
      readingList,
    ]);
    rows().forEach((node) => {
      const roomId = node.props['data-row-room'] as string;
      expect(node.props['data-link']).toBe(getSpaceRoomPath(space, roomId));
      expect(node.props['data-space']).toBe(space);
    });
    // One single useRoomListShortcuts call per render across all sections in rendered order.
    expect(shortcutCalls.at(-1)).toEqual([
      joined,
      designReview,
      iconSketches,
      interviews,
      readingList,
    ]);

    // Collapse Research Group: hides its rooms and shows the unread dot + accessible label.
    shortcutCalls.length = 0;
    const researchCategoryId = makeNavCategoryId(space, 'subspace', research);
    const researchButton = sectionButtons()[2]!;
    act(() => {
      researchButton.props.onClick({
        currentTarget: { getAttribute: () => researchCategoryId },
      });
    });

    expect(store.get(closedAtom).has(researchCategoryId)).toBe(true);
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      designReview,
      iconSketches,
    ]);
    const collapsedResearch = sectionButtons()[2]!;
    expect(collapsedResearch.props['data-closed']).toBe('true');
    expect(collapsedResearch.props['aria-label']).toContain('Research Group');
    expect(
      collapsedResearch.findAll(
        (node) => typeof node.type === 'string' && 'data-unread' in node.props
      )
    ).toHaveLength(1);
    expect(shortcutCalls).toEqual([[joined, designReview, iconSketches]]);

    // Selecting the only unread room keeps it visible under the collapsed header and clears the dot.
    shortcutCalls.length = 0;
    selected.roomId = readingList;
    act(() => {
      renderer!.update(
        <Provider store={store}>
          <ClosedNavCategoriesProvider value={closedAtom}>
            <Space />
          </ClosedNavCategoriesProvider>
        </Provider>
      );
    });
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      designReview,
      iconSketches,
      readingList,
    ]);
    const selectedResearch = sectionButtons()[2]!;
    expect(
      selectedResearch.findAll(
        (node) => typeof node.type === 'string' && 'data-unread' in node.props
      )
    ).toHaveLength(0);
    expect(selectedResearch.props['aria-label']).toBeUndefined();
    expect(shortcutCalls).toEqual([[joined, designReview, iconSketches, readingList]]);
  });

  it('resets all manually ordered displayed sections in one atomic account-data write', () => {
    const { space, joined, design, designReview, iconSketches } = rooms.ids;
    accountData.content = {
      lists: {
        [space]: [joined],
        [design]: [iconSketches, designReview],
        '!unrelated:example.org': ['!other:example.org'],
      },
    };
    const store = createStore();
    store.set(allRoomsAtom, {
      type: 'INITIALIZE',
      rooms: [space, joined, design, designReview, iconSketches],
    });
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([
        [joined, new Set([space])],
        [design, new Set([space])],
        [designReview, new Set([design])],
        [iconSketches, new Set([design])],
      ]),
    });
    mountSpace(store);

    const rows = () =>
      renderer!.root.findAll(
        (node) => typeof node.type === 'string' && 'data-row-room' in node.props
      );
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      iconSketches,
      designReview,
    ]);

    const sortButton = renderer!.root.find(
      (node) => node.type === 'button' && node.props['data-menu-entry'] === 'Sort Rooms A to Z'
    );
    act(() => {
      sortButton.props.onClick();
    });

    expect(accountData.setAccountData).toHaveBeenCalledTimes(1);
    expect(accountData.setAccountData).toHaveBeenCalledWith('io.mindroom.room_order', {
      lists: { '!unrelated:example.org': ['!other:example.org'] },
    });
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      designReview,
      iconSketches,
    ]);
  });
});
