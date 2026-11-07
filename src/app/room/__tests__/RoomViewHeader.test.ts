import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasListEntry } from '../../canvas/canvasIndexStore';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const { encryptionState, navigateSpy, permissionState, screenSizeState, membersState } = vi.hoisted(
  () => ({
    navigateSpy: vi.fn(),
    membersState: { open: false, setOpen: vi.fn() },
    encryptionState: {
      value: undefined as unknown,
    },
    permissionState: {
      canInvite: true,
      canKick: true,
    },
    screenSizeState: {
      value: 'Desktop',
    },
  })
);

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  const reactModule = await import('react');

  return {
    ...actual,
    Avatar: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Badge: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    Box: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
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
      Monitor: 'Monitor',
      Pin: 'Pin',
      Search: 'Search',
      Terminal: 'Terminal',
      User: 'User',
      VerticalDots: 'VerticalDots',
    },
    Line: () => reactModule.createElement('hr'),
    Menu: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    MenuItem: ({
      children,
      after,
      onClick,
    }: {
      children: React.ReactNode;
      after?: React.ReactNode;
      onClick?: () => void;
    }) => reactModule.createElement('button', { type: 'button', onClick }, children, after),
    Overlay: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    OverlayBackdrop: () => reactModule.createElement('div'),
    OverlayCenter: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    PopOut: ({ anchor, content }: { anchor?: unknown; content: React.ReactNode }) =>
      anchor ? content : null,
    Spinner: () => reactModule.createElement('div'),
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
    toRem: (value: number) => `${value}rem`,
    Tooltip: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('div', null, children),
    TooltipProvider: ({
      children,
    }: {
      children: (triggerRef: React.Ref<HTMLButtonElement>) => React.ReactNode;
    }) =>
      reactModule.createElement(
        reactModule.Fragment,
        null,
        children(() => undefined)
      ),
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
  useNavigate: () => navigateSpy,
}));

vi.mock('../../ui/page/Page', () => ({
  PageHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../ui/styles/ContainerColor.css', () => ({
  ContainerColor: () => 'ContainerColor',
}));

vi.mock('../../avatars/RoomAvatar', () => ({
  RoomAvatar: () => React.createElement('div'),
  RoomIcon: () => React.createElement('div'),
}));

vi.mock('../RoomTopicViewer', () => ({
  RoomTopicViewer: () => React.createElement('div'),
}));

vi.mock('../../rooms/LeaveRoomPrompt', () => ({
  LeaveRoomPrompt: () => React.createElement('div'),
}));

vi.mock('../../members/invite/InviteUserPrompt', () => ({
  InviteUserPrompt: () => React.createElement('div'),
}));

vi.mock('../../matrix/hooks/useStateEvent', () => ({
  useStateEvent: () => encryptionState.value,
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getHomeserverUrl: () => 'https://example.org',
    getSafeUserId: () => '@user:example.org',
  }),
}));

vi.mock('../../matrix/hooks/useRoom', () => ({
  useRoom: () => ({
    roomId: '!room:example.org',
    getJoinRule: () => undefined,
    isSpaceRoom: () => false,
  }),
  useIsDirectRoom: () => false,
}));

vi.mock('../../members/useMembersDrawer', () => ({
  useMembersDrawer: () => [membersState.open, membersState.setOpen],
}));

vi.mock('../../matrix/hooks/useSpace', () => ({
  useSpaceOptionally: () => undefined,
}));

vi.mock('../../matrix/matrix', () => ({
  getCanonicalAliasOrRoomId: () => '!room:example.org',
  isRoomAlias: () => false,
  mxcUrlToHttp: () => undefined,
}));

vi.mock('../RoomViewHeader.css', () => ({
  HeaderActionButton: 'HeaderActionButton',
  HeaderTopic: 'HeaderTopic',
}));

vi.mock('../RoomViewHeaderLayout.css', () => ({
  Header: 'Header',
  Topic: 'Topic',
}));

vi.mock('../../schedules/roomSchedules.css', () => ({
  Trigger: 'Trigger',
  Count: 'Count',
}));

