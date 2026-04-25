import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROOM_THREAD_EXIT_TARGET_STATE_KEY,
  setRoomThreadExitTargetForHistoryState,
} from '../../hooks/roomNavigateState';

type MockThreadContextBannerProps = {
  onExitThread?: () => void;
  summaryInfo?: { summaryText?: string; generatedTs?: number; messageCount?: number };
};

type MockPageProps = React.ComponentProps<'div'>;

const {
  bumpRecentThreadMock,
  historyBackMock,
  isNativeIOSMock,
  navigatePathMock,
  pageState,
  passthrough,
  roomTimelineType,
  navigateRoomFocusEventMock,
  navigateRoomThreadMock,
  threadContextBannerState,
  useThreadRootEventMock,
} = vi.hoisted(() => ({
  bumpRecentThreadMock: vi.fn(),
  historyBackMock: vi.fn(),
  isNativeIOSMock: vi.fn(() => false),
  navigatePathMock: vi.fn(),
  pageState: {
    props: undefined as MockPageProps | undefined,
  },
  passthrough: 'div',
  roomTimelineType: 'room-timeline',
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

vi.mock('../../hooks/useStateEvent', () => ({
  useStateEvent: () => undefined,
}));

vi.mock('../../hooks/usePowerLevels', () => ({
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getHomeserverUrl: () => 'https://mindroom.chat',
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
  Page: React.forwardRef<HTMLDivElement, MockPageProps>((props, ref) => {
    pageState.props = props;
    return React.createElement('div', { ...props, ref });
  }),
}));

vi.mock('./RoomViewHeader', () => ({
  RoomViewHeader: passthrough,
}));

vi.mock('../../mindroom/threads/ThreadContextBanner', () => ({
  ThreadContextBanner: (props: MockThreadContextBannerProps) => {
    threadContextBannerState.props = props;
    return React.createElement('div');
  },
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
    navigatePath: navigatePathMock,
    navigateRoomFocusEvent: navigateRoomFocusEventMock,
    navigateRoomThread: navigateRoomThreadMock,
  }),
}));

vi.mock('../../utils/nativeSso', () => ({
  isNativeIOS: isNativeIOSMock,
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

vi.mock('../../mindroom/threads/useThreadRootEvent', () => ({
  useThreadRootEvent: useThreadRootEventMock,
}));

vi.mock('../../mindroom/threads/useRoomThreadSummaryState', () => ({
  useRoomThreadSummaryState: () => ({
    summaryMap: new Map(),
    storeThreadSummary: vi.fn(),
  }),
}));

vi.mock('../../state/recentThreads', () => ({
  bumpRecentThread: bumpRecentThreadMock,
}));

const makeRoom = (roomId: string) => ({
  roomId,
  getThread: () => undefined,
  findEventById: () => undefined,
});
let roomIdSeed = 0;
const nextRoomId = (label: string) => `!${label}-${roomIdSeed++}:example.org`;

const getTimeline = (renderer: ReturnType<typeof create>) =>
  (renderer.root.findByType(roomTimelineType as never) as unknown) as {
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
    historyBackMock.mockReset();
    isNativeIOSMock.mockReset();
    isNativeIOSMock.mockReturnValue(false);
    navigatePathMock.mockReset();
    navigateRoomFocusEventMock.mockReset();
    navigateRoomThreadMock.mockReset();
    pageState.props = undefined;
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
    const { RoomView } = await import('./RoomView');
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
    const { RoomView } = await import('./RoomView');
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
    const { RoomView } = await import('./RoomView');
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
    const { RoomView } = await import('./RoomView');
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
    const { RoomView } = await import('./RoomView');
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
    const { RoomView } = await import('./RoomView');
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

    const { RoomView } = await import('./RoomView');

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

    const { RoomView } = await import('./RoomView');

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

    const { RoomView } = await import('./RoomView');

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
    const { RoomView } = await import('./RoomView');
    const room = makeRoom(nextRoomId('room-a'));

    await act(async () => {
      create(React.createElement(RoomView, { room: room as never, threadId: '$thread' }));
    });

    expect(threadContextBannerState.props?.onExitThread).toBeTypeOf('function');

    await act(async () => {
      threadContextBannerState.props?.onExitThread?.();
    });

    expect(historyBackMock).not.toHaveBeenCalled();
    expect(navigateRoomFocusEventMock).toHaveBeenCalledWith(
      room.roomId,
      '$thread',
      { replace: true }
    );
  });

  it('renders the room page with the app-height lock style', async () => {
    const { RoomView } = await import('./RoomView');
    const room = makeRoom('!room-a:example.org');

    await act(async () => {
      create(React.createElement(RoomView, { room: room as never }));
    });

    expect(pageState.props?.style).toMatchObject({ height: 'var(--app-height, 100%)' });
  });

  it('canonicalizes resolved thread ids and passes them through the thread view', async () => {
    const { RoomView } = await import('./RoomView');
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

  it('bumps the recent-thread list from the canonical open thread id', async () => {
    const { RoomView } = await import('./RoomView');
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
});
