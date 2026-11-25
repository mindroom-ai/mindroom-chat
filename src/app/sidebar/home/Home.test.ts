import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import type { RoomToParents } from '../../matrix/types/room';
import {
  type ClosedNavCategoriesAtom,
  makeClosedNavCategoriesAtom,
} from '../../ui/nav/closedNavCategories';
import { Home } from './Home';

const {
  navigate,
  screen,
  sortState,
  roomsById,
  groupProps,
  sectionDropIds,
  closedState,
} = vi.hoisted(() => {
  const sort: {
    mode: 'recent' | 'name' | 'manual';
    showTimes: boolean;
    savedList: string[] | undefined;
    setMode: ReturnType<typeof vi.fn>;
    setShowTimes: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  } = {
    mode: 'name',
    showTimes: false,
    savedList: undefined,
    setMode: vi.fn(),
    setShowTimes: vi.fn(),
    save: vi.fn(),
  };
  return {
    navigate: vi.fn(),
    screen: { size: 'Desktop' },
    sortState: sort,
    groupProps: [] as Array<{ canMoveRoom?: unknown; onMoveRoom?: unknown }>,
    sectionDropIds: [] as string[],
    closedState: { atom: undefined as ClosedNavCategoriesAtom | undefined },
    roomsById: new Map<
      string,
      { roomId: string; name: string; lastActive: number; space?: boolean }
    >([
      ['!room:example.org', { roomId: '!room:example.org', name: 'Alpha', lastActive: 1000 }],
      ['!beta:example.org', { roomId: '!beta:example.org', name: 'Beta', lastActive: 3000 }],
      [
        '!work:example.org',
        { roomId: '!work:example.org', name: 'Work', lastActive: 0, space: true },
      ],
      [
        '!design:example.org',
        { roomId: '!design:example.org', name: 'Design Team', lastActive: 0, space: true },
      ],
      [
        '!planning:example.org',
        { roomId: '!planning:example.org', name: 'Weekly Planning', lastActive: 2000 },
      ],
      [
        '!sketches:example.org',
        { roomId: '!sketches:example.org', name: 'Sketches', lastActive: 1500 },
      ],
      [
        '!garden:example.org',
        { roomId: '!garden:example.org', name: 'Garden Club', lastActive: 0, space: true },
      ],
      [
        '!plants:example.org',
        { roomId: '!plants:example.org', name: 'Plant Care', lastActive: 1200 },
      ],
    ]),
  };
});

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', null, children);
  const button = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    reactModule.createElement('button', props, children);

  return {
    Avatar: passthrough,
    Box: passthrough,
    Button: button,
    Icon: passthrough,
    IconButton: button,
    Icons: {
      Check: 'Check',
      Hash: 'Hash',
      Link: 'Link',
      Plus: 'Plus',
      Search: 'Search',
      Sort: 'Sort',
      VerticalDots: 'VerticalDots',
    },
    Line: () => reactModule.createElement('hr'),
    Menu: ({ children, ref }: { children?: React.ReactNode; ref?: React.Ref<HTMLDivElement> }) =>
      reactModule.createElement('div', { ref }, children),
    PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
      anchor ? reactModule.createElement('div', null, content) : null,
    Switch: ({ value }: { value?: boolean }) =>
      reactModule.createElement('span', { 'data-switch': String(Boolean(value)) }),
    Text: passthrough,
    config: { space: { S100: '4px', S200: '8px' } },
    toRem: () => '10rem',
  };
});

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 36 })),
    measureElement: vi.fn(),
    scrollOffset: 0,
    takeSnapshot: () => [],
  }),
}));

vi.mock('../../ui/glass/GlassPrimitives', async () => {
  const reactModule = await import('react');
  return {
    Menu: ({ children, ...props }: { children?: React.ReactNode }) =>
      reactModule.createElement('div', { role: 'menu', ...props }, children),
    MenuItem: ({
      as: As = 'button',
      children,
      after,
      ...props
    }: {
      as?: 'button' | 'div';
      children?: React.ReactNode;
      after?: React.ReactNode;
      [key: string]: unknown;
    }) => reactModule.createElement(As, props, children, after),
  };
});

