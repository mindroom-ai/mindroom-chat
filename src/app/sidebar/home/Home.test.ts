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
  homeState,
  startDirectChatMock,
  shortcutCalls,
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
    homeState: {
      directRooms: [] as Array<Record<string, unknown>>,
      homeAgents: [] as Array<Record<string, unknown>>,
      directTabShown: true,
      selectedRoomId: undefined as string | undefined,
    },
    startDirectChatMock: vi.fn(),
    shortcutCalls: [] as Array<readonly string[]>,
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
    color: {
      Critical: { Main: '#f00' },
      Primary: { Main: '#00f' },
      Success: { Main: '#0f0' },
      Background: { Container: '#fff' },
      SurfaceVariant: { Container: '#eee', OnContainer: '#111' },
    },
    Icons: {
      Category: 'Category',
      Check: 'Check',
      ChevronBottom: 'ChevronBottom',
      ChevronTop: 'ChevronTop',
      Hash: 'Hash',
      Link: 'Link',
      Message: 'Message',
      Plus: 'Plus',
      Search: 'Search',
      Sort: 'Sort',
      VerticalDots: 'VerticalDots',
    },
    Spinner: () => reactModule.createElement('span', { 'data-spinner': 'true' }),
    Line: () => reactModule.createElement('hr'),
    Menu: ({ children, ref }: { children?: React.ReactNode; ref?: React.Ref<HTMLDivElement> }) =>
      reactModule.createElement('div', { ref }, children),
    PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
      anchor ? reactModule.createElement('div', null, content) : null,
    Switch: ({ value }: { value?: boolean }) =>
      reactModule.createElement('span', { 'data-switch': String(Boolean(value)) }),
    Text: passthrough,
    config: {
      space: { S100: '4px', S200: '8px' },
      opacity: { Disabled: 0.4, P300: 0.3, P500: 0.5 },
      radii: { Pill: '999px' },
      fontWeight: { W400: 400 },
    },
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

vi.mock('../../matrix/state/archivedRooms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/state/archivedRooms')>()),
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
    NavLink: ({
      children,
      to,
      ...props
    }: {
      children?: React.ReactNode;
      to?: string;
      [key: string]: unknown;
    }) => reactModule.createElement('a', { href: to, ...props }, children),
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
  getDirectCreatePath: () => '/direct/create',
  getExplorePath: () => '/explore',
  getHomeCreatePath: () => '/home/create',
  getHomeRoomPath: (roomId: string) => `/home/${roomId}`,
  getHomeSearchPath: () => '/home/search',
  withSearchParam: (path: string) => path,
}));

