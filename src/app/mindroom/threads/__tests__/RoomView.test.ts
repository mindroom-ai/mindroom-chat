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
  compactRoomTimelineState,
  edgeSwipeBackState,
  edgeSwipeForwardState,
  historyBackMock,
  historyForwardMock,
  isIOSStandaloneWebAppMock,
  isNativeIOSMock,
  navigatePathMock,
  pageState,
  passthrough,
  roomTimelineType,
  simpleModeState,
  navigateRoomFocusEventMock,
  navigateRoomThreadMock,
  threadContextBannerState,
  useThreadRootEventMock,
} = vi.hoisted(() => ({
  bumpRecentThreadMock: vi.fn(),
  compactRoomTimelineState: {
    enabled: false,
    onThreadClick: vi.fn(),
    threadRootIds: ['$thread'],
  },
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
  isIOSStandaloneWebAppMock: vi.fn(() => false),
  isNativeIOSMock: vi.fn(() => false),
  navigatePathMock: vi.fn(),
  pageState: {
    props: undefined as MockPageProps | undefined,
  },
  passthrough: 'div',
  roomTimelineType: 'room-timeline',
  simpleModeState: { enabled: false },
  navigateRoomFocusEventMock: vi.fn(),
  navigateRoomThreadMock: vi.fn(),
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

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
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

vi.mock('../../settings/useMindroomAccountSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../settings/useMindroomAccountSettings')>();
  return {
    ...actual,
    useSimpleMode: () => simpleModeState.enabled,
  };
});

vi.mock('../../../components/editor', () => ({
  useEditor: () => ({}),
}));

vi.mock('../../../features/room/RoomInputPlaceholder', () => ({
  RoomInputPlaceholder: passthrough,
}));

vi.mock('../compactThreadCardViewModel', () => ({
  useCompactThreadCardViewModels: ({
    room,
    threadRootIds,
  }: {
    room: { roomId: string };
    threadRootIds: string[];
  }) =>
    threadRootIds.map((threadRootId) => ({
      id: { roomId: room.roomId, threadRootId },
      recentThreadSummaryText: `Summary for ${threadRootId}`,
    })),
}));

vi.mock('../CompactThreadCard', () => ({
  CompactThreadCard: ({
    viewModel,
    onClick,
  }: {
    viewModel: { id: { threadRootId: string } };
    onClick: (threadRootId: string) => void;
  }) =>
    React.createElement(
      'button',
      {
        'data-thread-root-id': viewModel.id.threadRootId,
        onClick: () => onClick(viewModel.id.threadRootId),
        type: 'button',
      },
      viewModel.id.threadRootId
    ),
}));

vi.mock('../CompactRoomView.css', () => ({
  CardAction: 'CardAction',
  CardShell: 'CardShell',
  EmptyState: 'EmptyState',
  View: 'View',
}));

vi.mock('../MindroomRoomTimeline', async () => {
  const ReactModule = await import('react');
  const { CompactRoomView } = await import('../CompactRoomView');

  type MockRoomTimelineProps = {
    compactRoomScrollStateRef: React.MutableRefObject<Map<string, number>>;
    room: { roomId: string };
    threadId?: string;
  };

  return {
    RoomTimeline: (props: MockRoomTimelineProps) =>
      ReactModule.createElement(
        roomTimelineType,
        props,
        compactRoomTimelineState.enabled && !props.threadId
          ? ReactModule.createElement(CompactRoomView, {
              compactRoomScrollStateRef: props.compactRoomScrollStateRef,
              onThreadClick: compactRoomTimelineState.onThreadClick,
              room: props.room as never,
              threadRecordMap: new Map(),
              threadRootIds: compactRoomTimelineState.threadRootIds,
            })
          : null
      ),
  };
});

vi.mock('../../../features/room/RoomViewTyping', () => ({
  RoomViewTyping: passthrough,
}));

vi.mock('../../../features/room/RoomTombstone', () => ({
  RoomTombstone: passthrough,
}));

vi.mock('../../room-input/MindroomRoomInput', () => ({
  RoomInput: 'room-input',
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
  getThread: () => undefined,
  findEventById: () => undefined,
});
let roomIdSeed = 0;
const nextRoomId = (label: string) => `!${label}-${roomIdSeed++}:example.org`;

type ThreadStateHarnessProps = {
  eventId?: string;
  onState: (state: import('../useRoomViewThreadState').RoomViewThreadState) => void;
  room: ReturnType<typeof makeRoom>;
  threadId?: string;
};

const createThreadStateHarness =
  (useRoomViewThreadState: typeof import('../useRoomViewThreadState').useRoomViewThreadState) =>
  ({ eventId, onState, room, threadId }: ThreadStateHarnessProps) => {
    onState(useRoomViewThreadState({ eventId, room: room as never, threadId }));
    return null;
  };

const getTimeline = (renderer: ReturnType<typeof create>) =>
  renderer.root.findByType(roomTimelineType as never) as unknown as {
    props: {
      onToggle: (key: string) => void;
      onAddTag: (tag: string) => void;
      onSearchQueryChange: (query: string) => void;
      onSortDirectionChange: () => void;
      onToggleThreadSortFreeze: () => void;
      onReset: () => void;
      compactRoomScrollStateRef: React.MutableRefObject<Map<string, number>>;
      threadId?: string;
      threadFilterState: {
        resolved: string;
        streaming: string;
        scheduled: string;
        unread: string;
        idle: string;
        sortBy: string;
        sortDirection: string;
        freeText: string;
        tags: Map<string, string>;
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
    compactRoomTimelineState.enabled = false;
    compactRoomTimelineState.onThreadClick.mockReset();
    compactRoomTimelineState.threadRootIds = ['$thread'];
    edgeSwipeBackState.enabled = undefined;
    edgeSwipeBackState.onBack = undefined;
    edgeSwipeForwardState.enabled = undefined;
    edgeSwipeForwardState.onForward = undefined;
    historyBackMock.mockReset();
    historyForwardMock.mockReset();
    isIOSStandaloneWebAppMock.mockReset();
    isIOSStandaloneWebAppMock.mockReturnValue(false);
    isNativeIOSMock.mockReset();
    isNativeIOSMock.mockReturnValue(false);
    navigatePathMock.mockReset();
    navigateRoomFocusEventMock.mockReset();
    navigateRoomThreadMock.mockReset();
    pageState.props = undefined;
    simpleModeState.enabled = false;
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

  it('restores compact scroll after a card open and history-back thread exit', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    compactRoomTimelineState.enabled = true;
    compactRoomTimelineState.onThreadClick.mockImplementation((threadRootId: string) => {
      navigateRoomThreadMock(room.roomId, threadRootId);
    });
    let scrollElement = { scrollTop: 0 };
    const createNodeMock = (element: React.ReactElement) => {
      if (element.props['data-compact-room-view'] === 'true') return scrollElement;
      return {};
    };
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(RoomView, { room: room as never }), {
        createNodeMock,
      });
    });

    scrollElement.scrollTop = 418;
    await act(async () => {
      renderer?.root.findByProps({ 'data-thread-root-id': '$thread' }).props.onClick();
    });

    expect(navigateRoomThreadMock).toHaveBeenCalledWith(room.roomId, '$thread');

    await act(async () => {
      renderer?.update(React.createElement(RoomView, { room: room as never, threadId: '$thread' }));
    });

    window.history.state = {
      usr: {
        [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
          roomId: room.roomId,
          threadId: '$thread',
          useHistoryBack: true,
        },
      },
    };

    await act(async () => {
      threadContextBannerState.props?.onExitThread?.();
    });

    expect(historyBackMock).toHaveBeenCalledOnce();

    scrollElement = { scrollTop: 0 };
    await act(async () => {
      renderer?.update(React.createElement(RoomView, { room: room as never }));
    });

    expect(scrollElement.scrollTop).toBe(418);
  });

  it('restores compact scroll after a native-iOS replacement thread exit', async () => {
    isNativeIOSMock.mockReturnValue(true);
    compactRoomTimelineState.enabled = true;
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    const exitPath = `/home/${encodeURIComponent(room.roomId)}`;
    let scrollElement = { scrollTop: 0 };
    const createNodeMock = (element: React.ReactElement) => {
      if (element.props['data-compact-room-view'] === 'true') return scrollElement;
      return {};
    };
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(RoomView, { room: room as never }), {
        createNodeMock,
      });
    });

    scrollElement.scrollTop = 512;
    await act(async () => {
      renderer?.root.findByProps({ 'data-thread-root-id': '$thread' }).props.onClick();
      renderer?.update(React.createElement(RoomView, { room: room as never, threadId: '$thread' }));
    });

    window.history.state = {
      usr: {
        [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
          exitPath,
          roomId: room.roomId,
          threadId: '$thread',
          useHistoryBack: false,
        },
      },
    };

    await act(async () => {
      threadContextBannerState.props?.onExitThread?.();
    });

    expect(navigatePathMock).toHaveBeenCalledWith(exitPath, { replace: true });

    scrollElement = { scrollTop: 0 };
    await act(async () => {
      renderer?.update(React.createElement(RoomView, { room: room as never }));
    });

    expect(scrollElement.scrollTop).toBe(512);
  });

  it('does not restore one room compact scroll position into another room', async () => {
    compactRoomTimelineState.enabled = true;
    const { RoomView } = await import('../../../features/room/RoomView');
    const roomA = makeRoom(nextRoomId('room-a'));
    const roomB = makeRoom(nextRoomId('room-b'));
    let scrollElement = { scrollTop: 0 };
    const createNodeMock = (element: React.ReactElement) => {
      if (element.props['data-compact-room-view'] === 'true') return scrollElement;
      return {};
    };
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(React.createElement(RoomView, { room: roomA as never }), {
        createNodeMock,
      });
    });

    scrollElement.scrollTop = 733;
    await act(async () => {
      renderer?.update(
        React.createElement(RoomView, { room: roomA as never, threadId: '$thread' })
      );
    });

    scrollElement = { scrollTop: 0 };
    await act(async () => {
      renderer?.update(React.createElement(RoomView, { room: roomB as never }));
    });

    expect(scrollElement.scrollTop).toBe(0);
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

  it('ignores agent filters and sort freeze as soon as the room becomes agentless', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(RoomView, { room: room as never, hasMindroomAgents: true })
      );
    });

    await act(async () => {
      getTimeline(renderer!).props.onToggle('resolved');
      getTimeline(renderer!).props.onToggleThreadSortFreeze();
    });
    expect(getTimeline(renderer!).props.threadFilterState.resolved).toBe('include');
    expect(getTimeline(renderer!).props.threadSortFreezeState).not.toBeNull();

    await act(async () => {
      renderer?.update(
        React.createElement(RoomView, { room: room as never, hasMindroomAgents: false })
      );
    });
    expect(getTimeline(renderer!).props.threadFilterState.resolved).toBe('any');
    expect(getTimeline(renderer!).props.threadFilterState.sortBy).toBe('lastReply');
    expect(getTimeline(renderer!).props.threadSortFreezeState).toBeNull();

    await act(async () => {
      renderer?.update(
        React.createElement(RoomView, { room: room as never, hasMindroomAgents: true })
      );
    });
    expect(getTimeline(renderer!).props.threadFilterState.resolved).toBe('include');
    expect(getTimeline(renderer!).props.threadSortFreezeState).toBeNull();
  });

  it('cycles and preserves sort modes in Simple Mode, including agentless rooms', async () => {
    simpleModeState.enabled = true;
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(RoomView, { room: room as never, hasMindroomAgents: true })
      );
    });

    expect(getTimeline(renderer!).props.threadFilterState.sortBy).toBe('lastReply');
    expect(getTimeline(renderer!).props.threadFilterState.sortDirection).toBe('desc');
    expect(getTimeline(renderer!).props.threadSortFreezeState).toBeNull();

    await act(async () => {
      getTimeline(renderer!).props.onSortDirectionChange();
    });

    expect(getTimeline(renderer!).props.threadFilterState.sortBy).toBe('lastReply');
    expect(getTimeline(renderer!).props.threadFilterState.sortDirection).toBe('asc');

    await act(async () => {
      renderer?.update(
        React.createElement(RoomView, { room: room as never, hasMindroomAgents: false })
      );
    });

    expect(getTimeline(renderer!).props.threadFilterState.sortBy).toBe('lastReply');
    expect(getTimeline(renderer!).props.threadFilterState.sortDirection).toBe('asc');

    await act(async () => {
      getTimeline(renderer!).props.onSortDirectionChange();
    });

    expect(getTimeline(renderer!).props.threadFilterState.sortBy).toBe('natural');
    expect(getTimeline(renderer!).props.threadFilterState.sortDirection).toBe('desc');
  });

  it('preserves hidden agent filters when searching in an agentless room', async () => {
    vi.useFakeTimers();
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(RoomView, { room: room as never, hasMindroomAgents: true })
      );
    });

    await act(async () => {
      getTimeline(renderer!).props.onToggle('resolved');
    });
    await act(async () => {
      getTimeline(renderer!).props.onAddTag('saved');
    });

    await act(async () => {
      renderer?.update(
        React.createElement(RoomView, { room: room as never, hasMindroomAgents: false })
      );
    });

    await act(async () => {
      getTimeline(renderer!).props.onSearchQueryChange('hello is:streaming tag:priority');
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(getTimeline(renderer!).props.threadFilterState.freeText).toBe(
      'hello is:streaming tag:priority'
    );
    expect(getTimeline(renderer!).props.threadFilterState.resolved).toBe('any');
    expect(getTimeline(renderer!).props.threadFilterState.tags).toEqual(new Map());

    await act(async () => {
      renderer?.update(
        React.createElement(RoomView, { room: room as never, hasMindroomAgents: true })
      );
    });

    expect(getTimeline(renderer!).props.threadFilterState.freeText).toBe(
      'hello is:streaming tag:priority'
    );
    expect(getTimeline(renderer!).props.threadFilterState.resolved).toBe('include');
    expect(getTimeline(renderer!).props.threadFilterState.streaming).toBe('any');
    expect(getTimeline(renderer!).props.threadFilterState.tags).toEqual(
      new Map([['saved', 'include']])
    );
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

  it('lets the app shell own the viewport height (CINNY-132)', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom('!room-a:example.org');

    await act(async () => {
      create(React.createElement(RoomView, { room: room as never }));
    });

    // #root is the visual-viewport follower; a second --app-height authority
    // here is what left a gap between the composer and the iOS keyboard.
    expect(JSON.stringify(pageState.props?.style ?? {})).not.toContain('--app-height');
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

  it('replaces a local route while translating its browser-back exit target', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    const localThreadId = `~${room.roomId}:txn-local`;
    const exitPath = `/home/${encodeURIComponent(room.roomId)}`;
    useThreadRootEventMock.mockReturnValue('$confirmed-thread');
    window.history.state = {
      idx: 4,
      key: `thread-entry-key:${room.roomId}`,
      usr: {
        preservedUserState: 'keep-me',
        [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
          exitPath,
          roomId: room.roomId,
          threadId: localThreadId,
          useHistoryBack: true,
        },
      },
    };

    await act(async () => {
      create(
        React.createElement(RoomView, {
          room: room as never,
          threadId: localThreadId,
        })
      );
    });

    const navigateOptions = navigateRoomThreadMock.mock.calls[0]?.[3];
    expect(navigateRoomThreadMock).toHaveBeenCalledWith(
      room.roomId,
      '$confirmed-thread',
      undefined,
      {
        replace: true,
        state: {
          preservedUserState: 'keep-me',
          [ROOM_THREAD_EXIT_TARGET_STATE_KEY]: {
            exitPath,
            roomId: room.roomId,
            threadId: '$confirmed-thread',
            useHistoryBack: true,
          },
        },
      }
    );
    expect(navigateOptions?.state).not.toHaveProperty('usr');
    expect(navigateOptions?.state).not.toHaveProperty('idx');

    window.history.state = {
      idx: 4,
      key: `thread-entry-key:${room.roomId}`,
      usr: navigateOptions?.state,
    };
    await act(async () => {
      threadContextBannerState.props?.onExitThread?.();
    });

    expect(historyBackMock).toHaveBeenCalledOnce();
    expect(navigateRoomFocusEventMock).not.toHaveBeenCalled();
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

  it('opens a successful compact room message send as a thread', async () => {
    const { useRoomViewThreadState } = await import('../useRoomViewThreadState');
    const ThreadStateHarness = createThreadStateHarness(useRoomViewThreadState);
    const room = makeRoom(nextRoomId('room-a'));
    let threadState: import('../useRoomViewThreadState').RoomViewThreadState | undefined;

    await act(async () => {
      create(
        React.createElement(ThreadStateHarness, {
          onState: (state) => {
            threadState = state;
          },
          room,
        })
      );
    });

    await act(async () => {
      threadState?.handleRoomMessageSent('$sent');
    });

    expect(navigateRoomThreadMock).toHaveBeenCalledWith(room.roomId, '$sent');
  });

  it('does not open successful sends as new threads outside the compact room overview', async () => {
    const { useRoomViewThreadState } = await import('../useRoomViewThreadState');
    const ThreadStateHarness = createThreadStateHarness(useRoomViewThreadState);
    const room = makeRoom(nextRoomId('room-a'));
    let threadState: import('../useRoomViewThreadState').RoomViewThreadState | undefined;

    await act(async () => {
      create(
        React.createElement(ThreadStateHarness, {
          onState: (state) => {
            threadState = state;
          },
          room,
          threadId: '$thread-a',
        })
      );
    });

    await act(async () => {
      threadState?.handleRoomMessageSent('$sent');
    });

    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
  });

  it('does not open successful sends when only an effective thread id is active', async () => {
    const { useRoomViewThreadState } = await import('../useRoomViewThreadState');
    const ThreadStateHarness = createThreadStateHarness(useRoomViewThreadState);
    const room = makeRoom(nextRoomId('room-a'));
    let threadState: import('../useRoomViewThreadState').RoomViewThreadState | undefined;

    useThreadRootEventMock.mockReturnValue('$thread-from-state');

    await act(async () => {
      create(
        React.createElement(ThreadStateHarness, {
          onState: (state) => {
            threadState = state;
          },
          room,
        })
      );
    });

    expect(threadState?.effectiveThreadId).toBe('$thread-from-state');

    await act(async () => {
      threadState?.handleRoomMessageSent('$sent');
    });

    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
  });

  it('opens unresolved local-echo sends as compact threads', async () => {
    const { useRoomViewThreadState } = await import('../useRoomViewThreadState');
    const ThreadStateHarness = createThreadStateHarness(useRoomViewThreadState);
    const room = makeRoom(nextRoomId('room-a'));
    let threadState: import('../useRoomViewThreadState').RoomViewThreadState | undefined;

    await act(async () => {
      create(
        React.createElement(ThreadStateHarness, {
          onState: (state) => {
            threadState = state;
          },
          room,
        })
      );
    });

    let accepted = false;
    await act(async () => {
      accepted = threadState?.handleRoomMessageSent('~local-echo') ?? false;
    });

    expect(accepted).toBe(true);
    expect(navigateRoomThreadMock).toHaveBeenCalledWith(room.roomId, '~local-echo');
  });

  it('hides the composer until a local-echo thread root is confirmed', async () => {
    const { RoomView } = await import('../../../features/room/RoomView');
    const room = makeRoom(nextRoomId('room-a'));
    useThreadRootEventMock.mockReturnValue('~pending-thread');

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        React.createElement(RoomView, {
          room: room as never,
          threadId: '~pending-thread',
        })
      );
    });

    expect(renderer?.root.findAllByType('room-input')).toHaveLength(0);
    expect(JSON.stringify(renderer?.toJSON())).toContain(
      'Replies are available after this message is confirmed.'
    );
  });

  it('does not open successful sends as new threads in classic mode', async () => {
    const { useRoomViewThreadState } = await import('../useRoomViewThreadState');
    const ThreadStateHarness = createThreadStateHarness(useRoomViewThreadState);
    const room = makeRoom(nextRoomId('room-a'));
    let threadState: import('../useRoomViewThreadState').RoomViewThreadState | undefined;

    await act(async () => {
      create(
        React.createElement(ThreadStateHarness, {
          onState: (state) => {
            threadState = state;
          },
          room,
        })
      );
    });

    await act(async () => {
      threadState?.handleViewModeChange('classic');
    });
    await act(async () => {
      threadState?.handleRoomMessageSent('$sent');
    });

    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
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
