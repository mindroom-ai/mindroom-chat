import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockRoomViewProps = {
  onThreadLoadError?: (threadId: string) => void;
};

const {
  clearLastOpenThreadMock,
  getLastOpenThreadMock,
  navigateRoomMock,
  navigateRoomThreadMock,
  room,
  roomState,
  setLastOpenThreadMock,
} = vi.hoisted(() => ({
  clearLastOpenThreadMock: vi.fn(),
  getLastOpenThreadMock: vi.fn(),
  navigateRoomMock: vi.fn(),
  navigateRoomThreadMock: vi.fn(),
  room: { roomId: '!room:example.org', isCallRoom: () => false },
  roomState: {
    eventId: undefined as string | undefined,
    search: '',
    roomViewProps: undefined as MockRoomViewProps | undefined,
  },
  setLastOpenThreadMock: vi.fn(),
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
    useAtomValue: () => false,
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

vi.mock('../../../hooks/useRoomMembers', () => ({
  useRoomMembers: () => [],
}));

vi.mock('../../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: navigateRoomMock,
    navigateRoomThread: navigateRoomThreadMock,
  }),
}));

vi.mock('../lastOpenThread', () => ({
  clearLastOpenThread: clearLastOpenThreadMock,
  getLastOpenThread: getLastOpenThreadMock,
  setLastOpenThread: setLastOpenThreadMock,
}));

vi.mock('../../../features/call/CallView', () => ({
  CallView: () => React.createElement('div'),
}));

vi.mock('../../../features/room/RoomViewHeader', () => ({
  RoomViewHeader: () => React.createElement('mock-room-view-header'),
}));

vi.mock('../../../features/room/CallChatView', () => ({
  CallChatView: () => React.createElement('div'),
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
    roomState.eventId = undefined;
    roomState.search = '';
    roomState.roomViewProps = undefined;
    navigateRoomMock.mockReset();
    navigateRoomThreadMock.mockReset();
    getLastOpenThreadMock.mockReset();
    setLastOpenThreadMock.mockReset();
    clearLastOpenThreadMock.mockReset();
  });

  it('auto-restores the saved thread on bare room entry', async () => {
    getLastOpenThreadMock.mockReturnValue('$saved');
    const { Room } = await import('../../../features/room/Room');

    await act(async () => {
      create(React.createElement(Room));
    });

    expect(navigateRoomThreadMock).toHaveBeenCalledWith(
      '!room:example.org',
      '$saved',
      undefined,
      { replace: true }
    );
  });

  it('does not override an explicit thread in the URL', async () => {
    roomState.search = '?threadId=%24explicit';
    getLastOpenThreadMock.mockReturnValue('$saved');
    const { Room } = await import('../../../features/room/Room');

    await act(async () => {
      create(React.createElement(Room));
    });

    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
    expect(setLastOpenThreadMock).toHaveBeenCalledWith('!room:example.org', '$explicit');
  });

  it('does not override an explicit event permalink', async () => {
    roomState.eventId = '$event';
    getLastOpenThreadMock.mockReturnValue('$saved');
    const { Room } = await import('../../../features/room/Room');

    await act(async () => {
      create(React.createElement(Room));
    });

    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
  });

  it('updates the saved thread when room navigation enters a thread', async () => {
    const { Room } = await import('../../../features/room/Room');

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });

    roomState.search = '?threadId=%24opened';

    await act(async () => {
      renderer!.update(React.createElement(Room));
    });

    expect(setLastOpenThreadMock).toHaveBeenCalledWith('!room:example.org', '$opened');
  });

  it('clears the saved thread when the same room leaves thread mode', async () => {
    roomState.search = '?threadId=%24saved';
    const { Room } = await import('../../../features/room/Room');

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });

    roomState.search = '';
    getLastOpenThreadMock.mockReturnValue(undefined);

    await act(async () => {
      renderer!.update(React.createElement(Room));
    });

    expect(clearLastOpenThreadMock).toHaveBeenCalledWith('!room:example.org');
  });

  it('falls back to the room timeline when an auto-restored thread fails', async () => {
    getLastOpenThreadMock.mockReturnValue('$saved');
    const { Room } = await import('../../../features/room/Room');

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(React.createElement(Room));
    });

    roomState.search = '?threadId=%24saved';

    await act(async () => {
      renderer!.update(React.createElement(Room));
    });

    await act(async () => {
      roomState.roomViewProps?.onThreadLoadError?.('$saved');
    });

    expect(clearLastOpenThreadMock).toHaveBeenCalledWith('!room:example.org');
    expect(navigateRoomMock).toHaveBeenCalledWith('!room:example.org', undefined, { replace: true });
  });

  it('does not redirect away from an explicit thread deep link that fails', async () => {
    roomState.search = '?threadId=%24saved';
    getLastOpenThreadMock.mockReturnValue('$saved');
    const { Room } = await import('../../../features/room/Room');

    await act(async () => {
      create(React.createElement(Room));
    });

    await act(async () => {
      roomState.roomViewProps?.onThreadLoadError?.('$saved');
    });

    expect(clearLastOpenThreadMock).toHaveBeenCalledWith('!room:example.org');
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
});