vi.mock('../../navigation/useSelectedRoom', () => ({
  useSelectedRoom: () => homeState.selectedRoomId,
}));
vi.mock('../../routes/useHomeSelected', () => ({ useHomeCreateSelected: () => false }));
vi.mock('../../lib/hooks/useScreenSize', () => ({
  ScreenSize: { Desktop: 'Desktop', Tablet: 'Tablet', Mobile: 'Mobile' },
  useScreenSizeContext: () => screen.size,
}));
vi.mock('../../command-palette/CommandPaletteSearchField', () => ({
  CommandPaletteSearchField: () => React.createElement('div', { 'data-find-anything': true }),
}));
vi.mock('../../ui/SearchField.css', () => ({ NavSearchField: 'nav' }));
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
  RoomNavCategoryButton: ({
    children,
    before,
    after,
    closed,
    ...props
  }: {
    children?: React.ReactNode;
    before?: React.ReactNode;
    after?: React.ReactNode;
    closed?: boolean;
    [key: string]: unknown;
  }) =>
    React.createElement('button', { 'aria-expanded': !closed, ...props }, before, children, after),
}));
vi.mock('../room-nav/RoomNavItem', () => ({
  RoomNavItem: ({
    room,
    linkPath,
    direct,
    showDraft,
    nameOverride,
    selected,
  }: {
    room: { roomId: string };
    linkPath: string;
    direct?: boolean;
    showDraft?: boolean;
    nameOverride?: string;
    selected?: boolean;
  }) =>
    React.createElement('div', {
      'data-room-nav-item': room.roomId,
      'data-link-path': linkPath,
      'data-direct': direct ? 'true' : undefined,
      'data-show-draft': showDraft ? 'true' : undefined,
      'data-name-override': nameOverride,
      'data-selected': selected ? 'true' : undefined,
    }),
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
vi.mock('../../ui/nav/useCategoryHandler', async (importOriginal) =>
  importOriginal<typeof import('../../ui/nav/useCategoryHandler')>()
);
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
      returnFocusTo,
    }: {
      onOpen: (roomIdOrAlias: string, viaServers?: string[], eventId?: string) => void;
      returnFocusTo?: HTMLElement | null;
    }) =>
      reactModule.createElement('div', {
        'data-join-address-prompt': 'true',
        onOpen,
        returnFocusTo,
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
vi.mock('../direct/useDirectRooms', () => ({
  useDirectRooms: () => homeState.directRooms,
  useDirectRoomIds: () => homeState.directRooms.map((room) => room.roomId as string),
}));
vi.mock('./homeAgents', () => ({
  useHomeAgents: () => homeState.homeAgents,
  startDirectChat: (...args: unknown[]) => startDirectChatMock(...args),
  agentNameIn: (_room: unknown, userId: string) => userId.replace(/^@mindroom_/, '').split(':')[0],
}));
vi.mock('../../settings/railButtons', () => ({
  useRailButtons: () => ({ direct: homeState.directTabShown }),
}));
vi.mock('../useRoomListShortcuts', () => ({
  useRoomListShortcuts: (roomIds: readonly string[]) => {
    shortcutCalls.push([...roomIds]);
  },
}));
vi.mock('../../avatars/UserAvatar', () => ({
  UserAvatar: ({ alt }: { alt?: string }) => React.createElement('span', null, alt),
}));
vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));
vi.mock('../../matrix/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ 'm.room_versions': { default: '11' } }),
}));
vi.mock('../../matrix/hooks/useRoomActiveRuns', () => ({
  useRoomActiveRuns: () => ({ runs: [], threads: new Set() }),
}));
vi.mock('../../matrix/matrix', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/matrix')>()),
  getCanonicalAliasOrRoomId: (_mx: unknown, roomId: string) => roomId,
  mxcUrlToHttp: () => undefined,
}));
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

const fakeAnchorEvent = {
  currentTarget: {
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 120, height: 32 }),
    focus: vi.fn(),
  },
};

