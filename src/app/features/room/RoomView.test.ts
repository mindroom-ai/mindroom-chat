import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { passthrough, roomTimelineType, navigateRoomMock } = vi.hoisted(() => ({
  passthrough: 'div',
  roomTimelineType: 'room-timeline',
  navigateRoomMock: vi.fn(),
}));

const storageState = new Map<string, string>();

vi.stubGlobal('localStorage', {
  get length() {
    return storageState.size;
  },
  clear: () => {
    storageState.clear();
  },
  getItem: (key: string) => storageState.get(key) ?? null,
  key: (index: number) => Array.from(storageState.keys())[index] ?? null,
  setItem: (key: string, value: string) => {
    storageState.set(key, value);
  },
  removeItem: (key: string) => {
    storageState.delete(key);
  },
});
vi.stubGlobal('window', {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  navigator: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
});

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

vi.mock('./ThreadContextBanner', () => ({
  ThreadContextBanner: passthrough,
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
  useThreadResolution: () => ({ isResolved: false, isPending: false, tags: null }),
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
  (renderer.root.findByType(roomTimelineType as never) as unknown) as {
    props: {
      onToggle: (key: string) => void;
      onReset: () => void;
      threadFilterState: {
        resolved: string;
        streaming: string;
        scheduled: string;
        unread: string;
        idle: string;
        sortDirection: string;
      };
    };
  };

describe('RoomView', () => {
  beforeEach(() => {
    storageState.clear();
    navigateRoomMock.mockReset();
    vi.resetModules();
  });

  it('persists the thread filter state across thread enter/exit', async () => {
    const { RoomView } = await import('./RoomView');
    const room = makeRoom('!room-a:example.org');
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(RoomView, { room: room as never }));
    });

    // Toggle resolved: any -> include
    await act(async () => {
      getTimeline(renderer!).props.onToggle('resolved');
    });

    expect(getTimeline(renderer!).props.threadFilterState.resolved).toBe('include');

    // Enter thread — filter should persist
    await act(async () => {
      renderer?.update(React.createElement(RoomView, { room: room as never, threadId: '$thread' }));
    });

    expect(getTimeline(renderer!).props.threadFilterState.resolved).toBe('include');

    // Exit thread — filter should persist
    await act(async () => {
      renderer?.update(React.createElement(RoomView, { room: room as never }));
    });

    expect(getTimeline(renderer!).props.threadFilterState.resolved).toBe('include');
  });

  it('keeps thread filter state isolated per room when switching rooms', async () => {
    const { RoomView } = await import('./RoomView');
    const roomA = makeRoom('!room-a:example.org');
    const roomB = makeRoom('!room-b:example.org');
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(RoomView, { room: roomA as never }));
    });

    await act(async () => {
      getTimeline(renderer!).props.onToggle('resolved');
    });

    expect(getTimeline(renderer!).props.threadFilterState.resolved).toBe('include');

    // Switch rooms; room B starts with its own default state.
    await act(async () => {
      renderer?.update(React.createElement(RoomView, { room: roomB as never }));
    });

    expect(getTimeline(renderer!).props.threadFilterState.resolved).toBe('any');

    // Give room B a different persisted value.
    await act(async () => {
      getTimeline(renderer!).props.onToggle('resolved');
    });

    await act(async () => {
      getTimeline(renderer!).props.onToggle('resolved');
    });

    expect(getTimeline(renderer!).props.threadFilterState.resolved).toBe('exclude');

    // Switch back; room A should keep its own persisted value.
    await act(async () => {
      renderer?.update(React.createElement(RoomView, { room: roomA as never }));
    });

    expect(getTimeline(renderer!).props.threadFilterState.resolved).toBe('include');

    // Room B should also keep its own persisted value when revisited.
    await act(async () => {
      renderer?.update(React.createElement(RoomView, { room: roomB as never }));
    });

    expect(getTimeline(renderer!).props.threadFilterState.resolved).toBe('exclude');
  });

  it('resets all filters on onReset', async () => {
    const { RoomView } = await import('./RoomView');
    const room = makeRoom('!room-a:example.org');
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(RoomView, { room: room as never }));
    });

    await act(async () => {
      getTimeline(renderer!).props.onToggle('resolved');
      getTimeline(renderer!).props.onToggle('streaming');
    });

    await act(async () => {
      getTimeline(renderer!).props.onReset();
    });

    const state = getTimeline(renderer!).props.threadFilterState;
    expect(state.resolved).toBe('any');
    expect(state.streaming).toBe('any');
    expect(state.sortDirection).toBe('desc');
  });
});