// The schedules browser tests exercise the dialog and its mention/profile UI.
vi.mock('../../schedules/RoomSchedulesDialog', () => ({
  RoomSchedulesDialog: () => null,
}));

vi.mock('../../matrix/hooks/useStateEvents', () => ({
  useStateEvents: () => [],
}));

vi.mock('../../notifications/MarkRoomReadMenuItem', () => ({
  MarkRoomReadMenuItem: () => null,
}));

vi.mock('../../rooms/archive/ArchiveRoomMenuItem', () => ({
  ArchiveRoomMenuItem: () => null,
}));

vi.mock('../../canvas/CanvasHeaderButton', () => ({
  CanvasHeaderButton: (props: Record<string, unknown>) =>
    React.createElement('mock-canvas-header-button', props),
}));

vi.mock('../../navigation/useRoomViewMode', () => ({
  useRoomViewMode: () => ({ availableViewModes: [], setViewMode: vi.fn(), viewMode: 'threaded' }),
}));

vi.mock('../../matrix/state/useUnread', () => ({
  useRoomUnread: () => false,
}));

vi.mock('../../matrix/hooks/usePowerLevels', () => ({
  usePowerLevels: () => ({}),
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../notifications/readReceipts', () => ({
  markRoomAndThreadsAsRead: vi.fn(),
}));

vi.mock('../../matrix/state/roomToUnread', () => ({
  roomToUnreadAtom: {},
}));

vi.mock('../../lib/dom', () => ({
  copyToClipboard: vi.fn(),
}));

vi.mock('../../matrix/hooks/useRoomMeta', () => ({
  useRoomAvatar: () => undefined,
  useRoomName: () => 'General',
  useRoomTopic: () => undefined,
}));

vi.mock('../../lib/hooks/useScreenSize', () => ({
  ScreenSize: {
    Desktop: 'Desktop',
    Tablet: 'Tablet',
    Mobile: 'Mobile',
  },
  useScreenSizeContext: () => screenSizeState.value,
}));

vi.mock('../../lib/keyboard', () => ({
  stopPropagation: vi.fn(),
}));

vi.mock('../../matrix/matrix-to', () => ({
  getMatrixToRoom: () => 'matrix.to/#/!room:example.org',
}));

vi.mock('../../matrix/via-servers', () => ({
  getViaServers: () => [],
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../event-store/threads/useThreadPinning', () => ({
  usePinnedEventIds: () => [],
}));

vi.mock('../../messages/pins/RoomPinMenu', () => ({
  RoomPinMenu: () => React.createElement('div'),
}));

vi.mock('../../navigation/useRoomSettingsState', () => ({
  useOpenRoomSettings: () => vi.fn(),
}));

vi.mock('../../notifications/RoomNotificationSwitcher', () => ({
  RoomNotificationModeSwitcher: ({
    children,
  }: {
    children: (handleOpen: () => void, opened: boolean, changing: boolean) => React.ReactNode;
  }) => React.createElement(React.Fragment, null, children(vi.fn(), false, false)),
}));

vi.mock('../../matrix/hooks/useRoomsNotificationPreferences', () => ({
  getRoomNotificationMode: () => 'all_messages',
  getRoomNotificationModeIcon: () => 'Notification',
  useRoomsNotificationPreferencesContext: () => ({}),
}));

vi.mock('../../timeline/jump-to-time/JumpToTime', () => ({
  JumpToTime: () => React.createElement('div'),
}));

vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: vi.fn(),
    navigateRoomThread: vi.fn(),
  }),
}));

vi.mock('../../matrix/hooks/useRoomCreators', () => ({
  useRoomCreators: () => new Set<string>(),
}));

vi.mock('../../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    action: (action: string) =>
      action === 'invite' ? permissionState.canInvite : permissionState.canKick,
  }),
}));

