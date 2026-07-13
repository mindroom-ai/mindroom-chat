import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockRoomViewProps = {
  hasMindroomAgents?: boolean;
  eventId?: string;
  focusEventInRoom?: boolean;
  threadId?: string;
  onThreadLoadError?: (threadId: string) => void;
};

type MockCallChatViewProps = MockRoomViewProps & {
  room: { roomId: string; isCallRoom: () => boolean };
};

const { navigateRoomMock, navigateRoomThreadMock, removeRecentThreadMock, room, roomState } =
  vi.hoisted(() => ({
    navigateRoomMock: vi.fn(),
    navigateRoomThreadMock: vi.fn(),
    removeRecentThreadMock: vi.fn(),
    room: {
      roomId: '!room:example.org',
      isCallRoom: () => roomState.callRoom,
      getMembers: () => roomState.members,
    },
    roomState: {
      callChat: false,
      callChatViewProps: undefined as MockCallChatViewProps | undefined,
      callRoom: false,
      eventId: undefined as string | undefined,
      members: [] as Array<{ membership: string; userId: string }>,
      search: '',
      roomViewProps: undefined as MockRoomViewProps | undefined,
    },
  }));

vi.mock('folds', () => ({
  Box: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  Line: () => React.createElement('div'),
}));

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
  MembersDrawer: () => React.createElement('div'),
}));

vi.mock('../../../hooks/useScreenSize', () => ({
  ScreenSize: {
    Desktop: 'Desktop',
    Mobile: 'Mobile',
  },
  useScreenSizeContext: () => 'Desktop',
}));

vi.mock('../../../state/hooks/settings', () => ({
  useSetting: (_atom: unknown, key: string) => {
    switch (key) {
      case 'isPeopleDrawer':
        return [false];
      case 'hideActivity':
        return [false];
      default:
        return [false];
    }
  },
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
  useMatrixClient: () => ({}),
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

vi.stubGlobal('window', {});

describe('Room', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    roomState.callChat = false;
    roomState.callChatViewProps = undefined;
    roomState.callRoom = false;
    roomState.eventId = undefined;
    roomState.members = [];
    roomState.search = '';
    roomState.roomViewProps = undefined;
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