vi.mock('../../matrix/state/archivedRooms', () => ({
  useVisibleRooms: (rooms: string[]) => rooms,
}));

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../ui/nav/NavItem', async () => {
  const reactModule = await import('react');
  const passthrough = ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => reactModule.createElement('div', props, children);
  return {
    NavButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement('button', props, children),
    NavCategory: passthrough,
    NavEmptyCenter: passthrough,
    NavEmptyLayout: ({ options }: { options?: React.ReactNode }) =>
      reactModule.createElement('div', { 'data-empty-layout': 'true' }, options),
    NavItem: passthrough,
    NavItemContent: passthrough,
    NavLink: passthrough,
  };
});
vi.mock('../../ui/nav/NavCategoryHeader', async () => {
  const reactModule = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', null, children);
  return {
    NavCategoryHeader: passthrough,
  };
});

vi.mock('../../routes/pathUtils', () => ({
  getExplorePath: () => '/explore',
  getHomeCreatePath: () => '/home/create',
  getHomeRoomPath: (roomId: string) => `/home/${roomId}`,
  getHomeSearchPath: () => '/home/search',
  withSearchParam: (path: string) => path,
}));

vi.mock('../../matrix/matrix', () => ({
  getCanonicalAliasOrRoomId: (_mx: unknown, roomId: string) => roomId,
}));
vi.mock('../../navigation/useSelectedRoom', () => ({ useSelectedRoom: () => undefined }));
vi.mock('../../routes/useHomeSelected', () => ({ useHomeCreateSelected: () => false }));
vi.mock('../../lib/hooks/useScreenSize', () => ({
  ScreenSize: { Desktop: 'Desktop', Tablet: 'Tablet', Mobile: 'Mobile' },
  useScreenSizeContext: () => screen.size,
}));
vi.mock('../../command-palette/CommandPaletteSearchField', () => ({
  CommandPaletteSearchField: () => React.createElement('div', { 'data-find-anything': true }),
}));
vi.mock('../../command-palette/CommandPaletteSearchField.css', () => ({ NavSearchField: 'nav' }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getRoom: (roomId: string) => {
      const info = roomsById.get(roomId);
      if (!info) return null;
      return {
        roomId: info.roomId,
        name: info.name,
        isSpaceRoom: () => Boolean(info.space),
        getMyMembership: () => 'join',
        getLastActiveTimestamp: () => info.lastActive,
        currentState: { getStateEvents: () => [] },
        getLiveTimeline: () => ({
          getState: () => ({
            getStateEvents: (type: string) =>
              type === 'm.room.create' && info.space
                ? { getContent: () => ({ type: 'm.space' }), getTs: () => 1 }
                : undefined,
          }),
        }),
        on: vi.fn(),
        off: vi.fn(),
        removeListener: vi.fn(),
      };
    },
    getSafeUserId: () => '@alice:example.org',
    getAccountData: () => undefined,
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
  }),
}));
vi.mock('../../ui/VirtualTile', () => ({ VirtualTile: 'div' }));
vi.mock('../room-nav/RoomNavCategoryButton', () => ({
  RoomNavCategoryButton: 'button',
}));
vi.mock('../room-nav/RoomNavItem', () => ({
  RoomNavItem: 'div',
}));
vi.mock('../room-nav/roomOrder', () => ({
  HOME_ROOM_LIST: 'home',
  useRoomOrders: () => ({
    orderOf: (_listId: string, roomIds: readonly string[]) =>
      sortState.savedList ? [...sortState.savedList] : [...roomIds],
    modeOf: () => sortState.mode,
    hasExplicitMode: () => sortState.mode !== 'name',
    showTimesOf: () => sortState.showTimes,
    hasSavedOrder: () => Boolean(sortState.savedList?.length),
    save: sortState.save,
    setMode: sortState.setMode,
    setShowTimes: sortState.setShowTimes,
    resetSubspaceOverride: vi.fn(),
    appendRoom: vi.fn(),
  }),
}));
vi.mock('../room-nav/SortableRoomList', () => ({
  SortableRoomGroup: ({
    children,
    canMoveRoom,
    onMoveRoom,
  }: {
    children?: React.ReactNode;
    canMoveRoom?: unknown;
    onMoveRoom?: unknown;
  }) => {
    groupProps.push({ canMoveRoom, onMoveRoom });
    return React.createElement('div', { 'data-sortable-group': 'true' }, children);
  },
  useRoomSectionDrop: (spaceId: string) => {
    sectionDropIds.push(spaceId);
    return { 'data-section-drop': spaceId };
  },
  SortableRoomList: ({
    children,
    reorderDisabled,
  }: {
    children?: React.ReactNode;
    reorderDisabled?: boolean;
  }) =>
    React.createElement(
      'div',
      { 'data-sortable-list': 'home', 'data-reorder-disabled': String(Boolean(reorderDisabled)) },
      children
    ),
  SortableRoomRow: ({
    room,
    activityTimestamp,
  }: {
    room: { roomId: string };
    activityTimestamp?: number;
  }) =>
    React.createElement('div', {
      'data-home-room-row': room.roomId,
      'data-activity-ts': activityTimestamp ?? '',
    }),
}));
vi.mock('../space/SpaceRoomSection', () => {
  type MockSection = {
    spaceId: string;
    categoryId: string;
    closed: boolean;
    listedRoomIds: string[];
    shownRoomIds: string[];
    ancestorSpaceIds: string[];
  };
  type MockChildNode = {
    section: MockSection;
    children: MockChildNode[];
    subtreeShownRoomIds: string[];
  };
  const MockSpaceRoomSection = ({
    section,
    childNodes = [],
    subtreeShownRoomIds,
    roomPath,
    showOverview,
    quietUnread,
    pinMode,
  }: {
    section: MockSection;
    childNodes?: MockChildNode[];
    subtreeShownRoomIds?: string[];
    roomPath?: (roomId: string) => string;
    showOverview?: boolean;
    quietUnread?: boolean;
    pinMode?: string | ((target: MockSection) => string | undefined);
  }): React.ReactElement => {
    const resolvedPin = typeof pinMode === 'function' ? pinMode(section) : pinMode;
    return React.createElement(
      'div',
      {
        'data-space-section': section.spaceId,
        'data-category-id': section.categoryId,
        'data-closed': String(section.closed),
        'data-listed-rooms': section.listedRoomIds.join(','),
        'data-subtree-rooms': (subtreeShownRoomIds ?? section.shownRoomIds).join(','),
        'data-room-path': roomPath?.('!sample') ?? '',
        'data-show-overview': String(Boolean(showOverview)),
        'data-quiet-unread': String(Boolean(quietUnread)),
        'data-pin-mode': resolvedPin ?? '',
      },
      !section.closed
        ? childNodes.map((child) =>
            React.createElement(MockSpaceRoomSection, {
              key: child.section.categoryId,
              section: child.section,
              childNodes: child.children,
              subtreeShownRoomIds: child.subtreeShownRoomIds,
              roomPath,
              showOverview,
              quietUnread,
              pinMode,
            })
          )
        : null
    );
  };
  return { SpaceRoomSection: MockSpaceRoomSection };
});
vi.mock('../../ui/nav/useCategoryHandler', () => ({ useCategoryHandler: () => vi.fn() }));
vi.mock('../../routes/useNavToActivePathMapper', () => ({
  useNavToActivePathMapper: vi.fn(),
}));
vi.mock('../../ui/page/Page', async () => {
  const reactModule = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', null, children);
  const pageNavContent = ({
    header,
    children,
  }: {
    header?: React.ReactNode;
    children?: React.ReactNode;
  }) => reactModule.createElement('div', { 'data-page-nav-content': true }, header, children);
  return { PageNav: passthrough, PageNavContent: pageNavContent, PageNavHeader: passthrough };
});
vi.mock('../../ui/nav/useClosedNavCategories', () => ({
  useClosedNavCategoriesAtom: () => closedState.atom!,
}));
vi.mock('../../lib/keyboard', () => ({ stopPropagation: vi.fn() }));
vi.mock('../../matrix/hooks/useRoomsNotificationPreferences', () => ({
  getRoomNotificationMode: vi.fn(),
  useRoomsNotificationPreferencesContext: () => new Map(),
}));
vi.mock('../../rooms/join/JoinAddressPrompt', async () => {
  const reactModule = await import('react');
  return {
    JoinAddressPrompt: ({
      onOpen,
    }: {
      onOpen: (roomIdOrAlias: string, viaServers?: string[], eventId?: string) => void;
    }) =>
      reactModule.createElement('div', {
        'data-join-address-prompt': 'true',
        onOpen,
      }),
  };
});
vi.mock('../threads/ThreadNavCategory', () => {
  return { ThreadNavCategory: () => React.createElement('div', { 'data-thread-nav': true }) };
});
vi.mock('../threads/RecentlyOpenedNavCategory', () => ({
  RecentlyOpenedNavCategory: () => React.createElement('div', { 'data-recently-opened-nav': true }),
}));
vi.mock('../../notifications/MarkRoomsReadMenuItem', () => ({
  MarkRoomsReadMenuItem: ({ roomIds }: { roomIds: string[] }) =>
    React.createElement('div', { 'data-mark-read-rooms': roomIds.join(',') }),
}));
vi.mock('./HiddenRailPages', () => ({ HiddenRailPages: () => null }));
vi.mock('./MacAppMenuEntry', () => ({ MacAppMenuEntry: () => null }));