const renderHeader = async (
  joinRequestCount = 0,
  headerProps: {
    hasMindroomAgents?: boolean;
    computerAvailable?: boolean;
    computerOpen?: boolean;
    computerShown?: boolean;
    onComputerToggle?: () => void;
    shownPanel?: string;
    onPanelToggle?: (id: string) => void;
    canvases?: CanvasListEntry[];
    openCanvasId?: string;
    onCanvasOpen?: (canvasId: string) => void;
    onCanvasClose?: () => void;
    threadId?: string;
  } = {}
) => {
  const store = createStore();
  const { RoomViewHeader } = await import('../RoomViewHeader');
  const renderer = create(
    React.createElement(
      Provider,
      { store },
      React.createElement(RoomViewHeader, {
        hasMindroomAgents: true,
        joinRequestCount,
        ...headerProps,
      })
    )
  );

  return { renderer, store };
};

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

/** Opens the room menu from the header's More Options button. */
const openRoomMenu = (renderer: ReturnType<typeof create>) =>
  act(async () =>
    renderer.root
      .findByProps({ 'aria-label': 'More Options' })
      .props.onClick({ currentTarget: { getBoundingClientRect: () => ({}) } })
  );

/** The room menu's entries (buttons without a label of their own) whose text is `text`. */
const findMenuEntries = (renderer: ReturnType<typeof create>, text: string) =>
  renderer.root.findAll(
    (node) => node.type === 'button' && !node.props['aria-label'] && textOf(node) === text
  );

/**
 * The control that shows Members: the header button, or on phones the room menu's entry, which
 * the menu opens first.
 */
const membersControl = async (renderer: ReturnType<typeof create>, label: string) => {
  if (screenSizeState.value !== 'Mobile') return renderer.root.findByProps({ 'aria-label': label });
  await openRoomMenu(renderer);
  const [entry] = findMenuEntries(renderer, label);
  if (!entry) throw new Error(`No room menu entry ${label}`);
  return entry;
};

afterEach(() => {
  membersState.open = false;
  membersState.setOpen.mockClear();
  encryptionState.value = undefined;
  screenSizeState.value = 'Desktop';
  permissionState.canInvite = true;
  permissionState.canKick = true;
});

importBeforeTests(() => import('../RoomViewHeader'));

