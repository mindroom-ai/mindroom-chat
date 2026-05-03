import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROOM_THREAD_EXIT_TARGET_STATE_KEY,
  setRoomThreadExitTargetForHistoryState,
} from '../roomNavigateState';

type MockThreadContextBannerProps = {
  onExitThread?: () => void;
  summaryInfo?: { summaryText?: string; generatedTs?: number; messageCount?: number };
};

type MockPageProps = React.ComponentProps<'div'>;

const {
  bumpRecentThreadMock,
  edgeSwipeBackState,
  edgeSwipeForwardState,
  historyBackMock,
  historyForwardMock,
  interactiveSwipeState,
  isIOSStandaloneWebAppMock,
  isNativeIOSMock,
  navigatePathMock,
  pageState,
  passthrough,
  roomTimelineType,
  navigateRoomFocusEventMock,
  navigateRoomThreadMock,
  screenSizeState,
  threadContextBannerState,
  useThreadRootEventMock,
} = vi.hoisted(() => ({
  bumpRecentThreadMock: vi.fn(),
  edgeSwipeBackState: {
    enabled: undefined as boolean | undefined,
    onBack: undefined as (() => void) | undefined,
  },
  edgeSwipeForwardState: {
    enabled: undefined as boolean | undefined,
    onForward: undefined as (() => void) | undefined,
  },
  historyBackMock: vi.fn(),
  historyForwardMock: vi.fn(),
  interactiveSwipeState: {
    options: undefined as
      | {
          enabled: boolean;
          leftTarget?: { label?: string; roomId?: string; threadId?: string };
          onCommit: (target: {
            direction: 'left' | 'right';
            roomId?: string;
            threadId?: string;
          }) => void;
          onPreviewFreeze: (target: {
            direction: 'left' | 'right';
            label?: string;
            roomId?: string;
            threadId?: string;
          }) => void;
          rightTarget?: { label?: string; roomId?: string; threadId?: string };
        }
      | undefined,
    snapshot: {
      phase: 'idle' as 'idle' | 'armed' | 'dragging' | 'settling' | 'canceling',
      target: undefined as
        | { direction: 'left' | 'right'; roomId?: string; threadId?: string }
        | undefined,
    },
  },
  isIOSStandaloneWebAppMock: vi.fn(() => false),
  isNativeIOSMock: vi.fn(() => false),
  navigatePathMock: vi.fn(),
  pageState: {
    props: undefined as MockPageProps | undefined,
  },
  passthrough: 'div',
  roomTimelineType: 'room-timeline',
  navigateRoomFocusEventMock: vi.fn(),
  navigateRoomThreadMock: vi.fn(),
  screenSizeState: {
    current: 'Desktop',
  },
  threadContextBannerState: {
    props: undefined as MockThreadContextBannerProps | undefined,
  },
  useThreadRootEventMock: vi.fn(() => undefined),
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
vi.stubGlobal('sessionStorage', {
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
  history: {
    back: historyBackMock,
    forward: historyForwardMock,
    state: null,
  },
  localStorage,
  removeEventListener: () => undefined,
  sessionStorage,
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

vi.mock('../../../hooks/useStateEvent', () => ({
  useStateEvent: () => undefined,
}));

vi.mock('../../../hooks/usePowerLevels', () => ({
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getHomeserverUrl: () => 'https://mindroom.chat',
    getSafeUserId: () => '@alice:example.org',
  }),
}));

vi.mock('../../../components/editor', () => ({
  useEditor: () => ({}),
}));

vi.mock('../../../features/room/RoomInputPlaceholder', () => ({
  RoomInputPlaceholder: passthrough,
}));

vi.mock('../MindroomRoomTimeline', () => ({
  RoomTimeline: roomTimelineType,
}));

vi.mock('../../../features/room/RoomViewTyping', () => ({
  RoomViewTyping: passthrough,
}));

vi.mock('../../../features/room/RoomTombstone', () => ({
  RoomTombstone: passthrough,
}));

vi.mock('../../room-input/MindroomRoomInput', () => ({
  RoomInput: passthrough,
}));

vi.mock('../../../features/room/RoomViewFollowing', () => ({
  RoomViewFollowing: passthrough,
  RoomViewFollowingPlaceholder: passthrough,
}));

vi.mock('../../../components/page', () => ({
  Page: React.forwardRef<HTMLDivElement, MockPageProps>((props, ref) => {
    pageState.props = props;
    return React.createElement('div', { ...props, ref });
  }),
}));

vi.mock('../../../features/room/RoomViewHeader', () => ({
  RoomViewHeader: passthrough,
}));

vi.mock('../MindroomRoomViewHeader', () => ({
  RoomViewHeader: passthrough,
}));

vi.mock('../ThreadContextBanner', () => ({
  ThreadContextBanner: (props: MockThreadContextBannerProps) => {
    threadContextBannerState.props = props;
    return React.createElement('div');
  },
}));

vi.mock('../../../hooks/useKeyDown', () => ({
  useKeyDown: vi.fn(),
}));

vi.mock('../../../utils/dom', () => ({
  editableActiveElement: () => false,
}));

vi.mock('../../../state/settings', () => ({
  settingsAtom: {},
}));

vi.mock('../../../state/hooks/settings', () => ({
  useSetting: () => [false],
}));

vi.mock('../../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    event: () => true,
  }),
}));

