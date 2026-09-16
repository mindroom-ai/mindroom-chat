import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockRoomViewProps = {
  computerAvailable?: boolean;
  computerOpen?: boolean;
  hasMindroomAgents?: boolean;
  joinRequestCount?: number;
  eventId?: string;
  focusEventInRoom?: boolean;
  threadId?: string;
  onThreadLoadError?: (threadId: string) => void;
  onComputerToggle?: () => void;
};

type MockComputerPanelProps = {
  agents: Array<{ userId: string; name: string }>;
  continuationReady?: boolean;
  apiUrl: string;
  roomId: string;
  threadId?: string;
};

type MockCallChatViewProps = MockRoomViewProps & {
  room: { roomId: string; isCallRoom: () => boolean };
};

const { mx, navigateRoomMock, navigateRoomThreadMock, removeRecentThreadMock, room, roomState } =
  vi.hoisted(() => ({
    navigateRoomMock: vi.fn(),
    navigateRoomThreadMock: vi.fn(),
    removeRecentThreadMock: vi.fn(),
    mx: { getSafeUserId: () => '@alice:example.org' },
    room: {
      roomId: '!room:example.org',
      isCallRoom: () => roomState.callRoom,
      getMembers: () => roomState.members,
      getThread: () => undefined,
      findEventById: () => roomState.routedEvent,
      on: (name: string, handler: (...args: unknown[]) => void) =>
        roomState.listeners.set(name, handler),
      removeListener: (name: string) => roomState.listeners.delete(name),
    },
    roomState: {
      listeners: new Map<string, (...args: unknown[]) => void>(),
      drawer: false,
      screenSize: 'Desktop',
      panelDisposals: 0,
      routedEvent: undefined as
        | undefined
        | { getId: () => string; threadRootId?: string; isSending: () => boolean },
      callChat: false,
      callChatViewProps: undefined as MockCallChatViewProps | undefined,
      callRoom: false,
      clientConfig: { mindroom: {} } as { mindroom?: { computers?: { apiUrl?: string } } },
      computerPanelProps: undefined as MockComputerPanelProps | undefined,
      eventId: undefined as string | undefined,
      members: [] as Array<{ membership: string; userId: string }>,
      search: '',
      roomViewProps: undefined as MockRoomViewProps | undefined,
      setPeopleDrawer: vi.fn(),
    },
  }));

vi.mock('folds', () => ({
  Box: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  Line: () => React.createElement('div'),
  Overlay: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  OverlayBackdrop: () => React.createElement('div'),
}));

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock('../../sidebar/ResizablePanel.css', () => ({ Panel: 'panel', Handle: 'handle' }));
vi.mock('../../sidebar/ResizableMembersPanel.css', () => ({ MobileOverlay: 'mobile-overlay' }));

vi.mock('is-hotkey', () => ({
  isKeyHotkey: () => false,
}));

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai');

  return {
    ...actual,
    useAtomValue: () => roomState.callChat,
  };
});

vi.mock('react-router-dom', () => ({
  useParams: () => ({ eventId: roomState.eventId }),
  useSearchParams: () => [new URLSearchParams(roomState.search)],
}));

vi.mock('../../../features/room/RoomView', () => ({
  RoomView: (props: MockRoomViewProps) => {
    roomState.roomViewProps = props;
    return React.createElement('mock-room-view');
  },
}));

vi.mock('../MindroomRoomView', () => ({
  RoomView: (props: MockRoomViewProps) => {
    roomState.roomViewProps = props;
    return React.createElement('mock-room-view');
  },
}));

vi.mock('../../../features/room/MembersDrawer', () => ({
  MembersDrawer: () => React.createElement('aside', { 'aria-label': 'Members' }),
}));

vi.mock('../../../hooks/useScreenSize', () => ({
  ScreenSize: {
    Desktop: 'Desktop',
    Tablet: 'Tablet',
    Mobile: 'Mobile',
  },
  useScreenSizeContext: () => roomState.screenSize,
}));

vi.mock('../../../state/hooks/settings', () => ({
  useSetting: (_atom: unknown, key: string) => {
    switch (key) {
      case 'hideActivity':
        return [false];
      default:
        return [false];
    }
  },
}));

vi.mock('../../sidebar/useMembersDrawer', () => ({
  useMembersDrawer: () => [roomState.drawer, roomState.setPeopleDrawer],
}));

vi.mock('../../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../../hooks/usePowerLevels', () => ({
  PowerLevelsContextProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  usePowerLevels: () => ({}),
}));

vi.mock('../../../hooks/useRoom', () => ({
  useRoom: () => room,
}));

vi.mock('../../../hooks/useKeyDown', () => ({
  useKeyDown: vi.fn(),
}));

vi.mock('../../notifications/readReceipts', () => ({
  markRoomAndThreadsAsRead: vi.fn(),
  markThreadAsRead: vi.fn(),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mx,
}));

vi.mock('../../../hooks/useClientConfig', () => ({
  useClientConfig: () => roomState.clientConfig,
}));

