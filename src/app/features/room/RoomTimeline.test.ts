import React, { createRef } from 'react';
import { RoomEvent } from 'matrix-js-sdk';
import { Editor } from 'slate';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  passthrough,
  scrollType,
  roomThreadOverviewType,
  matrixClientMock,
  threadRenderStateMock,
} = vi.hoisted(() => ({
  passthrough: 'div',
  scrollType: 'room-timeline-scroll',
  roomThreadOverviewType: 'room-thread-overview',
  matrixClientMock: {
    fetchRelations: vi.fn(),
    getEventMapper: vi.fn(() => (rawEvent: unknown) => rawEvent),
    getEventTimeline: vi.fn(),
    getHomeserverUrl: vi.fn(() => 'https://example.org'),
    getRoom: vi.fn(() => null),
    getSafeUserId: vi.fn(() => '@alice:example.org'),
    getThreadTimeline: vi.fn(),
    getUserId: vi.fn(() => '@alice:example.org'),
    paginateEventTimeline: vi.fn(),
    processAggregatedTimelineEvents: vi.fn(),
    relations: vi.fn(),
  },
  threadRenderStateMock: {
    threadEventIndexMapRef: { current: new Map() },
    threadEvents: [],
    threadInitialRenderMode: 'live',
    setSupplementalThreadEvents: vi.fn(),
    resetThreadRenderState: vi.fn(),
  },
}));

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();
  return {
    ...actual,
    Badge: passthrough,
    Box: passthrough,
    Chip: passthrough,
    ContainerColor: {},
    Icon: passthrough,
    Icons: {
      ArrowBottom: 'ArrowBottom',
      ArrowTop: 'ArrowTop',
      ChevronBottom: 'ChevronBottom',
      ChevronTop: 'ChevronTop',
      Code: 'Code',
      Search: 'Search',
    },
    Line: passthrough,
    Scroll: scrollType,
    Text: passthrough,
    as: () => passthrough,
    color: {
      ...actual.color,
      Success: {
        ...actual.color.Success,
        Main: '#0a0',
      },
      Warning: {
        ...actual.color.Warning,
        ContainerLine: '#aa0',
      },
    },
    config: {
      ...actual.config,
      space: {
        ...actual.config.space,
        S200: '8px',
        S400: '16px',
        S600: '24px',
        S700: '28px',
      },
    },
    toRem: (value: number) => `${value}rem`,
  };
});

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => matrixClientMock,
}));

vi.mock('../../hooks/useAlive', () => ({
  useAlive: () => () => true,
}));

vi.mock('../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../state/hooks/settings', () => ({
  useSetting: (_atom: unknown, key: string) => {
    switch (key) {
      case 'messageLayout':
        return ['Compact'];
      case 'messageSpacing':
        return ['400'];
      case 'dateFormatString':
        return ['MMM D'];
      default:
        return [false];
    }
  },
}));

vi.mock('../../state/settings', () => ({
  MessageLayout: {
    Compact: 'Compact',
    Bubble: 'Bubble',
    Modern: 'Modern',
  },
  settingsAtom: {},
}));

vi.mock('../../hooks/useRoom', () => ({
  useIsDirectRoom: () => false,
}));

vi.mock('../../hooks/useIgnoredUsers', () => ({
  useIgnoredUsers: () => [],
}));

vi.mock('jotai', () => ({
  useAtomValue: () => [],
  useSetAtom: () => vi.fn(),
}));

vi.mock('../../hooks/usePowerLevels', () => ({
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../hooks/useRoomCreators', () => ({
  useRoomCreators: () => [],
}));

vi.mock('../../hooks/useRoomCreatorsTag', () => ({
  useRoomCreatorsTag: () => [],
}));

vi.mock('../../hooks/usePowerLevelTags', () => ({
  usePowerLevelTags: () => [],
}));

vi.mock('../../hooks/useMemberPowerTag', () => ({
  useAccessiblePowerTagColors: () => ({}),
  useGetMemberPowerTag: () => () => undefined,
}));

vi.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({ kind: 'light' }),
}));

vi.mock('../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    action: () => true,
    event: () => true,
    stateEvent: () => true,
  }),
}));

vi.mock('../../state/hooks/unread', () => ({
  useRoomUnread: () => false,
}));

vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: vi.fn(),
    navigateRoomThread: vi.fn(),
  }),
}));

vi.mock('../../hooks/useMentionClickHandler', () => ({
  useMentionClickHandler: () => vi.fn(),
}));

vi.mock('../../hooks/useSpoilerClickHandler', () => ({
  useSpoilerClickHandler: () => vi.fn(),
}));

vi.mock('../../state/hooks/userRoomProfile', () => ({
  useOpenUserRoomProfile: () => vi.fn(),
}));