vi.mock('../../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => [],
}));

vi.mock('../../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigatePath: navigatePathMock,
    navigateRoomFocusEvent: navigateRoomFocusEventMock,
    navigateRoomThread: navigateRoomThreadMock,
  }),
}));

vi.mock('../../../hooks/useScreenSize', () => ({
  ScreenSize: {
    Desktop: 'Desktop',
    Mobile: 'Mobile',
    Tablet: 'Tablet',
  },
  useScreenSizeContext: () => screenSizeState.current,
}));

vi.mock('../../native/nativeSso', () => ({
  isIOSStandaloneWebApp: isIOSStandaloneWebAppMock,
  isNativeIOS: isNativeIOSMock,
}));

vi.mock('../../native/useEdgeSwipeBack', () => ({
  useEdgeSwipeBack: vi.fn((onBack: () => void, enabled: boolean) => {
    edgeSwipeBackState.onBack = onBack;
    edgeSwipeBackState.enabled = enabled;
  }),
}));

vi.mock('../../native/useEdgeSwipeForward', () => ({
  useEdgeSwipeForward: vi.fn((onForward: () => void, enabled: boolean) => {
    edgeSwipeForwardState.onForward = onForward;
    edgeSwipeForwardState.enabled = enabled;
  }),
}));

vi.mock('../../native/useInteractiveRoomThreadSwipe', () => ({
  useInteractiveRoomThreadSwipe: vi.fn((options) => {
    interactiveSwipeState.options = options;
    return interactiveSwipeState.snapshot;
  }),
}));

vi.mock('../MindroomRoomViewSwipe.css', () => ({
  ActivePane: 'ActivePane',
  PreviewPane: 'PreviewPane',
  PreviewPaneLeft: 'PreviewPaneLeft',
  PreviewPaneRight: 'PreviewPaneRight',
  SwipePane: 'SwipePane',
  SwipePaneTransition: 'SwipePaneTransition',
  SwipeShell: 'SwipeShell',
  PreviewAvatar: 'PreviewAvatar',
  PreviewBody: 'PreviewBody',
  PreviewChrome: 'PreviewChrome',
  PreviewHeader: 'PreviewHeader',
  PreviewLine: 'PreviewLine',
  PreviewLineLong: 'PreviewLineLong',
  PreviewLineMedium: 'PreviewLineMedium',
  PreviewLineShort: 'PreviewLineShort',
  PreviewTitleColumn: 'PreviewTitleColumn',
}));

vi.mock('../useRoomThreadTags', () => ({
  useThreadResolution: () => ({ isResolved: false, isPending: false, tags: null }),
  useToggleThreadResolution: () => ({
    canToggle: false,
    setResolved: vi.fn(),
    updating: false,
    error: undefined,
  }),
}));

vi.mock('../useThreadRootEvent', () => ({
  useThreadRootEvent: useThreadRootEventMock,
}));

vi.mock('../useRoomThreadSummaryState', () => ({
  useRoomThreadSummaryState: () => ({
    summaryMap: new Map(),
    storeThreadSummary: vi.fn(),
  }),
}));

vi.mock('../../recent-threads/recentThreads', () => ({
  bumpRecentThread: bumpRecentThreadMock,
}));

const makeRoom = (roomId: string) => ({
  roomId,
  name: 'Room',
  getCanonicalAlias: () => undefined,
  getThread: () => undefined,
  findEventById: () => undefined,
});
let roomIdSeed = 0;
const nextRoomId = (label: string) => `!${label}-${roomIdSeed++}:example.org`;

type ThreadStateHarnessProps = {
  eventId?: string;
  onState: (state: import('../useRoomViewThreadState').RoomViewThreadState) => void;
  room: ReturnType<typeof makeRoom>;
  swipeIdle?: boolean;
  thresholdSwipeEnabled?: boolean;
  threadId?: string;
};

const createThreadStateHarness =
  (useRoomViewThreadState: typeof import('../useRoomViewThreadState').useRoomViewThreadState) =>
  ({
    eventId,
    onState,
    room,
    swipeIdle,
    thresholdSwipeEnabled,
    threadId,
  }: ThreadStateHarnessProps) => {
    onState(
      useRoomViewThreadState({
        eventId,
        room: room as never,
        swipeIdle,
        thresholdSwipeEnabled,
        threadId,
      })
    );
    return null;
  };

