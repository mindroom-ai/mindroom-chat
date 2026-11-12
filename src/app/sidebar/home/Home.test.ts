import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Home } from './Home';

const { homeRoomsState, navigate, screen } = vi.hoisted(() => ({
  homeRoomsState: { roomIds: ['!room:example.org'] },
  navigate: vi.fn(),
  screen: { size: 'Desktop' },
}));

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
      Hash: 'Hash',
      Link: 'Link',
      Plus: 'Plus',
      Search: 'Search',
      VerticalDots: 'VerticalDots',
    },
    Menu: React.forwardRef<HTMLDivElement, { children?: React.ReactNode }>(({ children }, ref) =>
      reactModule.createElement('div', { ref }, children)
    ),
    PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
      anchor ? reactModule.createElement('div', null, content) : null,
    Text: passthrough,
    config: { space: { S100: '8px' } },
    toRem: () => '10rem',
  };
});

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    measureElement: vi.fn(),
    scrollOffset: 0,
    takeSnapshot: () => [],
  }),
}));

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
  default: ({ children }: { children: React.ReactNode }) =>
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
  useMatrixClient: () => ({ getRoom: () => null, getSafeUserId: () => '@alice:example.org' }),
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
  useRoomOrder: (_listId: string, roomIds: string[]) => ({
    roomIds,
    manual: false,
    save: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock('../room-nav/SortableRoomList', () => ({
  SortableRoomList: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  SortableRoomRow: 'div',
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
  const pageNavContent = ({ children }: { children?: React.ReactNode }) =>
    reactModule.createElement('div', { 'data-page-nav-content': true }, children);
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
    navigate.mockReset();
  });

  const findFields = (renderer: ReactTestRenderer) =>
    renderer.root.findAllByProps({ 'data-find-anything': true });

  it('keeps create and join actions available when rooms exist', () => {
    const renderer = create(React.createElement(Home));

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
    const renderer = create(React.createElement(Home));

    expectRoomActionsWork(renderer);
    expect(findFields(renderer)).toHaveLength(1);
    expect(renderer.root.findAllByProps({ 'data-recently-opened-nav': true })).toHaveLength(1);

    renderer.unmount();
  });

  it('leaves the search field to the top bar on a phone', () => {
    screen.size = 'Mobile';
    const renderer = create(React.createElement(Home));

    expect(findFields(renderer)).toHaveLength(0);
    expectRoomActionsWork(renderer);

    renderer.unmount();
  });
});