vi.mock('../../computer/ComputerPanel', () => ({
  ComputerPanel: (props: MockComputerPanelProps) => {
    React.useEffect(
      () => () => {
        roomState.panelDisposals += 1;
      },
      []
    );
    roomState.computerPanelProps = props;
    return React.createElement('mock-computer-panel');
  },
}));

vi.mock('../useRoomViewMode', () => ({
  useRoomViewMode: () => ({ viewMode: 'threaded' }),
}));

vi.mock('../../../hooks/useRoomMembers', () => ({
  useRoomMembers: () => roomState.members,
}));

vi.mock('../../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: navigateRoomMock,
    navigateRoomThread: navigateRoomThreadMock,
  }),
}));

vi.mock('../../recent-threads/recentThreads', () => ({
  removeRecentThread: removeRecentThreadMock,
}));

vi.mock('../../../features/call/CallView', () => ({
  CallView: () => React.createElement('div'),
}));

vi.mock('../../../features/room/RoomViewHeader', () => ({
  RoomViewHeader: () => React.createElement('mock-room-view-header'),
}));

vi.mock('../MindroomRoomViewHeader', () => ({
  RoomViewHeader: () => React.createElement('mock-room-view-header'),
}));

vi.mock('../MindroomCallChatView', () => ({
  MindroomCallChatView: (props: MockCallChatViewProps) => {
    roomState.callChatViewProps = props;
    return React.createElement('mock-call-chat-view');
  },
}));

vi.mock('../../../state/callEmbed', () => ({
  callChatAtom: {},
}));

vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });

