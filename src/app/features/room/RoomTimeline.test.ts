import React, { createRef } from 'react';
import { Direction, RoomEvent } from 'matrix-js-sdk';
import { Editor } from 'slate';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  passthrough,
  scrollType,
  roomThreadOverviewType,
  roomIntroType,
  defaultPlaceholderType,
  compactPlaceholderType,
  aliveFn,
  reactionOrEditEventMock,
  isMembershipChangedMock,
  matrixClientMock,
  threadRenderStateMock,
  threadResolutionMapMock,
  ignoredUsersMock,
  roomUnreadState,
  scrollToItemMock,
  scrollToElementMock,
  retryPaginationMock,
  loadCachedRoomEventsBeforeMock,
  loadCachedRoomPaginationTokenMock,
  loadLatestCachedRoomEventsMock,
  saveRoomEventsToCacheMock,
  virtualPaginatorState,
  settingsState,
} = vi.hoisted(() => ({
  passthrough: 'div',
  scrollType: 'room-timeline-scroll',
  roomThreadOverviewType: 'room-thread-overview',
  roomIntroType: 'room-intro',
  defaultPlaceholderType: 'default-placeholder',
  compactPlaceholderType: 'compact-placeholder',
  aliveFn: () => true,
  reactionOrEditEventMock: vi.fn(() => false),
  isMembershipChangedMock: vi.fn(() => false),
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
  threadResolutionMapMock: new Map<string, { isResolved: boolean }>(),
  ignoredUsersMock: [] as string[],
  roomUnreadState: { value: false },
  scrollToItemMock: vi.fn(),
  scrollToElementMock: vi.fn(),
  retryPaginationMock: vi.fn(),
  loadCachedRoomEventsBeforeMock: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
  loadCachedRoomPaginationTokenMock: vi.fn(async () => undefined),
  loadLatestCachedRoomEventsMock: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
  saveRoomEventsToCacheMock: vi.fn(async () => undefined),
  isTimelineAtLiveEndMock: vi.fn(() => true),
  settingsState: {
    paginationLimit: 300,
  },
  virtualPaginatorState: {
    lastOptions: undefined as
      | {
          count: number;
          range: { start: number; end: number };
          onRangeChange: (range: { start: number; end: number }) => void;
          onEnd?: (backwards: boolean) => Promise<void> | void;
        }
      | undefined,
    callCount: 0,
    renderItems: true,
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
  useAlive: () => aliveFn,
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
      case 'paginationLimit':
        return [settingsState.paginationLimit];
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
  sanitizePaginationLimit: (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(Math.trunc(v), 50) : 300,
  settingsAtom: {},
}));

vi.mock('../../hooks/useRoom', () => ({
  useIsDirectRoom: () => false,
}));

vi.mock('../../hooks/useIgnoredUsers', () => ({
  useIgnoredUsers: () => ignoredUsersMock,
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
  useRoomUnread: () => roomUnreadState.value,
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
  useVirtualPaginator: (options: {
    count: number;
    range: { start: number; end: number };
    onRangeChange: (range: { start: number; end: number }) => void;
  }) => {
    virtualPaginatorState.callCount += 1;
    virtualPaginatorState.lastOptions = options;
    return {
      getItems: () =>
        virtualPaginatorState.renderItems
          ? Array.from(
              { length: Math.max(options.range.end - options.range.start, 0) },
              (_, index) => options.range.start + index
            )
          : [],
      scrollToItem: scrollToItemMock,
      scrollToElement: scrollToElementMock,
      retryPagination: retryPaginationMock,
      observeBackAnchor: vi.fn(),
      observeFrontAnchor: vi.fn(),
    };
  },
}));

vi.mock('../../hooks/useMatrixEventRenderer', () => ({
  useMatrixEventRenderer: () => (...args: unknown[]) =>
    React.createElement('mock-event', {
      eventId: args[2],
      key: String(args[2]),
    }),
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

vi.mock('../../hooks/useStateEvents', () => ({
  useStateEvents: () => [],
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
  isMembershipChanged: isMembershipChangedMock,
  logEditDebug: vi.fn(),
  reactionOrEditEvent: reactionOrEditEventMock,
}));

vi.mock('../../components/message', () => ({
  DefaultPlaceholder: defaultPlaceholderType,
  CompactPlaceholder: compactPlaceholderType,
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
  RoomIntro: roomIntroType,
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
  markMainTimelineAsRead: vi.fn(),
  markRoomAndThreadsAsRead: vi.fn(),
  markThreadAsRead: vi.fn(),
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
  buildThreadReplyCountMap: (events: Array<{ getId(): string | undefined; threadRootId?: string }>) => {
    const counts = new Map<string, number>();
    events.forEach((event) => {
      const eventId = event.getId();
      const { threadRootId } = event;
      if (!eventId || !threadRootId || eventId === threadRootId) return;
      counts.set(threadRootId, (counts.get(threadRootId) ?? 0) + 1);
    });
    return counts;
  },
  eventBelongsToThread: (
    event: { getId(): string | undefined; threadRootId?: string },
    threadId: string
  ) => event.getId() === threadId || event.threadRootId === threadId,
  isThreadReplyEvent: (eventId: string, threadRootId?: string) =>
    !!threadRootId && threadRootId !== eventId,
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

vi.mock('./eventCacheTokenUtils', async (importOriginal) =>
  importOriginal<typeof import('./eventCacheTokenUtils')>()
);

vi.mock('./roomEventCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./roomEventCache')>();
  return {
    ...actual,
    loadCachedRoomEventsBefore: loadCachedRoomEventsBeforeMock,
    loadCachedRoomPaginationToken: loadCachedRoomPaginationTokenMock,
    loadLatestCachedRoomEvents: loadLatestCachedRoomEventsMock,
    saveRoomEventsToCache: saveRoomEventsToCacheMock,
  };
});

vi.mock('./eventCacheEditUtils', () => ({
  aggregateCachedRelationEvents: vi.fn(),
  hydrateCachedEvents: vi.fn(),
  serializeEventsForCache: () => [],
}));

vi.mock('./timelineScrollUtils', () => ({
  isScrollNearBottom: () => true,
  isTimelineAtLiveEnd: () => true,
  shouldAutoScrollRoomOnLiveEvent: () => false,
  shouldAutoScrollThreadOnLiveEvent: () => false,
}));

vi.mock('./threadEditBackfillUtils', () => ({
  markThreadEditBackfillAttempted: vi.fn(),
  shouldFetchThreadEditBackfill: () => false,
}));

vi.mock('./RoomThreadOverview', () => ({
  RoomThreadOverview: roomThreadOverviewType,
}));

vi.mock('../../hooks/useThreadLastActivityTs', () => ({
  getThreadLastActivityTs: () => 0,
  useThreadLastActivityTs: () => 0,
}));

vi.mock('../../hooks/useThreadStreamingState', () => ({
  getThreadStreamingState: () => false,
  useThreadStreamingState: () => false,
}));

vi.mock('../../utils/scheduledTaskContract', () => ({
  parseScheduledTaskStateEvent: () => null,
}));

vi.mock('./useRoomThreadTags', () => ({
  useRoomThreadResolutionMap: () => threadResolutionMapMock,
}));

vi.stubGlobal('window', {
  addEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
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

vi.stubGlobal('cancelAnimationFrame', vi.fn());

const makeEvent = (
  eventId: string,
  opts: {
    sender?: string;
    ts?: number;
    type?: string;
    content?: Record<string, unknown>;
    isThreadRoot?: boolean;
    threadRootId?: string;
    relation?: { rel_type?: string; event_id?: string };
    associatedId?: string;
    stateKey?: string;
    ts?: number;
    isRedacted?: boolean;
    isRedaction?: boolean;
  } = {}
) => ({
  event: { event_id: eventId, origin_server_ts: opts.ts ?? 0 },
  isThreadRoot: opts.isThreadRoot ?? false,
  threadRootId: opts.threadRootId,
  getAssociatedId: () => opts.associatedId,
  getContent: () => opts.content ?? { body: eventId },
  getId: () => eventId,
  getRelation: () => opts.relation,
  getRedactionEvent: () => undefined,
  getRoomId: () => '!room:example.org',
  getSender: () => opts.sender ?? '@alice:example.org',
  getServerAggregatedRelation: () => undefined,
  getStateKey: () => opts.stateKey,
  getTs: () => opts.ts ?? 0,
  getType: () => opts.type ?? 'm.room.message',
  getUnsigned: () => ({}),
  isRedacted: () => opts.isRedacted ?? false,
  isRedaction: () => opts.isRedaction ?? false,
  makeRedacted: vi.fn(),
  makeReplaced: vi.fn(),
  replacingEvent: () => undefined,
});

const makeCachedRoomEvent = (eventId: string, ts = 0) => ({
  event_id: eventId,
  origin_server_ts: ts,
});

const makeTimeline = (
  events: ReturnType<typeof makeEvent>[] = [],
  opts: {
    backwardToken?: string | null;
    forwardToken?: string | null;
  } = {}
) => {
  const paginationTokens = {
    backward: opts.backwardToken ?? null,
    forward: opts.forwardToken ?? null,
  };

  return {
    __paginationTokens: paginationTokens,
    getEvents: () => events,
    getNeighbouringTimeline: () => null,
    getPaginationToken: (direction: Direction) =>
      direction === Direction.Backward ? paginationTokens.backward : paginationTokens.forward,
    getRoomId: () => '!room:example.org',
    setPaginationToken: vi.fn((token: string | null, direction: Direction) => {
      if (direction === Direction.Backward) {
        paginationTokens.backward = token;
        return;
      }
      paginationTokens.forward = token;
    }),
  };
};

const makeRoom = ({
  liveEvents = [],
  liveTimeline,
  timelinesByEventId = new Map<string, ReturnType<typeof makeTimeline>>(),
  findEventById,
}: {
  liveEvents?: ReturnType<typeof makeEvent>[];
  liveTimeline?: ReturnType<typeof makeTimeline>;
  timelinesByEventId?: Map<string, ReturnType<typeof makeTimeline>>;
  findEventById?: (eventId: string) => ReturnType<typeof makeEvent> | undefined;
} = {}) => {
  const roomLiveTimeline = liveTimeline ?? makeTimeline(liveEvents);
  const currentLiveEvents = roomLiveTimeline.getEvents();
  const getEventFromTimelines = (eventId: string) =>
    currentLiveEvents.find((event) => event.getId() === eventId) ??
    Array.from(timelinesByEventId.values())
      .flatMap((timeline) => timeline.getEvents())
      .find((event) => event.getId() === eventId);
  const timelineSet = {
    getLiveTimeline: () => roomLiveTimeline,
    getTimelineForEvent: (eventId: string) =>
      currentLiveEvents.some((event) => event.getId() === eventId)
        ? roomLiveTimeline
        : timelinesByEventId.get(eventId),
  };
  (
    roomLiveTimeline as ReturnType<typeof makeTimeline> & {
      getTimelineSet?: () => typeof timelineSet;
    }
  ).getTimelineSet =
    () => timelineSet;
  timelinesByEventId.forEach((timeline) => {
    (
      timeline as ReturnType<typeof makeTimeline> & {
        getTimelineSet?: () => typeof timelineSet;
      }
    ).getTimelineSet = () => timelineSet;
  });
  const listeners = new Map<string | symbol, (...args: unknown[]) => void>();

  return {
    __listeners: listeners,
    addEventsToTimeline: vi.fn(),
    addLiveEvents: vi.fn(async (events: ReturnType<typeof makeEvent>[]) => {
      currentLiveEvents.push(...events);
    }),
    roomId: '!room:example.org',
    client: {
      getUserId: () => '@alice:example.org',
    },
    findEventById: findEventById ?? ((eventId: string) => getEventFromTimelines(eventId)),
    getEventReadUpTo: () => undefined,
    getLiveTimeline: () => roomLiveTimeline,
    getThread: () => null,
    getUnfilteredTimelineSet: () => timelineSet,
    hasEncryptionStateEvent: () => false,
    partitionThreadedEvents: (events: ReturnType<typeof makeEvent>[]) => [events, [], []],
    processThreadRoots: vi.fn(),
    relations: {
      aggregateChildEvent: vi.fn(),
    },
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

const waitForCondition = async (condition: () => boolean, cycles = 500) => {
  for (let index = 0; index < cycles; index += 1) {
    if (condition()) return;
    await flushAsyncWork(1);
  }

  throw new Error('Condition not reached in time');
};

beforeEach(() => {
  vi.clearAllMocks();
  threadResolutionMapMock.clear();
  ignoredUsersMock.length = 0;
  roomUnreadState.value = false;
  scrollToItemMock.mockReturnValue(false);
  scrollToElementMock.mockReturnValue(false);
  retryPaginationMock.mockReset();
  matrixClientMock.getEventMapper.mockImplementation(
    () =>
      (
        rawEvent: {
          content?: Record<string, unknown>;
          event_id?: string;
          origin_server_ts?: number;
        }
      ) =>
        typeof rawEvent?.event_id === 'string'
          ? makeEvent(rawEvent.event_id, {
              content: rawEvent.content,
              ts: rawEvent.origin_server_ts ?? 0,
            })
          : rawEvent
  );
  loadCachedRoomEventsBeforeMock.mockResolvedValue({ events: [], hasMoreBefore: false });
  loadCachedRoomPaginationTokenMock.mockResolvedValue(undefined);
  loadLatestCachedRoomEventsMock.mockResolvedValue({ events: [], hasMoreBefore: false });
  saveRoomEventsToCacheMock.mockResolvedValue(undefined);
  settingsState.paginationLimit = 300;
  virtualPaginatorState.lastOptions = undefined;
  virtualPaginatorState.callCount = 0;
  virtualPaginatorState.renderItems = true;
  reactionOrEditEventMock.mockImplementation(() => false);
  isMembershipChangedMock.mockImplementation(() => false);
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

const getClickableByText = (renderer: ReturnType<typeof create>, text: string) => {
  const hasTextDescendant = (node: { children: unknown[] }): boolean =>
    node.children.some((child) => {
      if (child === text) return true;
      if (typeof child === 'string') return false;
      return hasTextDescendant(child as { children: unknown[] });
    });

  const clickable = renderer.root.find((node) => {
    if (typeof node.props.onClick !== 'function') return false;

    return hasTextDescendant(node as unknown as { children: unknown[] });
  });

  return clickable;
};

const createControlledRoomTimelineHarness = (
  RoomTimelineComponent: (props: Record<string, unknown>) => React.ReactElement | null
) => {
  const roomInputRef = createRef<HTMLElement>();
  const editor = {} as Editor;

  return function ControlledRoomTimelineHarness({
    room,
    eventId,
    threadId,
    initialThreadFilter,
    initialThreadSort,
  }: {
    room: ReturnType<typeof makeRoom>;
    eventId?: string;
    threadId?: string;
    initialThreadFilter?: 'all' | 'resolved' | 'unresolved' | 'unread';
    initialThreadSort?: 'default' | 'last-reply' | 'streaming' | 'scheduled';
  }) {
    const [threadFilter, setThreadFilter] = React.useState<
      'all' | 'resolved' | 'unresolved' | 'unread'
    >(initialThreadFilter ?? 'all');
    const [threadSort, setThreadSort] = React.useState<
      'default' | 'last-reply' | 'streaming' | 'scheduled'
    >(initialThreadSort ?? 'default');

    return React.createElement(RoomTimelineComponent, {
      room,
      eventId,
      threadId,
      threadFilter,
      onThreadFilterChange: setThreadFilter,
      threadSort,
      onThreadSortChange: setThreadSort,
      roomInputRef,
      editor,
    });
  };
};

describe('RoomTimeline', () => {
  it('renders without thread render hook initialization errors', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const room = makeRoom();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    expect(() =>
      create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      )
    ).not.toThrow();
  });

  it('only hydrates the latest room cache slice when it is newer than the loaded room tail', async () => {
    const { shouldHydrateLatestRoomCache } = await import('./RoomTimeline');

    expect(
      shouldHydrateLatestRoomCache(makeCachedRoomEvent('$loaded', 100), makeCachedRoomEvent('$cached', 200))
    ).toBe(true);
    expect(
      shouldHydrateLatestRoomCache(makeCachedRoomEvent('$loaded', 200), makeCachedRoomEvent('$cached', 200))
    ).toBe(false);
    expect(
      shouldHydrateLatestRoomCache(makeCachedRoomEvent('$loaded', 300), makeCachedRoomEvent('$cached', 200))
    ).toBe(false);
  });

  it('deduplicates cached room hydration events against already loaded SDK events', async () => {
    const { filterLatestRoomCacheHydrationEvents } = await import('./RoomTimeline');

    expect(
      filterLatestRoomCacheHydrationEvents(
        [makeCachedRoomEvent('$loaded', 100), makeCachedRoomEvent('$new', 200)],
        [makeEvent('$loaded', { ts: 100 })] as never
      )
    ).toEqual([makeCachedRoomEvent('$new', 200)]);
  });

  it('hydrates cached room events into the live timeline', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { hydrateCachedEvents } = await import('./eventCacheEditUtils');
    const room = makeRoom({
      liveEvents: [makeEvent('$loaded', { ts: 100 })],
    });
    const roomInputRef = createRef<HTMLElement>();
    const editor = {} as Editor;
    let renderer: ReturnType<typeof create> | undefined;

    loadLatestCachedRoomEventsMock.mockResolvedValue({
      beforeToken: undefined,
      events: [makeCachedRoomEvent('$cached', 200)],
      hasMoreBefore: false,
    });

    try {
      await act(async () => {
        renderer = create(
          React.createElement(RoomTimeline, {
            room,
            roomInputRef,
            editor,
          })
        );
        await flushAsyncWork();
      });

      expect(hydrateCachedEvents).toHaveBeenCalledWith({
        room,
        events: expect.arrayContaining([
          expect.objectContaining({
            getId: expect.any(Function),
          }),
        ]),
      });
      expect(room.addLiveEvents).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            getId: expect.any(Function),
          }),
        ]),
        expect.objectContaining({
          fromCache: true,
          timelineWasEmpty: false,
          addToState: false,
        })
      );
      expect(room.getLiveTimeline().getEvents().map((event) => event.getId())).toEqual([
        '$loaded',
        '$cached',
      ]);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    }
  });

  it('logs room cache hydration failures instead of swallowing them', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const hydrationError = new Error('hydrate failed');
    const room = makeRoom({
      liveEvents: [makeEvent('$loaded', { ts: 100 })],
    });
    const roomInputRef = createRef<HTMLElement>();
    const editor = {} as Editor;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let renderer: ReturnType<typeof create> | undefined;

    loadLatestCachedRoomEventsMock.mockResolvedValue({
      beforeToken: undefined,
      events: [makeCachedRoomEvent('$cached', 200)],
      hasMoreBefore: false,
    });
    room.addLiveEvents.mockRejectedValueOnce(hydrationError);

    try {
      await act(async () => {
        renderer = create(
          React.createElement(RoomTimeline, {
            room,
            roomInputRef,
            editor,
          })
        );
        await flushAsyncWork();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to hydrate latest room cache for',
        room.roomId,
        hydrationError
      );
    } finally {
      consoleErrorSpy.mockRestore();
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    }
  });

  it('preserves an explicit null backward token when hydrating cached room history', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const liveEvent = makeEvent('$live-event', { ts: 10 });
    const cachedEvent = makeCachedRoomEvent('$cached-event', 5);
    const liveTimeline = makeTimeline([liveEvent], {
      backwardToken: 'stale-back-token',
    });
    const room = makeRoom({ liveTimeline });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    loadCachedRoomEventsBeforeMock.mockResolvedValueOnce({
      events: [cachedEvent],
      hasMoreBefore: false,
      beforeToken: null,
    });

    await act(async () => {
      await virtualPaginatorState.lastOptions?.onEnd?.(true);
      await flushAsyncWork();
    });

    expect(room.addEventsToTimeline).toHaveBeenCalled();
    expect(room.addEventsToTimeline.mock.lastCall?.[4]).toBeNull();

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('shows RoomIntro on room re-entry for a reused room object that already reached the top', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const liveEvent = makeEvent('$live-event', { ts: 10 });
    const liveTimeline = makeTimeline([liveEvent], {
      backwardToken: 'stale-back-token',
    });
    const room = makeRoom({ liveTimeline });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    loadCachedRoomPaginationTokenMock.mockResolvedValue(null);

    let firstRenderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      firstRenderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork();
    });

    await act(async () => {
      firstRenderer?.unmount();
      await flushAsyncWork(1);
    });

    let secondRenderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      secondRenderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork();
    });

    expect(secondRenderer?.root.findAllByType(roomIntroType)).toHaveLength(1);
    expect(secondRenderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);

    await act(async () => {
      secondRenderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('falls back to the existing SDK backward token when cached room history has no beforeToken metadata', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const liveEvent = makeEvent('$live-event', { ts: 10 });
    const cachedEvent = makeCachedRoomEvent('$cached-event', 5);
    const liveTimeline = makeTimeline([liveEvent], {
      backwardToken: 'server-back-token',
    });
    const room = makeRoom({ liveTimeline });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    loadCachedRoomEventsBeforeMock.mockResolvedValueOnce({
      events: [cachedEvent],
      hasMoreBefore: false,
    });

    await act(async () => {
      await virtualPaginatorState.lastOptions?.onEnd?.(true);
      await flushAsyncWork();
    });

    expect(room.addEventsToTimeline).toHaveBeenCalled();
    expect(room.addEventsToTimeline.mock.lastCall?.[4]).toBe('server-back-token');

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('recovers a stale room backward token only when cache metadata proves the room start', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const liveEvent = makeEvent('$live-event', { ts: 10 });
    const liveTimeline = makeTimeline([liveEvent], {
      backwardToken: 'stale-back-token',
    });
    const room = makeRoom({ liveTimeline });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    loadCachedRoomPaginationTokenMock.mockResolvedValue(null);

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork();
    });

    expect(liveTimeline.getPaginationToken(Direction.Backward)).toBeNull();
    expect(liveTimeline.setPaginationToken).toHaveBeenCalledWith(null, Direction.Backward);
    expect(renderer?.root.findAllByType(roomIntroType)).toHaveLength(1);
    expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
    expect(saveRoomEventsToCacheMock).toHaveBeenCalled();
    expect(saveRoomEventsToCacheMock.mock.lastCall?.[3]).toBeNull();

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('keeps eager-preloading past fifty batches in thread-heavy rooms until the configured limit is reached', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    settingsState.paginationLimit = 60;

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const liveEvents = [makeEvent('$visible-0', { ts: 1_000 })];
    const liveTimeline = makeTimeline(liveEvents, {
      backwardToken: 'page-0',
    });
    const room = makeRoom({ liveTimeline });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const preloadTarget = 59;
    let page = 0;
    let renderer: ReturnType<typeof create> | undefined;

    matrixClientMock.paginateEventTimeline.mockImplementation(async () => {
      page += 1;
      liveEvents.unshift(
        makeEvent(`$visible-${page}`, { ts: 1_000 - page * 10 }),
        ...Array.from({ length: 4 }, (_, index) =>
          makeEvent(`$thread-${page}-${index}`, {
            ts: 1_000 - page * 10 - index - 1,
            threadRootId: `$root-${page}`,
          })
        )
      );
      liveTimeline.__paginationTokens.backward = page < preloadTarget ? `page-${page}` : null;
      return true;
    });

    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await new Promise((resolve) => {
          setTimeout(resolve, 150);
        });
        await flushAsyncWork(10);
      });

      await act(async () => {
        await waitForCondition(
          () => matrixClientMock.paginateEventTimeline.mock.calls.length >= preloadTarget,
          800
        );
        await flushAsyncWork(20);
      });

      expect(matrixClientMock.paginateEventTimeline).toHaveBeenCalledTimes(preloadTarget);
      expect(page).toBe(preloadTarget);
      expect(virtualPaginatorState.lastOptions?.count).toBe(60);
    } finally {
      consoleLogSpy.mockRestore();
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    }
  });

  it('uses cache ordering for same-timestamp earliest room events when resolving room-start state', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const sdkFirstEvent = makeEvent('$b-event', { ts: 10 });
    const cacheFirstEvent = makeEvent('$a-event', { ts: 10 });
    const liveTimeline = makeTimeline([sdkFirstEvent, cacheFirstEvent], {
      backwardToken: 'stale-back-token',
    });
    const room = makeRoom({ liveTimeline });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    loadCachedRoomPaginationTokenMock.mockImplementation(
      async (_sessionId: string, _roomId: string, eventId?: string) =>
        eventId === '$a-event' ? null : undefined
    );

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork();
    });

    expect(loadCachedRoomPaginationTokenMock.mock.calls).not.toHaveLength(0);
    expect(loadCachedRoomPaginationTokenMock.mock.calls.every(([, , eventId]) => eventId === '$a-event')).toBe(
      true
    );
    expect(liveTimeline.getPaginationToken(Direction.Backward)).toBeNull();
    expect(renderer?.root.findAllByType(roomIntroType)).toHaveLength(1);
    expect(renderer?.root.findAllByType(compactPlaceholderType)).toHaveLength(0);
    expect(saveRoomEventsToCacheMock).toHaveBeenCalled();
    expect(saveRoomEventsToCacheMock.mock.lastCall?.[3]).toBeNull();

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('renders the room thread overview outside thread view', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const room = makeRoom();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    const renderer = create(
      React.createElement(ControlledRoomTimeline, {
        room,
      })
    );

    const overview = renderer.root.findByType(roomThreadOverviewType);

    expect(renderer.root.findAllByType(roomThreadOverviewType)).toHaveLength(1);
    expect(renderer.root.findByType(scrollType).findAllByType(roomThreadOverviewType)).toHaveLength(
      0
    );
    expect(overview.props.filter).toBe('all');
    expect(overview.props.counts).toEqual({ unresolved: 0, resolved: 0, unread: 0, all: 0 });
    expect(overview.props.onFilterChange).toBeTypeOf('function');
  });

  it('passes visible room thread counts to the overview', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const unresolvedThread = makeEvent('$thread-unresolved', { isThreadRoot: true });
    const resolvedThread = makeEvent('$thread-resolved', { isThreadRoot: true });
    const messageEvent = makeEvent('$message');
    const room = makeRoom({
      liveEvents: [messageEvent, unresolvedThread, resolvedThread],
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true });

    const renderer = create(
      React.createElement(ControlledRoomTimeline, {
        room,
      })
    );

    expect(renderer.root.findByType(roomThreadOverviewType).props.counts).toEqual({
      unresolved: 1,
      resolved: 1,
      unread: 0,
      all: 2,
    });
  });

  it('counts fallback-only thread roots in the room thread overview', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const fallbackRoot = makeEvent('$thread-root');
    const fallbackReply = makeEvent('$thread-reply', {
      threadRootId: fallbackRoot.getId(),
    });
    const room = makeRoom({
      liveEvents: [fallbackRoot, fallbackReply],
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    const renderer = create(
      React.createElement(ControlledRoomTimeline, {
        room,
      })
    );

    expect(renderer.root.findByType(roomThreadOverviewType).props.counts).toEqual({
      unresolved: 1,
      resolved: 0,
      unread: 0,
      all: 1,
    });
  });

  it('filters room events by thread resolution state', async () => {
    const { getThreadFilteredEvents } = await import('./RoomTimeline');
    const room = makeRoom();
    const unresolvedEvent = makeEvent('$thread-unresolved', { isThreadRoot: true });
    const resolvedEvent = makeEvent('$thread-resolved', { isThreadRoot: true });
    const messageEvent = makeEvent('$message');
    const renderableEvents = [messageEvent, unresolvedEvent, resolvedEvent];
    const resolutionMap = new Map([['$thread-resolved', { isResolved: true }]]);

    expect(
      getThreadFilteredEvents(
        renderableEvents as never,
        room as never,
        resolutionMap,
        undefined,
        'unresolved'
      ).map((event) => event.getId())
    ).toEqual(['$thread-unresolved']);
    expect(
      getThreadFilteredEvents(
        renderableEvents as never,
        room as never,
        resolutionMap,
        undefined,
        'resolved'
      ).map((event) => event.getId())
    ).toEqual(['$thread-resolved']);
  });

  it('treats fallback reply counts as visible thread roots for filtering', async () => {
    const { getThreadFilteredEvents } = await import('./RoomTimeline');
    const room = makeRoom();
    const fallbackRoot = makeEvent('$thread-root');
    const messageEvent = makeEvent('$message');
    const fallbackCounts = new Map([[fallbackRoot.getId(), 2]]);
    const resolutionMap = new Map<string, { isResolved: boolean }>();

    expect(
      getThreadFilteredEvents(
        [messageEvent, fallbackRoot] as never,
        room as never,
        resolutionMap,
        undefined,
        'unresolved',
        fallbackCounts
      ).map((event) => event.getId())
    ).toEqual(['$thread-root']);

    resolutionMap.set(fallbackRoot.getId(), { isResolved: true });
    expect(
      getThreadFilteredEvents(
        [messageEvent, fallbackRoot] as never,
        room as never,
        resolutionMap,
        undefined,
        'resolved',
        fallbackCounts
      ).map((event) => event.getId())
    ).toEqual(['$thread-root']);
  });

  it('filters hidden relations, thread replies, and ignored senders in isRenderableEvent', async () => {
    const { isRenderableEvent } = await import('./RoomTimeline');
    const baseArgs = [
      makeRoom() as never,
      undefined,
      new Set<string>(),
      false,
      false,
      false,
    ] as const;

    const messageEvent = makeEvent('$message');
    expect(isRenderableEvent(messageEvent as never, ...baseArgs)).toBe(true);

    const threadReply = makeEvent('$thread-reply', { threadRootId: '$thread-root' });
    expect(isRenderableEvent(threadReply as never, ...baseArgs)).toBe(false);

    const relationEvent = makeEvent('$edit', {
      associatedId: '$message',
      relation: { rel_type: 'm.replace', event_id: '$message' },
    });
    reactionOrEditEventMock.mockImplementation((event) => event.getId() === relationEvent.getId());
    expect(isRenderableEvent(relationEvent as never, ...baseArgs)).toBe(false);

    const ignoredEvent = makeEvent('$ignored', { sender: '@ignored:example.org' });
    expect(
      isRenderableEvent(
        ignoredEvent as never,
        makeRoom() as never,
        undefined,
        new Set(['@ignored:example.org']),
        false,
        false,
        false
      )
    ).toBe(false);
  });

  it('applies membership and hidden-event toggles in isRenderableEvent', async () => {
    const { isRenderableEvent } = await import('./RoomTimeline');
    const room = makeRoom();
    const membershipEvent = makeEvent('$member', { type: 'm.room.member' });
    isMembershipChangedMock.mockReturnValue(true);

    expect(
      isRenderableEvent(
        membershipEvent as never,
        room as never,
        undefined,
        new Set(),
        false,
        true,
        false
      )
    ).toBe(false);

    isMembershipChangedMock.mockReturnValue(false);
    expect(
      isRenderableEvent(
        membershipEvent as never,
        room as never,
        undefined,
        new Set(),
        false,
        false,
        true
      )
    ).toBe(false);

    const hiddenEvent = makeEvent('$hidden', {
      type: 'io.example.hidden',
      content: { body: 'hidden' },
    });
    expect(
      isRenderableEvent(hiddenEvent as never, room as never, undefined, new Set(), false, false, false)
    ).toBe(false);
    expect(
      isRenderableEvent(hiddenEvent as never, room as never, undefined, new Set(), true, false, false)
    ).toBe(true);
  });

  it('keeps filtered mode pinned to the full filtered range when live non-matching events arrive', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const unresolvedEvents = [
      makeEvent('$thread-1', { isThreadRoot: true }),
      makeEvent('$thread-2', { isThreadRoot: true }),
      makeEvent('$thread-3', { isThreadRoot: true }),
    ];
    const liveEvents = [...unresolvedEvents, makeEvent('$message-1')];
    const room = makeRoom({ liveEvents });
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 0, end: 4 });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onFilterChange('unresolved');
      await flushAsyncWork(1);
    });

    expect(virtualPaginatorState.lastOptions?.count).toBe(3);
    expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 0, end: 3 });

    const liveEventHandler = room.__listeners.get(RoomEvent.Timeline);
    expect(liveEventHandler).toBeTypeOf('function');

    liveEvents.push(makeEvent('$message-2'));

    await act(async () => {
      liveEventHandler?.(liveEvents[liveEvents.length - 1], room, false, false, {
        liveEvent: true,
      });
      await flushAsyncWork(1);
    });

    expect(virtualPaginatorState.lastOptions?.count).toBe(3);
    expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 0, end: 3 });
  });

  it('re-renders the room timeline for non-renderable live events at bottom', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleMessage = makeEvent('$message');
    const hiddenEdit = makeEvent('$edit', {
      associatedId: visibleMessage.getId(),
      relation: { rel_type: 'm.replace', event_id: visibleMessage.getId() },
    });
    reactionOrEditEventMock.mockImplementation((event) => event.getId() === hiddenEdit.getId());
    const room = makeRoom({ liveEvents: [visibleMessage] });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    const callCountBefore = virtualPaginatorState.callCount;
    const liveEventHandler = room.__listeners.get(RoomEvent.Timeline);
    expect(liveEventHandler).toBeTypeOf('function');

    await act(async () => {
      liveEventHandler?.(hiddenEdit, room, false, false, {
        liveEvent: true,
      });
      await flushAsyncWork(1);
    });

    expect(virtualPaginatorState.callCount).toBeGreaterThan(callCountBefore);

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('resets the room timeline to the latest live range when returning to all threads', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const unresolvedThread = makeEvent('$thread-unresolved', { isThreadRoot: true });
    const liveEvents = Array.from({ length: 304 }, (_, index) => makeEvent(`$message-${index}`));
    liveEvents.push(unresolvedThread);
    const room = makeRoom({ liveEvents });
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 5, end: 305 });

    await act(async () => {
      virtualPaginatorState.lastOptions?.onRangeChange({ start: 0, end: 10 });
      await flushAsyncWork(1);
    });

    expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 0, end: 10 });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onFilterChange('unresolved');
      await flushAsyncWork(1);
    });

    expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 0, end: 1 });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onFilterChange('all');
      await flushAsyncWork(1);
    });

    expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 5, end: 305 });
  });

  it('switches back to all threads before jumping to an unread event hidden by the active filter', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const resolvedThread = makeEvent('$thread-resolved', { isThreadRoot: true });
    const unreadMessage = makeEvent('$unread-message');
    const liveEvents = [resolvedThread];
    const unreadTimeline = makeTimeline([unreadMessage]);
    const room = makeRoom({
      liveEvents,
      timelinesByEventId: new Map([[unreadMessage.getId(), unreadTimeline]]),
    });
    room.getEventReadUpTo = () => unreadMessage.getId();
    roomUnreadState.value = true;
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true });
    matrixClientMock.getEventTimeline.mockResolvedValue(unreadTimeline);

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onFilterChange('resolved');
      await flushAsyncWork(1);
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.filter).toBe('resolved');

    const jumpToUnread = getClickableByText(renderer!, 'Jump to Unread');

    await act(async () => {
      jumpToUnread.props.onClick();
      await flushAsyncWork();
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.filter).toBe('all');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      unreadMessage.getId()
    );
  });

  it('maps hidden event targets to a visible neighbor instead of filtered index zero', async () => {
    const { getRenderableEventEntries, getTimelineTargetAnchor } = await import('./RoomTimeline');
    const olderMessage = makeEvent('$older', { ts: 1 });
    const threadRoot = makeEvent('$thread-root', { ts: 2 });
    const hiddenReply = makeEvent('$thread-reply', {
      threadRootId: threadRoot.getId(),
      ts: 3,
    });
    const newerMessage = makeEvent('$newer', { ts: 4 });
    const targetTimeline = makeTimeline([olderMessage, threadRoot, hiddenReply, newerMessage]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenReply.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getTimelineTargetAnchor({
        linkedTimelines: [targetTimeline] as never,
        renderableEntries,
        eventId: hiddenReply.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: threadRoot.getId(),
      index: 1,
      absoluteIndex: 1,
    });
  });

  it('falls back to the closest renderable entry when all target candidates are hidden', async () => {
    const { getRenderableEventEntries, getTimelineTargetAnchor } = await import('./RoomTimeline');
    const olderMessage = makeEvent('$older', { ts: 1 });
    const hiddenReply = makeEvent('$thread-reply', {
      threadRootId: '$thread-root',
      ts: 2,
    });
    const hiddenEdit = makeEvent('$edit', {
      associatedId: hiddenReply.getId(),
      relation: { rel_type: 'm.replace', event_id: hiddenReply.getId() },
      ts: 3,
    });
    const newerMessage = makeEvent('$newer', { ts: 4 });
    reactionOrEditEventMock.mockImplementation((event) => event.getId() === hiddenEdit.getId());
    const targetTimeline = makeTimeline([olderMessage, hiddenReply, hiddenEdit, newerMessage]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenEdit.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getTimelineTargetAnchor({
        linkedTimelines: [targetTimeline] as never,
        renderableEntries,
        eventId: hiddenEdit.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: newerMessage.getId(),
      index: 1,
      absoluteIndex: 3,
    });
  });

  it('falls back to the last renderable entry when read-up-to is beyond all visible events', async () => {
    const { getRenderableEventEntries, getUnreadTargetAnchor } = await import('./RoomTimeline');
    const firstVisible = makeEvent('$first', { ts: 1 });
    const lastVisible = makeEvent('$last', { ts: 2 });
    const hiddenReply = makeEvent('$hidden-reply', {
      threadRootId: '$thread-root',
      ts: 3,
    });
    const targetTimeline = makeTimeline([firstVisible, lastVisible, hiddenReply]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenReply.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getUnreadTargetAnchor({
        renderableEntries,
        eventId: hiddenReply.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: lastVisible.getId(),
      index: 1,
      absoluteIndex: 1,
    });
  });

  it('scrolls to the next visible event when read-up-to is filtered out in the live timeline', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const visibleRead = makeEvent('$visible-read', { ts: 1 });
    const hiddenReply = makeEvent('$hidden-reply', {
      threadRootId: '$thread-root',
      ts: 2,
    });
    const unreadVisible = makeEvent('$visible-unread', {
      sender: '@bob:example.org',
      ts: 3,
    });
    const room = makeRoom({
      liveEvents: [visibleRead, hiddenReply, unreadVisible],
    });
    room.getEventReadUpTo = () => hiddenReply.getId();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    await act(async () => {
      create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    expect(scrollToItemMock).toHaveBeenCalledWith(1, {
      behavior: 'instant',
      align: 'start',
      stopInView: true,
    });
  });

  it('switches back to all threads before opening an eventId hidden by the active filter', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const resolvedThread = makeEvent('$thread-resolved', { isThreadRoot: true });
    const permalinkMessage = makeEvent('$permalink-message');
    const targetTimeline = makeTimeline([permalinkMessage]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [resolvedThread],
      findEventById: (eventId) => {
        if (eventId === permalinkMessage.getId()) {
          return targetTimelineLoaded ? permalinkMessage : undefined;
        }

        return eventId === resolvedThread.getId() ? resolvedThread : undefined;
      },
    });
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === permalinkMessage.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: permalinkMessage.getId(),
          initialThreadFilter: 'resolved',
        })
      );
      await flushAsyncWork();
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.filter).toBe('all');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      permalinkMessage.getId()
    );
  });

  it('keeps the active thread filter when opening an unloaded eventId that still matches it', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleResolvedThread = makeEvent('$thread-visible', { isThreadRoot: true });
    const olderResolvedThread = makeEvent('$thread-older', { isThreadRoot: true });
    const targetTimeline = makeTimeline([olderResolvedThread]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [visibleResolvedThread],
      findEventById: (eventId) => {
        if (eventId === olderResolvedThread.getId()) {
          return targetTimelineLoaded ? olderResolvedThread : undefined;
        }

        return eventId === visibleResolvedThread.getId() ? visibleResolvedThread : undefined;
      },
    });
    threadResolutionMapMock.set(visibleResolvedThread.getId(), { isResolved: true });
    threadResolutionMapMock.set(olderResolvedThread.getId(), { isResolved: true });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === olderResolvedThread.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: olderResolvedThread.getId(),
          initialThreadFilter: 'resolved',
        })
      );
      await flushAsyncWork();
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.filter).toBe('resolved');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      olderResolvedThread.getId()
    );
  });

  it('keeps the unresolved filter when opening an unloaded unresolved thread root', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleUnresolvedThread = makeEvent('$thread-visible', { isThreadRoot: true });
    const olderUnresolvedThread = makeEvent('$thread-older', { isThreadRoot: true });
    const targetTimeline = makeTimeline([olderUnresolvedThread]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [visibleUnresolvedThread],
      findEventById: (eventId) => {
        if (eventId === olderUnresolvedThread.getId()) {
          return targetTimelineLoaded ? olderUnresolvedThread : undefined;
        }

        return eventId === visibleUnresolvedThread.getId() ? visibleUnresolvedThread : undefined;
      },
    });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === olderUnresolvedThread.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: olderUnresolvedThread.getId(),
          initialThreadFilter: 'unresolved',
        })
      );
      await flushAsyncWork();
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.filter).toBe('unresolved');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      olderUnresolvedThread.getId()
    );
  });

  it('keeps the unresolved filter when opening an unloaded fallback-only thread root after permalink load', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleUnresolvedThread = makeEvent('$thread-visible', { isThreadRoot: true });
    const fallbackThreadRoot = makeEvent('$thread-fallback');
    const fallbackThreadReply = makeEvent('$thread-fallback-reply', {
      threadRootId: fallbackThreadRoot.getId(),
    });
    const targetTimeline = makeTimeline([fallbackThreadRoot, fallbackThreadReply]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [visibleUnresolvedThread],
      findEventById: (eventId) => {
        if (eventId === fallbackThreadRoot.getId()) {
          return targetTimelineLoaded ? fallbackThreadRoot : undefined;
        }
        if (eventId === fallbackThreadReply.getId()) {
          return targetTimelineLoaded ? fallbackThreadReply : undefined;
        }

        return eventId === visibleUnresolvedThread.getId() ? visibleUnresolvedThread : undefined;
      },
    });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === fallbackThreadRoot.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: fallbackThreadRoot.getId(),
          initialThreadFilter: 'unresolved',
        })
      );
      await flushAsyncWork();
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.filter).toBe('unresolved');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      fallbackThreadRoot.getId()
    );
  });

  it('detects unread divider boundaries when read-up-to is filtered out', async () => {
    const { shouldRenderUnreadDividerAt } = await import('./RoomTimeline');

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 1,
        eventAbsoluteIndex: 2,
        prevRenderedEventAbsoluteIndex: 0,
      })
    ).toBe(true);

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 1,
        eventAbsoluteIndex: 1,
        prevRenderedEventAbsoluteIndex: 0,
      })
    ).toBe(false);

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 3,
        eventAbsoluteIndex: 5,
        prevRenderedEventAbsoluteIndex: 4,
      })
    ).toBe(false);
  });

  it('does not retrigger room focus scroll on unrelated live room updates', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const unresolvedThread = makeEvent('$thread-root', { isThreadRoot: true });
    const unreadMessage = makeEvent('$unread-message');
    const unreadTimelineEvents = [unreadMessage];
    const unreadTimeline = makeTimeline(unreadTimelineEvents);
    const room = makeRoom({
      liveEvents: [unresolvedThread],
      timelinesByEventId: new Map([[unreadMessage.getId(), unreadTimeline]]),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    room.getEventReadUpTo = () => unreadMessage.getId();
    roomUnreadState.value = true;
    matrixClientMock.getEventTimeline.mockResolvedValue(unreadTimeline);

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    const jumpToUnread = getClickableByText(renderer!, 'Jump to Unread');

    await act(async () => {
      jumpToUnread.props.onClick();
      await flushAsyncWork();
    });

    const initialScrollCallCount = scrollToItemMock.mock.calls.length;
    expect(initialScrollCallCount).toBeGreaterThan(0);
    expect(scrollToItemMock).toHaveBeenLastCalledWith(0, {
      align: 'start',
      behavior: 'instant',
      offset: 32,
      stopInView: false,
    });

    unreadTimelineEvents.push(makeEvent('$later-event', { ts: 10 }));

    await act(async () => {
      renderer?.update(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork();
    });

    expect(scrollToItemMock).toHaveBeenCalledTimes(initialScrollCallCount);

    await act(async () => {
      renderer?.unmount();
      await flushAsyncWork(1);
    });
  });

  it('tracks room-mode focus retries while the target event is still missing from the DOM', async () => {
    const { getNextRoomFocusRetry } = await import('./RoomTimeline');

    expect(
      getNextRoomFocusRetry({
        focusEventId: '$target',
        pendingRetry: undefined,
        scrolled: true,
        targetFound: false,
      })
    ).toEqual({
      eventId: '$target',
      attempts: 1,
    });

    expect(
      getNextRoomFocusRetry({
        focusEventId: '$target',
        pendingRetry: {
          eventId: '$target',
          attempts: 1,
        },
        scrolled: true,
        targetFound: false,
      })
    ).toEqual({
      eventId: '$target',
      attempts: 2,
    });

    expect(
      getNextRoomFocusRetry({
        focusEventId: '$target',
        pendingRetry: {
          eventId: '$target',
          attempts: 10,
        },
        scrolled: true,
        targetFound: false,
      })
    ).toBeUndefined();

    expect(
      getNextRoomFocusRetry({
        focusEventId: '$target',
        pendingRetry: undefined,
        scrolled: true,
        targetFound: true,
      })
    ).toBeUndefined();
  });

  it('maps hidden event targets to a visible neighbor instead of filtered index zero', async () => {
    const { getRenderableEventEntries, getTimelineTargetAnchor } = await import('./RoomTimeline');
    const olderMessage = makeEvent('$older', { ts: 1 });
    const threadRoot = makeEvent('$thread-root', { ts: 2 });
    const hiddenReply = makeEvent('$thread-reply', {
      threadRootId: threadRoot.getId(),
      ts: 3,
    });
    const newerMessage = makeEvent('$newer', { ts: 4 });
    const targetTimeline = makeTimeline([olderMessage, threadRoot, hiddenReply, newerMessage]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenReply.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getTimelineTargetAnchor({
        linkedTimelines: [targetTimeline] as never,
        renderableEntries,
        eventId: hiddenReply.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: threadRoot.getId(),
      index: 1,
      absoluteIndex: 1,
    });
  });

  it('falls back to the closest renderable entry when all target candidates are hidden', async () => {
    const { getRenderableEventEntries, getTimelineTargetAnchor } = await import('./RoomTimeline');
    const olderMessage = makeEvent('$older', { ts: 1 });
    const hiddenReply = makeEvent('$thread-reply', {
      threadRootId: '$thread-root',
      ts: 2,
    });
    const hiddenEdit = makeEvent('$edit', {
      associatedId: hiddenReply.getId(),
      relation: { rel_type: 'm.replace', event_id: hiddenReply.getId() },
      ts: 3,
    });
    const newerMessage = makeEvent('$newer', { ts: 4 });
    reactionOrEditEventMock.mockImplementation((event) => event.getId() === hiddenEdit.getId());
    const targetTimeline = makeTimeline([olderMessage, hiddenReply, hiddenEdit, newerMessage]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenEdit.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getTimelineTargetAnchor({
        linkedTimelines: [targetTimeline] as never,
        renderableEntries,
        eventId: hiddenEdit.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: newerMessage.getId(),
      index: 1,
      absoluteIndex: 3,
    });
  });

  it('falls back to the last renderable entry when read-up-to is beyond all visible events', async () => {
    const { getRenderableEventEntries, getUnreadTargetAnchor } = await import('./RoomTimeline');
    const firstVisible = makeEvent('$first', { ts: 1 });
    const lastVisible = makeEvent('$last', { ts: 2 });
    const hiddenReply = makeEvent('$hidden-reply', {
      threadRootId: '$thread-root',
      ts: 3,
    });
    const targetTimeline = makeTimeline([firstVisible, lastVisible, hiddenReply]);
    const room = makeRoom({
      timelinesByEventId: new Map([[hiddenReply.getId(), targetTimeline]]),
    });
    const renderableEntries = getRenderableEventEntries(
      [targetTimeline] as never,
      room as never,
      undefined,
      new Set(),
      false,
      false,
      false
    );

    expect(
      getUnreadTargetAnchor({
        renderableEntries,
        eventId: hiddenReply.getId(),
        absoluteIndex: 2,
      })
    ).toEqual({
      eventId: lastVisible.getId(),
      index: 1,
      absoluteIndex: 1,
    });
  });

  it('scrolls to the next visible event when read-up-to is filtered out in the live timeline', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const visibleRead = makeEvent('$visible-read', { ts: 1 });
    const hiddenReply = makeEvent('$hidden-reply', {
      threadRootId: '$thread-root',
      ts: 2,
    });
    const unreadVisible = makeEvent('$visible-unread', {
      sender: '@bob:example.org',
      ts: 3,
    });
    const room = makeRoom({
      liveEvents: [visibleRead, hiddenReply, unreadVisible],
    });
    room.getEventReadUpTo = () => hiddenReply.getId();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    await act(async () => {
      create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(1);
    });

    expect(scrollToItemMock).toHaveBeenCalledWith(1, {
      behavior: 'instant',
      align: 'start',
      stopInView: true,
    });
  });

  it('switches back to all threads before opening an eventId hidden by the active filter', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const resolvedThread = makeEvent('$thread-resolved', { isThreadRoot: true });
    const permalinkMessage = makeEvent('$permalink-message');
    const targetTimeline = makeTimeline([permalinkMessage]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [resolvedThread],
      findEventById: (eventId) => {
        if (eventId === permalinkMessage.getId()) {
          return targetTimelineLoaded ? permalinkMessage : undefined;
        }

        return eventId === resolvedThread.getId() ? resolvedThread : undefined;
      },
    });
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === permalinkMessage.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: permalinkMessage.getId(),
          initialThreadFilter: 'resolved',
        })
      );
      await flushAsyncWork();
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.filter).toBe('all');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      permalinkMessage.getId()
    );
  });

  it('keeps the active thread filter when opening an unloaded eventId that still matches it', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleResolvedThread = makeEvent('$thread-visible', { isThreadRoot: true });
    const olderResolvedThread = makeEvent('$thread-older', { isThreadRoot: true });
    const targetTimeline = makeTimeline([olderResolvedThread]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [visibleResolvedThread],
      findEventById: (eventId) => {
        if (eventId === olderResolvedThread.getId()) {
          return targetTimelineLoaded ? olderResolvedThread : undefined;
        }

        return eventId === visibleResolvedThread.getId() ? visibleResolvedThread : undefined;
      },
    });
    threadResolutionMapMock.set(visibleResolvedThread.getId(), { isResolved: true });
    threadResolutionMapMock.set(olderResolvedThread.getId(), { isResolved: true });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === olderResolvedThread.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: olderResolvedThread.getId(),
          initialThreadFilter: 'resolved',
        })
      );
      await flushAsyncWork();
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.filter).toBe('resolved');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      olderResolvedThread.getId()
    );
  });

  it('keeps the unresolved filter when opening an unloaded unresolved thread root', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleUnresolvedThread = makeEvent('$thread-visible', { isThreadRoot: true });
    const olderUnresolvedThread = makeEvent('$thread-older', { isThreadRoot: true });
    const targetTimeline = makeTimeline([olderUnresolvedThread]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [visibleUnresolvedThread],
      findEventById: (eventId) => {
        if (eventId === olderUnresolvedThread.getId()) {
          return targetTimelineLoaded ? olderUnresolvedThread : undefined;
        }

        return eventId === visibleUnresolvedThread.getId() ? visibleUnresolvedThread : undefined;
      },
    });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === olderUnresolvedThread.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: olderUnresolvedThread.getId(),
          initialThreadFilter: 'unresolved',
        })
      );
      await flushAsyncWork();
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.filter).toBe('unresolved');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      olderUnresolvedThread.getId()
    );
  });

  it('keeps the unresolved filter when opening an unloaded fallback-only thread root after permalink load', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    const visibleUnresolvedThread = makeEvent('$thread-visible', { isThreadRoot: true });
    const fallbackThreadRoot = makeEvent('$thread-fallback');
    const fallbackThreadReply = makeEvent('$thread-fallback-reply', {
      threadRootId: fallbackThreadRoot.getId(),
    });
    const targetTimeline = makeTimeline([fallbackThreadRoot, fallbackThreadReply]);
    let targetTimelineLoaded = false;
    const room = makeRoom({
      liveEvents: [visibleUnresolvedThread],
      findEventById: (eventId) => {
        if (eventId === fallbackThreadRoot.getId()) {
          return targetTimelineLoaded ? fallbackThreadRoot : undefined;
        }
        if (eventId === fallbackThreadReply.getId()) {
          return targetTimelineLoaded ? fallbackThreadReply : undefined;
        }

        return eventId === visibleUnresolvedThread.getId() ? visibleUnresolvedThread : undefined;
      },
    });
    matrixClientMock.getEventTimeline.mockImplementation(async (_timelineSet, eventId) => {
      if (eventId === fallbackThreadRoot.getId()) {
        targetTimelineLoaded = true;
        return targetTimeline;
      }

      return undefined;
    });

    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
          eventId: fallbackThreadRoot.getId(),
          initialThreadFilter: 'unresolved',
        })
      );
      await flushAsyncWork();
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.filter).toBe('unresolved');
    expect(matrixClientMock.getEventTimeline).toHaveBeenCalledWith(
      room.getUnfilteredTimelineSet(),
      fallbackThreadRoot.getId()
    );
  });

  it('detects unread divider boundaries when read-up-to is filtered out', async () => {
    const { shouldRenderUnreadDividerAt } = await import('./RoomTimeline');

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 1,
        eventAbsoluteIndex: 2,
        prevRenderedEventAbsoluteIndex: 0,
      })
    ).toBe(true);

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 1,
        eventAbsoluteIndex: 1,
        prevRenderedEventAbsoluteIndex: 0,
      })
    ).toBe(false);

    expect(
      shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex: 3,
        eventAbsoluteIndex: 5,
        prevRenderedEventAbsoluteIndex: 4,
      })
    ).toBe(false);
  });

  it('computes room-event focus against the active thread-filtered room list', async () => {
    const { getRoomEventFocusTarget } = await import('./RoomTimeline');
    const firstThread = makeEvent('$thread-1', { isThreadRoot: true });
    const messageEvent = makeEvent('$message-1');
    const secondThread = makeEvent('$thread-2', { isThreadRoot: true });
    const room = makeRoom();

    expect(
      getRoomEventFocusTarget({
        eventId: secondThread.getId(),
        renderableEvents: [firstThread, messageEvent, secondThread] as never,
        room: room as never,
        threadResolutionMap: threadResolutionMapMock,
        threadId: undefined,
        threadFilter: 'unresolved',
      })
    ).toEqual({
      index: 1,
      count: 2,
      resetThreadFilter: false,
    });
  });

  it('uses stopInView=false for the explicit room focus scroll', async () => {
    const { getRoomFocusScrollToItemOptions } = await import('./RoomTimeline');

    expect(getRoomFocusScrollToItemOptions(10, 100)).toEqual({
      align: 'center',
      behavior: 'instant',
      offset: undefined,
      stopInView: false,
    });
  });

  it('switches room focus to start alignment near the loaded room start', async () => {
    const { getRoomFocusScrollOptions, getRoomFocusScrollToItemOptions } = await import(
      './RoomTimeline'
    );

    expect(getRoomFocusScrollOptions(0, 100)).toEqual({
      align: 'start',
      behavior: 'instant',
      offset: 32,
    });
    expect(getRoomFocusScrollOptions(4, 100)).toEqual({
      align: 'start',
      behavior: 'instant',
      offset: 32,
    });
    expect(getRoomFocusScrollToItemOptions(2, 100)).toEqual({
      align: 'start',
      behavior: 'instant',
      offset: 32,
      stopInView: false,
    });
  });

  it('switches room focus to end alignment near the loaded room end', async () => {
    const { getRoomFocusScrollOptions, getRoomFocusScrollToItemOptions } = await import(
      './RoomTimeline'
    );

    expect(getRoomFocusScrollOptions(8, 12)).toEqual({
      align: 'end',
      behavior: 'instant',
      offset: -32,
    });
    expect(getRoomFocusScrollToItemOptions(8, 12)).toEqual({
      align: 'end',
      behavior: 'instant',
      offset: -32,
      stopInView: false,
    });
  });

  it('recenters focus during observed resize activity and finishes after the idle window', async () => {
    const { setupFocusObserver } = await import('./RoomTimeline');
    vi.useFakeTimers();

    try {
      const onRecenter = vi.fn();
      const onDone = vi.fn();
      const resizeObserverInstances: Array<{
        callback: (entries: ResizeObserverEntry[]) => void;
        observe: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
      }> = [];
      const rafCallbacks: FrameRequestCallback[] = [];

      class ResizeObserverMock {
        callback: (entries: ResizeObserverEntry[]) => void;

        observe = vi.fn();

        disconnect = vi.fn();

        constructor(callback: (entries: ResizeObserverEntry[]) => void) {
          this.callback = callback;
          resizeObserverInstances.push(this);
        }
      }

      vi.stubGlobal('ResizeObserver', ResizeObserverMock as never);
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      });

      const cleanup = setupFocusObserver({
        scrollContainer: {} as HTMLElement,
        target: {} as HTMLElement,
        onRecenter,
        onDone,
        idleMs: 200,
        hardMs: 2000,
      });

      expect(resizeObserverInstances).toHaveLength(1);
      const resizeObserver = resizeObserverInstances[0];
      expect(resizeObserver.observe).toHaveBeenNthCalledWith(1, expect.anything());
      expect(resizeObserver.observe).toHaveBeenNthCalledWith(2, expect.anything());

      resizeObserver.callback([] as ResizeObserverEntry[]);
      expect(onRecenter).not.toHaveBeenCalled();

      act(() => {
        rafCallbacks.shift()?.(0);
      });

      expect(onRecenter).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(199);
      });
      expect(onDone).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(resizeObserver.disconnect).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledTimes(1);

      cleanup();
    } finally {
      vi.useRealTimers();
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      });
    }
  });

  it('cancels a pending room focus retry when the focused event changes', async () => {
    const { isContinuingRoomFocusRetry } = await import('./RoomTimeline');

    expect(
      isContinuingRoomFocusRetry('$first', {
        eventId: '$first',
        attempts: 1,
      })
    ).toBe(true);
    expect(
      isContinuingRoomFocusRetry('$second', {
        eventId: '$first',
        attempts: 1,
      })
    ).toBe(false);
    expect(isContinuingRoomFocusRetry(undefined, { eventId: '$first', attempts: 1 })).toBe(false);
  });

  it('resets the room thread filter when the focused event is hidden by the active filter', async () => {
    const { getRoomEventFocusTarget } = await import('./RoomTimeline');
    const unresolvedThread = makeEvent('$thread-unresolved', { isThreadRoot: true });
    const resolvedThread = makeEvent('$thread-resolved', { isThreadRoot: true });
    const room = makeRoom();
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true });

    expect(
      getRoomEventFocusTarget({
        eventId: resolvedThread.getId(),
        renderableEvents: [unresolvedThread, resolvedThread] as never,
        room: room as never,
        threadResolutionMap: threadResolutionMapMock,
        threadId: undefined,
        threadFilter: 'unresolved',
      })
    ).toEqual({
      index: 1,
      count: 2,
      resetThreadFilter: true,
    });
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
