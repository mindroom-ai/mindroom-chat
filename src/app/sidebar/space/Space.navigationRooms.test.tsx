// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { RoomStateEvent } from 'matrix-js-sdk';
import { matchesEnum } from '../../lib/matchesEnum';
import { Space } from './Space';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { roomToUnreadAtom } from '../../matrix/state/roomToUnread';
import { makeClosedNavCategoriesAtom, makeNavCategoryId } from '../../ui/nav/closedNavCategories';
import { ClosedNavCategoriesProvider } from '../../ui/nav/useClosedNavCategories';
import { getSpaceRoomPath } from '../../routes/pathUtils';

// Integration tests for Space sidebar navigation: inline collapsible sub-space sections, persisted
// collapse state, scoped collapsed unread indicators, single shortcut hook, and atomic sort reset.

const {
  accountData,
  categoryButtonStats,
  dragGroup,
  editableSpaces,
  moveSpaceRoomMock,
  openCreateRoomMock,
  openCreateSpaceMock,
  passthrough,
  removeSpaceChildMock,
  rooms,
  screen,
  selected,
  shortcutCalls,
  stateListeners,
  subRooms,
} = vi.hoisted(() => {
  const specs = {
    space: { id: '!garden:example.org', name: 'garden', space: true },
    joined: { id: '!seedlings:example.org', name: 'seedlings', space: false },
    invited: { id: '!compost:example.org', name: 'compost', space: false },
    left: { id: '!orchard:example.org', name: 'orchard', space: false },
    organizer: { id: '!organizer:example.org', name: 'Operations', space: true },
    design: { id: '!design:example.org', name: 'Design Team', space: true },
    designReview: { id: '!design-review:example.org', name: 'Design Review', space: false },
    iconSketches: { id: '!icon-sketches:example.org', name: 'Icon Sketches', space: false },
    research: { id: '!research:example.org', name: 'Research Group', space: true },
    readingList: { id: '!reading-list:example.org', name: 'Reading List', space: false },
    interviews: { id: '!interviews:example.org', name: 'Field Interviews', space: false },
    nestedSub: { id: '!nested-sub:example.org', name: 'Nested Sub', space: false },
  };
  const byId = new Map(Object.values(specs).map((spec) => [spec.id, spec]));
  const ids = Object.fromEntries(
    Object.entries(specs).map(([key, spec]) => [key, spec.id])
  ) as Record<keyof typeof specs, string>;
  const editable = new Set<string>();
  const roomOf = (roomId: string) => {
    const spec = byId.get(roomId);
    const space = spec?.space ?? false;
    const type = space ? 'm.space' : undefined;
    return {
      roomId,
      name: spec?.name ?? roomId.slice(1, roomId.indexOf(':')),
      getCanonicalAlias: () => null,
      getMyMembership: () => 'join',
      isSpaceRoom: () => space,
      currentState: { getStateEvents: () => [] },
      getLiveTimeline: () => ({
        getState: () => ({
          getStateEvents: (eventType: string) => {
            if (eventType === 'm.room.create') {
              return {
                getContent: () => ({ type }),
                getSender: () => '@owner:example.org',
                getTs: () => 1000,
              };
            }
            if (eventType === 'm.room.power_levels') {
              return {
                getContent: () => ({
                  state_default: 50,
                  users: { '@alice:example.org': editable.has(roomId) ? 100 : 0 },
                }),
              };
            }
            return null;
          },
        }),
      }),
    };
  };
  const listeners = new Set<(...args: unknown[]) => void>();
  return {
    rooms: { ids, of: roomOf },
    editableSpaces: editable,
    stateListeners: listeners,
    moveSpaceRoomMock: vi.fn(async (): Promise<void> => undefined),
    removeSpaceChildMock: vi.fn(async (): Promise<void> => undefined),
    openCreateRoomMock: vi.fn(),
    openCreateSpaceMock: vi.fn(),
    dragGroup: {
      canMoveRoom: undefined as
        | ((sourceSpaceId: string, targetSpaceId: string, roomId: string) => boolean)
        | undefined,
      onMoveRoom: undefined as
        | ((sourceSpaceId: string, targetSpaceId: string, roomId: string) => void | Promise<void>)
        | undefined,
    },
    categoryButtonStats: {
      mounts: new Map<string, number>(),
      unmounts: new Map<string, number>(),
      renders: new Map<string, number>(),
    },
    subRooms: { renderRoom: undefined as ((room: unknown) => React.ReactNode) | undefined },
    screen: { size: 'Desktop' },
    selected: { roomId: undefined as string | undefined },
    shortcutCalls: [] as Array<readonly string[]>,
    accountData: {
      content: undefined as Record<string, unknown> | undefined,
      setAccountData: vi.fn(async () => ({})),
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
  on: (event: string, listener: (...args: unknown[]) => void) => {
    if (matchesEnum(event, RoomStateEvent.Events)) stateListeners.add(listener);
  },
  off: (event: string, listener: (...args: unknown[]) => void) => {
    if (matchesEnum(event, RoomStateEvent.Events)) stateListeners.delete(listener);
  },
  removeListener: (event: string, listener: (...args: unknown[]) => void) => {
    if (matchesEnum(event, RoomStateEvent.Events)) stateListeners.delete(listener);
  },
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
  NavCategoryHeader: React.forwardRef<HTMLDivElement, Record<string, unknown>>(
    function MockNavCategoryHeader({ children, ...props }, ref) {
      return (
        <div ref={ref} data-nav-category-header {...props}>
          {children as React.ReactNode}
        </div>
      );
    }
  ),
}));
vi.mock('../../ui/directional', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui/directional')>()),
  PopOut: ({ anchor, content }: { anchor?: unknown; content?: React.ReactNode }) =>
    anchor ? <div data-popout>{content}</div> : null,
}));
vi.mock('../../ui/nav/NavOptionsMenu', () => ({
  NavOptionsMenu: ({
    label,
    children,
  }: {
    label: string;
    children: (close: () => void) => React.ReactNode;
  }) => (
    <div data-nav-options={label} aria-label={label}>
      {children(() => undefined)}
    </div>
  ),
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
  RoomNavCategoryButton: React.forwardRef<
    HTMLButtonElement,
    {
      closed?: boolean;
      ownDirection?: boolean;
      after?: React.ReactNode;
      children?: React.ReactNode;
      'data-category-id'?: string;
    } & Record<string, unknown>
  >(function MockRoomNavCategoryButton({ closed, ownDirection, after, children, ...props }, ref) {
    const categoryId = props['data-category-id'] ?? '';
    categoryButtonStats.renders.set(
      categoryId,
      (categoryButtonStats.renders.get(categoryId) ?? 0) + 1
    );
    useEffect(() => {
      categoryButtonStats.mounts.set(
        categoryId,
        (categoryButtonStats.mounts.get(categoryId) ?? 0) + 1
      );
      return () => {
        categoryButtonStats.unmounts.set(
          categoryId,
          (categoryButtonStats.unmounts.get(categoryId) ?? 0) + 1
        );
      };
    }, [categoryId]);
    return (
      <button
        ref={ref}
        type="button"
        data-section-button
        data-closed={closed ? 'true' : 'false'}
        data-own-direction-prop={ownDirection ? 'true' : 'false'}
        {...props}
      >
        {children}
        {after}
      </button>
    );
  }),
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
  SortableRoomGroup: ({
    canMoveRoom,
    onMoveRoom,
    children,
  }: {
    canMoveRoom?: (sourceSpaceId: string, targetSpaceId: string, roomId: string) => boolean;
    onMoveRoom?: (sourceSpaceId: string, targetSpaceId: string, roomId: string) => void;
    children?: React.ReactNode;
  }) => {
    dragGroup.canMoveRoom = canMoveRoom;
    dragGroup.onMoveRoom = onMoveRoom;
    return <div data-sortable-group>{children}</div>;
  },
  useRoomSectionDrop: () => ({}),
  SortableRoomList: ({ listId, children }: { listId: string; children?: React.ReactNode }) => (
    <div data-sortable-list={listId}>{children}</div>
  ),
  SortableRoomRow: ({
    room,
    linkPath,
    spaceId,
    removeFromSpaceId,
    subRoom,
  }: {
    room: { roomId: string };
    linkPath: string;
    spaceId: string;
    removeFromSpaceId?: string;
    subRoom?: boolean;
  }) => (
    <div
      data-row-room={room.roomId}
      data-link={linkPath}
      data-space={spaceId}
      data-remove-from-space={removeFromSpaceId}
      data-sub-room={subRoom}
    />
  ),
}));
vi.mock('../../spaces/lobby/spaceChildren', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../spaces/lobby/spaceChildren')>()),
  moveSpaceRoom: moveSpaceRoomMock,
  removeSpaceChild: removeSpaceChildMock,
}));
vi.mock('../../navigation/useCreateRoomModal', () => ({
  useOpenCreateRoomModal: () => openCreateRoomMock,
}));
vi.mock('../../navigation/useCreateSpaceModal', () => ({
  useOpenCreateSpaceModal: () => openCreateSpaceMock,
}));
vi.mock('../../rooms/join/JoinBeforeNavigate', () => ({ JoinBeforeNavigate: () => null }));
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
vi.mock('../../matrix/hooks/usePowerLevels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/hooks/usePowerLevels')>()),
  usePowerLevels: (room: { roomId: string }) => ({
    state_default: 50,
    invite: 50,
    users: { '@alice:example.org': editableSpaces.has(room.roomId) ? 100 : 0 },
  }),
}));
vi.mock('../../matrix/hooks/useRoomCreators', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/hooks/useRoomCreators')>()),
  useRoomCreators: () => new Set(),
}));
vi.mock('../../matrix/hooks/useRoomPermissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/hooks/useRoomPermissions')>()),
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
vi.mock('../threads/ThreadNavCategory', () => ({ ThreadNavCategory: () => null }));
vi.mock('../threads/RecentlyOpenedNavCategory', () => ({ RecentlyOpenedNavCategory: () => null }));
vi.mock('../../lib/hooks/useScreenSize', () => ({
  ScreenSize: { Desktop: 'Desktop', Tablet: 'Tablet', Mobile: 'Mobile' },
  useScreenSizeContext: () => screen.size,
}));
vi.mock('../../command-palette/CommandPaletteSearchField', () => ({
  CommandPaletteSearchField: () => <div data-find-anything />,
}));
vi.mock('../../notifications/MarkRoomsReadMenuItem', () => ({ MarkRoomsReadMenuItem: () => null }));

