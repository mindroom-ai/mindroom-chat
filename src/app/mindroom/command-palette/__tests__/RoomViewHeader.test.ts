import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandPaletteOpenAtom } from '../commandPaletteState';

const { encryptionState, screenSizeState } = vi.hoisted(() => ({
  encryptionState: {
    value: undefined as unknown,
  },
  screenSizeState: {
    value: 'Desktop',
  },
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  const reactModule = await import('react');

  return {
    ...actual,
    Avatar: ({ children }: { children: React.ReactNode }) => reactModule.createElement('div', null, children),
    Badge: ({ children }: { children: React.ReactNode }) => reactModule.createElement('div', null, children),
    Box: ({ children }: { children: React.ReactNode }) => reactModule.createElement('div', null, children),
    config: {
      ...actual.config,
      space: {
        ...actual.config.space,
        S100: '4px',
      },
    },
    Icon: ({ src }: { src: string }) => reactModule.createElement('span', { 'data-icon': src }),
    IconButton: React.forwardRef<
      HTMLButtonElement,
      React.ButtonHTMLAttributes<HTMLButtonElement> & {
        children: React.ReactNode;
      }
    >(({ children, ...props }, ref) =>
      reactModule.createElement('button', { ref, type: 'button', ...props }, children)
    ),
    Icons: {
      ArrowLeft: 'ArrowLeft',
      CheckTwice: 'CheckTwice',
      Pin: 'Pin',
      Search: 'Search',
      Terminal: 'Terminal',
      User: 'User',
      VerticalDots: 'VerticalDots',
    },
    Line: () => reactModule.createElement('hr'),
    Menu: ({ children }: { children: React.ReactNode }) => reactModule.createElement('div', null, children),
    MenuItem: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('button', { type: 'button' }, children),
    Overlay: ({ children }: { children: React.ReactNode }) => reactModule.createElement('div', null, children),
    OverlayBackdrop: () => reactModule.createElement('div'),
    OverlayCenter: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    PopOut: () => null,
    Spinner: () => reactModule.createElement('div'),
    Text: ({ children }: { children: React.ReactNode }) => reactModule.createElement('span', null, children),
    toRem: (value: number) => `${value}rem`,
    Tooltip: ({ children }: { children: React.ReactNode }) => reactModule.createElement('div', null, children),
    TooltipProvider: ({
      children,
    }: {
      children: (triggerRef: React.Ref<HTMLButtonElement>) => React.ReactNode;
    }) => reactModule.createElement(reactModule.Fragment, null, children(() => undefined)),
  };
});

vi.mock('focus-trap-react', async () => {
  const reactModule = await import('react');
  return {
    default: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement(reactModule.Fragment, null, children),
  };
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../components/page', () => ({
  PageHeader: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('../../../styles/ContainerColor.css', () => ({
  ContainerColor: () => 'ContainerColor',
}));

vi.mock('../../../components/room-avatar', () => ({
  RoomAvatar: () => React.createElement('div'),
  RoomIcon: () => React.createElement('div'),
}));

vi.mock('../../../components/UseStateProvider', () => ({
  UseStateProvider: ({
    children,
  }: {
    children: (state: boolean, setState: (value: boolean) => void) => React.ReactNode;
  }) => React.createElement(React.Fragment, null, children(false, vi.fn())),
}));

vi.mock('../../../components/room-topic-viewer', () => ({
  RoomTopicViewer: () => React.createElement('div'),
}));

vi.mock('../../../components/BackRouteHandler', () => ({
  BackRouteHandler: ({ children }: { children: (onBack: () => void) => React.ReactNode }) =>
    React.createElement(React.Fragment, null, children(vi.fn())),
}));

vi.mock('../../../components/leave-room-prompt', () => ({
  LeaveRoomPrompt: () => React.createElement('div'),
}));

vi.mock('../../../components/invite-user-prompt', () => ({
  InviteUserPrompt: () => React.createElement('div'),
}));

vi.mock('../../../hooks/useStateEvent', () => ({
  useStateEvent: () => encryptionState.value,
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@user:example.org',
  }),
}));

vi.mock('../../../hooks/useRoom', () => ({
  useRoom: () => ({
    roomId: '!room:example.org',
    getJoinRule: () => undefined,
  }),
  useIsDirectRoom: () => false,
}));

vi.mock('../../../state/hooks/settings', () => ({
  useSetting: (_atom: unknown, key: string) => {
    switch (key) {
      case 'isPeopleDrawer':
        return [false, vi.fn()];
      case 'hideActivity':
        return [false];
      default:
        return [false, vi.fn()];
    }
  },
}));

vi.mock('../../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../../hooks/useSpace', () => ({
  useSpaceOptionally: () => undefined,
}));

vi.mock('../../../utils/matrix', () => ({
  getCanonicalAliasOrRoomId: () => '!room:example.org',
  isRoomAlias: () => false,
  mxcUrlToHttp: () => undefined,
}));

vi.mock('../../../features/room/RoomViewHeader.css', () => ({
  HeaderTopic: 'HeaderTopic',
}));

vi.mock('../../../state/hooks/unread', () => ({
  useRoomUnread: () => false,
}));

vi.mock('../../../hooks/usePowerLevels', () => ({
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../notifications/readReceipts', () => ({
  markRoomAndThreadsAsRead: vi.fn(),
}));

vi.mock('../../../state/room/roomToUnread', () => ({
  roomToUnreadAtom: {},
}));

vi.mock('../../../utils/dom', () => ({
  copyToClipboard: vi.fn(),
}));

vi.mock('../../../hooks/useRoomMeta', () => ({
  useRoomAvatar: () => undefined,
  useRoomName: () => 'General',
  useRoomTopic: () => undefined,
}));

vi.mock('../../../hooks/useScreenSize', () => ({
  ScreenSize: {
    Desktop: 'Desktop',
    Tablet: 'Tablet',
    Mobile: 'Mobile',
  },
  useScreenSizeContext: () => screenSizeState.value,
}));

vi.mock('../../../utils/keyboard', () => ({
  stopPropagation: vi.fn(),
}));

vi.mock('../../../plugins/matrix-to', () => ({
  getMatrixToRoom: () => 'matrix.to/#/!room:example.org',
}));

vi.mock('../../../plugins/via-servers', () => ({
  getViaServers: () => [],
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../../hooks/useRoomPinnedEvents', () => ({
  useRoomPinnedEvents: () => [],
}));

vi.mock('../../../features/room/room-pin-menu', () => ({
  RoomPinMenu: () => React.createElement('div'),
}));

vi.mock('../../../state/hooks/roomSettings', () => ({
  useOpenRoomSettings: () => vi.fn(),
}));

vi.mock('../../../components/RoomNotificationSwitcher', () => ({
  RoomNotificationModeSwitcher: ({
    children,
  }: {
    children: (handleOpen: () => void, opened: boolean, changing: boolean) => React.ReactNode;
  }) => React.createElement(React.Fragment, null, children(vi.fn(), false, false)),
}));

vi.mock('../../../hooks/useRoomsNotificationPreferences', () => ({
  getRoomNotificationMode: () => 'all_messages',
  getRoomNotificationModeIcon: () => 'Notification',
  useRoomsNotificationPreferencesContext: () => ({}),
}));

vi.mock('../../../features/room/jump-to-time', () => ({
  JumpToTime: () => React.createElement('div'),
}));

vi.mock('../../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => [],
}));

