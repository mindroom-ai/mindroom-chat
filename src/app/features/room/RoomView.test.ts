import React from 'react';
import { Provider as JotaiProvider } from 'jotai';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { passthrough, roomTimelineType, navigateRoomMock } = vi.hoisted(() => ({
  passthrough: 'div',
  roomTimelineType: 'room-timeline',
  navigateRoomMock: vi.fn(),
}));

vi.stubGlobal('window', {});

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  return {
    ...actual,
    Badge: passthrough,
    Box: passthrough,
    Chip: passthrough,
    Icon: passthrough,
    IconButton: passthrough,
    Icons: {
      ArrowLeft: 'ArrowLeft',
      Check: 'Check',
      CheckTwice: 'CheckTwice',
    },
    Spinner: passthrough,
    Text: passthrough,
    color: {
      ...actual.color,
      Critical: {
        ...actual.color.Critical,
        Main: '#c00',
      },
      Success: {
        ...actual.color.Success,
        Container: '#0a0',
        ContainerLine: '#070',
        OnContainer: '#fff',
      },
      SurfaceVariant: {
        ...actual.color.SurfaceVariant,
        Container: '#ddd',
        ContainerLine: '#bbb',
      },
    },
    config: {
      ...actual.config,
      borderWidth: {
        ...actual.config.borderWidth,
        B300: '1px',
      },
      space: {
        ...actual.config.space,
        S400: '16px',
      },
    },
  };
});

vi.mock('slate-react', () => ({
  ReactEditor: {
    focus: vi.fn(),
  },
}));

vi.mock('is-hotkey', () => ({
  isKeyHotkey: () => false,
}));

vi.mock('../../hooks/useStateEvent', () => ({
  useStateEvent: () => undefined,
}));

vi.mock('../../hooks/usePowerLevels', () => ({
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getSafeUserId: () => '@alice:example.org',
  }),
}));

vi.mock('../../components/editor', () => ({
  useEditor: () => ({}),
}));

vi.mock('./RoomInputPlaceholder', () => ({
  RoomInputPlaceholder: passthrough,
}));

vi.mock('./RoomTimeline', () => ({
  RoomTimeline: roomTimelineType,
}));

vi.mock('./RoomViewTyping', () => ({
  RoomViewTyping: passthrough,
}));

vi.mock('./RoomTombstone', () => ({
  RoomTombstone: passthrough,
}));

vi.mock('./RoomInput', () => ({
  RoomInput: passthrough,
}));

vi.mock('./RoomViewFollowing', () => ({
  RoomViewFollowing: passthrough,
  RoomViewFollowingPlaceholder: passthrough,
}));

vi.mock('../../components/page', () => ({
  Page: passthrough,
}));

vi.mock('./RoomViewHeader', () => ({
  RoomViewHeader: passthrough,
}));

vi.mock('../../hooks/useKeyDown', () => ({
  useKeyDown: vi.fn(),
}));

vi.mock('../../utils/dom', () => ({
  editableActiveElement: () => false,
}));

vi.mock('../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../state/hooks/settings', () => ({
  useSetting: () => [false],
}));

vi.mock('../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    event: () => true,
  }),
}));

vi.mock('../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => [],
}));

vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: navigateRoomMock,
  }),
}));

vi.mock('../../hooks/useEdgeSwipeBack', () => ({
  useEdgeSwipeBack: vi.fn(),
}));

vi.mock('./useRoomThreadTags', () => ({
  useThreadResolution: () => ({ isResolved: false, isPending: false }),
  useToggleThreadResolution: () => ({
    canToggle: false,
    setResolved: vi.fn(),
    updating: false,
    error: undefined,
  }),
}));

vi.mock('./useThreadRootEvent', () => ({
  useThreadRootEvent: () => undefined,
}));

const makeRoom = (roomId: string) => ({ roomId });
const getTimeline = (renderer: ReturnType<typeof create>) =>
  renderer.root.findByType(roomTimelineType as never) as unknown as {
    props: {
      onThreadFilterChange: (filter: 'all' | 'resolved' | 'unresolved' | 'unread') => void;
      threadFilter: 'all' | 'resolved' | 'unresolved' | 'unread';
      onThreadSortChange: (sort: 'default' | 'last-reply' | 'streaming' | 'scheduled') => void;
      threadSort: 'default' | 'last-reply' | 'streaming' | 'scheduled';
    };
  };

const renderRoomView = async (element: React.ReactElement): Promise<ReturnType<typeof create>> => {
  let renderer: ReturnType<typeof create> | undefined;

  await act(async () => {
    renderer = create(React.createElement(JotaiProvider, undefined, element));
  });

  if (!renderer) {
    throw new Error('RoomView renderer was not created');
  }

  return renderer;
};