const expectEmptyRoomActionsWork = (renderer: ReactTestRenderer) => {
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

const expectPopulatedAddRoomsMenuWorks = (renderer: ReactTestRenderer) => {
  // Populated Home hides direct top Create/Join buttons until + Add rooms menu opens.
  expect(
    renderer.root.findAll(
      (node) => node.type === 'button' && node.props['data-home-room-action'] === 'create'
    )
  ).toHaveLength(0);
  expect(
    renderer.root.findAll(
      (node) => node.type === 'button' && node.props['data-home-room-action'] === 'join'
    )
  ).toHaveLength(0);

  const openMenu = () => {
    const addButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['data-home-room-action'] === 'add'
    );
    act(() => {
      addButton.props.onClick(fakeAnchorEvent);
    });
  };

  openMenu();
  const createItem = renderer.root.find(
    (node) => node.type === 'button' && node.props['data-home-room-action'] === 'create'
  );
  act(() => {
    createItem.props.onClick();
  });
  expect(navigate).toHaveBeenCalledWith('/home/create');
  navigate.mockReset();

  openMenu();
  const joinItem = renderer.root.find(
    (node) => node.type === 'button' && node.props['data-home-room-action'] === 'join'
  );
  act(() => {
    joinItem.props.onClick();
  });
  const joinPrompt = renderer.root.find(
    (node) => node.type === 'div' && node.props['data-join-address-prompt'] === 'true'
  );
  expect(joinPrompt.props.returnFocusTo).toBe(fakeAnchorEvent.currentTarget);
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
    homeState.directRooms = [];
    homeState.homeAgents = [];
    homeState.directTabShown = true;
    homeState.selectedRoomId = undefined;
    startDirectChatMock.mockReset();
    shortcutCalls.length = 0;
  });

  const textOf = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map((child) => textOf(child)).join(' ');

  const findFields = (renderer: ReactTestRenderer) =>
    renderer.root.findAllByProps({ 'data-find-anything': true });

  it('replaces top create/join rows with the inline + Add rooms menu when rooms exist', () => {
    const { renderer } = renderHome(['!room:example.org']);

    expectPopulatedAddRoomsMenuWorks(renderer);
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
    expectEmptyRoomActionsWork(renderer);
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
    expectPopulatedAddRoomsMenuWorks(renderer);

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
  it('opens the Create/Join menu from the Rooms header hover + button and shows standalone + Add rooms on all-spaced Home', () => {
    const { renderer } = renderHome(['!room:example.org']);
    const headerPlus = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Add rooms'
    );
    act(() => {
      headerPlus.props.onClick(fakeAnchorEvent);
    });
    const createItem = renderer.root.find(
      (node) => node.type === 'button' && node.props['data-home-room-action'] === 'create'
    );
    act(() => {
      createItem.props.onClick();
    });
    expect(navigate).toHaveBeenCalledWith('/home/create');
    act(() => renderer.unmount());

    navigate.mockReset();
    const { renderer: spacedOnly } = renderHome(['!work:example.org', '!planning:example.org'], {
      '!planning:example.org': ['!work:example.org'],
    });
    expectPopulatedAddRoomsMenuWorks(spacedOnly);
    act(() => spacedOnly.unmount());
  });

  it('renders Direct messages and Agents sections in mindroom categories, stays in Home on click, and includes DMs in shortcuts and Mark as Read', async () => {
    const makeDm = (roomId: string, partnerId: string, joined: number, lastActive: number) => ({
      roomId,
      name: roomId,
      myUserId: '@alice:example.org',
      getJoinedMemberCount: () => joined,
      getInvitedMemberCount: () => 0,
      getLastActiveTimestamp: () => lastActive,
      getAvatarFallbackMember: () => ({ userId: partnerId, getMxcAvatarUrl: () => null }),
      getMembers: () => [
        { userId: '@alice:example.org', membership: 'join' },
        { userId: partnerId, membership: 'join' },
      ],
    });

    homeState.directRooms = [
      makeDm('!dm-maya:example.org', '@maya:example.org', 2, 5000),
      makeDm('!dm-group:example.org', '@mindroom_dev:example.org', 3, 4500),
      makeDm('!dm-dev:example.org', '@mindroom_dev:example.org', 2, 4000),
    ];
    homeState.homeAgents = [
      {
        userId: '@mindroom_dev:example.org',
        name: 'DevAgent',
        roomIds: ['!room:example.org'],
        direct: { roomId: '!dm-dev:example.org', waiting: false },
        lastUsedTs: 3000,
      },
      {
        userId: '@mindroom_researcher:example.org',
        name: 'Researcher',
        roomIds: ['!room:example.org'],
        lastUsedTs: 2000,
      },
    ];
    startDirectChatMock.mockResolvedValue('!dm-researcher-new:example.org');

    const { renderer } = renderHome(['!room:example.org']);

    // Only Rooms uses home| category prefix; Direct messages & Agents use mindroom|.
    const homeCategories = renderer.root
      .findAll(
        (node) =>
          node.type === 'button' &&
          typeof node.props['data-category-id'] === 'string' &&
          node.props['data-category-id'].startsWith('home|')
      )
      .map((node) => node.props['data-category-id']);
    expect(homeCategories).toEqual(['home|room']);

    const dmSection = renderer.root.findByProps({ 'data-testid': 'home-direct-section' });
    expect(
      dmSection
        .findAll((n) => typeof n.type === 'string' && 'data-room-nav-item' in n.props)
        .map((n) => ({
          id: n.props['data-room-nav-item'],
          link: n.props['data-link-path'],
          showDraft: n.props['data-show-draft'],
        }))
    ).toEqual([
      { id: '!dm-maya:example.org', link: '/home/!dm-maya:example.org', showDraft: 'true' },
      { id: '!dm-group:example.org', link: '/home/!dm-group:example.org', showDraft: 'true' },
    ]);

    const agentsSection = renderer.root.findByProps({ 'data-testid': 'home-agents-section' });
    expect(
      agentsSection
        .findAll((n) => typeof n.type === 'string' && 'data-room-nav-item' in n.props)
        .map((n) => ({
          id: n.props['data-room-nav-item'],
          link: n.props['data-link-path'],
          name: n.props['data-name-override'],
          showDraft: n.props['data-show-draft'],
        }))
    ).toEqual([
      {
        id: '!dm-dev:example.org',
        link: '/home/!dm-dev:example.org',
        name: 'DevAgent',
        showDraft: 'true',
      },
    ]);

    // Clicking an agent without a DM starts one and navigates in Home.
    const researcherButton = agentsSection.find(
      (n) =>
        n.type === 'button' && n.props['data-home-agent-id'] === '@mindroom_researcher:example.org'
    );
    await act(async () => {
      researcherButton.props.onClick();
    });
    expect(startDirectChatMock).toHaveBeenCalledWith(
      expect.anything(),
      '@mindroom_researcher:example.org',
      '11'
    );
    expect(navigate).toHaveBeenCalledWith('/home/!dm-researcher-new:example.org');

    // Shortcuts and HomeHeader Mark as Read include both ordinary rooms and DMs/agent DMs.
    expect(shortcutCalls.at(-1)).toEqual([
      '!room:example.org',
      '!dm-maya:example.org',
      '!dm-group:example.org',
      '!dm-dev:example.org',
    ]);
    const optionsButton = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Home Options'
    );
    act(() => {
      optionsButton.props.onClick(fakeAnchorEvent);
    });
    expect(
      renderer.root.findByProps({
        'data-mark-read-rooms':
          '!room:example.org,!dm-maya:example.org,!dm-group:example.org,!dm-dev:example.org',
      })
    ).toBeDefined();

    // Collapsing Direct messages hides its DM rows and removes them from shortcuts.
    const dmHeaderButton = dmSection.find(
      (n) => n.type === 'button' && n.props['data-category-id'] === 'mindroom|home-direct'
    );
    act(() => {
      dmHeaderButton.props.onClick({
        currentTarget: { getAttribute: () => 'mindroom|home-direct' },
      });
    });
    expect(
      dmSection.findAll((n) => typeof n.type === 'string' && 'data-room-nav-item' in n.props)
    ).toHaveLength(0);
    expect(shortcutCalls.at(-1)).toEqual(['!room:example.org', '!dm-dev:example.org']);

    act(() => renderer.unmount());
  });

  it('shows Direct messages when empty only if the Direct Messages rail button is hidden, and stays non-empty for DM-only accounts', () => {
    const { renderer: shownRail } = renderHome(['!room:example.org']);
    expect(shownRail.root.findAllByProps({ 'data-testid': 'home-direct-section' })).toHaveLength(0);
    act(() => shownRail.unmount());

    homeState.directTabShown = false;
    const { renderer: hiddenRail } = renderHome(['!room:example.org']);
    const dmSection = hiddenRail.root.findByProps({ 'data-testid': 'home-direct-section' });
    const newDmLink = dmSection.find(
      (n) => n.type === 'a' && n.props['data-home-dm-action'] === 'new'
    );
    expect(newDmLink.props.href).toBe('/direct/create');
    act(() => hiddenRail.unmount());

    // Account with only a DM (no rooms or spaces) renders populated Home, not NavEmptyLayout.
    homeState.directTabShown = true;
    homeState.directRooms = [
      {
        roomId: '!dm-liam:example.org',
        name: 'Liam',
        myUserId: '@alice:example.org',
        getJoinedMemberCount: () => 2,
        getInvitedMemberCount: () => 0,
        getLastActiveTimestamp: () => 1000,
        getAvatarFallbackMember: () => ({
          userId: '@liam:example.org',
          getMxcAvatarUrl: () => null,
        }),
      },
    ];
    const { renderer: dmOnly } = renderHome([]);
    expect(dmOnly.root.findAllByProps({ 'data-empty-layout': 'true' })).toHaveLength(0);
    expect(
      dmOnly.root.findAll(
        (n) => typeof n.type === 'string' && n.props['data-testid'] === 'home-direct-section'
      )
    ).toHaveLength(1);
    expectPopulatedAddRoomsMenuWorks(dmOnly);
    act(() => dmOnly.unmount());

    // Account with only an agent DM and Direct rail shown still shows Direct messages so New direct message is reachable.
    homeState.directTabShown = true;
    homeState.directRooms = [
      {
        roomId: '!dm-dev:example.org',
        name: 'DevAgent',
        myUserId: '@alice:example.org',
        getJoinedMemberCount: () => 2,
        getInvitedMemberCount: () => 0,
        getLastActiveTimestamp: () => 1000,
        getAvatarFallbackMember: () => ({
          userId: '@mindroom_dev:example.org',
          getMxcAvatarUrl: () => null,
        }),
      },
    ];
    const { renderer: agentDmOnly } = renderHome(['!room:example.org']);
    const agentOnlyDmSection = agentDmOnly.root.findByProps({
      'data-testid': 'home-direct-section',
    });
    const agentOnlyNewDm = agentOnlyDmSection.find(
      (n) => n.type === 'a' && n.props['data-home-dm-action'] === 'new'
    );
    expect(agentOnlyNewDm.props.href).toBe('/direct/create');
    act(() => agentDmOnly.unmount());
  });
});