describe('Room', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    roomState.listeners.clear();
    roomState.drawer = false;
    roomState.screenSize = 'Desktop';
    roomState.panelDisposals = 0;
    roomState.routedEvent = undefined;
    roomState.callChat = false;
    roomState.callChatViewProps = undefined;
    roomState.callRoom = false;
    roomState.clientConfig = { mindroom: {} };
    roomState.computerPanelProps = undefined;
    roomState.eventId = undefined;
    roomState.members = [];
    roomState.search = '';
    roomState.roomViewProps = undefined;
    roomState.setPeopleDrawer.mockReset();
    navigateRoomMock.mockReset();
    navigateRoomThreadMock.mockReset();
    removeRecentThreadMock.mockReset();
  });

  it('stays on the room timeline on bare room entry', async () => {
    const { Room } = await import('../../../features/room/Room');

    await act(async () => {
      create(React.createElement(Room));
    });

    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
    expect(navigateRoomMock).not.toHaveBeenCalled();
  });

  it.each(['Desktop', 'Tablet', 'Mobile'])(
    'shows the requested member sidebar on %s',
    async (size) => {
      roomState.screenSize = size;
      roomState.drawer = true;
      const { Room } = await import('../../../features/room/Room');
      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(React.createElement(Room));
      });
      expect(renderer!.root.findAllByType('aside')).toHaveLength(1);
      await act(async () => renderer!.unmount());
    }
  );

  it('passes live agent membership to the room toolbar surface', async () => {
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    expect(roomState.roomViewProps?.hasMindroomAgents).toBe(false);

    roomState.members = [
      { membership: 'invite', userId: '@mindroom_helper:example.org' },
      { membership: 'join', userId: '@alice:example.org' },
    ];
    await act(async () => {
      renderer!.update(React.createElement(Room));
    });
    expect(roomState.roomViewProps?.hasMindroomAgents).toBe(true);
  });

  it('passes the live pending join request count to the room header surface', async () => {
    roomState.members = [
      { membership: 'knock', userId: '@alice:example.org' },
      { membership: 'join', userId: '@bob:example.org' },
      { membership: 'knock', userId: '@carol:example.org' },
    ];
    const { Room } = await import('../../../features/room/Room');

    await act(async () => {
      create(React.createElement(Room));
    });

    expect(roomState.roomViewProps?.joinRequestCount).toBe(2);
  });

  it('opens the configured computer panel only for exact joined agent identities', async () => {
    roomState.clientConfig = {
      mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
    };
    roomState.members = [
      { membership: 'join', userId: '@mindroom_helper:example.org', name: 'Helper' },
      { membership: 'invite', userId: '@mindroom_invited:example.org', name: 'Invited' },
      { membership: 'join', userId: '@alice:example.org', name: 'Alice' },
    ] as never;
    roomState.search = '?threadId=%24thread';
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    expect(roomState.roomViewProps?.computerAvailable).toBe(true);

    await act(async () => roomState.roomViewProps?.onComputerToggle?.());

    expect(renderer!.root.findAllByType('mock-computer-panel')).toHaveLength(1);
    expect(roomState.setPeopleDrawer).toHaveBeenCalledWith(false);
    expect(roomState.computerPanelProps).toMatchObject({
      agents: [{ userId: '@mindroom_helper:example.org', name: 'Helper' }],
      apiUrl: 'https://computer.example.org',
      roomId: '!room:example.org',
      threadId: '$thread',
    });
  });

  it.each(['$root', '$reply'])(
    'routes continuation after canonical root %s resolves',
    async (resolvedRoot) => {
      roomState.clientConfig = {
        mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
      };
      roomState.members = [{ membership: 'join', userId: '@mindroom_helper:example.org' }];
      roomState.search = '?threadId=%24reply';
      const { Room } = await import('../../../features/room/Room');
      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(React.createElement(Room));
      });
      await act(async () => roomState.roomViewProps?.onComputerToggle?.());
      expect(roomState.computerPanelProps?.continuationReady).toBe(false);
      roomState.routedEvent = {
        getId: () => '$reply',
        threadRootId: resolvedRoot,
        isSending: () => false,
      };
      const { RoomEvent } = await import('matrix-js-sdk');
      await act(async () =>
        roomState.listeners.get(RoomEvent.Timeline)?.(roomState.routedEvent, room, false, false)
      );
      expect(roomState.computerPanelProps?.threadId).toBe(resolvedRoot);
      expect(roomState.computerPanelProps?.continuationReady).toBe(true);
      await act(async () => renderer!.unmount());
    }
  );

  it.each(['agent', 'api'])(
    'restores Members and disposes Computer when %s availability vanishes',
    async (cause) => {
      roomState.drawer = true;
      roomState.clientConfig = {
        mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
      };
      const members = [{ membership: 'join', userId: '@mindroom_helper:example.org' }];
      roomState.members = members;
      const { Room } = await import('../../../features/room/Room');
      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(React.createElement(Room));
      });
      await act(async () => roomState.roomViewProps?.onComputerToggle?.());
      expect(renderer!.root.findAllByProps({ 'aria-label': 'Members' })).toHaveLength(0);
      if (cause === 'agent') roomState.members = [];
      else
        roomState.clientConfig = {
          mindroom: { computers: { apiUrl: 'http://remote.example.org' } },
        };
      await act(async () => renderer!.update(React.createElement(Room)));
      expect(roomState.roomViewProps?.computerOpen).toBe(false);
      expect(roomState.panelDisposals).toBe(1);
      expect(renderer!.root.findAllByProps({ 'aria-label': 'Members' })).toHaveLength(1);
      roomState.members = members;
      roomState.clientConfig = {
        mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
      };
      await act(async () => renderer!.update(React.createElement(Room)));
      expect(roomState.roomViewProps?.computerOpen).toBe(false);
      await act(async () => renderer!.unmount());
    }
  );

  it('closes an open computer panel when the routed thread changes', async () => {
    roomState.clientConfig = {
      mindroom: { computers: { apiUrl: 'https://computer.example.org' } },
    };
    roomState.members = [
      { membership: 'join', userId: '@mindroom_helper:example.org', name: 'Helper' },
    ] as never;
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Room));
    });
    await act(async () => roomState.roomViewProps?.onComputerToggle?.());
    expect(renderer!.root.findAllByType('mock-computer-panel')).toHaveLength(1);

    roomState.search = '?threadId=%24new-thread';
    await act(async () => renderer!.update(React.createElement(Room)));

    expect(renderer!.root.findAllByType('mock-computer-panel')).toHaveLength(0);
  });

  it('leaves an explicit thread in the URL untouched', async () => {
    roomState.search = '?threadId=%24explicit';
    const { Room } = await import('../../../features/room/Room');

    await act(async () => {
      create(React.createElement(Room));
    });

    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
    expect(navigateRoomMock).not.toHaveBeenCalled();
  });

  it('does not navigate when returning to a room after leaving a thread', async () => {
    roomState.search = '?threadId=%24opened';
    const { Room } = await import('../../../features/room/Room');

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });

    roomState.search = '';

    await act(async () => {
      renderer!.update(React.createElement(Room));
    });

    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
    expect(navigateRoomMock).not.toHaveBeenCalled();
  });

  it('drops a thread from recent threads when it fails to load', async () => {
    roomState.search = '?threadId=%24saved';
    const { Room } = await import('../../../features/room/Room');

    await act(async () => {
      create(React.createElement(Room));
    });

    await act(async () => {
      roomState.roomViewProps?.onThreadLoadError?.('$saved');
    });

    expect(removeRecentThreadMock).toHaveBeenCalledWith('!room:example.org', '$saved');
    expect(navigateRoomMock).not.toHaveBeenCalled();
  });

  it('does not render a duplicate room header around RoomView in non-call rooms', async () => {
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Room));
    });

    expect(renderer!.root.findAllByType('mock-room-view')).toHaveLength(1);
    expect(renderer!.root.findAllByType('mock-room-view-header')).toHaveLength(0);
  });

  it('updates call-room chat from the overview to the selected thread route', async () => {
    roomState.callChat = true;
    roomState.callRoom = true;
    const { Room } = await import('../../../features/room/Room');
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(React.createElement(Room));
    });

    expect(roomState.callChatViewProps?.threadId).toBeUndefined();

    roomState.search = '?threadId=%24root';
    await act(async () => {
      renderer!.update(React.createElement(Room));
    });

    expect(roomState.callChatViewProps).toMatchObject({
      focusEventInRoom: false,
      room,
      threadId: '$root',
    });
    expect(roomState.callChatViewProps?.onThreadLoadError).toEqual(expect.any(Function));
  });
});
