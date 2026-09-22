import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel, ThreadRecord } from './types';
import { CompactRoomView } from './CompactRoomView';

vi.mock('../../components/inset-scrollbar/InsetScrollbar', () => ({
  InsetScrollbar: () => null,
}));
const menuProps = vi.hoisted(() => vi.fn());
vi.mock('./ThreadActionsMenu', () => ({
  ThreadActionsMenu: (props: unknown) => {
    menuProps(props);
    return null;
  },
}));

const pinningMocks = vi.hoisted(() => ({
  pinnedEventIds: [] as string[],
  canPin: false,
  setPinned: vi.fn(),
  updating: false,
  error: undefined,
}));
vi.mock('./useThreadPinning', () => ({ useThreadPinning: () => pinningMocks }));

const {
  passthrough,
  renderedCardProps,
  setResolvedMock,
  useCompactThreadCardViewModelsMock,
  useToggleThreadResolutionMock,
} = vi.hoisted(() => ({
  passthrough: 'div',
  renderedCardProps: vi.fn(),
  setResolvedMock: vi.fn(),
  useCompactThreadCardViewModelsMock: vi.fn(),
  useToggleThreadResolutionMock: vi.fn(),
}));

const makeViewModel = (
  threadRootId: string,
  overrides: Partial<CompactThreadCardViewModel> = {}
): CompactThreadCardViewModel => ({
  id: {
    roomId: '!room:server',
    threadRootId,
  },
  titleText: 'Thread title',
  displayTitleText: 'Thread title',
  previewText: 'Latest reply',
  primarySummaryText: 'Primary summary',
  recentThreadSummaryText: 'Recent summary',
  messageCount: 2,
  messageCountLabel: '2 msgs',
  attentionState: 'idle',
  attentionStatusText: 'Idle',
  participants: [],
  tags: [],
  isResolved: false,
  isUnread: false,
  isStreaming: false,
  ...overrides,
});

const makeThreadRecord = (
  threadRootId: string,
  overrides: Partial<ThreadRecord> = {}
): ThreadRecord => ({
  roomId: '!room:server',
  threadRootId,
  rootEventId: threadRootId,
  presentation: {
    summaryInfo: undefined,
    summaryText: undefined,
    rootPreviewText: undefined,
    latestReplyPreviewText: undefined,
    lastSenderId: undefined,
    lastSenderDisplayName: undefined,
    replyParticipantIds: [],
    primarySummaryText: undefined,
    recentThreadSummaryText: undefined,
    messageCount: 0,
    participantIds: [],
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 0,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    tags: [],
  },
  cache: {
    eventCount: 0,
    relationSnapshotComplete: false,
    tailLoaded: false,
  },
  absoluteIndex: 0,
  ...overrides,
});

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();

  return {
    ...actual,
    Box: passthrough,
    Button: 'button',
    IconButton: 'button',
    Text: passthrough,
  };
});

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({ t: translateFromEn }),
  };
});

vi.mock('./compactThreadCardViewModel', () => ({
  useCompactThreadCardViewModels: useCompactThreadCardViewModelsMock,
}));

vi.mock('./useRoomThreadTags', () => ({
  useToggleThreadResolution: useToggleThreadResolutionMock,
}));

vi.mock('./CompactThreadCard', () => ({
  CompactThreadCard: ({
    viewModel,
    onClick,
  }: {
    viewModel: CompactThreadCardViewModel;
    onClick: (threadRootId: string, summaryText?: string) => void;
  }) => {
    renderedCardProps({ viewModel });

    return React.createElement(
      'button',
      {
        type: 'button',
        'data-thread-root-id': viewModel.id.threadRootId,
        onClick: () => onClick(viewModel.id.threadRootId, viewModel.primarySummaryText),
      },
      viewModel.titleText
    );
  },
}));