describe('Space navigation', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    screen.size = 'Desktop';
    selected.roomId = undefined;
    shortcutCalls.length = 0;
    editableSpaces.clear();
    stateListeners.clear();
    dragGroup.canMoveRoom = undefined;
    dragGroup.onMoveRoom = undefined;
    categoryButtonStats.mounts.clear();
    categoryButtonStats.unmounts.clear();
    categoryButtonStats.renders.clear();
    moveSpaceRoomMock.mockReset();
    moveSpaceRoomMock.mockImplementation(async () => undefined);
    removeSpaceChildMock.mockReset();
    removeSpaceChildMock.mockImplementation(async () => undefined);
    openCreateRoomMock.mockReset();
    openCreateSpaceMock.mockReset();
    accountData.content = undefined;
    accountData.setAccountData.mockReset();
    localStorage.clear();
  });

  const rows = () =>
    renderer!.root.findAll(
      (node) => typeof node.type === 'string' && 'data-row-room' in node.props
    );

  const sectionButtons = () =>
    renderer!.root.findAll((node) => node.type === 'button' && 'data-section-button' in node.props);

  const unreadDots = (node: ReactTestInstance) =>
    node.findAll((child) => typeof child.type === 'string' && 'data-unread' in child.props);

  const renderSpace = (joined: string[], parents: Record<string, string[]> = {}) => {
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: joined });
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map(Object.entries(parents).map(([id, ids]) => [id, new Set(ids)])),
    });
    const closedAtom = makeClosedNavCategoriesAtom('@alice:example.org');
    const element = () => (
      <Provider store={store}>
        <ClosedNavCategoriesProvider value={closedAtom}>
          <Space />
        </ClosedNavCategoriesProvider>
      </Provider>
    );
    act(() => {
      renderer = create(element());
    });
    return { store, closedAtom, rerender: () => act(() => renderer!.update(element())) };
  };

  it('puts the Find anything field atop the list, and leaves it to the top bar on a phone', () => {
    const findFields = () =>
      renderer!.root.findAll(
        (node) => typeof node.type === 'string' && 'data-find-anything' in node.props
      );
    renderSpace([rooms.ids.space]);
    expect(findFields()).toHaveLength(1);
    act(() => renderer?.unmount());
    screen.size = 'Mobile';
    renderSpace([rooms.ids.space]);
    expect(findFields()).toHaveLength(0);
  });

  it('lists joined rooms under the space route and marks nested sub-rooms', () => {
    const { space, joined, invited, left } = rooms.ids;
    renderSpace([space, joined], { [joined]: [space], [invited]: [space], [left]: [space] });

    const rendered = rows();
    expect(rendered.map((node) => node.props['data-row-room'])).toEqual([joined]);
    expect(rendered[0]?.props['data-link']).toBe(getSpaceRoomPath(space, joined));
    expect(rendered[0]?.props['data-space']).toBe(space);
    expect(rendered[0]?.props['data-sub-room']).toBeUndefined();
    const under = subRooms.renderRoom?.(rooms.of('!seedlings-trays:example.org'));
    expect(React.isValidElement<{ subRoom?: boolean }>(under) && under.props.subRoom).toBe(true);
  });

  it('renders sub-space sections, scopes unread updates to collapsed headers, and keeps one shortcut list', () => {
    const { space, joined, design, designReview, iconSketches, research, readingList, interviews } =
      rooms.ids;
    const { store, closedAtom, rerender } = renderSpace(
      [space, joined, design, designReview, iconSketches, research, readingList, interviews],
      {
        [joined]: [space],
        [design]: [space],
        [research]: [space],
        [designReview]: [design],
        [iconSketches]: [design],
        [readingList]: [research],
        [interviews]: [research],
      }
    );

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
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      designReview,
      iconSketches,
      interviews,
      readingList,
    ]);
    expect(rows()[1]?.props['data-link']).toBe(getSpaceRoomPath(space, designReview));
    expect(rows()[1]?.props['data-space']).toBe(space);
    expect(shortcutCalls.at(-1)).toEqual([
      joined,
      designReview,
      iconSketches,
      interviews,
      readingList,
    ]);

    // Unread changes while expanded do not re-render Space.
    shortcutCalls.length = 0;
    act(() =>
      store.set(roomToUnreadAtom, {
        type: 'RESET',
        unreadInfos: [{ roomId: readingList, total: 2, highlight: 1 }],
      })
    );
    expect(shortcutCalls).toHaveLength(0);

    // Collapsing Research Group persists its category ID, hides its rooms, and shows the unread dot.
    const researchCategoryId = makeNavCategoryId(space, 'subspace', research);
    act(() => {
      sectionButtons()[2]!.props.onClick({
        currentTarget: { getAttribute: () => researchCategoryId },
      });
    });
    expect(store.get(closedAtom).has(researchCategoryId)).toBe(true);
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      designReview,
      iconSketches,
    ]);
    expect(sectionButtons()[2]!.props['data-closed']).toBe('true');
    expect(sectionButtons()[2]!.props['aria-label']).toContain('Research Group');
    expect(unreadDots(sectionButtons()[2]!)).toHaveLength(1);
    expect(shortcutCalls).toEqual([[joined, designReview, iconSketches]]);

    // Unread changes while collapsed refresh only the collapsed header, not Space.
    shortcutCalls.length = 0;
    act(() => store.set(roomToUnreadAtom, { type: 'RESET', unreadInfos: [] }));
    expect(shortcutCalls).toHaveLength(0);
    expect(unreadDots(sectionButtons()[2]!)).toHaveLength(0);
    expect(sectionButtons()[2]!.props['aria-label']).toBeUndefined();

    act(() =>
      store.set(roomToUnreadAtom, {
        type: 'RESET',
        unreadInfos: [{ roomId: readingList, total: 2, highlight: 1 }],
      })
    );
    expect(shortcutCalls).toHaveLength(0);
    expect(unreadDots(sectionButtons()[2]!)).toHaveLength(1);

    // Selecting the unread room keeps it visible under the collapsed header and clears the dot.
    selected.roomId = readingList;
    rerender();
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      designReview,
      iconSketches,
      readingList,
    ]);
    expect(unreadDots(sectionButtons()[2]!)).toHaveLength(0);
    expect(sectionButtons()[2]!.props['aria-label']).toBeUndefined();
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
    renderSpace([space, joined, design, designReview, iconSketches], {
      [joined]: [space],
      [design]: [space],
      [designReview]: [design],
      [iconSketches]: [design],
    });
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

  it('shows editable empty sub-spaces, reacts to power-level changes, and keeps section headers mounted across toggles', () => {
    const { space, joined, organizer, design, designReview, research, readingList } = rooms.ids;
    const { store } = renderSpace(
      [space, joined, organizer, design, designReview, research, readingList],
      {
        [joined]: [space],
        [organizer]: [space],
        [design]: [space],
        [research]: [organizer],
        [designReview]: [design],
        [readingList]: [research],
      }
    );

    const organizerCategoryId = makeNavCategoryId(space, 'subspace', organizer);
    const researchCategoryId = makeNavCategoryId(space, 'subspace', research);

    // Non-editable empty organizer is hidden without hiding its populated child Research Group.
    expect(sectionButtons().map((node) => node.props['data-category-id'])).toEqual([
      makeNavCategoryId(space, 'room'),
      makeNavCategoryId(space, 'subspace', design),
      researchCategoryId,
    ]);

    // Granting m.space.child permission on the organizer via RoomPowerLevels reveals it immediately.
    editableSpaces.add(organizer);
    act(() => {
      stateListeners.forEach((listener) =>
        listener({ getType: () => 'm.room.power_levels', getRoomId: () => organizer })
      );
    });
    expect(sectionButtons().map((node) => node.props['data-category-id'])).toEqual([
      makeNavCategoryId(space, 'room'),
      makeNavCategoryId(space, 'subspace', design),
      organizerCategoryId,
      researchCategoryId,
    ]);

    // Unread updates while Research Group is expanded do not re-render its header button.
    const rendersBeforeExpandedUnread = categoryButtonStats.renders.get(researchCategoryId) ?? 0;
    act(() =>
      store.set(roomToUnreadAtom, {
        type: 'RESET',
        unreadInfos: [{ roomId: readingList, total: 1, highlight: 0 }],
      })
    );
    expect(categoryButtonStats.renders.get(researchCategoryId)).toBe(rendersBeforeExpandedUnread);

    // Collapsing and re-expanding keeps the same button mounted (preserving keyboard focus).
    const researchButton = () =>
      sectionButtons().find((node) => node.props['data-category-id'] === researchCategoryId)!;
    act(() => {
      researchButton().props.onClick({ currentTarget: { getAttribute: () => researchCategoryId } });
    });
    expect(categoryButtonStats.mounts.get(researchCategoryId)).toBe(1);
    expect(categoryButtonStats.unmounts.get(researchCategoryId) ?? 0).toBe(0);

    // While collapsed with unread, an unrelated unread update does not re-render this header.
    const rendersWhileCollapsed = categoryButtonStats.renders.get(researchCategoryId) ?? 0;
    act(() =>
      store.set(roomToUnreadAtom, {
        type: 'RESET',
        unreadInfos: [
          { roomId: readingList, total: 1, highlight: 0 },
          { roomId: designReview, total: 3, highlight: 0 },
        ],
      })
    );
    expect(categoryButtonStats.renders.get(researchCategoryId)).toBe(rendersWhileCollapsed);

    act(() => {
      researchButton().props.onClick({ currentTarget: { getAttribute: () => researchCategoryId } });
    });
    expect(categoryButtonStats.mounts.get(researchCategoryId)).toBe(1);
    expect(categoryButtonStats.unmounts.get(researchCategoryId) ?? 0).toBe(0);
  });

  it('validates cross-section moves, calls moveSpaceRoom, guards in-flight moves, and appends only to manual targets', async () => {
    const { space, joined, design, designReview, iconSketches, research, readingList, nestedSub } =
      rooms.ids;
    editableSpaces.add(space);
    editableSpaces.add(design);
    editableSpaces.add(research);
    const archivedDesignRoom = '!archived-design:example.org';
    accountData.content = {
      lists: {
        [design]: [iconSketches, archivedDesignRoom, designReview],
      },
    };
    renderSpace(
      [space, joined, design, designReview, iconSketches, research, readingList, nestedSub],
      {
        [joined]: [space],
        [design]: [space],
        [research]: [space],
        [designReview]: [design],
        [iconSketches]: [design],
        [readingList]: [research],
        [nestedSub]: [joined],
      }
    );

    expect(dragGroup.canMoveRoom?.(space, design, joined)).toBe(true);
    expect(dragGroup.canMoveRoom?.(space, space, joined)).toBe(false);
    // Nested chat sub-room is not a direct child of space -> blocked.
    expect(dragGroup.canMoveRoom?.(space, design, nestedSub)).toBe(false);
    // Target space without m.space.child permission -> blocked.
    expect(dragGroup.canMoveRoom?.(space, rooms.ids.organizer, joined)).toBe(false);

    // Moving into an A-Z target (research) calls moveSpaceRoom and leaves account data untouched.
    await act(async () => {
      await dragGroup.onMoveRoom?.(space, research, joined);
    });
    expect(moveSpaceRoomMock).toHaveBeenCalledTimes(1);
    expect(moveSpaceRoomMock).toHaveBeenCalledWith(
      client,
      space,
      expect.objectContaining({ roomId: research }),
      joined
    );
    expect(accountData.setAccountData).not.toHaveBeenCalled();

    // Moving into a manually ordered target (design) preserves hidden/archived saved IDs and
    // appends the moved room once.
    moveSpaceRoomMock.mockClear();
    let resolveMove!: () => void;
    moveSpaceRoomMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveMove = resolve;
        })
    );

    let firstMove!: Promise<void>;
    act(() => {
      firstMove = Promise.resolve(dragGroup.onMoveRoom?.(space, design, joined));
    });
    // While in flight, overlapping moves of the same room are blocked.
    expect(dragGroup.canMoveRoom?.(space, design, joined)).toBe(false);
    await act(async () => {
      await dragGroup.onMoveRoom?.(space, design, joined);
    });
    expect(moveSpaceRoomMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveMove();
      await firstMove;
    });
    expect(accountData.setAccountData).toHaveBeenCalledTimes(1);
    expect(accountData.setAccountData).toHaveBeenCalledWith('io.mindroom.room_order', {
      lists: {
        [design]: [iconSketches, archivedDesignRoom, designReview, joined],
      },
    });
    expect(dragGroup.canMoveRoom?.(space, design, joined)).toBe(true);
  });

  it('gates header + and section + actions by permission and keeps root Rooms + rooms-only', () => {
    const { space, joined, design, designReview } = rooms.ids;

    // Non-editable space and sub-space: no header + button, no section + buttons, sub-space still has options.
    renderSpace([space, joined, design, designReview], {
      [joined]: [space],
      [design]: [space],
      [designReview]: [design],
    });
    expect(
      renderer!.root.findAll(
        (node) =>
          typeof node.type === 'string' && node.props['data-nav-options'] === 'Add to garden'
      )
    ).toHaveLength(0);
    expect(
      renderer!.root.findAll(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Add to Rooms'
      )
    ).toHaveLength(0);
    expect(
      renderer!.root.findAll(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Add to Design Team'
      )
    ).toHaveLength(0);
    expect(
      renderer!.root.findAll(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Design Team options'
      )
    ).toHaveLength(1);

    // Editable root and sub-space: header +, root Rooms + (rooms-only), and sub-space + (all 4 add actions).
    act(() => renderer!.unmount());
    editableSpaces.add(space);
    editableSpaces.add(design);
    renderSpace([space, joined, design, designReview], {
      [joined]: [space],
      [design]: [space],
      [designReview]: [design],
    });

    // Space header ⋮ omits Add entries because + sits directly beside it.
    const headerOptionsMenu = renderer!.root.find(
      (node) => typeof node.type === 'string' && node.props['data-nav-options'] === 'Space Options'
    );
    const headerOptionsEntries = headerOptionsMenu
      .findAll((node) => node.type === 'button' && 'data-menu-entry' in node.props)
      .map((node) => node.props['data-menu-entry']);
    expect(headerOptionsEntries).not.toContain('New Room');
    expect(headerOptionsEntries).toContain('Space Settings');

    // Top-level room rows receive removeFromSpaceId for their own section; sub-room rows do not.
    const joinedRow = renderer!.root.find((node) => node.props['data-row-room'] === joined);
    const designReviewRow = renderer!.root.find(
      (node) => node.props['data-row-room'] === designReview
    );
    expect(joinedRow.props['data-remove-from-space']).toBe(space);
    expect(designReviewRow.props['data-remove-from-space']).toBe(design);
    const subRoomEl = subRooms.renderRoom?.(rooms.of(designReview)) as
      | React.ReactElement<{ removeFromSpaceId?: string; subRoom?: boolean }>
      | undefined;
    expect(subRoomEl?.props.subRoom).toBe(true);
    expect(subRoomEl?.props.removeFromSpaceId).toBeUndefined();

    const headerAddMenu = renderer!.root.find(
      (node) => typeof node.type === 'string' && node.props['data-nav-options'] === 'Add to garden'
    );
    const headerAddEntries = headerAddMenu
      .findAll((node) => node.type === 'button' && 'data-menu-entry' in node.props)
      .map((node) => node.props['data-menu-entry']);
    expect(headerAddEntries).toEqual([
      'New Room',
      'Add Existing Room',
      'New Sub-space',
      'Add Existing Sub-space',
    ]);
    act(() => {
      headerAddMenu
        .find((node) => node.type === 'button' && node.props['data-menu-entry'] === 'New Room')
        .props.onClick();
    });
    expect(openCreateRoomMock).toHaveBeenCalledWith(space);

    // Root Rooms section + opens only the 2 room entries.
    const roomsAddButton = renderer!.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Add to Rooms'
    );
    const rect = { x: 0, y: 0, width: 24, height: 24 };
    act(() => {
      roomsAddButton.props.onClick({ currentTarget: { getBoundingClientRect: () => rect } });
    });
    const roomsPopout = renderer!.root.find(
      (node) => typeof node.type === 'string' && 'data-popout' in node.props
    );
    const roomsAddEntries = roomsPopout
      .findAll((node) => node.type === 'button' && 'data-menu-entry' in node.props)
      .map((node) => node.props['data-menu-entry']);
    expect(roomsAddEntries).toEqual(['New Room', 'Add Existing Room']);

    // Sub-space + opens all 4 entries targeting that sub-space.
    const designAddButton = renderer!.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Add to Design Team'
    );
    act(() => {
      designAddButton.props.onClick({ currentTarget: { getBoundingClientRect: () => rect } });
    });
    const popouts = renderer!.root.findAll(
      (node) => typeof node.type === 'string' && 'data-popout' in node.props
    );
    const designPopout = popouts[popouts.length - 1]!;
    const designAddEntries = designPopout
      .findAll((node) => node.type === 'button' && 'data-menu-entry' in node.props)
      .map((node) => node.props['data-menu-entry']);
    expect(designAddEntries).toEqual([
      'New Room',
      'Add Existing Room',
      'New Sub-space',
      'Add Existing Sub-space',
    ]);
    act(() => {
      designPopout
        .find((node) => node.type === 'button' && node.props['data-menu-entry'] === 'New Sub-space')
        .props.onClick();
    });
    expect(openCreateSpaceMock).toHaveBeenCalledWith(design);
  });

  it('targets the immediate nested parent space in sub-space Remove from menu', () => {
    const { space, joined, organizer, research, readingList } = rooms.ids;
    editableSpaces.add(space);
    editableSpaces.add(organizer);
    editableSpaces.add(research);
    renderSpace([space, joined, organizer, research, readingList], {
      [joined]: [space],
      [organizer]: [space],
      [research]: [organizer],
      [readingList]: [research],
    });

    const researchOptionsButton = renderer!.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Research Group options'
    );
    const rect = { x: 0, y: 0, width: 24, height: 24 };
    act(() => {
      researchOptionsButton.props.onClick({
        currentTarget: { getBoundingClientRect: () => rect },
      });
    });

    const popout = renderer!.root.find(
      (node) => typeof node.type === 'string' && 'data-popout' in node.props
    );
    const removeEntry = popout.find(
      (node) => node.type === 'button' && node.props['data-menu-entry'] === 'Remove from Operations'
    );
    act(() => {
      removeEntry.props.onClick();
    });
    expect(removeSpaceChildMock).toHaveBeenCalledTimes(1);
    expect(removeSpaceChildMock).toHaveBeenCalledWith(client, organizer, research);

    // When the immediate parent (Operations) is NOT editable (even if root is editable),
    // Remove from Operations is hidden.
    act(() => renderer!.unmount());
    editableSpaces.delete(organizer);
    renderSpace([space, joined, organizer, research, readingList], {
      [joined]: [space],
      [organizer]: [space],
      [research]: [organizer],
      [readingList]: [research],
    });
    const researchOptionsReadonlyParent = renderer!.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Research Group options'
    );
    act(() => {
      researchOptionsReadonlyParent.props.onClick({
        currentTarget: { getBoundingClientRect: () => rect },
      });
    });
    const readonlyPopout = renderer!.root.find(
      (node) => typeof node.type === 'string' && 'data-popout' in node.props
    );
    expect(
      readonlyPopout.findAll(
        (node) =>
          node.type === 'button' &&
          typeof node.props['data-menu-entry'] === 'string' &&
          node.props['data-menu-entry'].startsWith('Remove from')
      )
    ).toHaveLength(0);
  });

  it('opens header context menus on right-click and marks empty editable sections subtly visible', () => {
    const { space, joined, organizer, design, designReview } = rooms.ids;
    editableSpaces.add(organizer);
    editableSpaces.add(design);
    renderSpace([space, joined, organizer, design, designReview], {
      [joined]: [space],
      [organizer]: [space],
      [design]: [space],
      [designReview]: [design],
    });

    const headers = renderer!.root.findAll(
      (node) => typeof node.type === 'string' && 'data-nav-category-header' in node.props
    );
    // Root Rooms is NOT editable here -> no onContextMenu handler attached.
    expect(headers[0]!.props.onContextMenu).toBeUndefined();

    // Right-clicking Design Team header opens its sub-space options menu.
    const preventDefault = vi.fn();
    act(() => {
      headers[1]!.props.onContextMenu({
        preventDefault,
        clientX: 40,
        clientY: 80,
        nativeEvent: { pointerType: 'mouse' },
      });
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    const designPopout = renderer!.root.find(
      (node) => typeof node.type === 'string' && 'data-popout' in node.props
    );
    const designLabels = designPopout
      .findAll((node) => node.type === 'button' && 'data-menu-entry' in node.props)
      .map((node) => node.props['data-menu-entry']);
    // Right-clicking a sub-space header opens the full context menu (Add + management).
    expect(designLabels).toContain('New Room');
    expect(designLabels).toContain('Space Settings');
    expect(designLabels).toContain('Leave Space');

    // Clicking sub-space ⋮ on a hover-capable mouse omits Add; touch pointerType includes Add.
    const designOptionsButton = renderer!.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Design Team options'
    );
    const rect = { x: 0, y: 0, width: 24, height: 24 };
    act(() => {
      designOptionsButton.props.onClick({
        currentTarget: { getBoundingClientRect: () => rect },
        nativeEvent: { pointerType: 'mouse' },
      });
    });
    const desktopOptionsLabels = renderer!.root
      .find((node) => typeof node.type === 'string' && 'data-popout' in node.props)
      .findAll((node) => node.type === 'button' && 'data-menu-entry' in node.props)
      .map((node) => node.props['data-menu-entry']);
    expect(desktopOptionsLabels).not.toContain('New Room');
    expect(desktopOptionsLabels).toContain('Space Settings');

    act(() => {
      designOptionsButton.props.onClick({
        currentTarget: { getBoundingClientRect: () => rect },
        nativeEvent: { pointerType: 'touch' },
      });
    });
    const touchOptionsLabels = renderer!.root
      .find((node) => typeof node.type === 'string' && 'data-popout' in node.props)
      .findAll((node) => node.type === 'button' && 'data-menu-entry' in node.props)
      .map((node) => node.props['data-menu-entry']);
    expect(touchOptionsLabels).toContain('New Room');
    expect(touchOptionsLabels).toContain('Space Settings');

    // Non-hover devices (matchMedia '(hover: none)') also open the full menu from ⋮.
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === '(hover: none)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
    try {
      act(() => {
        designOptionsButton.props.onClick({
          currentTarget: { getBoundingClientRect: () => rect },
          nativeEvent: { pointerType: '' },
        });
      });
      const noHoverOptionsLabels = renderer!.root
        .find((node) => typeof node.type === 'string' && 'data-popout' in node.props)
        .findAll((node) => node.type === 'button' && 'data-menu-entry' in node.props)
        .map((node) => node.props['data-menu-entry']);
      expect(noHoverOptionsLabels).toContain('New Room');
    } finally {
      window.matchMedia = originalMatchMedia;
    }

    // Editable empty Operations keeps a subtly-visible class on its + button, unlike populated Design Team.
    const opsAddButton = renderer!.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Add to Operations'
    );
    const designAddButton = renderer!.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Add to Design Team'
    );
    expect(String(opsAddButton.props.className).length).toBeGreaterThan(
      String(designAddButton.props.className).length
    );

    // Making root space editable enables right-click on root Rooms header (rooms-only Add menu).
    act(() => renderer!.unmount());
    editableSpaces.add(space);
    renderSpace([space, joined, organizer, design, designReview], {
      [joined]: [space],
      [organizer]: [space],
      [design]: [space],
      [designReview]: [design],
    });
    const editableHeaders = renderer!.root.findAll(
      (node) => typeof node.type === 'string' && 'data-nav-category-header' in node.props
    );
    const preventRoot = vi.fn();
    act(() => {
      editableHeaders[0]!.props.onContextMenu({
        preventDefault: preventRoot,
        clientX: 20,
        clientY: 30,
        nativeEvent: { pointerType: 'mouse' },
      });
    });
    expect(preventRoot).toHaveBeenCalledTimes(1);
    const rootPopout = renderer!.root.find(
      (node) => typeof node.type === 'string' && 'data-popout' in node.props
    );
    expect(
      rootPopout
        .findAll((node) => node.type === 'button' && 'data-menu-entry' in node.props)
        .map((node) => node.props['data-menu-entry'])
    ).toEqual(['New Room', 'Add Existing Room']);
  });
});