describe('RoomViewHeader', () => {
  it('hides schedules without agents', async () => {
    const { renderer } = await renderHeader(0, { hasMindroomAgents: false });
    expect(renderer.root.findAllByProps({ 'aria-label': 'Scheduled tasks (0)' })).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it('keeps schedules accessible on phones, in the room menu', async () => {
    screenSizeState.value = 'Mobile';
    const { renderer } = await renderHeader();
    expect(renderer.root.findAllByProps({ 'aria-label': 'Scheduled tasks (0)' })).toHaveLength(0);
    await openRoomMenu(renderer);
    expect(findMenuEntries(renderer, 'Scheduled tasks (0)')).toHaveLength(1);
    act(() => renderer.unmount());
  });

  it("keeps a phone's header to the back button, the name and the room menu", async () => {
    screenSizeState.value = 'Mobile';
    const { renderer } = await renderHeader(0, {
      canvases: [
        {
          canvasId: '$canvas',
          roomId: '!room:example.org',
          threadId: '$thread',
          agentUserId: '@mindroom_helper:example.org',
          title: 'Plans',
          createdTs: 1,
          revisionId: '$canvas',
          updatedTs: 1,
          shared: false,
        },
      ],
      onCanvasOpen: vi.fn(),
      onCanvasClose: vi.fn(),
    });
    const labelled = renderer.root
      .findAll((node) => node.type === 'button' && !!node.props['aria-label'])
      .map((node) => node.props['aria-label'] as string);
    expect(labelled).toEqual(['Back', 'More Options']);
    expect(renderer.root.findAllByType('mock-canvas-header-button' as never)).toHaveLength(0);

    await openRoomMenu(renderer);
    for (const entry of ['Scheduled tasks (0)', 'Show Canvas', 'Show Members']) {
      expect(findMenuEntries(renderer, entry), entry).toHaveLength(1);
    }
    act(() => renderer.unmount());
  });

  it.each(
    ['Desktop', 'Tablet', 'Mobile'].flatMap((screen) =>
      [false, true].map((storedOpen) => ({ screen, storedOpen }))
    )
  )(
    'opens Members over Computer on $screen with stored visibility $storedOpen',
    async ({ screen, storedOpen }) => {
      screenSizeState.value = screen;
      membersState.open = storedOpen;
      const onComputerToggle = vi.fn();
      const onPanelToggle = vi.fn();
      const { renderer } = await renderHeader(0, {
        computerAvailable: true,
        computerOpen: true,
        onComputerToggle,
        shownPanel: 'computer',
        onPanelToggle,
      });
      const button = await membersControl(renderer, 'Show Members');
      await act(async () => button.props.onClick());
      expect(onPanelToggle).toHaveBeenCalledWith('members');
      act(() => renderer.unmount());
    }
  );

  it.each(
    ['Desktop', 'Tablet'].flatMap((screen) =>
      [false, true].map((storedOpen) => ({ screen, storedOpen }))
    )
  )(
    'replaces an open canvas with Members in one click on $screen with stored visibility $storedOpen',
    async ({ screen, storedOpen }) => {
      screenSizeState.value = screen;
      membersState.open = storedOpen;
      const onPanelToggle = vi.fn();
      const { renderer } = await renderHeader(0, { shownPanel: 'canvas', onPanelToggle });
      const button = renderer.root.findByProps({ 'aria-label': 'Show Members' });
      await act(async () => button.props.onClick());
      expect(onPanelToggle).toHaveBeenCalledWith('members');
      act(() => renderer.unmount());
    }
  );

  it.each(['Desktop', 'Tablet', 'Mobile'])(
    'leaves the command palette to the sidebar and shortcut on %s',
    async (screen) => {
      screenSizeState.value = screen;
      const { renderer } = await renderHeader();

      expect(renderer.root.findAllByProps({ 'aria-label': 'Open command palette' })).toHaveLength(
        0
      );
      expect(
        renderer.root.findAll((node) => node.props?.['data-icon'] === 'Terminal')
      ).toHaveLength(0);
      act(() => renderer.unmount());
    }
  );

  it.each([
    { label: 'an unencrypted room', encrypted: false, offered: true },
    { label: 'an encrypted room', encrypted: true, offered: false },
  ])(
    'offers message search in the room menu, not the top bar, for $label',
    async ({ encrypted, offered }) => {
      if (encrypted) encryptionState.value = {};
      const { renderer } = await renderHeader(0, {});
      const findIcons = (icon: string) =>
        renderer.root.findAll((node) => node.props?.['data-icon'] === icon);
      const findMessageSearch = () =>
        renderer.root.findAll(
          (node) => node.type === 'button' && textOf(node).includes('Message Search')
        );

      expect(findIcons('Search')).toHaveLength(0);
      const moreOptions = renderer.root.findByProps({ 'aria-label': 'More Options' });
      await act(async () =>
        moreOptions.props.onClick({ currentTarget: { getBoundingClientRect: () => ({}) } })
      );

      expect(
        renderer.root.findAll((node) => node.type === 'button' && textOf(node) === 'Leave Room')
      ).toHaveLength(1);
      // An encrypted room keeps the entry in its place, disabled, with the reason.
      expect(findMessageSearch()).toHaveLength(1);
      expect(textOf(findMessageSearch()[0]).includes('Not available in encrypted rooms')).toBe(
        !offered
      );
      expect(findMessageSearch()[0].props.onClick === undefined).toBe(!offered);
      if (offered) {
        navigateSpy.mockClear();
        await act(async () => findMessageSearch()[0].props.onClick());
        expect(navigateSpy).toHaveBeenCalledWith(
          `/home/search/?${new URLSearchParams({ rooms: '!room:example.org' })}`
        );
      }
      act(() => renderer.unmount());
    }
  );

  it.each(['Desktop', 'Tablet'])(
    'shows pending join requests on the %s Members button only to moderators',
    async (screenSize) => {
      screenSizeState.value = screenSize;
      const { renderer } = await renderHeader(2);

      expect(
        renderer.root.findByProps({
          'aria-label': 'Show Members, 2 pending join requests',
        })
      ).toBeDefined();
      expect(renderer.root.findAllByProps({ children: 2 }).length).toBeGreaterThan(0);

      permissionState.canInvite = false;
      permissionState.canKick = false;
      const { renderer: unauthorizedRenderer } = await renderHeader(2);

      expect(
        unauthorizedRenderer.root.findAllByProps({
          'aria-label': 'Show Members, 2 pending join requests',
        })
      ).toHaveLength(0);
      expect(
        unauthorizedRenderer.root.findByProps({
          'aria-label': 'Show Members',
        })
      ).toBeDefined();
    }
  );

  it('shows pending join requests on phones in the room menu, with a dot on its button', async () => {
    screenSizeState.value = 'Mobile';
    const dots = (renderer: ReturnType<typeof create>) =>
      renderer.root.findAll((node) => node.props['data-room-menu-dot'] === '');
    const { renderer } = await renderHeader(2);
    expect(dots(renderer).length).toBeGreaterThan(0);
    await openRoomMenu(renderer);
    expect(findMenuEntries(renderer, 'Show Members, 2 pending join requests')).toHaveLength(1);
    act(() => renderer.unmount());

    permissionState.canInvite = false;
    permissionState.canKick = false;
    const { renderer: unauthorized } = await renderHeader(2);
    expect(dots(unauthorized)).toHaveLength(0);
    await openRoomMenu(unauthorized);
    expect(findMenuEntries(unauthorized, 'Show Members')).toHaveLength(1);
    act(() => unauthorized.unmount());
  });

  describe('canvas entry point', () => {
    const listed: CanvasListEntry[] = [
      {
        canvasId: '$canvas',
        roomId: '!room:example.org',
        threadId: '$thread',
        agentUserId: '@mindroom_helper:example.org',
        title: 'Plans',
        createdTs: 1,
        revisionId: '$canvas',
        updatedTs: 1,
        shared: false,
      },
    ];
    const findCanvasButtons = (renderer: ReturnType<typeof create>) =>
      renderer.root.findAllByType('mock-canvas-header-button' as never);

    it('renders the Canvas button with the conversation’s canvases and its handlers', async () => {
      const onCanvasOpen = vi.fn();
      const onCanvasClose = vi.fn();
      const { renderer } = await renderHeader(0, {
        canvases: listed,
        openCanvasId: '$canvas',
        onCanvasOpen,
        onCanvasClose,
      });

      const buttons = findCanvasButtons(renderer);
      expect(buttons).toHaveLength(1);
      expect(buttons[0].props).toEqual({
        canvases: listed,
        openCanvasId: '$canvas',
        onOpen: onCanvasOpen,
        onClose: onCanvasClose,
      });
      act(() => renderer.unmount());
    });

    it.each([
      { name: 'there are no canvases', canvases: undefined, open: vi.fn(), close: vi.fn() },
      { name: 'it cannot open one', canvases: listed, open: undefined, close: vi.fn() },
      { name: 'it cannot close one', canvases: listed, open: vi.fn(), close: undefined },
    ])('renders no Canvas button when $name', async ({ canvases, open, close }) => {
      const { renderer } = await renderHeader(0, {
        canvases,
        onCanvasOpen: open,
        onCanvasClose: close,
      });

      expect(findCanvasButtons(renderer)).toHaveLength(0);
      act(() => renderer.unmount());
    });
  });

  describe('computer entry points', () => {
    const findButton = (renderer: ReturnType<typeof create>, label: string) =>
      renderer.root.findAll((node) => node.type === 'button' && node.props['aria-label'] === label);
    const findMenuItem = (renderer: ReturnType<typeof create>) =>
      renderer.root.findAll(
        (node) =>
          node.type === 'button' && !node.props['aria-label'] && textOf(node) === 'Show Computer'
      );
    const openMoreMenu = (renderer: ReturnType<typeof create>) =>
      act(async () =>
        renderer.root
          .findByProps({ 'aria-label': 'More Options' })
          .props.onClick({ currentTarget: { getBoundingClientRect: () => ({}) } })
      );

    const base = { available: true, open: false, shown: false, toggle: true };
    it.each([
      { name: 'was never shown', ...base, entry: 'menu' },
      { name: 'was shown', ...base, shown: true, entry: 'button' },
      { name: 'is open', ...base, open: true, entry: 'button' },
      { name: 'is open and was shown', ...base, open: true, shown: true, entry: 'button' },
      { name: 'is unavailable', ...base, available: false, entry: 'none' },
      {
        name: 'is unavailable but was shown',
        ...base,
        available: false,
        shown: true,
        entry: 'none',
      },
      { name: 'cannot be toggled', ...base, shown: true, toggle: false, entry: 'none' },
    ])(
      'offers the computer through the $entry when it $name',
      async ({ available, open, shown, toggle, entry }) => {
        const { renderer } = await renderHeader(0, {
          computerAvailable: available,
          computerOpen: open,
          computerShown: shown,
          onComputerToggle: toggle ? vi.fn() : undefined,
        });
        await openMoreMenu(renderer);

        const button = [
          ...findButton(renderer, 'Show Computer'),
          ...findButton(renderer, 'Hide Computer'),
        ];
        expect(button).toHaveLength(entry === 'button' ? 1 : 0);
        expect(findMenuItem(renderer)).toHaveLength(entry === 'menu' ? 1 : 0);
        act(() => renderer.unmount());
      }
    );

    it.each([
      { screen: 'Desktop', shown: true, open: false },
      { screen: 'Tablet', shown: true, open: false },
      { screen: 'Tablet', shown: false, open: true },
    ])(
      'keeps the header button on $screen (shown $shown, open $open)',
      async ({ screen, shown, open }) => {
        screenSizeState.value = screen;
        const { renderer } = await renderHeader(0, {
          computerAvailable: true,
          computerShown: shown,
          computerOpen: open,
          onComputerToggle: vi.fn(),
        });

        expect([
          ...findButton(renderer, 'Show Computer'),
          ...findButton(renderer, 'Hide Computer'),
        ]).toHaveLength(1);
        act(() => renderer.unmount());
      }
    );

    // A phone's header holds only Back, the name and More (and a call that is on).
    it.each([
      { name: 'was shown', shown: true, open: false },
      { name: 'is open', shown: false, open: true },
      { name: 'was never shown', shown: false, open: false },
    ])('offers the computer only through the room menu on phones when it $name', async (state) => {
      screenSizeState.value = 'Mobile';
      const { renderer } = await renderHeader(0, {
        computerAvailable: true,
        computerShown: state.shown,
        computerOpen: state.open,
        onComputerToggle: vi.fn(),
      });
      await openMoreMenu(renderer);

      expect(findButton(renderer, 'Show Computer')).toHaveLength(0);
      expect(findButton(renderer, 'Hide Computer')).toHaveLength(0);
      // The entry is named after whether the computer shows, as the button is.
      const entry = state.open ? 'Hide Computer' : 'Show Computer';
      expect(findMenuEntries(renderer, entry)).toHaveLength(1);
      act(() => renderer.unmount());
    });

    it('does not offer the computer on phones when it is unavailable', async () => {
      screenSizeState.value = 'Mobile';
      const { renderer } = await renderHeader(0, {
        computerAvailable: false,
        computerShown: true,
        onComputerToggle: vi.fn(),
      });
      await openMoreMenu(renderer);

      expect(findButton(renderer, 'Show Computer')).toHaveLength(0);
      expect(findMenuItem(renderer)).toHaveLength(0);
      act(() => renderer.unmount());
    });

    it('opens the computer from the room menu and closes the menu', async () => {
      const onComputerToggle = vi.fn();
      const { renderer } = await renderHeader(0, {
        computerAvailable: true,
        onComputerToggle,
      });
      await openMoreMenu(renderer);
      const leaveRoom = () =>
        renderer.root.findAll((node) => node.type === 'button' && textOf(node) === 'Leave Room');
      expect(leaveRoom()).toHaveLength(1);

      await act(async () => findMenuItem(renderer)[0].props.onClick());

      expect(onComputerToggle).toHaveBeenCalledOnce();
      expect(leaveRoom()).toHaveLength(0);
      act(() => renderer.unmount());
    });
  });
});
