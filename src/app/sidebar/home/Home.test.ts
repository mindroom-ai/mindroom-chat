import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Home } from './Home';

const { homeRoomsState, navigate, screen, sortState, roomsById } = vi.hoisted(() => {
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
    homeRoomsState: { roomIds: ['!room:example.org'] },
    navigate: vi.fn(),
    screen: { size: 'Desktop' },
    sortState: sort,
    roomsById: new Map<string, { roomId: string; name: string; lastActive: number }>([
      ['!room:example.org', { roomId: '!room:example.org', name: 'Alpha', lastActive: 1000 }],
      ['!beta:example.org', { roomId: '!beta:example.org', name: 'Beta', lastActive: 3000 }],
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
    Menu: React.forwardRef<HTMLDivElement, { children?: React.ReactNode }>(({ children }, ref) =>
      reactModule.createElement('div', { ref }, children)
    ),
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

vi.mock('jotai', () => ({
  atom: (init: unknown) => ({ init }),
  useAtom: () => [new Set<string>(), vi.fn()],
  useAtomValue: () => new Map<string, unknown>(),
  useSetAtom: () => vi.fn(),
}));

vi.mock('focus-trap-react', () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../ui/nav/NavItem', async () => {
  const reactModule = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', null, children);
  return {
    NavButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      reactModule.createElement('button', props, children),
    NavCategory: passthrough,
    NavEmptyCenter: passthrough,
    NavEmptyLayout: ({ options }: { options?: React.ReactNode }) =>
      reactModule.createElement('div', null, options),
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
vi.mock('../../matrix/state/useHomeRooms', () => ({ useHomeRooms: () => homeRoomsState.roomIds }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getRoom: (roomId: string) => {
      const info = roomsById.get(roomId);
      if (!info) return null;
      return {
        roomId: info.roomId,
        name: info.name,
        getLastActiveTimestamp: () => info.lastActive,
        currentState: { getStateEvents: () => [] },
        getLiveTimeline: () => ({ getState: () => ({ getStateEvents: () => [] }) }),
        on: vi.fn(),
        off: vi.fn(),
        removeListener: vi.fn(),
      };
    },
    getSafeUserId: () => '@alice:example.org',
    on: vi.fn(),
    off: vi.fn(),
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
vi.mock('../../ui/nav/closedNavCategories', () => ({
  makeNavCategoryId: () => 'home-room',
}));
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
  useClosedNavCategoriesAtom: () => ({}),
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
  MarkRoomsReadMenuItem: 'div',
}));
vi.mock('./HiddenRailPages', () => ({ HiddenRailPages: () => null }));

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
    homeRoomsState.roomIds = ['!room:example.org'];
    screen.size = 'Desktop';
    sortState.mode = 'name';
    sortState.showTimes = false;
    sortState.savedList = undefined;
    sortState.setMode.mockReset();
    sortState.setShowTimes.mockReset();
    navigate.mockReset();
  });

  const textOf = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map((child) => textOf(child)).join(' ');

  const findFields = (renderer: ReactTestRenderer) =>
    renderer.root.findAllByProps({ 'data-find-anything': true });

  it('keeps create and join actions available when rooms exist', () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Home));
    });

    expectRoomActionsWork(renderer);
    expect(findFields(renderer)).toHaveLength(1);
    expect(renderer.root.findAllByProps({ 'data-thread-nav': true })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ 'data-recently-opened-nav': true })).toHaveLength(1);
    expect(
      renderer.root
        .findByProps({ 'data-page-nav-content': true })
        .findAllByProps({ 'data-recently-opened-nav': true })
    ).toHaveLength(0);

    renderer.unmount();
  });

  it('keeps create and join actions available in the empty state', () => {
    homeRoomsState.roomIds = [];
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Home));
    });

    expectRoomActionsWork(renderer);
    expect(findFields(renderer)).toHaveLength(1);
    expect(renderer.root.findAllByProps({ 'data-recently-opened-nav': true })).toHaveLength(1);

    renderer.unmount();
  });

  it('leaves the search field to the top bar on a phone', () => {
    screen.size = 'Mobile';
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Home));
    });

    expect(findFields(renderer)).toHaveLength(0);
    expectRoomActionsWork(renderer);

    renderer.unmount();
  });

  it('opens the header Sort rooms menu, switches sort modes, toggles activity times, and disables reorder in Recent mode', () => {
    homeRoomsState.roomIds = ['!room:example.org', '!beta:example.org'];
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Home));
    });

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
      renderer.update(React.createElement(Home));
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