vi.mock('../../hooks/useSpace', () => ({
  useSpaceOptionally: () => undefined,
}));

vi.mock('../../hooks/useImagePackRooms', () => ({
  useImagePackRooms: () => [],
}));

vi.mock('../../hooks/useMemberEventParser', () => ({
  useMemberEventParser: () => () => undefined,
}));

vi.mock('../../hooks/useVirtualPaginator', () => ({
  useVirtualPaginator: () => ({
    getItems: () => [],
    scrollToItem: vi.fn(),
    scrollToElement: vi.fn(),
    observeBackAnchor: vi.fn(),
    observeFrontAnchor: vi.fn(),
  }),
}));

vi.mock('../../hooks/useMatrixEventRenderer', () => ({
  useMatrixEventRenderer: () => () => null,
}));

vi.mock('../../hooks/useIntersectionObserver', () => ({
  getIntersectionObserverEntry: () => undefined,
  useIntersectionObserver: vi.fn(),
}));

vi.mock('../../hooks/useDebounce', () => ({
  useDebounce: (fn: (...args: unknown[]) => unknown) => fn,
}));

vi.mock('../../hooks/useResizeObserver', () => ({
  getResizeObserverEntry: () => undefined,
  useResizeObserver: vi.fn(),
}));

vi.mock('../../hooks/useDocumentFocusChange', () => ({
  useDocumentFocusChange: vi.fn(),
}));

vi.mock('../../hooks/useKeyDown', () => ({
  useKeyDown: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}));

vi.mock('../../plugins/react-custom-html-parser', () => ({
  LINKIFY_OPTS: {},
  factoryRenderLinkifyWithMention: () => vi.fn(),
  getReactCustomHtmlParser: () => ({}),
  makeMentionCustomProps: () => ({}),
  renderMatrixMention: () => null,
}));

vi.mock('../../styles/CustomHtml.css', () => ({
  Code: 'Code',
}));

vi.mock('./RoomTimeline.css', () => ({
  TimelineFloat: () => 'TimelineFloat',
}));

vi.mock('../../utils/matrix', () => ({
  eventWithShortcode: (_packs: unknown, body: string) => body,
  factoryEventSentBy: () => false,
  getMxIdLocalPart: (userId: string) => userId,
}));

vi.mock('../../utils/room', () => ({
  canEditEvent: () => false,
  decryptAllTimelineEvent: vi.fn(),
  getEditedEvent: () => undefined,
  getEventReactions: () => undefined,
  getLatestEdit: (_target: unknown, edits: Array<{ getTs: () => number }>) =>
    edits.reduce((latest, edit) => (edit.getTs() >= latest.getTs() ? edit : latest), edits[0]),
  getLatestEditableEvt: () => undefined,
  getMemberDisplayName: () => 'Alice',
  getReactionContent: () => undefined,
  isMembershipChanged: () => false,
  logEditDebug: vi.fn(),
  reactionOrEditEvent: () => false,
}));

vi.mock('../../components/message', () => ({
  DefaultPlaceholder: passthrough,
  CompactPlaceholder: passthrough,
  Reply: passthrough,
  ThreadIndicator: passthrough,
  MessageBase: passthrough,
  MessageUnsupportedContent: passthrough,
  Time: passthrough,
  MessageNotDecryptedContent: passthrough,
  RedactedContent: passthrough,
  MSticker: passthrough,
  ImageContent: passthrough,
  EventContent: passthrough,
}));

vi.mock('./message', () => ({
  Reactions: passthrough,
  Message: passthrough,
  Event: passthrough,
  EncryptedContent: passthrough,
}));

vi.mock('../../components/room-intro', () => ({
  RoomIntro: passthrough,
}));

vi.mock('../../components/RenderMessageContent', () => ({
  RenderMessageContent: passthrough,
}));

vi.mock('../../components/media', () => ({
  Image: passthrough,
}));

vi.mock('../../components/image-viewer', () => ({
  ImageViewer: passthrough,
}));

vi.mock('../../utils/notifications', () => ({
  markAsRead: vi.fn(),
}));

vi.mock('../../utils/dom', () => ({
  editableActiveElement: () => null,
  scrollToBottom: vi.fn(),
}));

vi.mock('../../utils/time', () => ({
  inSameDay: () => true,
  minuteDifference: () => 0,
  timeDayMonthYear: () => 'time',
  today: 'today',
  yesterday: 'yesterday',
}));

vi.mock('../../components/editor', () => ({
  createMentionElement: () => ({}),
  isEmptyEditor: () => true,
  moveCursor: vi.fn(),
}));

vi.mock('../../state/room/roomInputDrafts', () => ({
  roomIdToReplyDraftAtomFamily: () => ({}),
}));

vi.mock('../../state/room/roomToParents', () => ({
  roomToParentsAtom: {},
}));