vi.mock('../../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    action: () => true,
  }),
}));

const renderHeader = async () => {
  const store = createStore();
  const { RoomViewHeader } = await import('../../../features/room/RoomViewHeader');
  const renderer = create(
    React.createElement(
      Provider,
      { store },
      React.createElement(RoomViewHeader)
    )
  );

  return { renderer, store };
};

afterEach(() => {
  encryptionState.value = undefined;
  screenSizeState.value = 'Desktop';
});

describe('RoomViewHeader', () => {
  it('opens the shared command palette atom from the new top-bar button', async () => {
    const { renderer, store } = await renderHeader();
    const button = renderer.root.findByProps({ 'aria-label': 'Open command palette' });

    await act(async () => {
      button.props.onClick();
    });

    expect(store.get(commandPaletteOpenAtom)).toBe(true);
  });

  it('keeps the command palette button visible on mobile and in encrypted rooms', async () => {
    screenSizeState.value = 'Mobile';
    encryptionState.value = {};
    const { renderer } = await renderHeader();

    expect(renderer.root.findByProps({ 'aria-label': 'Open command palette' })).toBeDefined();
    expect(renderer.root.findAll((node) => node.props?.['data-icon'] === 'Search')).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.props?.['data-icon'] === 'Terminal')).toHaveLength(1);
  });
});