vi.mock('./CompactRoomView.css', () => ({
  View: 'View',
  EmptyState: 'EmptyState',
  CardAction: 'CardAction',
  CardQuickAction: 'CardQuickAction',
  CardMenuButton: 'CardMenuButton',
  CardShell: 'CardShell',
  PinnedSection: 'PinnedSection',
}));

const makeRoom = () =>
  ({
    roomId: '!room:server',
  } as Room);

describe('CompactRoomView', () => {
  it('opens thread actions on right click and navigates only after Open thread is chosen', async () => {
    useCompactThreadCardViewModelsMock.mockReturnValue([makeViewModel('$context')]);
    const onThreadClick = vi.fn();
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$context'],
        threadRecordMap: new Map(),
        onThreadClick,
        compactRoomScrollStateRef: { current: new Map() },
      })
    );
    const shell = renderer.root.findByProps({ className: 'CardShell' });
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 123,
      clientY: 234,
      currentTarget: { querySelector: () => null },
    };
    await act(async () => {
      shell.props.onContextMenu(event);
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(onThreadClick).not.toHaveBeenCalled();
    const selectedMenu = menuProps.mock.calls.at(-1)![0];
    expect(selectedMenu.rootId).toBe('$context');
    expect(selectedMenu.anchor).toEqual({ x: 123, y: 234, width: 0, height: 0 });
    act(() => selectedMenu.onOpenThread());
    expect(onThreadClick).toHaveBeenCalledWith('$context', 'Recent summary');
    renderer.unmount();
  });

  it('offers a keyboard and touch accessible menu button for resolved cards', () => {
    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$context', { isResolved: true }),
    ]);
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$context'],
        threadRecordMap: new Map(),
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );
    expect(renderer.root.findAllByProps({ 'aria-haspopup': 'menu' })).toHaveLength(1);
    renderer.unmount();
  });

  it('ignores stale callbacks after another thread menu opens', async () => {
    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$first'),
      makeViewModel('$second'),
    ]);
    const firstTrigger = { focus: vi.fn(), isConnected: true };
    const secondTrigger = { focus: vi.fn(), isConnected: true };
    const onThreadClick = vi.fn();
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$first', '$second'],
        threadRecordMap: new Map(),
        onThreadClick,
        compactRoomScrollStateRef: { current: new Map() },
      })
    );
    const [firstShell, secondShell] = renderer.root.findAllByProps({ className: 'CardShell' });

    await act(async () => {
      firstShell.props.onContextMenu({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clientX: 10,
        clientY: 20,
        currentTarget: { querySelector: () => firstTrigger },
      });
    });
    const firstMenu = menuProps.mock.calls.at(-1)![0];

    act(() => {
      secondShell.props.onContextMenu({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clientX: 30,
        clientY: 40,
        currentTarget: { querySelector: () => secondTrigger },
      });
    });
    const secondMenu = menuProps.mock.calls.at(-1)![0];

    act(() => firstMenu.onClose());
    expect(firstTrigger.focus).not.toHaveBeenCalled();
    expect(menuProps.mock.calls.at(-1)![0].rootId).toBe('$second');

    act(() => firstMenu.onOpenThread());
    expect(onThreadClick).not.toHaveBeenCalled();
    expect(menuProps.mock.calls.at(-1)![0].rootId).toBe('$second');

    act(() => secondMenu.onClose());
    expect(secondTrigger.focus).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  const resizeCallbacks = new Set<() => void>();
  afterEach(() => {
    vi.unstubAllGlobals();
    resizeCallbacks.clear();
  });
  beforeEach(() => {
    pinningMocks.pinnedEventIds = [];
    pinningMocks.canPin = false;
    pinningMocks.setPinned.mockReset();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: () => void) {}

        observe() {
          resizeCallbacks.add(this.callback);
        }

        disconnect() {
          resizeCallbacks.delete(this.callback);
        }
      }
    );
    vi.clearAllMocks();
    useCompactThreadCardViewModelsMock.mockReturnValue([]);
    useToggleThreadResolutionMock.mockReturnValue({
      canToggle: true,
      setResolved: setResolvedMock,
      updating: false,
      updatingThreadRootIds: new Set(),
      error: undefined,
    });
  });

  it('lets admins pin a card without opening the thread', () => {
    pinningMocks.canPin = true;
    useCompactThreadCardViewModelsMock.mockReturnValue([makeViewModel('$announcement')]);
    const onThreadClick = vi.fn();
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$announcement'],
        threadRecordMap: new Map(),
        onThreadClick,
        compactRoomScrollStateRef: { current: new Map() },
      })
    );
    const button = renderer.root.findByProps({ 'data-compact-thread-pin': 'true' });
    act(() => button.props.onClick());
    expect(pinningMocks.setPinned).toHaveBeenCalledWith('$announcement', true);
    expect(onThreadClick).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('groups pins above ordinary cards and omits their Resolve action for every role', () => {
    pinningMocks.pinnedEventIds = ['$announcement'];
    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$announcement'),
      makeViewModel('$ordinary'),
    ]);
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$announcement', '$ordinary'],
        threadRecordMap: new Map(),
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );
    const section = renderer.root.findByProps({ 'data-pinned-threads': 'true' });
    expect(section.findAllByProps({ 'data-thread-root-id': '$announcement' })).toHaveLength(1);
    expect(section.findAllByProps({ 'data-compact-thread-resolve': 'true' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'data-compact-thread-pin': 'true' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'data-compact-thread-resolve': 'true' })).toHaveLength(1);
    renderer.unmount();
  });

  it('renders an empty state when there are no thread roots', () => {
    const room = makeRoom();
    const renderer = create(
      React.createElement(CompactRoomView, {
        room,
        threadRootIds: [],
        threadRecordMap: new Map(),
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );

    expect(useCompactThreadCardViewModelsMock).toHaveBeenCalledWith({
      room,
      threadRootIds: [],
      threadRecordMap: new Map(),
    });
    expect(renderer.root.findAll((node) => node.children.includes('No threads'))).toHaveLength(1);
    expect(renderedCardProps).not.toHaveBeenCalled();
  });

  it('builds compact card view models through the shared MindRoom selector', () => {
    const room = makeRoom();
    const threadRecordMap = new Map([['$thread-1', makeThreadRecord('$thread-1')]]);
    const viewModel = makeViewModel('$thread-1', { titleText: 'AI summary' });
    useCompactThreadCardViewModelsMock.mockReturnValue([viewModel]);

    create(
      React.createElement(CompactRoomView, {
        room,
        threadRootIds: ['$thread-1'],
        threadRecordMap,
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );

    expect(useCompactThreadCardViewModelsMock).toHaveBeenCalledWith({
      room,
      threadRootIds: ['$thread-1'],
      threadRecordMap,
    });
    expect(renderedCardProps).toHaveBeenCalledWith({ viewModel });
  });

  it('resolves an editable thread without opening its compact card', () => {
    const onThreadClick = vi.fn();
    const viewModel = makeViewModel('$thread-resolve');
    useCompactThreadCardViewModelsMock.mockReturnValue([viewModel]);

    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-resolve'],
        threadRecordMap: new Map([['$thread-resolve', makeThreadRecord('$thread-resolve')]]),
        onThreadClick,
        compactRoomScrollStateRef: { current: new Map() },
      })
    );
    const resolveButton = renderer.root.findByProps({
      'data-compact-thread-resolve': 'true',
    });

    act(() => {
      resolveButton.props.onClick();
    });

    expect(resolveButton.props['aria-label']).toBe('Resolve');
    expect(setResolvedMock).toHaveBeenCalledWith('$thread-resolve', true);
    expect(onThreadClick).not.toHaveBeenCalled();
  });

  it('omits the resolve action for resolved threads and users without permission', () => {
    useCompactThreadCardViewModelsMock.mockReturnValue([makeViewModel('$thread-read-only')]);
    useToggleThreadResolutionMock.mockReturnValue({
      canToggle: false,
      setResolved: setResolvedMock,
      updating: false,
      error: undefined,
    });
    const readOnly = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-read-only'],
        threadRecordMap: new Map(),
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );

    expect(readOnly.root.findAllByProps({ 'data-compact-thread-resolve': 'true' })).toHaveLength(0);

    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$thread-resolved', { isResolved: true }),
    ]);
    useToggleThreadResolutionMock.mockReturnValue({
      canToggle: true,
      setResolved: setResolvedMock,
      updating: false,
      error: undefined,
    });
    const resolved = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-resolved'],
        threadRecordMap: new Map(),
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );

    expect(resolved.root.findAllByProps({ 'data-compact-thread-resolve': 'true' })).toHaveLength(0);
  });

  it('disables only the resolve action whose thread update is pending', () => {
    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$thread-pending'),
      makeViewModel('$thread-idle'),
    ]);
    useToggleThreadResolutionMock.mockReturnValue({
      canToggle: true,
      setResolved: setResolvedMock,
      updating: true,
      updatingThreadRootIds: new Set(['$thread-pending']),
      error: undefined,
    });
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-pending', '$thread-idle'],
        threadRecordMap: new Map(),
        onThreadClick: vi.fn(),
        compactRoomScrollStateRef: { current: new Map() },
      })
    );

    const actions = renderer.root.findAllByProps({ 'data-compact-thread-resolve': 'true' });
    expect(actions.map((action) => action.props.disabled)).toEqual([true, false]);
  });

  it('reports a failed thread resolution mutation', () => {
    const error = new Error('state event rejected');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useToggleThreadResolutionMock.mockReturnValue({
      canToggle: true,
      setResolved: setResolvedMock,
      updating: false,
      error,
    });

    act(() => {
      create(
        React.createElement(CompactRoomView, {
          room: makeRoom(),
          threadRootIds: [],
          threadRecordMap: new Map(),
          onThreadClick: vi.fn(),
          compactRoomScrollStateRef: { current: new Map() },
        })
      );
    });

    expect(consoleError).toHaveBeenCalledWith('[CompactRoomView] Resolve failed:', error);
    consoleError.mockRestore();
  });

  it('forwards card clicks using the recent-thread summary from the view model', () => {
    const onThreadClick = vi.fn();
    const viewModel = makeViewModel('$thread-3', {
      primarySummaryText: 'Card title',
      recentThreadSummaryText: 'Recent sidebar summary',
    });
    useCompactThreadCardViewModelsMock.mockReturnValue([viewModel]);
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-3'],
        threadRecordMap: new Map([['$thread-3', makeThreadRecord('$thread-3')]]),
        onThreadClick,
        compactRoomScrollStateRef: { current: new Map() },
      })
    );

    const button = renderer.root.findByProps({ 'data-thread-root-id': '$thread-3' });

    act(() => {
      button.props.onClick();
    });

    expect(onThreadClick).toHaveBeenCalledWith('$thread-3', 'Recent sidebar summary');
  });

  it.each([false, true])(
    'retries a restore after inset resizing only before the reader moves (moved=%s)',
    (moved) => {
      const room = makeRoom();
      useCompactThreadCardViewModelsMock.mockReturnValue([makeViewModel('$thread-1')]);
      let maxScrollTop = 100;
      let currentScrollTop = 0;
      const scrollElement = {
        get scrollTop() {
          return currentScrollTop;
        },
        set scrollTop(value: number) {
          currentScrollTop = Math.min(value, maxScrollTop);
        },
      };
      let renderer: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          React.createElement(CompactRoomView, {
            room,
            threadRootIds: ['$thread-1'],
            threadRecordMap: new Map([['$thread-1', makeThreadRecord('$thread-1')]]),
            onThreadClick: vi.fn(),
            compactRoomScrollStateRef: { current: new Map([[room.roomId, 418]]) },
          }),
          { createNodeMock: () => scrollElement }
        );
      });
      expect(currentScrollTop).toBe(100);
      if (moved) scrollElement.scrollTop = 50;
      maxScrollTop = 500;
      act(() => resizeCallbacks.forEach((callback) => callback()));
      expect(currentScrollTop).toBe(moved ? 50 : 418);
      act(() => renderer.unmount());
      expect(resizeCallbacks.size).toBe(0);
    }
  );

  it('restores the room scroll position after the compact view remounts', () => {
    const room = makeRoom();
    useCompactThreadCardViewModelsMock.mockReturnValue([makeViewModel('$thread-1')]);
    const compactRoomScrollStateRef = { current: new Map<string, number>() };
    let scrollElement = { scrollTop: 0 };
    const createNodeMock = (element: React.ReactElement) => {
      if (element.props['data-compact-room-view'] === 'true') return scrollElement;
      return {};
    };
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(
        React.createElement(CompactRoomView, {
          room,
          threadRootIds: ['$thread-1'],
          threadRecordMap: new Map([['$thread-1', makeThreadRecord('$thread-1')]]),
          onThreadClick: vi.fn(),
          compactRoomScrollStateRef,
        }),
        { createNodeMock }
      );
    });

    scrollElement.scrollTop = 418;
    act(() => {
      renderer?.unmount();
    });

    expect(compactRoomScrollStateRef.current.get(room.roomId)).toBe(418);

    scrollElement = { scrollTop: 0 };
    act(() => {
      renderer = create(
        React.createElement(CompactRoomView, {
          room,
          threadRootIds: ['$thread-1'],
          threadRecordMap: new Map([['$thread-1', makeThreadRecord('$thread-1')]]),
          onThreadClick: vi.fn(),
          compactRoomScrollStateRef,
        }),
        { createNodeMock }
      );
    });

    expect(scrollElement.scrollTop).toBe(418);

    act(() => {
      renderer?.unmount();
    });
  });

  it('waits for thread cards and retries a clamped restore as more cards load', () => {
    const room = makeRoom();
    const compactRoomScrollStateRef = {
      current: new Map<string, number>([[room.roomId, 418]]),
    };
    let maxScrollTop = 0;
    let currentScrollTop = 0;
    const scrollElement = {
      get scrollTop() {
        return currentScrollTop;
      },
      set scrollTop(nextScrollTop: number) {
        currentScrollTop = Math.min(nextScrollTop, maxScrollTop);
      },
    };
    const createNodeMock = (element: React.ReactElement) => {
      if (element.props['data-compact-room-view'] === 'true') return scrollElement;
      return {};
    };
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(
        React.createElement(CompactRoomView, {
          room,
          threadRootIds: [],
          threadRecordMap: new Map(),
          onThreadClick: vi.fn(),
          compactRoomScrollStateRef,
        }),
        { createNodeMock }
      );
    });

    expect(scrollElement.scrollTop).toBe(0);
    expect(compactRoomScrollStateRef.current.get(room.roomId)).toBe(418);

    maxScrollTop = 100;
    useCompactThreadCardViewModelsMock.mockReturnValue([makeViewModel('$thread-1')]);
    act(() => {
      renderer?.update(
        React.createElement(CompactRoomView, {
          room,
          threadRootIds: ['$thread-1'],
          threadRecordMap: new Map([['$thread-1', makeThreadRecord('$thread-1')]]),
          onThreadClick: vi.fn(),
          compactRoomScrollStateRef,
        })
      );
    });

    expect(scrollElement.scrollTop).toBe(100);

    maxScrollTop = 500;
    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$thread-1'),
      makeViewModel('$thread-2'),
    ]);
    act(() => {
      renderer?.update(
        React.createElement(CompactRoomView, {
          room,
          threadRootIds: ['$thread-1', '$thread-2'],
          threadRecordMap: new Map([
            ['$thread-1', makeThreadRecord('$thread-1')],
            ['$thread-2', makeThreadRecord('$thread-2')],
          ]),
          onThreadClick: vi.fn(),
          compactRoomScrollStateRef,
        })
      );
    });

    expect(scrollElement.scrollTop).toBe(418);

    scrollElement.scrollTop = 315;
    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$thread-1'),
      makeViewModel('$thread-2'),
      makeViewModel('$thread-3'),
    ]);
    act(() => {
      renderer?.update(
        React.createElement(CompactRoomView, {
          room,
          threadRootIds: ['$thread-1', '$thread-2', '$thread-3'],
          threadRecordMap: new Map([
            ['$thread-1', makeThreadRecord('$thread-1')],
            ['$thread-2', makeThreadRecord('$thread-2')],
            ['$thread-3', makeThreadRecord('$thread-3')],
          ]),
          onThreadClick: vi.fn(),
          compactRoomScrollStateRef,
        })
      );
    });

    expect(scrollElement.scrollTop).toBe(315);

    act(() => {
      renderer?.unmount();
    });

    expect(compactRoomScrollStateRef.current.get(room.roomId)).toBe(315);
  });

  it('does not retry a clamped restore after the user moves the scroll position', () => {
    const room = makeRoom();
    const compactRoomScrollStateRef = {
      current: new Map<string, number>([[room.roomId, 418]]),
    };
    let maxScrollTop = 100;
    let currentScrollTop = 0;
    const scrollElement = {
      get scrollTop() {
        return currentScrollTop;
      },
      set scrollTop(nextScrollTop: number) {
        currentScrollTop = Math.min(nextScrollTop, maxScrollTop);
      },
    };
    useCompactThreadCardViewModelsMock.mockReturnValue([makeViewModel('$thread-1')]);
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(
        React.createElement(CompactRoomView, {
          room,
          threadRootIds: ['$thread-1'],
          threadRecordMap: new Map([['$thread-1', makeThreadRecord('$thread-1')]]),
          onThreadClick: vi.fn(),
          compactRoomScrollStateRef,
        }),
        {
          createNodeMock: (element) =>
            element.props['data-compact-room-view'] === 'true' ? scrollElement : {},
        }
      );
    });

    expect(scrollElement.scrollTop).toBe(100);

    scrollElement.scrollTop = 50;
    maxScrollTop = 500;
    useCompactThreadCardViewModelsMock.mockReturnValue([
      makeViewModel('$thread-1'),
      makeViewModel('$thread-2'),
    ]);
    act(() => {
      renderer?.update(
        React.createElement(CompactRoomView, {
          room,
          threadRootIds: ['$thread-1', '$thread-2'],
          threadRecordMap: new Map([
            ['$thread-1', makeThreadRecord('$thread-1')],
            ['$thread-2', makeThreadRecord('$thread-2')],
          ]),
          onThreadClick: vi.fn(),
          compactRoomScrollStateRef,
        })
      );
    });

    expect(scrollElement.scrollTop).toBe(50);

    act(() => {
      renderer?.unmount();
    });

    expect(compactRoomScrollStateRef.current.get(room.roomId)).toBe(50);
  });

  it('keeps the saved position when the empty overview unmounts before cards load', () => {
    const room = makeRoom();
    const compactRoomScrollStateRef = {
      current: new Map<string, number>([[room.roomId, 418]]),
    };
    const scrollElement = { scrollTop: 0 };
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(
        React.createElement(CompactRoomView, {
          room,
          threadRootIds: [],
          threadRecordMap: new Map(),
          onThreadClick: vi.fn(),
          compactRoomScrollStateRef,
        }),
        {
          createNodeMock: (element) =>
            element.props['data-compact-room-view'] === 'true' ? scrollElement : {},
        }
      );
    });

    act(() => {
      renderer?.unmount();
    });

    expect(compactRoomScrollStateRef.current.get(room.roomId)).toBe(418);
  });
});