vi.mock('../../state/room/roomToUnread', () => ({
  roomToUnreadAtom: {},
}));

vi.mock('./threadUtils', () => ({
  buildThreadParticipantMap: () => new Map(),
  buildThreadReplyCountMap: () => new Map(),
  eventBelongsToThread: () => false,
  isThreadReplyEvent: () => false,
}));

vi.mock('../../components/message/mindroomThreadSummary', () => ({
  buildThreadSummaryMap: () => new Map(),
  findLatestThreadSummaryEvent: () => undefined,
  getThreadSummaryEventInfo: () => undefined,
}));

vi.mock('./useThreadRenderState', () => ({
  useThreadRenderState: () => threadRenderStateMock,
}));

vi.mock('./threadEventCache', () => ({
  getThreadCursorAnchor: () => undefined,
  loadCachedThreadEventsBefore: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
  loadLatestCachedThreadEvents: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
  normalizeCachedThreadEvents: (events: unknown[]) => events,
  saveThreadEventsToCache: vi.fn(async () => undefined),
}));

vi.mock('./eventCacheTokenUtils', () => ({
  compareCachedPaginationAnchors: () => 0,
}));

vi.mock('./roomEventCache', () => ({
  getRoomCursorAnchor: () => undefined,
  loadCachedRoomEventsBefore: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
  normalizeCachedRoomEvents: (events: unknown[]) => events,
  saveRoomEventsToCache: vi.fn(async () => undefined),
}));

vi.mock('./eventCacheEditUtils', () => ({
  aggregateCachedRelationEvents: vi.fn(),
  hydrateCachedEvents: vi.fn(),
  serializeEventsForCache: () => [],
}));

vi.mock('./timelineScrollUtils', () => ({
  isScrollNearBottom: () => true,
  isTimelineAtLiveEnd: () => true,
  shouldAutoScrollThreadOnLiveEvent: () => false,
}));

vi.mock('./threadEditBackfillUtils', () => ({
  markThreadEditBackfillAttempted: vi.fn(),
  shouldFetchThreadEditBackfill: () => false,
}));

vi.mock('./RoomThreadOverview', () => ({
  RoomThreadOverview: roomThreadOverviewType,
}));

vi.mock('./useRoomThreadResolution', () => ({
  useRoomThreadResolutionMap: () => new Map(),
}));

vi.stubGlobal('window', {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  matchMedia: vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
  navigator: {
    platform: 'MacIntel',
  },
});

vi.stubGlobal('document', {
  hasFocus: () => true,
});

vi.stubGlobal('navigator', {
  platform: 'MacIntel',
});

vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  callback(0);
  return 0;
});

const makeTimeline = () => ({
  getEvents: () => [],
  getNeighbouringTimeline: () => null,
  getPaginationToken: () => null,
  getRoomId: () => '!room:example.org',
  setPaginationToken: vi.fn(),
});

const makeRoom = () => {
  const liveTimeline = makeTimeline();
  const timelineSet = {
    getLiveTimeline: () => liveTimeline,
    getTimelineForEvent: () => undefined,
  };
  const listeners = new Map<string | symbol, (...args: unknown[]) => void>();

  return {
    __listeners: listeners,
    roomId: '!room:example.org',
    client: {
      getUserId: () => '@alice:example.org',
    },
    findEventById: () => undefined,
    getEventReadUpTo: () => undefined,
    getLiveTimeline: () => liveTimeline,
    getThread: () => null,
    getUnfilteredTimelineSet: () => timelineSet,
    hasEncryptionStateEvent: () => false,
    on: vi.fn((event, handler) => {
      listeners.set(event, handler);
    }),
    removeListener: vi.fn((event) => {
      listeners.delete(event);
    }),
  };
};

const flushAsyncWork = async (cycles = 5) => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  matrixClientMock.fetchRelations.mockResolvedValue({
    chunk: [],
    next_batch: null,
  });
  matrixClientMock.getEventTimeline.mockResolvedValue(undefined);
  matrixClientMock.getThreadTimeline.mockResolvedValue(undefined);
});

let useThreadAwareTimelineRefreshHook:
  | typeof import('./RoomTimeline').useThreadAwareTimelineRefresh
  | undefined;

type TimelineRefreshHarnessProps = {
  room: ReturnType<typeof makeRoom>;
  threadId?: string;
  liveTimelineLinked: boolean;
  refreshLatestThreadSlice: (threadId: string) => Promise<boolean>;
  onRoomRefresh: () => void;
};

const TimelineRefreshHarness = ({
  room,
  threadId,
  liveTimelineLinked,
  refreshLatestThreadSlice,
  onRoomRefresh,
}: TimelineRefreshHarnessProps) => {
  useThreadAwareTimelineRefreshHook?.({
    room: room as never,
    threadId,
    liveTimelineLinked,
    refreshLatestThreadSlice,
    onRoomRefresh,
  });

  return null;
};