const makeStore = (rooms: string[], parents: Record<string, string[]> = {}) => {
  const store = createStore();
  store.set(allRoomsAtom, { type: 'INITIALIZE', rooms });
  store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
  const roomToParents: RoomToParents = new Map(
    Object.entries(parents).map(([id, list]) => [id, new Set(list)])
  );
  store.set(roomToParentsAtom, { type: 'INITIALIZE', roomToParents, chatRooms: [] });
  return store;
};

const renderHome = (rooms: string[], parents: Record<string, string[]> = {}) => {
  closedState.atom = makeClosedNavCategoriesAtom('@alice:example.org');
  const store = makeStore(rooms, parents);
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(React.createElement(Provider, { store }, React.createElement(Home)));
  });
  return { renderer, store };
};

const expectRoomActionsWork = (renderer: ReactTestRenderer) => {
  const createButton = renderer.root.find(
    (node) => node.type === 'button' && node.props['data-home-room-action'] === 'create'
  );
  const joinButton = renderer.root.find(
    (node) => node.type === 'button' && node.props['data-home-room-action'] === 'join'
  );

  act(() => {
    createButton.props.onClick();
  });
  expect(navigate).toHaveBeenCalledWith('/home/create');
  navigate.mockReset();

  act(() => {
    joinButton.props.onClick();
  });
  const joinPrompt = renderer.root.find(
    (node) => node.type === 'div' && node.props['data-join-address-prompt'] === 'true'
  );
  act(() => {
    joinPrompt.props.onOpen('!joined:example.org');
  });
  expect(navigate).toHaveBeenCalledWith('/home/!joined:example.org');
};