describe('RoomView', () => {
  it('persists the room thread filter across thread enter/exit', async () => {
    const { RoomView } = await import('./RoomView');
    const room = makeRoom('!room-a:example.org');
    const renderer = await renderRoomView(React.createElement(RoomView, { room: room as never }));

    await act(async () => {
      getTimeline(renderer).props.onThreadFilterChange('unresolved');
    });

    expect(getTimeline(renderer).props.threadFilter).toBe('unresolved');

    await act(async () => {
      renderer.update(
        React.createElement(
          JotaiProvider,
          undefined,
          React.createElement(RoomView, { room: room as never, threadId: '$thread' })
        )
      );
    });

    expect(getTimeline(renderer).props.threadFilter).toBe('unresolved');

    await act(async () => {
      renderer.update(
        React.createElement(
          JotaiProvider,
          undefined,
          React.createElement(RoomView, { room: room as never })
        )
      );
    });

    expect(getTimeline(renderer).props.threadFilter).toBe('unresolved');
  });

  it('preserves the room thread filter when switching back to a room', async () => {
    const { RoomView } = await import('./RoomView');
    const roomA = makeRoom('!room-a:example.org');
    const roomB = makeRoom('!room-b:example.org');
    const renderer = await renderRoomView(React.createElement(RoomView, { room: roomA as never }));

    await act(async () => {
      getTimeline(renderer).props.onThreadFilterChange('resolved');
    });

    expect(getTimeline(renderer).props.threadFilter).toBe('resolved');

    await act(async () => {
      renderer.update(
        React.createElement(
          JotaiProvider,
          undefined,
          React.createElement(RoomView, { room: roomB as never })
        )
      );
    });

    expect(getTimeline(renderer).props.threadFilter).toBe('all');

    await act(async () => {
      renderer.update(
        React.createElement(
          JotaiProvider,
          undefined,
          React.createElement(RoomView, { room: roomA as never })
        )
      );
    });

    expect(getTimeline(renderer).props.threadFilter).toBe('resolved');
  });

  it('keeps per-room thread filter state independent', async () => {
    const { RoomView } = await import('./RoomView');
    const roomA = makeRoom('!room-a:example.org');
    const roomB = makeRoom('!room-b:example.org');
    const renderer = await renderRoomView(React.createElement(RoomView, { room: roomA as never }));

    await act(async () => {
      getTimeline(renderer).props.onThreadFilterChange('unresolved');
    });

    await act(async () => {
      renderer.update(
        React.createElement(
          JotaiProvider,
          undefined,
          React.createElement(RoomView, { room: roomB as never })
        )
      );
    });

    await act(async () => {
      getTimeline(renderer).props.onThreadFilterChange('resolved');
    });

    expect(getTimeline(renderer).props.threadFilter).toBe('resolved');

    await act(async () => {
      renderer.update(
        React.createElement(
          JotaiProvider,
          undefined,
          React.createElement(RoomView, { room: roomA as never })
        )
      );
    });

    expect(getTimeline(renderer).props.threadFilter).toBe('unresolved');

    await act(async () => {
      renderer.update(
        React.createElement(
          JotaiProvider,
          undefined,
          React.createElement(RoomView, { room: roomB as never })
        )
      );
    });

    expect(getTimeline(renderer).props.threadFilter).toBe('resolved');
  });

  it('persists thread sort across room switches', async () => {
    const { RoomView } = await import('./RoomView');
    const roomA = makeRoom('!room-a:example.org');
    const roomB = makeRoom('!room-b:example.org');
    const renderer = await renderRoomView(React.createElement(RoomView, { room: roomA as never }));

    await act(async () => {
      getTimeline(renderer).props.onThreadSortChange('streaming');
    });

    expect(getTimeline(renderer).props.threadSort).toBe('streaming');

    await act(async () => {
      renderer.update(
        React.createElement(
          JotaiProvider,
          undefined,
          React.createElement(RoomView, { room: roomB as never })
        )
      );
    });

    expect(getTimeline(renderer).props.threadSort).toBe('default');

    await act(async () => {
      renderer.update(
        React.createElement(
          JotaiProvider,
          undefined,
          React.createElement(RoomView, { room: roomA as never })
        )
      );
    });

    expect(getTimeline(renderer).props.threadSort).toBe('streaming');
  });

  it('uses default thread toolbar state for rooms that have not been visited', async () => {
    const { RoomView } = await import('./RoomView');
    const roomA = makeRoom('!room-a:example.org');
    const roomC = makeRoom('!room-c:example.org');
    const renderer = await renderRoomView(React.createElement(RoomView, { room: roomA as never }));

    await act(async () => {
      getTimeline(renderer).props.onThreadFilterChange('unread');
      getTimeline(renderer).props.onThreadSortChange('scheduled');
    });

    await act(async () => {
      renderer.update(
        React.createElement(
          JotaiProvider,
          undefined,
          React.createElement(RoomView, { room: roomC as never })
        )
      );
    });

    expect(getTimeline(renderer).props.threadFilter).toBe('all');
    expect(getTimeline(renderer).props.threadSort).toBe('default');
  });
});
