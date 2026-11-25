// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import { RelationType, RoomEvent, RoomStateEvent } from 'matrix-js-sdk';
import { matchesEnum } from '../../lib/matchesEnum';
import { Space } from './Space';
import { type RenderedSpaceRoomSection, SpaceRoomSection } from './SpaceRoomSection';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { roomToUnreadAtom } from '../../matrix/state/roomToUnread';
import { makeClosedNavCategoriesAtom, makeNavCategoryId } from '../../ui/nav/closedNavCategories';
import { ClosedNavCategoriesProvider } from '../../ui/nav/useClosedNavCategories';
import { getHomeRoomPath, getSpaceRoomPath } from '../../routes/pathUtils';

// Integration tests for Space sidebar navigation: inline collapsible sub-space sections, persisted
// collapse state, scoped collapsed unread indicators, single shortcut hook, and atomic sort reset.

const {
  accountData,
  activeSpace,
  activityByRoom,
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
  timelineListeners,
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
  const activity = new Map<string, number>();
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
      getLastActiveTimestamp: () => activity.get(roomId) ?? 0,
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
  const timeline = new Set<(...args: unknown[]) => void>();
  return {
    rooms: { ids, of: roomOf },
    activeSpace: { roomId: ids.space },
    activityByRoom: activity,
    editableSpaces: editable,
    stateListeners: listeners,
    timelineListeners: timeline,
    moveSpaceRoomMock: vi.fn(async (): Promise<void> => undefined),
    removeSpaceChildMock: vi.fn(async (): Promise<void> => undefined),
    openCreateRoomMock: vi.fn(),
    openCreateSpaceMock: vi.fn(),
    dragGroup: {
      canMoveRoom: undefined as
        ((sourceSpaceId: string, targetSpaceId: string, roomId: string) => boolean) | undefined,
      onMoveRoom: undefined as
        | ((sourceSpaceId: string, targetSpaceId: string, roomId: string) => void | Promise<void>)
        | undefined,
    },
    categoryButtonStats: {
      mounts: new Map<string, number>(),
      unmounts: new Map<string, number>(),
      renders: new Map<string, number>(),
    },
    subRooms: {
      renderRoom: undefined as ((room: unknown) => React.ReactNode) | undefined,
      previewPath: undefined as ((roomId: string) => string) | undefined,
    },
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
    if (matchesEnum(event, RoomEvent.Timeline)) timelineListeners.add(listener);
  },
  off: (event: string, listener: (...args: unknown[]) => void) => {
    if (matchesEnum(event, RoomStateEvent.Events)) stateListeners.delete(listener);
    if (matchesEnum(event, RoomEvent.Timeline)) timelineListeners.delete(listener);
  },
  removeListener: (event: string, listener: (...args: unknown[]) => void) => {
    if (matchesEnum(event, RoomStateEvent.Events)) stateListeners.delete(listener);
    if (matchesEnum(event, RoomEvent.Timeline)) timelineListeners.delete(listener);
  },
};

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
  useMatch: () => null,
}));
vi.mock('focus-trap-react', () => ({ FocusTrap: passthrough }));
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
  NavCategoryHeader: function MockNavCategoryHeader({
    children,
    ref,
    ...props
  }: Record<string, unknown> & { ref?: React.Ref<HTMLDivElement> }) {
    return (
      <div ref={ref} data-nav-category-header {...props}>
        {children as React.ReactNode}
      </div>
    );
  },
}));
vi.mock('../../ui/directional', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui/directional')>()),
  PopOut: ({ anchor, content }: { anchor?: unknown; content?: React.ReactNode }) =>
    anchor ? <div data-popout>{content}</div> : null,
}));
vi.mock('../../ui/nav/NavOptionsMenu', () => ({
  NavOptionsMenu: ({
    label,
    active,
    children,
  }: {
    label: string;
    active?: boolean;
    children: (close: () => void) => React.ReactNode;
  }) => (
    <div data-nav-options={label} aria-label={label} data-active={active ? 'true' : undefined}>
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
  RoomNavCategoryButton: function MockRoomNavCategoryButton({
    closed,
    ownDirection,
    after,
    children,
    ref,
    ...props
  }: React.ComponentPropsWithRef<'button'> & {
    closed?: boolean;
    ownDirection?: boolean;
    after?: React.ReactNode;
    children?: React.ReactNode;
    'data-category-id'?: string;
  }) {
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
  },
}));
// The rows under a room read its state, which these rooms do not have; how Space draws them is kept.
vi.mock('../room-nav/SubRoomRows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../room-nav/SubRoomRows')>()),
  SubRoomRows: ({
    renderRoom,
    previewPath,
  }: {
    renderRoom: (room: unknown) => React.ReactNode;
    previewPath: (roomId: string) => string;
  }) => {
    subRooms.renderRoom = renderRoom;
    subRooms.previewPath = previewPath;
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
  SortableRoomList: ({
    listId,
    reorderDisabled,
    children,
  }: {
    listId: string;
    reorderDisabled?: boolean;
    children?: React.ReactNode;
  }) => (
    <div data-sortable-list={listId} data-reorder-disabled={String(Boolean(reorderDisabled))}>
      {children}
    </div>
  ),
  SortableRoomRow: ({
    room,
    linkPath,
    spaceId,
    removeFromSpaceId,
    subRoom,
    activityTimestamp,
  }: {
    room: { roomId: string };
    linkPath: string;
    spaceId?: string;
    removeFromSpaceId?: string;
    subRoom?: boolean;
    activityTimestamp?: number;
  }) => (
    <div
      data-row-room={room.roomId}
      data-sortable-row
      data-link={linkPath}
      data-space={spaceId}
      data-remove-from-space={removeFromSpaceId}
      data-sub-room={subRoom}
      data-activity-ts={activityTimestamp}
    />
  ),
}));
vi.mock('../room-nav/RoomNavItem', () => ({
  RoomNavItem: ({
    room,
    selected: isSelected,
    linkPath,
    spaceId,
    removeFromSpaceId,
    subRoom,
    activityTimestamp,
  }: {
    room: { roomId: string };
    selected?: boolean;
    linkPath: string;
    spaceId?: string;
    removeFromSpaceId?: string;
    subRoom?: boolean;
    activityTimestamp?: number;
  }) => (
    <div
      data-row-room={room.roomId}
      data-static-row
      data-selected={isSelected ? 'true' : undefined}
      data-link={linkPath}
      data-space={spaceId}
      data-remove-from-space={removeFromSpaceId}
      data-sub-room={subRoom}
      data-activity-ts={activityTimestamp}
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
  useSpace: () => rooms.of(activeSpace.roomId),
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
    activeSpace.roomId = rooms.ids.space;
    activityByRoom.clear();
    editableSpaces.clear();
    stateListeners.clear();
    timelineListeners.clear();
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

  const textOf = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map((child) => textOf(child)).join(' ');

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

  it('switches sort modes via the Space header Sort rooms menu while preserving saved custom order', () => {
    const { space, joined, invited, design, designReview, iconSketches } = rooms.ids;
    accountData.content = {
      lists: {
        [space]: [joined, invited],
        '!unrelated:example.org': ['!other:example.org'],
      },
    };
    renderSpace([space, joined, invited, design, designReview, iconSketches], {
      [joined]: [space],
      [invited]: [space],
      [design]: [space],
      [designReview]: [design],
      [iconSketches]: [design],
    });
    // Legacy lists-only data resolves space to manual: seedlings (joined) before compost (invited).
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      invited,
      designReview,
      iconSketches,
    ]);

    const headerSortMenu = () => renderer!.root.findByProps({ 'data-nav-options': 'Sort rooms' });

    // Switch Space to A to Z: compost (invited) sorts before seedlings (joined), lists stay intact.
    const aToZ = headerSortMenu().find(
      (node) => node.props.role === 'menuitemradio' && textOf(node).includes('A to Z')
    );
    act(() => {
      aToZ.props.onClick();
    });

    expect(accountData.setAccountData).toHaveBeenCalledWith('io.mindroom.room_order', {
      lists: {
        [space]: [joined, invited],
        '!unrelated:example.org': ['!other:example.org'],
      },
      modes: { [space]: 'name' },
    });
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      invited,
      joined,
      designReview,
      iconSketches,
    ]);

    // Switching back to Custom order restores the preserved custom list without losing it.
    const custom = headerSortMenu().find(
      (node) => node.props.role === 'menuitemradio' && textOf(node).includes('Custom order')
    );
    expect(textOf(custom)).toContain('Saved');
    act(() => {
      custom.props.onClick();
    });
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      invited,
      designReview,
      iconSketches,
    ]);
  });

  it('sorts by Recent activity with sub-room lifting, live timeline updates ignoring edits/backfill, and sub-space overrides', () => {
    const { space, joined, invited, nestedSub, design, designReview, iconSketches } = rooms.ids;
    activityByRoom.set(invited, 2000);
    activityByRoom.set(joined, 1000);
    activityByRoom.set(nestedSub, 5000); // Newer sub-room lifts joined above invited.
    activityByRoom.set(designReview, 1500);
    activityByRoom.set(iconSketches, 4000);

    renderSpace([space, joined, invited, nestedSub, design, designReview, iconSketches], {
      [joined]: [space],
      [invited]: [space],
      [nestedSub]: [joined],
      [design]: [space],
      [designReview]: [design],
      [iconSketches]: [design],
    });
    expect(timelineListeners.size).toBe(0);

    // Enable Show activity times and switch to Recent activity via the Space header Sort rooms menu.
    const headerSortMenu = () => renderer!.root.findByProps({ 'data-nav-options': 'Sort rooms' });
    const showTimesRow = headerSortMenu().find((node) => node.props.role === 'menuitemcheckbox');
    act(() => {
      showTimesRow.props.onClick();
    });
    const recentItem = headerSortMenu().find(
      (node) => node.props.role === 'menuitemradio' && textOf(node).includes('Recent activity')
    );
    act(() => {
      recentItem.props.onClick();
    });

    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      invited,
      iconSketches,
      designReview,
    ]);
    expect(
      renderer!.root.findByProps({ 'data-sortable-list': space }).props['data-reorder-disabled']
    ).toBe('true');
    expect(
      renderer!.root.findByProps({ 'data-sortable-list': design }).props['data-reorder-disabled']
    ).toBe('true');
    expect(
      rows().find((node) => node.props['data-row-room'] === invited)!.props['data-activity-ts']
    ).toBe(2000);
    expect(timelineListeners.size).toBe(1);

    // Backfill, non-live events, m.replace edits, and state events do NOT move invited above joined.
    activityByRoom.set(invited, 9000);
    const emitTimeline = (
      roomId: string,
      opts: {
        type?: string;
        stateKey?: string;
        replace?: boolean;
        redaction?: boolean;
        backfill?: boolean;
        live?: boolean;
      }
    ) => {
      const event = {
        getType: () => opts.type ?? (opts.redaction ? 'm.room.redaction' : 'm.room.message'),
        getStateKey: () => opts.stateKey,
        getRelation: () => (opts.replace ? { rel_type: RelationType.Replace } : null),
        isRedacted: () => false,
        isRedaction: () => Boolean(opts.redaction),
      };
      act(() => {
        timelineListeners.forEach((fn) =>
          fn(event, rooms.of(roomId), Boolean(opts.backfill), false, {
            liveEvent: opts.live ?? true,
          })
        );
      });
    };
    emitTimeline(invited, { backfill: true });
    emitTimeline(invited, { live: false });
    emitTimeline(invited, { replace: true });
    emitTimeline(invited, { type: 'com.example.room_features', stateKey: '' });
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      invited,
      iconSketches,
      designReview,
    ]);

    // Real live message moves invited above joined.
    emitTimeline(invited, { live: true });
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      invited,
      joined,
      iconSketches,
      designReview,
    ]);

    // Open sub-space Design Team options menu: Match space (Recent) is checked.
    const openDesignOptions = () => {
      const btn = renderer!.root.find(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Design Team options'
      );
      act(() => {
        btn.props.onClick({
          nativeEvent: { pointerType: 'mouse' },
          currentTarget: { getBoundingClientRect: () => ({ x: 0, y: 0, width: 24, height: 24 }) },
        });
      });
    };
    const subMenu = () => renderer!.root.findByProps({ 'data-popout': true });
    openDesignOptions();
    const matchSpaceRadio = subMenu().find(
      (node) => node.props.role === 'menuitemradio' && textOf(node).includes('Match space (Recent)')
    );
    expect(matchSpaceRadio.props['aria-checked']).toBe(true);

    // Override Design Team: turn off Show activity times (explicit false) and set A to Z.
    const subShowTimes = subMenu().find((node) => node.props.role === 'menuitemcheckbox');
    act(() => {
      subShowTimes.props.onClick();
    });
    const subAToZ = subMenu().find(
      (node) => node.props.role === 'menuitemradio' && textOf(node).includes('A to Z')
    );
    act(() => {
      subAToZ.props.onClick();
    });

    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      invited,
      joined,
      designReview,
      iconSketches,
    ]);
    expect(
      renderer!.root.findByProps({ 'data-sortable-list': design }).props['data-reorder-disabled']
    ).toBe('false');
    expect(
      rows().find((node) => node.props['data-row-room'] === designReview)!.props['data-activity-ts']
    ).toBeUndefined();
    expect(
      rows().find((node) => node.props['data-row-room'] === invited)!.props['data-activity-ts']
    ).toBe(9000);

    // Reset Design Team back via "Match space (Recent)".
    openDesignOptions();
    const resetMatch = subMenu().find(
      (node) => node.props.role === 'menuitemradio' && textOf(node).includes('Match space (Recent)')
    );
    expect(resetMatch.props['aria-checked']).toBe(false);
    act(() => {
      resetMatch.props.onClick();
    });

    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      invited,
      joined,
      iconSketches,
      designReview,
    ]);
    expect(
      rows().find((node) => node.props['data-row-room'] === iconSketches)!.props['data-activity-ts']
    ).toBe(4000);
  });

  it('inherits sort mode and showTimes from the parent space when viewing a sub-space standalone', () => {
    const { space, design, designReview, iconSketches } = rooms.ids;
    activeSpace.roomId = design;
    accountData.content = {
      modes: { [space]: 'recent' },
      showTimes: { [space]: true },
    };
    activityByRoom.set(designReview, 1000);
    activityByRoom.set(iconSketches, 4000);

    renderSpace([space, design, designReview, iconSketches], {
      [design]: [space],
      [designReview]: [design],
      [iconSketches]: [design],
    });

    expect(rows().map((node) => node.props['data-row-room'])).toEqual([iconSketches, designReview]);
    expect(
      rows().find((node) => node.props['data-row-room'] === iconSketches)!.props['data-activity-ts']
    ).toBe(4000);
    const sortMenu = renderer!.root.findByProps({ 'data-nav-options': 'Sort rooms' });
    expect(sortMenu.props['data-active']).toBe('true');
  });

  it('inherits sort mode and showTimes across a hidden empty organizer sub-space', () => {
    const { space, organizer, research, readingList, interviews } = rooms.ids;
    // Organizer is empty and non-editable (hidden from rendered sections), while Research sits under it.
    accountData.content = {
      modes: { [space]: 'recent' },
      showTimes: { [space]: true },
    };
    // A to Z order in research: Field Interviews, Reading List. Recent order reverses them.
    activityByRoom.set(interviews, 1000);
    activityByRoom.set(readingList, 5000);

    renderSpace([space, organizer, research, readingList, interviews], {
      [organizer]: [space],
      [research]: [organizer],
      [readingList]: [research],
      [interviews]: [research],
    });

    // Organizer is hidden, yet Research inherits Recent and showTimes from root space!
    expect(sectionButtons().map((node) => textOf(node))).toEqual(['Research Group']);
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([readingList, interviews]);
    expect(
      renderer!.root.findByProps({ 'data-sortable-list': research }).props['data-reorder-disabled']
    ).toBe('true');
    expect(
      rows().find((node) => node.props['data-row-room'] === readingList)!.props['data-activity-ts']
    ).toBe(5000);
  });

  it('shows editable empty sub-spaces, reacts to power-level changes, nests sub-spaces, and keeps headers mounted across toggles', () => {
    const { space, joined, organizer, design, designReview, research, readingList } = rooms.ids;
    const { store, rerender } = renderSpace(
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
    const headingLevelOf = (categoryId: string) =>
      renderer!.root
        .findAll(
          (node) => typeof node.type === 'string' && 'data-nav-category-header' in node.props
        )
        .find(
          (header) =>
            header.findAll(
              (child) => child.type === 'button' && child.props['data-category-id'] === categoryId
            ).length > 0
        )?.props['aria-level'];
    expect(headingLevelOf(organizerCategoryId)).toBe(3);
    expect(headingLevelOf(researchCategoryId)).toBe(4);

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
    const mountsBeforeToggle = categoryButtonStats.mounts.get(researchCategoryId) ?? 0;
    const unmountsBeforeToggle = categoryButtonStats.unmounts.get(researchCategoryId) ?? 0;
    act(() => {
      researchButton().props.onClick({ currentTarget: { getAttribute: () => researchCategoryId } });
    });
    expect(categoryButtonStats.mounts.get(researchCategoryId)).toBe(mountsBeforeToggle);
    expect(categoryButtonStats.unmounts.get(researchCategoryId) ?? 0).toBe(unmountsBeforeToggle);

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
    expect(categoryButtonStats.mounts.get(researchCategoryId)).toBe(mountsBeforeToggle);
    expect(categoryButtonStats.unmounts.get(researchCategoryId) ?? 0).toBe(unmountsBeforeToggle);

    // Collapsing the parent organizer hides nested Research Group headers, rolls up its unread
    // dot, and keeps only the active descendant room row visible (preserving its owning space).
    const organizerButton = () =>
      sectionButtons().find((node) => node.props['data-category-id'] === organizerCategoryId)!;
    act(() => {
      organizerButton().props.onClick({ currentTarget: { getAttribute: () => organizerCategoryId } });
    });
    expect(sectionButtons().map((node) => node.props['data-category-id'])).toEqual([
      makeNavCategoryId(space, 'room'),
      makeNavCategoryId(space, 'subspace', design),
      organizerCategoryId,
    ]);
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([joined, designReview]);
    expect(shortcutCalls.at(-1)).toEqual([joined, designReview]);
    expect(unreadDots(organizerButton())).toHaveLength(1);

    selected.roomId = readingList;
    rerender();
    expect(sectionButtons().map((node) => node.props['data-category-id'])).toEqual([
      makeNavCategoryId(space, 'room'),
      makeNavCategoryId(space, 'subspace', design),
      organizerCategoryId,
    ]);
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      designReview,
      readingList,
    ]);
    const retainedRow = rows().find((node) => node.props['data-row-room'] === readingList)!;
    expect(retainedRow.props['data-remove-from-space']).toBe(research);
    expect(retainedRow.props['data-selected']).toBe('true');
    // Retained descendant row renders as a plain non-draggable RoomNavItem (not inside a
    // SortableRoomList), so dragging and releasing it cannot trigger onMoveRoom into organizer.
    expect(retainedRow.props['data-static-row']).toBe(true);
    expect(retainedRow.props['data-sortable-row']).toBeUndefined();
    expect(
      renderer!.root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          'data-sortable-list' in node.props &&
          node.findAll(
            (child) =>
              typeof child.type === 'string' && child.props['data-row-room'] === readingList
          ).length > 0
      )
    ).toHaveLength(0);
    expect(
      renderer!.root.findAll(
        (node) =>
          typeof node.type === 'string' &&
          (node.props['data-sortable-list'] === organizer ||
            node.props['data-sortable-list'] === research)
      )
    ).toHaveLength(0);
    expect(shortcutCalls.at(-1)).toEqual([joined, designReview, readingList]);
    expect(unreadDots(organizerButton())).toHaveLength(0);

    // Expanding the parent restores nested Research Group and its sortable room row cleanly.
    act(() => {
      organizerButton().props.onClick({ currentTarget: { getAttribute: () => organizerCategoryId } });
    });
    expect(sectionButtons().map((node) => node.props['data-category-id'])).toEqual([
      makeNavCategoryId(space, 'room'),
      makeNavCategoryId(space, 'subspace', design),
      organizerCategoryId,
      researchCategoryId,
    ]);
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([
      joined,
      designReview,
      readingList,
    ]);
    const expandedRow = rows().find((node) => node.props['data-row-room'] === readingList)!;
    expect(expandedRow.props['data-sortable-row']).toBe(true);
    expect(expandedRow.props['data-static-row']).toBeUndefined();

    // Collapsing again after selection moves elsewhere hides the descendant row completely.
    selected.roomId = undefined;
    rerender();
    act(() => {
      organizerButton().props.onClick({ currentTarget: { getAttribute: () => organizerCategoryId } });
    });
    expect(sectionButtons().map((node) => node.props['data-category-id'])).toEqual([
      makeNavCategoryId(space, 'room'),
      makeNavCategoryId(space, 'subspace', design),
      organizerCategoryId,
    ]);
    expect(rows().map((node) => node.props['data-row-room'])).toEqual([joined, designReview]);
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
      React.ReactElement<{ removeFromSpaceId?: string; subRoom?: boolean }> | undefined;
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

  it('opens header context menus on right-click and distinguishes desktop vs touch options', () => {
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

  it('supports Home roomPath, showOverview, pinMode, and optional sort.inherit on SpaceRoomSection', () => {
    const { space, joined, design, designReview } = rooms.ids;
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [space, joined, design, designReview] });
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([
        [joined, new Set([space])],
        [design, new Set([space])],
        [designReview, new Set([design])],
      ]),
    });
    const closedAtom = makeClosedNavCategoriesAtom('@alice:example.org');
    const makeSection = (
      spaceId: string,
      roomId: string,
      parentSpaceId?: string
    ): RenderedSpaceRoomSection => ({
      spaceId,
      isRoot: false,
      parentSpaceId,
      ancestorSpaceIds: parentSpaceId ? [parentSpaceId] : [],
      isEmpty: false,
      categoryId: makeNavCategoryId('home', 'space', spaceId),
      ownRoomsByName: [roomId],
      scopeRoomsByName: [roomId],
      closed: false,
      tree: { top: [roomId], children: new Map() },
      orderedTop: [roomId],
      shownRoomIds: [roomId],
      listedRoomIds: [roomId],
      mode: 'name',
      showTimes: false,
      inheritFrom: parentSpaceId ? [parentSpaceId] : undefined,
      sort: {
        mode: 'name',
        inherit: parentSpaceId ? { mode: 'name', overridden: false, onReset: vi.fn() } : undefined,
        showTimes: false,
        hasSavedOrder: false,
        onModeChange: vi.fn(),
        onShowTimesChange: vi.fn(),
      },
    });

    const topSection = makeSection(space, joined);
    const subSection = makeSection(design, designReview, space);

    act(() => {
      renderer = create(
        <Provider store={store}>
          <ClosedNavCategoriesProvider value={closedAtom}>
            <SpaceRoomSection
              section={topSection}
              spaceId={space}
              spaceIdOrAlias={space}
              selectedRoomId={undefined}
              onCategoryClick={vi.fn()}
              onReorder={vi.fn()}
              roomPath={getHomeRoomPath}
              showOverview
              pinMode={undefined}
            />
            <SpaceRoomSection
              section={subSection}
              spaceId={design}
              spaceIdOrAlias={design}
              selectedRoomId={undefined}
              onCategoryClick={vi.fn()}
              onReorder={vi.fn()}
              roomPath={getHomeRoomPath}
              showOverview
              pinMode="toggle"
            />
          </ClosedNavCategoriesProvider>
        </Provider>
      );
    });

    // Rows link to /home/<room>, omit spaceId (so actions stay in Home), and keep removeFromSpaceId.
    expect(
      rows().map((node) => ({
        room: node.props['data-row-room'],
        link: node.props['data-link'],
        spaceId: node.props['data-space'],
        removeFromSpaceId: node.props['data-remove-from-space'],
      }))
    ).toEqual([
      { room: joined, link: getHomeRoomPath(joined), spaceId: undefined, removeFromSpaceId: space },
      {
        room: designReview,
        link: getHomeRoomPath(designReview),
        spaceId: undefined,
        removeFromSpaceId: design,
      },
    ]);
    expect(subRooms.previewPath?.(designReview)).toBe(getHomeRoomPath(designReview));

    const rect = { x: 0, y: 0, width: 24, height: 24 };

    // Top-level Home space section: shows Space overview, omits Match space and Pin/Unpin.
    const topOptions = renderer!.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'garden options'
    );
    act(() => {
      topOptions.props.onClick({
        currentTarget: { getBoundingClientRect: () => rect },
        nativeEvent: { pointerType: 'mouse' },
      });
    });
    const topPopout = renderer!.root.find(
      (node) => typeof node.type === 'string' && 'data-popout' in node.props
    );
    const topRadios = topPopout
      .findAll((node) => node.props.role === 'menuitemradio')
      .map((node) => textOf(node));
    const topEntries = topPopout
      .findAll((node) => node.type === 'button' && 'data-menu-entry' in node.props)
      .map((node) => node.props['data-menu-entry']);
    expect(topRadios.some((label) => label.includes('Match space'))).toBe(false);
    expect(topEntries).toContain('Space overview');
    expect(topEntries).not.toContain('Pin to Sidebar');
    expect(topEntries).not.toContain('Unpin from Sidebar');

    // Sub-space Home section: shows Space overview, Match space, and Pin to Sidebar.
    const subOptions = renderer!.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Design Team options'
    );
    act(() => {
      subOptions.props.onClick({
        currentTarget: { getBoundingClientRect: () => rect },
        nativeEvent: { pointerType: 'mouse' },
      });
    });
    const subPopout = renderer!.root.findAll(
      (node) => typeof node.type === 'string' && 'data-popout' in node.props
    )[1]!;
    const subRadios = subPopout
      .findAll((node) => node.props.role === 'menuitemradio')
      .map((node) => textOf(node));
    const subEntries = subPopout
      .findAll((node) => node.type === 'button' && 'data-menu-entry' in node.props)
      .map((node) => node.props['data-menu-entry']);
    expect(subRadios.some((label) => label.includes('Match space'))).toBe(true);
    expect(subEntries).toContain('Space overview');
    expect(subEntries).toContain('Pin to Sidebar');
  });

  it('renders quiet unread and highlight dots on collapsed Home SpaceRoomSection with subtree roll-up', () => {
    const { space, joined, design, designReview } = rooms.ids;
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [space, joined, design, designReview] });
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
    store.set(roomToParentsAtom, { type: 'INITIALIZE', roomToParents: new Map() });
    store.set(roomToUnreadAtom, {
      type: 'RESET',
      unreadInfos: [{ roomId: designReview, total: 1, highlight: 0 }],
    });
    const closedAtom = makeClosedNavCategoriesAtom('@alice:example.org');
    const collapsedTop: RenderedSpaceRoomSection = {
      spaceId: space,
      isRoot: false,
      parentSpaceId: undefined,
      ancestorSpaceIds: [],
      isEmpty: false,
      categoryId: makeNavCategoryId('home', 'space', space),
      ownRoomsByName: [joined],
      scopeRoomsByName: [joined],
      closed: true,
      tree: { top: [joined], children: new Map() },
      orderedTop: [joined],
      shownRoomIds: [joined],
      listedRoomIds: [],
      mode: 'name',
      showTimes: false,
      inheritFrom: undefined,
    };

    act(() => {
      renderer = create(
        <Provider store={store}>
          <ClosedNavCategoriesProvider value={closedAtom}>
            <SpaceRoomSection
              section={collapsedTop}
              subtreeShownRoomIds={[joined, designReview]}
              spaceId={space}
              spaceIdOrAlias={space}
              selectedRoomId={undefined}
              onCategoryClick={vi.fn()}
              onReorder={vi.fn()}
              roomPath={getHomeRoomPath}
              showOverview
              quietUnread
            />
          </ClosedNavCategoriesProvider>
        </Provider>
      );
    });

    // Plain unread rolled up from nested sub-space: data-unread present, no data-highlight.
    const plainDot = unreadDots(sectionButtons()[0]!);
    expect(plainDot).toHaveLength(1);
    expect(plainDot[0]!.props['data-highlight']).toBeUndefined();

    // Upgrading to a mention sets data-highlight="true".
    act(() =>
      store.set(roomToUnreadAtom, {
        type: 'RESET',
        unreadInfos: [{ roomId: designReview, total: 2, highlight: 1 }],
      })
    );
    const highlightDot = unreadDots(sectionButtons()[0]!);
    expect(highlightDot).toHaveLength(1);
    expect(highlightDot[0]!.props['data-highlight']).toBe('true');
  });
});