describe('Home', () => {
  afterEach(() => {
    screen.size = 'Desktop';
    sortState.mode = 'name';
    sortState.showTimes = false;
    sortState.savedList = undefined;
    sortState.setMode.mockReset();
    sortState.setShowTimes.mockReset();
    navigate.mockReset();
    groupProps.length = 0;
    sectionDropIds.length = 0;
  });

  const textOf = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map((child) => textOf(child)).join(' ');

  const findFields = (renderer: ReactTestRenderer) =>
    renderer.root.findAllByProps({ 'data-find-anything': true });

  it('keeps create and join actions available when rooms exist', () => {
    const { renderer } = renderHome(['!room:example.org']);

    expectRoomActionsWork(renderer);
    expect(findFields(renderer)).toHaveLength(1);
    expect(renderer.root.findAllByProps({ 'data-thread-nav': true })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ 'data-recently-opened-nav': true })).toHaveLength(1);
    expect(
      renderer.root
        .findByProps({ 'data-page-nav-content': true })
        .findAllByProps({ 'data-recently-opened-nav': true })
    ).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it('shows the empty state only when both unspaced rooms and space sections are empty', () => {
    const { renderer } = renderHome([]);

    expect(renderer.root.findAllByProps({ 'data-empty-layout': 'true' })).toHaveLength(1);
    expect(
      renderer.root.findAll(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Sort rooms'
      )
    ).toHaveLength(0);
    expectRoomActionsWork(renderer);
    expect(findFields(renderer)).toHaveLength(1);
    expect(renderer.root.findAllByProps({ 'data-recently-opened-nav': true })).toHaveLength(1);

    act(() => renderer.unmount());
  });

  it('opens a single-space all-spaced Home expanded by default without Rooms header, Home sort, or No Rooms', () => {
    const { renderer } = renderHome(
      [
        '!work:example.org',
        '!design:example.org',
        '!planning:example.org',
        '!sketches:example.org',
      ],
      {
        '!design:example.org': ['!work:example.org'],
        '!planning:example.org': ['!work:example.org'],
        '!sketches:example.org': ['!design:example.org'],
      }
    );

    expect(renderer.root.findAllByProps({ 'data-empty-layout': 'true' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'data-testid': 'room-nav-category' })).toHaveLength(0);
    expect(
      renderer.root.findAll(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Sort rooms'
      )
    ).toHaveLength(0);

    const sections = renderer.root.findAll(
      (node) => typeof node.type === 'string' && 'data-space-section' in node.props
    );
    expect(
      sections.map((node) => ({
        spaceId: node.props['data-space-section'],
        categoryId: node.props['data-category-id'],
        closed: node.props['data-closed'],
        listed: node.props['data-listed-rooms'],
        subtree: node.props['data-subtree-rooms'],
        roomPath: node.props['data-room-path'],
        showOverview: node.props['data-show-overview'],
        quietUnread: node.props['data-quiet-unread'],
        pinMode: node.props['data-pin-mode'],
      }))
    ).toEqual([
      {
        spaceId: '!work:example.org',
        categoryId: 'home|space|!work:example.org',
        closed: 'false',
        listed: '!planning:example.org',
        subtree: '!planning:example.org,!sketches:example.org',
        roomPath: '/home/!sample',
        showOverview: 'true',
        quietUnread: 'true',
        pinMode: '',
      },
      {
        spaceId: '!design:example.org',
        categoryId: 'home|space|!design:example.org',
        closed: 'false',
        listed: '!sketches:example.org',
        subtree: '!sketches:example.org',
        roomPath: '/home/!sample',
        showOverview: 'true',
        quietUnread: 'true',
        pinMode: 'toggle',
      },
    ]);

    // HomeHeader Mark as Read covers all visible rooms (including spaced rooms).
    const optionsButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Home Options'
    );
    act(() => {
      optionsButton.props.onClick({
        currentTarget: { getBoundingClientRect: () => ({ x: 0, y: 0, width: 24, height: 24 }) },
      });
    });
    expect(
      renderer.root.findByProps({
        'data-mark-read-rooms': '!sketches:example.org,!planning:example.org',
      })
    ).toBeDefined();

    act(() => renderer.unmount());
  });

  it('collapses multi-space all-spaced Home by default while hiding Rooms header and Home sort', () => {
    const { renderer } = renderHome(
      [
        '!work:example.org',
        '!design:example.org',
        '!planning:example.org',
        '!sketches:example.org',
        '!garden:example.org',
        '!plants:example.org',
      ],
      {
        '!design:example.org': ['!work:example.org'],
        '!planning:example.org': ['!work:example.org'],
        '!sketches:example.org': ['!design:example.org'],
        '!plants:example.org': ['!garden:example.org'],
      }
    );

    expect(renderer.root.findAllByProps({ 'data-empty-layout': 'true' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'data-testid': 'room-nav-category' })).toHaveLength(0);
    expect(
      renderer.root.findAll(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Sort rooms'
      )
    ).toHaveLength(0);

    // Top-level spaces start collapsed; nested Design Team stays hidden inside collapsed Work.
    const sections = renderer.root.findAll(
      (node) => typeof node.type === 'string' && 'data-space-section' in node.props
    );
    expect(
      sections.map((node) => ({
        spaceId: node.props['data-space-section'],
        closed: node.props['data-closed'],
        subtree: node.props['data-subtree-rooms'],
      }))
    ).toEqual([
      {
        spaceId: '!garden:example.org',
        closed: 'true',
        subtree: '!plants:example.org',
      },
      {
        spaceId: '!work:example.org',
        closed: 'true',
        subtree: '!planning:example.org,!sketches:example.org',
      },
    ]);

    act(() => renderer.unmount());
  });

  it('passes both unspaced and spaced visible rooms to HomeHeader Mark as Read', () => {
    const { renderer } = renderHome(
      ['!room:example.org', '!work:example.org', '!planning:example.org'],
      { '!planning:example.org': ['!work:example.org'] }
    );

    expect(
      renderer.root.findAll(
        (node) => typeof node.type === 'string' && node.props['data-testid'] === 'room-nav-category'
      )
    ).toHaveLength(1);
    expect(
      renderer.root.findAll(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Sort rooms'
      )
    ).toHaveLength(1);

    const optionsButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Home Options'
    );
    act(() => {
      optionsButton.props.onClick({
        currentTarget: { getBoundingClientRect: () => ({ x: 0, y: 0, width: 24, height: 24 }) },
      });
    });
    expect(
      renderer.root.findByProps({
        'data-mark-read-rooms': '!room:example.org,!planning:example.org',
      })
    ).toBeDefined();

    act(() => renderer.unmount());
  });

  it('wraps unspaced Rooms (with HOME_ROOM_LIST section drop) and space sections in one SortableRoomGroup without cross-section moves', () => {
    const { renderer } = renderHome(
      ['!room:example.org', '!work:example.org', '!planning:example.org'],
      { '!planning:example.org': ['!work:example.org'] }
    );

    const groups = renderer.root.findAll(
      (node) => typeof node.type === 'string' && node.props['data-sortable-group'] === 'true'
    );
    expect(groups).toHaveLength(1);
    expect(groupProps.length).toBeGreaterThanOrEqual(1);
    expect(
      groupProps.every((entry) => entry.canMoveRoom === undefined && entry.onMoveRoom === undefined)
    ).toBe(true);
    expect(sectionDropIds).toContain('home');
    expect(sectionDropIds.every((id) => id === 'home')).toBe(true);

    const group = groups[0]!;
    expect(
      group.findAll(
        (node) =>
          typeof node.type === 'string' &&
          node.props['data-testid'] === 'room-nav-category' &&
          node.props['data-section-drop'] === 'home'
      )
    ).toHaveLength(1);
    const workSections = group.findAll(
      (node) =>
        typeof node.type === 'string' && node.props['data-space-section'] === '!work:example.org'
    );
    expect(workSections).toHaveLength(1);
    expect(workSections[0]?.props['data-closed']).toBe('true');

    act(() => renderer.unmount());
  });

  it('leaves the search field to the top bar on a phone', () => {
    screen.size = 'Mobile';
    const { renderer } = renderHome(['!room:example.org']);

    expect(findFields(renderer)).toHaveLength(0);
    expectRoomActionsWork(renderer);

    act(() => renderer.unmount());
  });

  it('opens the header Sort rooms menu, switches sort modes, toggles activity times, and disables reorder in Recent mode', () => {
    const { renderer, store } = renderHome(['!room:example.org', '!beta:example.org']);

    const sortTrigger = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Sort rooms'
    );
    expect(
      renderer.root.findByProps({ 'data-sortable-list': 'home' }).props['data-reorder-disabled']
    ).toBe('false');
    expect(
      renderer.root
        .findAll((node) => typeof node.type === 'string' && 'data-home-room-row' in node.props)
        .map((node) => [node.props['data-home-room-row'], node.props['data-activity-ts']])
    ).toEqual([
      ['!room:example.org', ''],
      ['!beta:example.org', ''],
    ]);

    // Open Sort rooms popover and switch to Recent activity & toggle Show activity times.
    act(() => {
      sortTrigger.props.onClick({
        currentTarget: { getBoundingClientRect: () => ({ x: 0, y: 0, width: 24, height: 24 }) },
      });
    });
    const showTimesItem = renderer.root.find((node) => node.props.role === 'menuitemcheckbox');
    act(() => {
      showTimesItem.props.onClick();
    });
    expect(sortState.setShowTimes).toHaveBeenCalledWith('home', true);

    const recentItem = renderer.root.find(
      (node) => node.props.role === 'menuitemradio' && textOf(node).includes('Recent activity')
    );
    act(() => {
      recentItem.props.onClick();
    });
    expect(sortState.setMode).toHaveBeenCalledWith('home', 'recent', [
      '!room:example.org',
      '!beta:example.org',
    ]);

    // Re-render in Recent + showTimes: rows reorder by activity, timestamps pass through, reorder is disabled.
    sortState.mode = 'recent';
    sortState.showTimes = true;
    act(() => {
      renderer.update(React.createElement(Provider, { store }, React.createElement(Home)));
    });
    expect(
      renderer.root.findByProps({ 'data-sortable-list': 'home' }).props['data-reorder-disabled']
    ).toBe('true');
    expect(
      renderer.root
        .findAll((node) => typeof node.type === 'string' && 'data-home-room-row' in node.props)
        .map((node) => [node.props['data-home-room-row'], node.props['data-activity-ts']])
    ).toEqual([
      ['!beta:example.org', 3000],
      ['!room:example.org', 1000],
    ]);

    // Switching to Custom order from Recent freezes the current order.
    act(() => {
      sortTrigger.props.onClick({
        currentTarget: { getBoundingClientRect: () => ({ x: 0, y: 0, width: 24, height: 24 }) },
      });
    });
    const customItem = renderer.root.find(
      (node) => node.props.role === 'menuitemradio' && textOf(node).includes('Custom order')
    );
    act(() => {
      customItem.props.onClick();
    });
    expect(sortState.setMode).toHaveBeenLastCalledWith('home', 'manual', [
      '!beta:example.org',
      '!room:example.org',
    ]);

    act(() => renderer.unmount());
  });
});