const getTimeline = (renderer: ReturnType<typeof create>) =>
  renderer.root.findByType(roomTimelineType as never) as unknown as {
    props: {
      onToggle: (key: string) => void;
      onSortDirectionChange: () => void;
      onToggleThreadSortFreeze: () => void;
      onReset: () => void;
      threadId?: string;
      threadFilterState: {
        resolved: string;
        streaming: string;
        scheduled: string;
        unread: string;
        idle: string;
        sortBy: string;
        sortDirection: string;
      };
      threadSortFreezeState: {
        controlSignature: string | null;
        orderedRootIds: string[];
      } | null;
    };
  };

describe('RoomView', () => {
  beforeEach(() => {
    vi.useRealTimers();
    storageState.clear();
    bumpRecentThreadMock.mockReset();
    edgeSwipeBackState.enabled = undefined;
    edgeSwipeBackState.onBack = undefined;
    edgeSwipeForwardState.enabled = undefined;
    edgeSwipeForwardState.onForward = undefined;
    historyBackMock.mockReset();
    historyForwardMock.mockReset();
    interactiveSwipeState.options = undefined;
    interactiveSwipeState.snapshot = {
      phase: 'idle',
      target: undefined,
    };
    isIOSStandaloneWebAppMock.mockReset();
    isIOSStandaloneWebAppMock.mockReturnValue(false);
    isNativeIOSMock.mockReset();
    isNativeIOSMock.mockReturnValue(false);
    navigatePathMock.mockReset();
    navigateRoomFocusEventMock.mockReset();
    navigateRoomThreadMock.mockReset();
    pageState.props = undefined;
    screenSizeState.current = 'Desktop';
    threadContextBannerState.props = undefined;
    useThreadRootEventMock.mockReset();
    useThreadRootEventMock.mockReturnValue(undefined);
    window.history.state = null;
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists the thread filter state across thread enter/exit', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
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
    const { RoomView } = await import('../../../features/room/RoomView');
    const roomA = makeRoom(nextRoomId('room-a'));
    const roomB = makeRoom(nextRoomId('room-b'));
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

  it('persists the freeze state across thread enter/exit in the same room', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(RoomView, { room: room as never }));
    });

    await act(async () => {
      getTimeline(renderer!).props.onToggleThreadSortFreeze();
    });

    expect(getTimeline(renderer!).props.threadSortFreezeState).not.toBeNull();

    await act(async () => {
      renderer?.update(React.createElement(RoomView, { room: room as never, threadId: '$thread' }));
    });

    expect(getTimeline(renderer!).props.threadSortFreezeState).not.toBeNull();

    await act(async () => {
      renderer?.update(React.createElement(RoomView, { room: room as never }));
    });

    expect(getTimeline(renderer!).props.threadSortFreezeState).not.toBeNull();
  });

  it('resets the freeze state when switching rooms', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const roomA = makeRoom(nextRoomId('room-a'));
    const roomB = makeRoom(nextRoomId('room-b'));
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(RoomView, { room: roomA as never }));
    });

    await act(async () => {
      getTimeline(renderer!).props.onToggleThreadSortFreeze();
    });

    expect(getTimeline(renderer!).props.threadSortFreezeState).not.toBeNull();

    await act(async () => {
      renderer?.update(React.createElement(RoomView, { room: roomB as never }));
    });

    expect(getTimeline(renderer!).props.threadSortFreezeState).toBeNull();
  });

  it('clears the freeze state when sort cycles back to natural', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(RoomView, { room: room as never }));
    });

    await act(async () => {
      getTimeline(renderer!).props.onToggleThreadSortFreeze();
    });

    expect(getTimeline(renderer!).props.threadSortFreezeState).not.toBeNull();
    expect(getTimeline(renderer!).props.threadFilterState.sortBy).toBe('lastReply');

    await act(async () => {
      getTimeline(renderer!).props.onSortDirectionChange();
    });

    await act(async () => {
      getTimeline(renderer!).props.onSortDirectionChange();
    });

    expect(getTimeline(renderer!).props.threadFilterState.sortBy).toBe('natural');
    expect(getTimeline(renderer!).props.threadSortFreezeState).toBeNull();
  });

  it('resets all filters on onReset', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
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

  it('exits a thread with history back when it was opened from the room timeline', async () => {
    const room = makeRoom(nextRoomId('room-a'));
    window.history.state = {
      usr: {
        [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
          roomId: room.roomId,
          threadId: '$thread',
        },
      },
    };

    const { RoomView } = await import('../../../features/room/RoomView');

    await act(async () => {
      create(React.createElement(RoomView, { room: room as never, threadId: '$thread' }));
    });

    expect(threadContextBannerState.props?.onExitThread).toBeTypeOf('function');

    await act(async () => {
      threadContextBannerState.props?.onExitThread?.();
    });

    expect(historyBackMock).toHaveBeenCalledOnce();
    expect(navigateRoomFocusEventMock).not.toHaveBeenCalled();
  });

  it('exits a thread with history back when the exit target is stored by history entry key', async () => {
    const room = makeRoom(nextRoomId('room-a'));
    window.history.state = {
      key: `thread-entry-key:${room.roomId}`,
    };
    setRoomThreadExitTargetForHistoryState(window.history.state, {
      roomId: room.roomId,
      threadId: '$thread',
    });

    const { RoomView } = await import('../../../features/room/RoomView');

    await act(async () => {
      create(React.createElement(RoomView, { room: room as never, threadId: '$thread' }));
    });

    expect(threadContextBannerState.props?.onExitThread).toBeTypeOf('function');

    await act(async () => {
      threadContextBannerState.props?.onExitThread?.();
    });

    expect(historyBackMock).toHaveBeenCalledOnce();
    expect(navigateRoomFocusEventMock).not.toHaveBeenCalled();
  });

  it('sets the last exited thread before taking the history back exit branch', async () => {
    const { lastExitedThreadAtom } = await import('../lastExitedThread');
    const { useRoomViewThreadState } = await import('../useRoomViewThreadState');
    const ThreadStateHarness = createThreadStateHarness(useRoomViewThreadState);
    const store = createStore();
    const room = makeRoom(nextRoomId('room-a'));
    let renderer: ReturnType<typeof create> | undefined;
    let threadState: import('../useRoomViewThreadState').RoomViewThreadState | undefined;
    window.history.state = {
      key: `thread-entry-key:${room.roomId}`,
    };
    setRoomThreadExitTargetForHistoryState(window.history.state, {
      roomId: room.roomId,
      threadId: '$thread',
      useHistoryBack: true,
    });

    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(ThreadStateHarness, {
            onState: (state) => {
              threadState = state;
            },
            room,
            threadId: '$thread',
          })
        )
      );
    });

    await act(async () => {
      threadState?.handleExitThread();
      renderer?.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(ThreadStateHarness, {
            onState: (state) => {
              threadState = state;
            },
            room,
          })
        )
      );
    });

    expect(historyBackMock).toHaveBeenCalledOnce();
    expect(store.get(lastExitedThreadAtom)).toEqual({
      roomId: room.roomId,
      threadId: '$thread',
    });
  });

  it('exits a thread with replace navigation instead of history back in standalone iOS web apps', async () => {
    isIOSStandaloneWebAppMock.mockReturnValue(true);
    const room = makeRoom(nextRoomId('room-a'));
    window.history.state = {
      key: `thread-entry-key:${room.roomId}`,
    };
    setRoomThreadExitTargetForHistoryState(window.history.state, {
      exitPath: `/home/${encodeURIComponent(room.roomId)}`,
      roomId: room.roomId,
      threadId: '$thread',
      useHistoryBack: true,
    });

    const { RoomView } = await import('../../../features/room/RoomView');

    await act(async () => {
      create(React.createElement(RoomView, { room: room as never, threadId: '$thread' }));
    });

    expect(threadContextBannerState.props?.onExitThread).toBeTypeOf('function');

    await act(async () => {
      threadContextBannerState.props?.onExitThread?.();
    });

    expect(historyBackMock).not.toHaveBeenCalled();
    expect(navigatePathMock).toHaveBeenCalledWith(`/home/${encodeURIComponent(room.roomId)}`, {
      replace: true,
    });
    expect(navigateRoomFocusEventMock).not.toHaveBeenCalled();
  });

  it('sets the last exited thread before taking the exit path replace branch', async () => {
    const { lastExitedThreadAtom } = await import('../lastExitedThread');
    const { useRoomViewThreadState } = await import('../useRoomViewThreadState');
    const ThreadStateHarness = createThreadStateHarness(useRoomViewThreadState);
    const store = createStore();
    const room = makeRoom(nextRoomId('room-a'));
    const exitPath = `/home/${encodeURIComponent(room.roomId)}`;
    let renderer: ReturnType<typeof create> | undefined;
    let threadState: import('../useRoomViewThreadState').RoomViewThreadState | undefined;
    window.history.state = {
      key: `thread-entry-key:${room.roomId}`,
    };
    setRoomThreadExitTargetForHistoryState(window.history.state, {
      exitPath,
      roomId: room.roomId,
      threadId: '$thread',
      useHistoryBack: false,
    });

    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(ThreadStateHarness, {
            onState: (state) => {
              threadState = state;
            },
            room,
            threadId: '$thread',
          })
        )
      );
    });

    await act(async () => {
      threadState?.handleExitThread();
      renderer?.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(ThreadStateHarness, {
            onState: (state) => {
              threadState = state;
            },
            room,
          })
        )
      );
    });

    expect(navigatePathMock).toHaveBeenCalledWith(exitPath, { replace: true });
    expect(store.get(lastExitedThreadAtom)).toEqual({
      roomId: room.roomId,
      threadId: '$thread',
    });
  });

  it('exits a thread by navigating to the stored exit path on native iOS', async () => {
    isNativeIOSMock.mockReturnValue(true);
    const room = makeRoom(nextRoomId('room-a'));
    window.history.state = {
      key: `thread-entry-key:${room.roomId}`,
    };
    setRoomThreadExitTargetForHistoryState(window.history.state, {
      exitPath: `/home/${encodeURIComponent(room.roomId)}`,
      roomId: room.roomId,
      threadId: '$thread',
      useHistoryBack: false,
    });

    const { RoomView } = await import('../../../features/room/RoomView');

    await act(async () => {
      create(React.createElement(RoomView, { room: room as never, threadId: '$thread' }));
    });

    expect(threadContextBannerState.props?.onExitThread).toBeTypeOf('function');

    await act(async () => {
      threadContextBannerState.props?.onExitThread?.();
    });

    expect(historyBackMock).not.toHaveBeenCalled();
    expect(navigatePathMock).toHaveBeenCalledWith(`/home/${encodeURIComponent(room.roomId)}`, {
      replace: true,
    });
    expect(navigateRoomFocusEventMock).not.toHaveBeenCalled();
  });

  it('falls back to the focused room event route for deep-linked threads', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));

    await act(async () => {
      create(React.createElement(RoomView, { room: room as never, threadId: '$thread' }));
    });

    expect(threadContextBannerState.props?.onExitThread).toBeTypeOf('function');

    await act(async () => {
      threadContextBannerState.props?.onExitThread?.();
    });

    expect(historyBackMock).not.toHaveBeenCalled();
    expect(navigateRoomFocusEventMock).toHaveBeenCalledWith(room.roomId, '$thread', {
      replace: true,
    });
  });

  it('F1: preserves the last exited thread across same-instance exit rerender and reopens it on swipe-forward', async () => {
    const { lastExitedThreadAtom } = await import('../lastExitedThread');
    const { useRoomViewThreadState } = await import('../useRoomViewThreadState');
    const ThreadStateHarness = createThreadStateHarness(useRoomViewThreadState);
    const store = createStore();
    const room = makeRoom(nextRoomId('room-a'));
    let renderer: ReturnType<typeof create> | undefined;
    let threadState: import('../useRoomViewThreadState').RoomViewThreadState | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(ThreadStateHarness, {
            onState: (state) => {
              threadState = state;
            },
            room,
            threadId: '$thread',
          })
        )
      );
    });

    expect(threadState?.handleExitThread).toBeTypeOf('function');

    await act(async () => {
      threadState?.handleExitThread();
      renderer?.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(ThreadStateHarness, {
            onState: (state) => {
              threadState = state;
            },
            room,
          })
        )
      );
    });

    expect(navigateRoomFocusEventMock).toHaveBeenCalledWith(room.roomId, '$thread', {
      replace: true,
    });
    expect(store.get(lastExitedThreadAtom)).toEqual({
      roomId: room.roomId,
      threadId: '$thread',
    });
    expect(edgeSwipeForwardState.enabled).toBe(true);
    expect(edgeSwipeForwardState.onForward).toBeTypeOf('function');

    await act(async () => {
      edgeSwipeForwardState.onForward?.();
    });

    expect(store.get(lastExitedThreadAtom)).toBeNull();
    expect(navigateRoomThreadMock).toHaveBeenCalledWith(room.roomId, '$thread');
    expect(historyForwardMock).not.toHaveBeenCalled();
  });

  it('seeds thread exit history before clearing swipe-forward state', async () => {
    const { lastExitedThreadAtom } = await import('../lastExitedThread');
    const { useRoomViewThreadState } = await import('../useRoomViewThreadState');
    const ThreadStateHarness = createThreadStateHarness(useRoomViewThreadState);
    const store = createStore();
    const room = makeRoom(nextRoomId('room-a'));
    let renderer: ReturnType<typeof create> | undefined;
    let threadState: import('../useRoomViewThreadState').RoomViewThreadState | undefined;

    store.set(lastExitedThreadAtom, {
      roomId: room.roomId,
      threadId: '$thread',
    });
    navigateRoomThreadMock.mockImplementation((navigatedRoomId, navigatedThreadId) => {
      if (store.get(lastExitedThreadAtom)?.threadId !== navigatedThreadId) return;

      window.history.state = {
        usr: {
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            roomId: navigatedRoomId,
            threadId: navigatedThreadId,
          },
        },
      };
    });

    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(ThreadStateHarness, {
            onState: (state) => {
              threadState = state;
            },
            room,
          })
        )
      );
    });

    expect(edgeSwipeForwardState.enabled).toBe(true);

    await act(async () => {
      edgeSwipeForwardState.onForward?.();
      renderer?.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(ThreadStateHarness, {
            onState: (state) => {
              threadState = state;
            },
            room,
            threadId: '$thread',
          })
        )
      );
    });

    expect(threadState?.effectiveThreadId).toBe('$thread');
    expect(store.get(lastExitedThreadAtom)).toBeNull();
    expect(edgeSwipeBackState.enabled).toBe(true);

    await act(async () => {
      edgeSwipeBackState.onBack?.();
    });

    expect(historyBackMock).toHaveBeenCalledOnce();
    expect(navigateRoomFocusEventMock).not.toHaveBeenCalled();
  });

  it('clears the last exited thread when a thread is mounted', async () => {
    const { lastExitedThreadAtom } = await import('../lastExitedThread');
    const { useRoomViewThreadState } = await import('../useRoomViewThreadState');
    const ThreadStateHarness = createThreadStateHarness(useRoomViewThreadState);
    const store = createStore();
    const room = makeRoom(nextRoomId('room-a'));
    store.set(lastExitedThreadAtom, {
      roomId: room.roomId,
      threadId: '$previous',
    });

    await act(async () => {
      create(
        React.createElement(
          Provider,
          { store },
          React.createElement(ThreadStateHarness, {
            onState: () => undefined,
            room,
            threadId: '$current',
          })
        )
      );
    });

    expect(store.get(lastExitedThreadAtom)).toBeNull();
  });

  it('clears the last exited thread when switching rooms', async () => {
    const { lastExitedThreadAtom } = await import('../lastExitedThread');
    const { useRoomViewThreadState } = await import('../useRoomViewThreadState');
    const ThreadStateHarness = createThreadStateHarness(useRoomViewThreadState);
    const store = createStore();
    const room = makeRoom(nextRoomId('room-a'));
    store.set(lastExitedThreadAtom, {
      roomId: '!other:example.org',
      threadId: '$previous',
    });

    await act(async () => {
      create(
        React.createElement(
          Provider,
          { store },
          React.createElement(ThreadStateHarness, {
            onState: () => undefined,
            room,
          })
        )
      );
    });

    expect(store.get(lastExitedThreadAtom)).toBeNull();
  });

  it('clears the last exited thread on true unmount', async () => {
    const { lastExitedThreadAtom } = await import('../lastExitedThread');
    const { useRoomViewThreadState } = await import('../useRoomViewThreadState');
    const ThreadStateHarness = createThreadStateHarness(useRoomViewThreadState);
    const store = createStore();
    const room = makeRoom(nextRoomId('room-a'));
    let renderer: ReturnType<typeof create> | undefined;
    store.set(lastExitedThreadAtom, {
      roomId: room.roomId,
      threadId: '$previous',
    });

    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(ThreadStateHarness, {
            onState: () => undefined,
            room,
          })
        )
      );
    });

    expect(store.get(lastExitedThreadAtom)).toEqual({
      roomId: room.roomId,
      threadId: '$previous',
    });

    await act(async () => {
      renderer?.unmount();
    });

    expect(store.get(lastExitedThreadAtom)).toBeNull();
  });

  it('renders the room page with the app-height lock style', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom('!room-a:example.org');

    await act(async () => {
      create(React.createElement(RoomView, { room: room as never }));
    });

    expect(pageState.props?.style).toMatchObject({ height: 'var(--app-height, 100%)' });
  });

  it('mounts the interactive swipe shell only on mobile and disables threshold hooks there', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(RoomView, { room: room as never, threadId: '$thread' })
      );
    });

    expect(renderer!.root.findAllByProps({ 'data-room-thread-swipe-shell': 'true' })).toHaveLength(
      0
    );
    expect(edgeSwipeBackState.enabled).toBe(true);

    screenSizeState.current = 'Mobile';
    await act(async () => {
      renderer?.update(React.createElement(RoomView, { room: room as never, threadId: '$thread' }));
    });

    expect(renderer!.root.findAllByProps({ 'data-room-thread-swipe-shell': 'true' })).toHaveLength(
      1
    );
    expect(edgeSwipeBackState.enabled).toBe(false);
    expect(interactiveSwipeState.options?.enabled).toBe(true);
    expect(interactiveSwipeState.options?.leftTarget).toMatchObject({
      label: 'Room overview',
      roomId: room.roomId,
      threadId: '$thread',
    });
  });

  it('renders an inert passive preview only while the interactive controller has a target', async () => {
    screenSizeState.current = 'Mobile';
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(RoomView, { room: room as never, threadId: '$thread' })
      );
    });

    expect(
      renderer!.root.findAllByProps({ 'data-room-thread-swipe-preview': 'true' })
    ).toHaveLength(0);

    interactiveSwipeState.snapshot = {
      phase: 'dragging',
      target: { direction: 'left', threadId: '$thread' },
    };
    await act(async () => {
      interactiveSwipeState.options?.onPreviewFreeze({
        direction: 'left',
        label: 'Room overview',
        threadId: '$thread',
      });
      renderer?.update(React.createElement(RoomView, { room: room as never, threadId: '$thread' }));
    });

    const previews = renderer!.root.findAllByProps({ 'data-room-thread-swipe-preview': 'true' });
    expect(previews).toHaveLength(1);
    expect(previews[0].props['aria-hidden']).toBe('true');
    expect(previews[0].props.inert).toBe('');
  });

  it('commits interactive left-edge exit to same-room focused overview without history back', async () => {
    screenSizeState.current = 'Mobile';
    const { lastExitedThreadAtom } = await import('../lastExitedThread');
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    const store = createStore();

    await act(async () => {
      create(
        React.createElement(
          Provider,
          { store },
          React.createElement(RoomView, { room: room as never, threadId: '$thread' })
        )
      );
    });

    await act(async () => {
      interactiveSwipeState.options?.onCommit({ direction: 'left', threadId: '$thread' });
    });

    expect(historyBackMock).not.toHaveBeenCalled();
    expect(navigateRoomFocusEventMock).toHaveBeenCalledWith(room.roomId, '$thread', {
      replace: true,
    });
    expect(store.get(lastExitedThreadAtom)).toEqual({
      roomId: room.roomId,
      threadId: '$thread',
    });
  });

  it('commits left-edge exit with the frozen target if the current thread changes before settle', async () => {
    screenSizeState.current = 'Mobile';
    const { lastExitedThreadAtom } = await import('../lastExitedThread');
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    const store = createStore();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(RoomView, { room: room as never, threadId: '$thread-a' })
        )
      );
    });

    const frozenTarget = interactiveSwipeState.options?.leftTarget;
    expect(frozenTarget).toMatchObject({
      roomId: room.roomId,
      threadId: '$thread-a',
    });

    await act(async () => {
      renderer?.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(RoomView, { room: room as never, threadId: '$thread-b' })
        )
      );
    });

    await act(async () => {
      interactiveSwipeState.options?.onCommit({ direction: 'left', ...frozenTarget! });
    });

    expect(navigateRoomFocusEventMock).toHaveBeenCalledWith(room.roomId, '$thread-a', {
      replace: true,
    });
    expect(navigateRoomFocusEventMock).not.toHaveBeenCalledWith(room.roomId, '$thread-b', {
      replace: true,
    });
    expect(store.get(lastExitedThreadAtom)).toEqual({
      roomId: room.roomId,
      threadId: '$thread-a',
    });
  });

  it('commits left-edge exit with the canonical thread id while route replacement is deferred by swipe', async () => {
    screenSizeState.current = 'Mobile';
    interactiveSwipeState.snapshot = {
      phase: 'dragging',
      target: {
        direction: 'left',
        roomId: undefined,
        threadId: '~pending-thread',
      },
    };
    const confirmedThreadId = ['$', 'confirmed-thread'].join('');
    useThreadRootEventMock.mockReturnValue(confirmedThreadId);
    const { lastExitedThreadAtom } = await import('../lastExitedThread');
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    const store = createStore();

    await act(async () => {
      create(
        React.createElement(
          Provider,
          { store },
          React.createElement(RoomView, { room: room as never, threadId: '~pending-thread' })
        )
      );
    });

    expect(interactiveSwipeState.options?.leftTarget).toMatchObject({
      roomId: room.roomId,
      threadId: '~pending-thread',
    });
    expect(navigateRoomThreadMock).not.toHaveBeenCalled();

    await act(async () => {
      interactiveSwipeState.options?.onCommit({
        direction: 'left',
        roomId: room.roomId,
        threadId: '~pending-thread',
      });
    });

    expect(navigateRoomFocusEventMock).toHaveBeenCalledWith(room.roomId, confirmedThreadId, {
      replace: true,
    });
    expect(navigateRoomFocusEventMock).not.toHaveBeenCalledWith(room.roomId, '~pending-thread', {
      replace: true,
    });
    expect(store.get(lastExitedThreadAtom)).toEqual({
      roomId: room.roomId,
      threadId: confirmedThreadId,
    });
  });

  it('commits right-edge re-entry only for the same-room last exited thread and consumes it', async () => {
    screenSizeState.current = 'Mobile';
    const { lastExitedThreadAtom } = await import('../lastExitedThread');
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    const store = createStore();
    store.set(lastExitedThreadAtom, {
      roomId: room.roomId,
      threadId: '$previous',
    });

    await act(async () => {
      create(
        React.createElement(
          Provider,
          { store },
          React.createElement(RoomView, { room: room as never })
        )
      );
    });

    expect(interactiveSwipeState.options?.rightTarget).toMatchObject({
      label: 'Thread',
      threadId: '$previous',
    });

    await act(async () => {
      interactiveSwipeState.options?.onCommit({ direction: 'right', threadId: '$previous' });
    });

    expect(navigateRoomThreadMock).toHaveBeenCalledWith(room.roomId, '$previous');
    expect(historyForwardMock).not.toHaveBeenCalled();
    expect(store.get(lastExitedThreadAtom)).toBeNull();
  });

  it('commits right-edge re-entry with the frozen target if the atom changes before settle', async () => {
    screenSizeState.current = 'Mobile';
    const { lastExitedThreadAtom } = await import('../lastExitedThread');
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    const store = createStore();
    store.set(lastExitedThreadAtom, {
      roomId: room.roomId,
      threadId: '$previous',
    });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(RoomView, { room: room as never })
        )
      );
    });

    const frozenTarget = interactiveSwipeState.options?.rightTarget;
    expect(frozenTarget).toMatchObject({
      roomId: room.roomId,
      threadId: '$previous',
    });

    await act(async () => {
      store.set(lastExitedThreadAtom, {
        roomId: room.roomId,
        threadId: '$changed',
      });
      renderer?.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(RoomView, { room: room as never })
        )
      );
    });

    await act(async () => {
      interactiveSwipeState.options?.onCommit({ direction: 'right', ...frozenTarget! });
    });

    expect(navigateRoomThreadMock).toHaveBeenCalledWith(room.roomId, '$previous');
    expect(navigateRoomThreadMock).not.toHaveBeenCalledWith(room.roomId, '$changed');
    expect(store.get(lastExitedThreadAtom)).toBeNull();
  });

  it('commits right-edge re-entry with the frozen target if the atom clears before settle', async () => {
    screenSizeState.current = 'Mobile';
    const { lastExitedThreadAtom } = await import('../lastExitedThread');
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    const store = createStore();
    store.set(lastExitedThreadAtom, {
      roomId: room.roomId,
      threadId: '$previous',
    });

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        React.createElement(
          Provider,
          { store },
          React.createElement(RoomView, { room: room as never })
        )
      );
    });

    const frozenTarget = interactiveSwipeState.options?.rightTarget;
    expect(frozenTarget).toMatchObject({
      roomId: room.roomId,
      threadId: '$previous',
    });

    await act(async () => {
      store.set(lastExitedThreadAtom, null);
      renderer?.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(RoomView, { room: room as never })
        )
      );
    });

    await act(async () => {
      interactiveSwipeState.options?.onCommit({ direction: 'right', ...frozenTarget! });
    });

    expect(navigateRoomThreadMock).toHaveBeenCalledWith(room.roomId, '$previous');
    expect(store.get(lastExitedThreadAtom)).toBeNull();
  });

  it('canonicalizes resolved thread ids and passes them through the thread view', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    useThreadRootEventMock.mockReturnValue('$confirmed-thread');

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(RoomView, {
          room: room as never,
          threadId: '~pending-thread',
          eventId: '$focus',
        })
      );
    });

    expect(navigateRoomThreadMock).toHaveBeenCalledWith(
      room.roomId,
      '$confirmed-thread',
      '$focus',
      { replace: true }
    );
    expect(getTimeline(renderer!).props.threadId).toBe('$confirmed-thread');
  });

  it('defers canonical thread route replacement while interactive swipe is non-idle', async () => {
    const { useRoomViewThreadState } = await import('../useRoomViewThreadState');
    const ThreadStateHarness = createThreadStateHarness(useRoomViewThreadState);
    const room = makeRoom(nextRoomId('room-a'));
    useThreadRootEventMock.mockReturnValue('$confirmed-thread');
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ThreadStateHarness, {
          onState: () => undefined,
          room,
          threadId: '~pending-thread',
          eventId: '$focus',
          swipeIdle: false,
        })
      );
    });

    expect(navigateRoomThreadMock).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.update(
        React.createElement(ThreadStateHarness, {
          onState: () => undefined,
          room,
          threadId: '~pending-thread',
          eventId: '$focus',
          swipeIdle: true,
        })
      );
    });

    expect(navigateRoomThreadMock).toHaveBeenCalledWith(
      room.roomId,
      '$confirmed-thread',
      '$focus',
      { replace: true }
    );
  });

  it('bumps the recent-thread list from the canonical open thread id', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    useThreadRootEventMock.mockReturnValue('$confirmed-thread');

    await act(async () => {
      create(
        React.createElement(RoomView, {
          room: room as never,
          threadId: '~pending-thread',
        })
      );
    });

    expect(bumpRecentThreadMock).toHaveBeenCalledWith(
      room.roomId,
      '$confirmed-thread',
      undefined,
      undefined
    );
  });

  it('does not persist unresolved local-echo ids in the recent-thread list', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    useThreadRootEventMock.mockReturnValue('~pending-thread');

    await act(async () => {
      create(
        React.createElement(RoomView, {
          room: room as never,
          threadId: '~pending-thread',
        })
      );
    });

    expect(bumpRecentThreadMock).not.toHaveBeenCalled();
  });
});