describe('RoomTimeline', () => {
  it('renders without thread render hook initialization errors', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const room = makeRoom();
    const roomInputRef = createRef<HTMLElement>();
    const editor = {} as Editor;

    expect(() =>
      create(
        React.createElement(RoomTimeline, {
          room,
          roomInputRef,
          editor,
        })
      )
    ).not.toThrow();
  });

  it('renders the room thread overview outside thread view', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const room = makeRoom();
    const roomInputRef = createRef<HTMLElement>();
    const editor = {} as Editor;

    const renderer = create(
      React.createElement(RoomTimeline, {
        room,
        roomInputRef,
        editor,
      })
    );

    expect(renderer.root.findAllByType(roomThreadOverviewType)).toHaveLength(1);
    expect(renderer.root.findByType(scrollType).findAllByType(roomThreadOverviewType)).toHaveLength(
      0
    );
  });

  it('coalesces queued refreshes and reruns after in-flight settles', async () => {
    const roomTimelineModule = await import('./RoomTimeline');
    useThreadAwareTimelineRefreshHook = roomTimelineModule.useThreadAwareTimelineRefresh;
    const threadId = '$thread';
    const room = makeRoom();
    const onRoomRefresh = vi.fn();
    let resolveRefresh: ((value: boolean) => void) | undefined;
    const refreshLatestThreadSlice = vi
      .fn(async (_expectedThreadId: string) => true)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveRefresh = resolve;
          })
      );
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(TimelineRefreshHarness, {
          room,
          threadId,
          liveTimelineLinked: true,
          refreshLatestThreadSlice,
          onRoomRefresh,
        })
      );
      await flushAsyncWork(1);
    });

    const refreshHandler = room.__listeners.get(RoomEvent.TimelineRefresh);
    expect(refreshHandler).toBeTypeOf('function');

    // Fire twice while first is in-flight — only one call, second is queued
    await act(async () => {
      refreshHandler?.(room);
      refreshHandler?.(room);
      await flushAsyncWork(1);
    });

    expect(refreshLatestThreadSlice).toHaveBeenCalledTimes(1);
    expect(refreshLatestThreadSlice).toHaveBeenCalledWith(threadId);
    expect(onRoomRefresh).not.toHaveBeenCalled();

    // Settle the first — the coalesced pending triggers a second call
    await act(async () => {
      resolveRefresh?.(true);
      await flushAsyncWork();
    });

    expect(refreshLatestThreadSlice).toHaveBeenCalledTimes(2);

    // After both settle, a fresh event still works
    await act(async () => {
      refreshHandler?.(room);
      await flushAsyncWork();
    });

    expect(refreshLatestThreadSlice).toHaveBeenCalledTimes(3);

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('cancels a queued refresh when the thread closes mid-flight', async () => {
    const roomTimelineModule = await import('./RoomTimeline');
    useThreadAwareTimelineRefreshHook = roomTimelineModule.useThreadAwareTimelineRefresh;
    const threadId = '$thread';
    const room = makeRoom();
    const onRoomRefresh = vi.fn();
    let resolveRefresh: ((value: boolean) => void) | undefined;
    const refreshLatestThreadSlice = vi
      .fn(async (_expectedThreadId: string) => true)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveRefresh = resolve;
          })
      );
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(TimelineRefreshHarness, {
          room,
          threadId,
          liveTimelineLinked: true,
          refreshLatestThreadSlice,
          onRoomRefresh,
        })
      );
      await flushAsyncWork(1);
    });

    const refreshHandler = room.__listeners.get(RoomEvent.TimelineRefresh);
    expect(refreshHandler).toBeTypeOf('function');

    // Fire refresh — starts in-flight
    await act(async () => {
      refreshHandler?.(room);
      await flushAsyncWork(1);
    });

    expect(refreshLatestThreadSlice).toHaveBeenCalledTimes(1);

    // Queue another refresh while the first request is still in-flight.
    await act(async () => {
      refreshHandler?.(room);
      await flushAsyncWork(1);
    });

    expect(refreshLatestThreadSlice).toHaveBeenCalledTimes(1);

    // Re-render without threadId (thread closed) before the queued rerun can start.
    await act(async () => {
      renderer?.update(
        React.createElement(TimelineRefreshHarness, {
          room,
          threadId: undefined,
          liveTimelineLinked: true,
          refreshLatestThreadSlice,
          onRoomRefresh,
        })
      );
      await flushAsyncWork(1);
    });

    // Settle the original in-flight — the queued rerun should be discarded.
    await act(async () => {
      resolveRefresh?.(true);
      await flushAsyncWork();
    });

    expect(refreshLatestThreadSlice).toHaveBeenCalledTimes(1);
    expect(onRoomRefresh).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });
});
