import React, { createRef } from 'react';
import { Direction, RoomEvent } from 'matrix-js-sdk';
import { Editor } from 'slate';
import { act, create as baseCreate } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultThreadFilterState } from './roomThreadOverviewModel';
import {
  clearThreadOpenSeedSnapshotsForTests,
  getThreadOpenSeedSnapshot,
  saveThreadOpenSeedSnapshot,
} from './threadOpenSeedCache';

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
  loadLatestCachedThreadSummaryInfoMock,
  loadCachedThreadSummariesMock,
  saveRoomEventsToCacheMock,
  saveCachedThreadSummaryMock,
  isTimelineAtLiveEndMock,
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
  threadResolutionMapMock: new Map<string, { isResolved: boolean; tags: Record<string, unknown> | null }>(),
  ignoredUsersMock: [] as string[],
  roomUnreadState: { value: false },
  scrollToItemMock: vi.fn(),
  scrollToElementMock: vi.fn(),
  retryPaginationMock: vi.fn(),
  loadCachedRoomEventsBeforeMock: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
  loadCachedRoomPaginationTokenMock: vi.fn(async () => undefined),
  loadLatestCachedRoomEventsMock: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
  loadLatestCachedThreadSummaryInfoMock: vi.fn(async () => undefined),
  loadCachedThreadSummariesMock: vi.fn(async () => new Map()),
  saveRoomEventsToCacheMock: vi.fn(async () => undefined),
  saveCachedThreadSummaryMock: vi.fn(async () => undefined),
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

const mountedRenderers = new Set<ReturnType<typeof baseCreate>>();
const create: typeof baseCreate = ((...args: Parameters<typeof baseCreate>) => {
  const renderer = baseCreate(...args);
  mountedRenderers.add(renderer);
  return renderer;
}) as typeof baseCreate;

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
  THREAD_BATCH_SIZE: 200,
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
  getLatestMessageContent: (
    event?: { getContent?: () => Record<string, unknown> | undefined },
    editedEvent?: { getContent?: () => Record<string, unknown> | undefined }
  ) => editedEvent?.getContent?.() ?? event?.getContent?.(),
  getLatestEdit: (_target: unknown, edits: Array<{ getTs: () => number }>) =>
    edits.reduce((latest, edit) => (edit.getTs() >= latest.getTs() ? edit : latest), edits[0]),
  getLatestEditableEvt: () => undefined,
  getMemberDisplayName: () => 'Alice',
  getReactionContent: () => undefined,
  isMembershipChanged: isMembershipChangedMock,
  logEditDebug: vi.fn(),
  reactionOrEditEvent: reactionOrEditEventMock,
  trimReplyFromBody: (body: string) => body,
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

vi.mock('../../components/CollapsibleMessage', () => ({
  CollapsibleMessage: passthrough,
  expandAllMessages: vi.fn(),
  collapseAllMessages: vi.fn(),
}));

vi.mock('../../components/RenderMessageContent', () => ({
  RenderMessageContent: passthrough,
}));

vi.mock('../../components/CollapsibleMessage', async () => {
  const ReactImport = await import('react');

  return {
    expandAllMessages: vi.fn(),
    collapseAllMessages: vi.fn(),
    CollapsibleMessage: ({ children }: { children: React.ReactNode }) =>
      ReactImport.createElement(passthrough, undefined, children),
  };
});

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

vi.mock('../../components/message/mindroomThreadSummary', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../components/message/mindroomThreadSummary')>();
  return {
    ...actual,
    buildThreadSummaryMap: () => new Map(),
    findLatestThreadSummaryEvent: () => undefined,
    getThreadSummaryEventInfo: () => undefined,
  };
});

vi.mock('./useThreadRenderState', () => ({
  useThreadRenderState: () => threadRenderStateMock,
}));

vi.mock('./threadEventCache', () => ({
  getThreadCursorAnchor: vi.fn((rawEvent?: { event_id?: string; origin_server_ts?: number }) =>
    rawEvent?.event_id
      ? {
          eventId: rawEvent.event_id,
          ts: rawEvent.origin_server_ts ?? 0,
        }
      : undefined
  ),
  loadCachedThreadEventsBefore: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
  loadLatestCachedThreadSummaryInfo: loadLatestCachedThreadSummaryInfoMock,
  loadLatestCachedThreadEvents: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
  normalizeCachedThreadEvents: (events: unknown[]) => events,
  saveThreadEventsToCache: vi.fn(async () => undefined),
}));

vi.mock('./threadPaginationUtils', () => ({
  computeReconciliationToken: () => undefined,
  findEarliestLoadedThreadReplyByCacheOrder: () => undefined,
  reconcileThreadBackwardPagination: vi.fn(),
}));

vi.mock('./eventCacheTokenUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./eventCacheTokenUtils')>();
  return actual;
});

vi.mock('./threadSummaryCache', () => ({
  loadCachedThreadSummaries: loadCachedThreadSummariesMock,
  saveCachedThreadSummary: saveCachedThreadSummaryMock,
}));


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
  serializeEventsForCache: (_room: unknown, events: Array<{ event?: Record<string, unknown>; getId?(): string | undefined; getTs?(): number; getContent?(): Record<string, unknown> }>) =>
    events.map((event) =>
      event.event ?? {
        content: event.getContent?.() ?? {},
        event_id: event.getId?.(),
        origin_server_ts: event.getTs?.() ?? 0,
      }
    ),
}));

vi.mock('./timelineScrollUtils', () => ({
  isScrollNearBottom: () => true,
  isTimelineAtLiveEnd: isTimelineAtLiveEndMock,
  shouldAutoScrollRoomOnLiveEvent: () => false,
  shouldAutoScrollThreadOnLiveEvent: () => false,
}));

vi.mock('./threadEditBackfillUtils', () => ({
  hasLikelyIncompleteStreamingBody: (value: unknown) =>
    typeof value === 'string' && /^thinking(?:\.{3}|…)(?:\s*⋯)?$/i.test(value.trim()),
  markThreadEditBackfillAttempted: vi.fn(),
  shouldFetchThreadEditBackfill: () => false,
}));

vi.mock('./RoomThreadOverview', () => ({
  RoomThreadOverview: roomThreadOverviewType,
}));

vi.mock('./CompactRoomView', () => ({
  CompactRoomView: compactPlaceholderType,
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
    unsigned?: Record<string, unknown>;
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
  getUnsigned: () => opts.unsigned ?? {},
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
  threads = [],
}: {
  liveEvents?: ReturnType<typeof makeEvent>[];
  liveTimeline?: ReturnType<typeof makeTimeline>;
  timelinesByEventId?: Map<string, ReturnType<typeof makeTimeline>>;
  findEventById?: (eventId: string) => ReturnType<typeof makeEvent> | undefined;
  threads?: Array<{ id?: string; rootEvent?: ReturnType<typeof makeEvent> | undefined }>;
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
    getThread: (threadId: string) => threads.find((thread) => thread.id === threadId) ?? null,
    getThreads: () => threads,
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
  clearThreadOpenSeedSnapshotsForTests();
  threadRenderStateMock.threadEventIndexMapRef.current = new Map();
  threadRenderStateMock.threadEvents = [];
  threadRenderStateMock.threadInitialRenderMode = 'live';
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
  loadLatestCachedThreadSummaryInfoMock.mockResolvedValue(undefined);
  loadCachedThreadSummariesMock.mockResolvedValue(new Map());
  saveRoomEventsToCacheMock.mockResolvedValue(undefined);
  saveCachedThreadSummaryMock.mockResolvedValue(undefined);
  settingsState.paginationLimit = 300;
  virtualPaginatorState.lastOptions = undefined;
  virtualPaginatorState.callCount = 0;
  virtualPaginatorState.renderItems = true;
  isTimelineAtLiveEndMock.mockReturnValue(true);
  reactionOrEditEventMock.mockImplementation(() => false);
  isMembershipChangedMock.mockImplementation(() => false);
  matrixClientMock.fetchRelations.mockResolvedValue({
    chunk: [],
    next_batch: null,
  });
  matrixClientMock.getEventTimeline.mockResolvedValue(undefined);
  matrixClientMock.getThreadTimeline.mockResolvedValue(undefined);
  matrixClientMock.paginateEventTimeline.mockResolvedValue(false);
});

afterEach(() => {
  mountedRenderers.forEach((renderer) => renderer.unmount());
  mountedRenderers.clear();
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

const DEFAULT_THREAD_FILTER_STATE = createDefaultThreadFilterState();

const threadFilterStateFromLegacy = (
  filter?: 'all' | 'resolved' | 'unresolved' | 'unread'
): import('./roomThreadOverviewModel').ThreadFilterState => {
  switch (filter) {
    case 'resolved':
      return { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'include' as const, tags: new Map() };
    case 'unresolved':
      return { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'exclude' as const, tags: new Map() };
    case 'unread':
      return { ...DEFAULT_THREAD_FILTER_STATE, unread: 'include' as const, tags: new Map() };
    default:
      return { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() };
  }
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
  }: {
    room: ReturnType<typeof makeRoom>;
    eventId?: string;
    threadId?: string;
    initialThreadFilter?: 'all' | 'resolved' | 'unresolved' | 'unread';
  }) {
    const [threadFilterState, setThreadFilterState] =
      React.useState<import('./roomThreadOverviewModel').ThreadFilterState>(
        threadFilterStateFromLegacy(initialThreadFilter)
      );

    const onToggle = React.useCallback(
      (key: 'resolved' | 'streaming' | 'scheduled' | 'unread' | 'idle') => {
        setThreadFilterState((prev) => {
          const current = prev[key];
          const next = current === 'any' ? 'include' : current === 'include' ? 'exclude' : 'any';
          return { ...prev, [key]: next };
        });
      },
      []
    );

    const onSortDirectionChange = React.useCallback(() => {
      setThreadFilterState((prev) => {
        const { cycleSortMode } = require('./roomThreadOverviewModel');
        return { ...prev, ...cycleSortMode(prev) };
      });
    }, []);

    const onReset = React.useCallback(() => {
      setThreadFilterState({ ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() });
    }, []);

    return React.createElement(RoomTimelineComponent, {
      room,
      eventId,
      threadId,
      threadFilterState,
      onToggle,
      onSortDirectionChange,
      onCycleTag: vi.fn(),
      onAddTag: vi.fn(),
      onRemoveTag: vi.fn(),
      onReset,
      viewMode: 'default',
      onViewModeChange: vi.fn(),
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
            threadFilterState: { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() },
            onToggle: vi.fn(),
            onSortDirectionChange: vi.fn(),
            onCycleTag: vi.fn(),
            onAddTag: vi.fn(),
            onRemoveTag: vi.fn(),
            onReset: vi.fn(),
            viewMode: 'default',
            onViewModeChange: vi.fn(),
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
            threadFilterState: { ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() },
            onToggle: vi.fn(),
            onSortDirectionChange: vi.fn(),
            onCycleTag: vi.fn(),
            onAddTag: vi.fn(),
            onRemoveTag: vi.fn(),
            onReset: vi.fn(),
            viewMode: 'default',
            onViewModeChange: vi.fn(),
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

    await waitForCondition(() => room.addEventsToTimeline.mock.calls.length > 0, 100);

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
    expect(overview.props.state).toEqual({ ...DEFAULT_THREAD_FILTER_STATE, tags: new Map() });
    expect(overview.props.threadCount).toBe(0);
    expect(overview.props.onToggle).toBeTypeOf('function');
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
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true, tags: null });

    const renderer = create(
      React.createElement(ControlledRoomTimeline, {
        room,
      })
    );

    expect(renderer.root.findByType(roomThreadOverviewType).props.threadCount).toBe(2);
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

    expect(renderer.root.findByType(roomThreadOverviewType).props.threadCount).toBe(1);
  });

  it('counts reply-backed thread roots in preload surface counts even when the root is not renderable in the room timeline', async () => {
    const { getRoomPreloadCounts } = await import('./RoomTimeline');
    const fallbackRoot = makeEvent('$thread-root');
    const fallbackReply = makeEvent('$thread-reply', {
      threadRootId: fallbackRoot.getId(),
    });
    const liveTimeline = makeTimeline([fallbackReply]);
    const room = makeRoom({
      liveTimeline,
      findEventById: (eventId: string) => (eventId === fallbackRoot.getId() ? fallbackRoot : undefined),
    });

    expect(
      getRoomPreloadCounts([liveTimeline] as never, room as never, {
        threadId: undefined,
        ignoredUsersSet: new Set<string>(),
        showHiddenEvents: false,
        hideMembershipEvents: false,
        hideNickAvatarEvents: false,
      })
    ).toEqual({
      cacheCount: 0,
      renderableCount: 0,
      surfaceCount: 1,
    });
  });

  it('renders reply-backed thread roots in overview mode when only replies are loaded in the room timeline', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const fallbackRoot = makeEvent('$thread-root');
    const fallbackReply = makeEvent('$thread-reply', {
      threadRootId: fallbackRoot.getId(),
    });
    const room = makeRoom({
      liveEvents: [fallbackReply],
      findEventById: (eventId: string) => (eventId === fallbackRoot.getId() ? fallbackRoot : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    const renderer = create(
      React.createElement(ControlledRoomTimeline, {
        room,
        initialThreadFilter: 'unresolved',
      })
    );

    expect(renderer.root.findByType(roomThreadOverviewType).props.threadCount).toBe(1);
    expect(renderer.root.findByType(roomThreadOverviewType).props.statusCounts).toEqual({
      resolved: 0,
      streaming: 0,
      scheduled: 0,
      unread: 0,
      idle: 0,
    });
    expect(
      renderer.root.findAllByProps({
        eventId: fallbackRoot.getId(),
      })
    ).toHaveLength(1);
  });

  it('collects room-loaded thread events in chronological order without surfacing relation rows', async () => {
    const { getLoadedRoomThreadEvents, getLoadedRoomThreadSeedEvents } = await import('./RoomTimeline');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1 });
    const newerReply = makeEvent('$thread-reply-2', {
      threadRootId: threadId,
      ts: 4,
    });
    const firstReply = makeEvent('$thread-reply-1', {
      content: { body: 'thinking...' },
      threadRootId: threadId,
      ts: 2,
    });
    const threadedEdit = makeEvent('$thread-edit-1', {
      content: {
        body: '* edited reply',
        'm.new_content': {
          body: 'edited reply',
          msgtype: 'm.text',
        },
      },
      threadRootId: threadId,
      relation: { rel_type: 'm.replace', event_id: '$thread-reply-1' },
      ts: 3,
    });
    const editRedaction = makeEvent('$thread-edit-redaction', {
      associatedId: '$thread-edit-1',
      isRedaction: true,
      threadRootId: threadId,
      ts: 5,
    });
    const olderTimeline = makeTimeline([rootEvent, firstReply, threadedEdit, editRedaction]);
    const liveTimeline = makeTimeline([newerReply]);
    (
      olderTimeline as ReturnType<typeof makeTimeline> & {
        getNeighbouringTimeline: (direction: Direction) => ReturnType<typeof makeTimeline> | null;
      }
    ).getNeighbouringTimeline = (direction: Direction) =>
      direction === Direction.Forward ? liveTimeline : null;
    (
      liveTimeline as ReturnType<typeof makeTimeline> & {
        getNeighbouringTimeline: (direction: Direction) => ReturnType<typeof makeTimeline> | null;
      }
    ).getNeighbouringTimeline = (direction: Direction) =>
      direction === Direction.Backward ? olderTimeline : null;
    const room = makeRoom({
      liveTimeline,
      timelinesByEventId: new Map([
        [threadId, olderTimeline],
        ['$thread-reply-1', olderTimeline],
        ['$thread-edit-1', olderTimeline],
        ['$thread-edit-redaction', olderTimeline],
      ]),
    });

    expect(getLoadedRoomThreadEvents(room as never, threadId).map((event) => event.getId())).toEqual([
      '$thread-root',
      '$thread-reply-1',
      '$thread-reply-2',
    ]);
    expect(getLoadedRoomThreadSeedEvents(room as never, threadId).map((event) => event.getId())).toEqual(
      ['$thread-root', '$thread-reply-1', '$thread-edit-1', '$thread-reply-2', '$thread-edit-redaction']
    );
  });

  it('seeds thread fallback immediately from room-loaded replies for targeted opens before thread cache hydration resolves', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { hydrateCachedEvents } = await import('./eventCacheEditUtils');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const firstReply = makeEvent('$thread-reply-1', {
      content: { body: 'thinking...' },
      threadRootId: threadId,
      ts: 2,
    });
    const threadedEdit = makeEvent('$thread-edit-1', {
      content: {
        body: '* edited reply',
        'm.new_content': {
          body: 'edited reply',
          msgtype: 'm.text',
        },
      },
      threadRootId: threadId,
      relation: { rel_type: 'm.replace', event_id: '$thread-reply-1' },
      ts: 3,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      threadRootId: threadId,
      ts: 4,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([secondReply, threadedEdit, rootEvent, firstReply]),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let resolveCacheLoad:
      | ((value: { events: unknown[]; hasMoreBefore: boolean; beforeToken?: string | null }) => void)
      | undefined;
    vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCacheLoad = resolve;
        }) as ReturnType<typeof loadLatestCachedThreadEvents>
    );

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            eventId: '$thread-reply-1',
            threadId,
          })
        );
      });

      await waitForCondition(
        () => vi.mocked(hydrateCachedEvents).mock.calls.length > 0,
        50
      );
      expect(vi.mocked(hydrateCachedEvents)).toHaveBeenCalledWith({
        room,
        events: [rootEvent, firstReply, threadedEdit, secondReply],
        timelineSets: [room.getUnfilteredTimelineSet()],
      });
      expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
        rootEvent,
        firstReply,
        secondReply,
      ]);
    } finally {
      resolveCacheLoad?.({
        events: [],
        hasMoreBefore: false,
      });
      await act(async () => {
        await Promise.resolve();
      });
      renderer?.unmount();
    }
  });

  it('warms thread-open seed snapshots from room-preloaded thread events', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const firstReply = makeEvent('$thread-reply-1', {
      content: { body: 'thinking...' },
      threadRootId: threadId,
      ts: 2,
    });
    const threadedEdit = makeEvent('$thread-edit-1', {
      content: {
        body: '* edited reply',
        'm.new_content': {
          body: 'edited reply',
          msgtype: 'm.text',
        },
      },
      threadRootId: threadId,
      relation: { rel_type: 'm.replace', event_id: '$thread-reply-1' },
      ts: 3,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      threadRootId: threadId,
      ts: 4,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([secondReply, threadedEdit, firstReply, rootEvent], {
        backwardToken: null,
        forwardToken: null,
      }),
      findEventById: (eventId: string) =>
        [threadId, '$thread-reply-1', '$thread-reply-2'].includes(eventId)
          ? ({
              [threadId]: rootEvent,
              '$thread-reply-1': firstReply,
              '$thread-reply-2': secondReply,
            } as const)[eventId]
          : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
      });

      await waitForCondition(
        () => getThreadOpenSeedSnapshot(room as never, threadId).length === 4,
        50
      );

      expect(getThreadOpenSeedSnapshot(room as never, threadId).map((mEvent) => mEvent.getId())).toEqual([
        threadId,
        '$thread-reply-1',
        '$thread-edit-1',
        '$thread-reply-2',
      ]);
    } finally {
      renderer?.unmount();
    }
  });

  it('prioritizes large thread seeds from the room thread list even when they are outside the viewport', async () => {
    const { collectPriorityThreadSeedPrewarmRoots } = await import('./RoomTimeline');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 25,
          },
        },
      },
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent], {
        backwardToken: null,
        forwardToken: null,
      }),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    room.getThreads = () =>
      [
        {
          id: threadId,
          length: 25,
          rootEvent,
        },
      ] as never;
    const visibleSmallRoot = makeEvent('$visible-root', {
      isThreadRoot: true,
      ts: 5,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 2,
          },
        },
      },
    });

    expect(
      collectPriorityThreadSeedPrewarmRoots({
        room: room as never,
        threadFilteredEventEntries: [{ event: visibleSmallRoot }] as never,
        threadReplyCountMap: new Map(),
        threadResolutionMap: new Map(),
        rangeStart: 0,
        rangeEnd: 1,
      })
    ).toEqual([
      {
        threadId,
        replyCount: 25,
        visible: false,
      },
    ]);
  });

  it('prioritizes threads from the active overview range over larger off-screen room threads', async () => {
    const { collectPriorityThreadSeedPrewarmRoots } = await import('./RoomTimeline');
    const visibleRoots = Array.from({ length: 12 }, (_, index) =>
      makeEvent(`$thread-root-${index + 1}`, {
        isThreadRoot: true,
        ts: index + 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 25,
            },
          },
        },
      })
    );
    const largeOffscreenRoot = makeEvent('$thread-root-large-offscreen', {
      isThreadRoot: true,
      ts: 100,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 400,
          },
        },
      },
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([...visibleRoots, largeOffscreenRoot], {
        backwardToken: null,
        forwardToken: null,
      }),
    });
    room.getThreads = () =>
      [
        {
          id: largeOffscreenRoot.getId(),
          length: 400,
          rootEvent: largeOffscreenRoot,
        },
      ] as never;

    expect(
      collectPriorityThreadSeedPrewarmRoots({
        room: room as never,
        threadFilteredEventEntries: visibleRoots.map((event) => ({ event })) as never,
        threadReplyCountMap: new Map(),
        threadResolutionMap: new Map(),
        rangeStart: 10,
        rangeEnd: 12,
      }).slice(0, 2)
    ).toEqual([
      {
        threadId: '$thread-root-3',
        replyCount: 25,
        visible: true,
      },
      {
        threadId: '$thread-root-4',
        replyCount: 25,
        visible: true,
      },
    ]);
  });

  it('ignores room thread-list entries without a root event or known reply count', async () => {
    const { collectPriorityThreadSeedPrewarmRoots } = await import('./RoomTimeline');
    const visibleRoot = makeEvent('$visible-thread-root', {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 25,
          },
        },
      },
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([visibleRoot], {
        backwardToken: null,
        forwardToken: null,
      }),
    });
    room.getThreads = () =>
      [
        {
          id: '$thread-without-root',
          length: 0,
          rootEvent: undefined,
        },
      ] as never;

    expect(() =>
      collectPriorityThreadSeedPrewarmRoots({
        room: room as never,
        threadFilteredEventEntries: [{ event: visibleRoot }] as never,
        threadReplyCountMap: new Map(),
        threadResolutionMap: new Map(),
        rangeStart: 0,
        rangeEnd: 1,
      })
    ).not.toThrow();
  });

  it('seeds untargeted first open from the richer in-memory thread snapshot when room and model seeds are thinner', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { hydrateCachedEvents } = await import('./eventCacheEditUtils');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const firstReply = makeEvent('$thread-reply-1', {
      content: { body: 'thinking...' },
      threadRootId: threadId,
      ts: 2,
    });
    const threadedEdit = makeEvent('$thread-edit-1', {
      content: {
        body: '* edited reply',
        'm.new_content': {
          body: 'edited reply',
          msgtype: 'm.text',
        },
      },
      threadRootId: threadId,
      relation: { rel_type: 'm.replace', event_id: '$thread-reply-1' },
      ts: 3,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      threadRootId: threadId,
      ts: 4,
    });
    const thirdReply = makeEvent('$thread-reply-3', {
      threadRootId: threadId,
      ts: 5,
    });
    const threadTimeline = makeTimeline([rootEvent, secondReply], {
      backwardToken: null,
    });
    const threadTimelineSet = {
      getLiveTimeline: () => threadTimeline,
      getTimelineForEvent: (eventId: string) =>
        [threadId, '$thread-reply-2'].includes(eventId) ? threadTimeline : undefined,
    };
    const threadModel = {
      rootEvent,
      events: [secondReply],
      getUnfilteredTimelineSet: () => threadTimelineSet,
    };
    const room = makeRoom({
      liveTimeline: makeTimeline([threadedEdit, rootEvent, firstReply]),
      findEventById: (eventId: string) =>
        [threadId, '$thread-reply-1'].includes(eventId)
          ? ({
              [threadId]: rootEvent,
              '$thread-reply-1': firstReply,
            } as const)[eventId]
          : undefined,
    });
    room.getMember = ((userId: string) => ({ name: userId })) as never;
    room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    saveThreadOpenSeedSnapshot(room as never, threadId, [
      rootEvent,
      firstReply,
      threadedEdit,
      secondReply,
      thirdReply,
    ]);
    let resolveCacheLoad:
      | ((value: { events: unknown[]; hasMoreBefore: boolean; beforeToken?: string | null }) => void)
      | undefined;
    vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCacheLoad = resolve;
        }) as ReturnType<typeof loadLatestCachedThreadEvents>
    );

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
      });

      await waitForCondition(
        () =>
          threadRenderStateMock.setSupplementalThreadEvents.mock.calls.some(
            ([expectedThreadId, events]) =>
              expectedThreadId === threadId && Array.isArray(events) && events.length === 5
          ),
        50
      );

      expect(vi.mocked(hydrateCachedEvents)).toHaveBeenCalledWith({
        room,
        events: [rootEvent, firstReply, threadedEdit],
        timelineSets: [room.getUnfilteredTimelineSet()],
      });
      expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
        rootEvent,
        firstReply,
        threadedEdit,
        secondReply,
        thirdReply,
      ]);
    } finally {
      resolveCacheLoad?.({
        events: [],
        hasMoreBefore: false,
      });
      await act(async () => {
        await Promise.resolve();
      });
      renderer?.unmount();
    }
  });

  it('seeds untargeted thread reopen immediately from an existing local thread model before cache hydration resolves', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const firstReply = makeEvent('$thread-reply-1', {
      threadRootId: threadId,
      ts: 2,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      threadRootId: threadId,
      ts: 3,
    });
    const threadTimeline = makeTimeline([rootEvent, firstReply, secondReply], {
      backwardToken: null,
    });
    const threadTimelineSet = {
      getLiveTimeline: () => threadTimeline,
      getTimelineForEvent: (eventId: string) =>
        [threadId, '$thread-reply-1', '$thread-reply-2'].includes(eventId)
          ? threadTimeline
          : undefined,
    };
    const threadModel = {
      rootEvent,
      events: [firstReply, secondReply],
      getUnfilteredTimelineSet: () => threadTimelineSet,
    };
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    room.getThread = (eventId: string) => (eventId === threadId ? (threadModel as never) : null);
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let resolveCacheLoad:
      | ((value: { events: unknown[]; hasMoreBefore: boolean; beforeToken?: string | null }) => void)
      | undefined;
    vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCacheLoad = resolve;
        }) as ReturnType<typeof loadLatestCachedThreadEvents>
    );

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
      });

      await waitForCondition(
        () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
        50
      );
      expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
        rootEvent,
        firstReply,
        secondReply,
      ]);
    } finally {
      resolveCacheLoad?.({
        events: [],
        hasMoreBefore: false,
      });
      await act(async () => {
        await Promise.resolve();
      });
      renderer?.unmount();
    }
  });

  it('reuses the in-memory thread snapshot on untargeted reopen before cache hydration resolves', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 2,
          },
        },
      },
    });
    const firstReply = makeEvent('$thread-reply-1', {
      threadRootId: threadId,
      ts: 2,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      threadRootId: threadId,
      ts: 3,
    });
    const partialThreadTimeline = makeTimeline([rootEvent, firstReply], {
      backwardToken: null,
    });
    const partialThreadTimelineSet = {
      getLiveTimeline: () => partialThreadTimeline,
      getTimelineForEvent: (eventId: string) =>
        [threadId, '$thread-reply-1'].includes(eventId) ? partialThreadTimeline : undefined,
    };
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    room.getThread = (eventId: string) =>
      eventId === threadId
        ? ({
            rootEvent,
            events: [firstReply],
            getUnfilteredTimelineSet: () => partialThreadTimelineSet,
          } as never)
        : null;
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    saveThreadOpenSeedSnapshot(room as never, threadId, [firstReply, secondReply]);
    expect(getThreadOpenSeedSnapshot(room as never, threadId).map((mEvent) => mEvent.getId())).toEqual([
      '$thread-reply-1',
      '$thread-reply-2',
    ]);

    let resolveCacheLoad:
      | ((value: { events: unknown[]; hasMoreBefore: boolean; beforeToken?: string | null }) => void)
      | undefined;
    vi.mocked(loadLatestCachedThreadEvents).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCacheLoad = resolve;
        }) as ReturnType<typeof loadLatestCachedThreadEvents>
    );

    let secondRenderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        secondRenderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
      });

      await waitForCondition(
        () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
        50
      );
      const reopenCall = threadRenderStateMock.setSupplementalThreadEvents.mock.calls.find(
        ([expectedThreadId]) => expectedThreadId === threadId
      );
      expect(reopenCall).toBeDefined();
      expect(
        (reopenCall?.[1] as { getId?: () => string }[]).map((mEvent) => mEvent?.getId?.())
      ).toEqual([threadId, '$thread-reply-1', '$thread-reply-2']);
    } finally {
      resolveCacheLoad?.({
        events: [],
        hasMoreBefore: false,
      });
      await act(async () => {
        await Promise.resolve();
      });
      secondRenderer?.unmount();
    }
  });

  it('hydrates every cached thread page before falling back to network bootstrap', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadCachedThreadEventsBefore, loadLatestCachedThreadEvents } = await import(
      './threadEventCache'
    );
    const threadId = '$thread-root';
    const room = makeRoom();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: undefined,
      events: [
        {
          content: {
            body: 'reply-3',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-3',
          origin_server_ts: 3,
        },
      ],
      hasMoreBefore: true,
      rootEvent: undefined,
      snapshotComplete: false,
      tailLoaded: false,
    } as never);
    vi.mocked(loadCachedThreadEventsBefore).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 1,
        },
        {
          content: {
            body: 'reply-2',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 2,
        },
      ],
      hasMoreBefore: false,
      rootEvent: undefined,
      snapshotComplete: false,
      tailLoaded: false,
    } as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () =>
          threadRenderStateMock.setSupplementalThreadEvents.mock.calls.some(
            ([expectedThreadId, events]) =>
              expectedThreadId === threadId &&
              Array.isArray(events) &&
              events.length === 3
          ),
        50
      );

      expect(loadCachedThreadEventsBefore).toHaveBeenCalledTimes(1);
      expect(threadRenderStateMock.setSupplementalThreadEvents).toHaveBeenCalledWith(threadId, [
        expect.objectContaining({ getId: expect.any(Function) }),
        expect.objectContaining({ getId: expect.any(Function) }),
        expect.objectContaining({ getId: expect.any(Function) }),
      ]);
      const latestCall = threadRenderStateMock.setSupplementalThreadEvents.mock.calls
        .filter(([expectedThreadId]) => expectedThreadId === threadId)
        .at(-1);
      expect(latestCall?.[1].map((event: ReturnType<typeof makeEvent>) => event.getId())).toEqual([
        '$thread-reply-1',
        '$thread-reply-2',
        '$thread-reply-3',
      ]);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('skips thread bootstrap and edit backfill on untargeted open when cached thread hydrate is complete', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const room = makeRoom();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    threadRenderStateMock.threadEvents = [
      makeEvent(threadId, {
        isThreadRoot: true,
        ts: 1,
      }),
      makeEvent('$thread-reply-1', {
        threadRootId: threadId,
        ts: 2,
      }),
    ];
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'root',
            msgtype: 'm.text',
          },
          event_id: threadId,
          origin_server_ts: 1,
        },
        {
          content: {
            body: 'reply',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
        },
      ],
      hasMoreBefore: false,
      rootEvent: undefined,
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
        50
      );

      expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.fetchRelations).not.toHaveBeenCalled();
      expect(matrixClientMock.getThreadTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.relations).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('prefers cached thread hydrate over a tiny room seed on untargeted open', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const roomSeedReply = makeEvent('$room-seed-reply', {
      threadRootId: threadId,
      ts: 2,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, roomSeedReply]),
      findEventById: (eventId: string) =>
        eventId === threadId ? rootEvent : eventId === '$room-seed-reply' ? roomSeedReply : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'cached reply 1',
            msgtype: 'm.text',
          },
          event_id: '$cached-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'cached reply 2',
            msgtype: 'm.text',
          },
          event_id: '$cached-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
      },
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [
        {
          content: {
            body: 'reply-3',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-3',
          origin_server_ts: 4,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-1',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
      ],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
        50
      );

      const threadCalls = threadRenderStateMock.setSupplementalThreadEvents.mock.calls.filter(
        ([expectedThreadId]) => expectedThreadId === threadId
      );
      expect(threadCalls.length).toBeGreaterThan(0);
      expect(
        threadCalls.at(-1)?.[1].map((event: ReturnType<typeof makeEvent>) => event.getId())
      ).toEqual(['$cached-reply-1', '$cached-reply-2']);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('repairs complete cached thread snapshots that are missing relation hydration', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents, saveThreadEventsToCache } = await import(
      './threadEventCache'
    );
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 1,
          },
        },
      },
    });
    const room = makeRoom({
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            sender?: string;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                relation: rawEvent.content?.['m.relates_to'] as
                  | { rel_type?: string; event_id?: string }
                  | undefined,
                sender: rawEvent.sender,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
                unsigned: rawEvent.unsigned,
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'Thinking...  ⋯',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
          sender: '@bot:example.org',
        },
      ],
      hasMoreBefore: false,
      relationSnapshotComplete: false,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
        sender: '@alice:example.org',
      },
      snapshotComplete: true,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [
        {
          content: {
            body: 'Thinking...  ⋯',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
          sender: '@bot:example.org',
        },
        {
          content: {
            'm.new_content': {
              body: 'Final answer',
              msgtype: 'm.text',
            },
            'm.relates_to': {
              event_id: '$thread-reply-1',
              rel_type: 'm.replace',
            },
            body: '* Final answer',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1-edit',
          origin_server_ts: 3,
          sender: '@bot:example.org',
        },
      ],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => matrixClientMock.fetchRelations.mock.calls.length > 0, 200);

      expect(matrixClientMock.fetchRelations).toHaveBeenCalledWith(
        '!room:example.org',
        threadId,
        null,
        null,
        expect.objectContaining({
          dir: Direction.Backward,
          limit: 200,
          recurse: true,
        })
      );
      expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.getThreadTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
      expect(
        vi.mocked(saveThreadEventsToCache).mock.calls.some(
          (call) => call[2] === threadId && call[9] === true
        )
      ).toBe(true);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('infers a complete cached thread snapshot from the persisted expected reply count when root counts are sparse', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const room = makeRoom({
      findEventById: (eventId: string) =>
        eventId === threadId
          ? makeEvent(threadId, {
              isThreadRoot: true,
              ts: 1,
            })
          : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
                unsigned: rawEvent.unsigned,
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      expectedReplyCount: 2,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
      },
      relationSnapshotComplete: true,
      snapshotComplete: false,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [
        {
          content: {
            body: 'reply-3',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-3',
          origin_server_ts: 4,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-1',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
      ],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
        50
      );

      expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.fetchRelations).not.toHaveBeenCalled();
      expect(matrixClientMock.getThreadTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('does not trust stale complete cache flags when the persisted expected reply count is larger than the cached reply set', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const room = makeRoom({
      findEventById: (eventId: string) =>
        eventId === threadId
          ? makeEvent(threadId, {
              isThreadRoot: true,
              ts: 1,
            })
          : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      expectedReplyCount: 3,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
      },
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    } as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => matrixClientMock.fetchRelations.mock.calls.length > 0, 50);
      expect(matrixClientMock.fetchRelations).toHaveBeenCalled();
      expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('prefers fresher room root counts over stale cached root counts when checking complete cached thread snapshots', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents, saveThreadEventsToCache } = await import(
      './threadEventCache'
    );
    const threadId = '$thread-root';
    const room = makeRoom({
      findEventById: (eventId: string) =>
        eventId === threadId
          ? makeEvent(threadId, {
              isThreadRoot: true,
              ts: 1,
              unsigned: {
                'm.relations': {
                  'm.thread': {
                    count: 3,
                  },
                },
              },
            })
          : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
                unsigned: rawEvent.unsigned,
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      expectedReplyCount: 2,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 2,
            },
          },
        },
      },
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [
        {
          content: {
            body: 'reply-3',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-3',
          origin_server_ts: 4,
          'm.thread.root': threadId,
        },
      ],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => matrixClientMock.fetchRelations.mock.calls.length > 0, 50);
      expect(matrixClientMock.fetchRelations).toHaveBeenCalled();
      expect(
        vi.mocked(saveThreadEventsToCache).mock.calls.some(
          (call) => call[2] === threadId && call[8] === 3 && call[9] === true
        )
      ).toBe(true);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('falls back to the cached root count when the fresher room root is sparse', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const room = makeRoom({
      findEventById: (eventId: string) =>
        eventId === threadId
          ? makeEvent(threadId, {
              isThreadRoot: true,
              ts: 1,
            })
          : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
                unsigned: rawEvent.unsigned,
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      expectedReplyCount: undefined,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 2,
            },
          },
        },
      },
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    } as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () => threadRenderStateMock.setSupplementalThreadEvents.mock.calls.length > 0,
        50
      );

      expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.fetchRelations).not.toHaveBeenCalled();
      expect(matrixClientMock.getThreadTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('fills incomplete cached thread snapshots from thread relations before falling back to sdk bootstrap', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents, saveThreadEventsToCache } = await import(
      './threadEventCache'
    );
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 3,
          },
        },
      },
    });
    const staleThreadTimeline = makeTimeline([rootEvent], {
      backwardToken: 'stale-backward-token',
    });
    const threadTimelineSet = {
      getLiveTimeline: () => staleThreadTimeline,
      getTimelineForEvent: (eventId: string) =>
        eventId === threadId ? staleThreadTimeline : undefined,
    };
    (
      staleThreadTimeline as ReturnType<typeof makeTimeline> & {
        getTimelineSet?: () => typeof threadTimelineSet;
      }
    ).getTimelineSet = () => threadTimelineSet;
    const room = makeRoom({
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    room.getThread = () =>
      ({
        events: [rootEvent],
        getUnfilteredTimelineSet: () => threadTimelineSet,
        rootEvent,
      }) as never;
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
                unsigned: rawEvent.unsigned,
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      expectedReplyCount: 3,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 3,
            },
          },
        },
      },
      snapshotComplete: false,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [
        {
          content: {
            body: 'reply-3',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-3',
          origin_server_ts: 4,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-2',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-2',
          origin_server_ts: 3,
          'm.thread.root': threadId,
        },
        {
          content: {
            body: 'reply-1',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
      ],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);

      expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(1);
      expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.getThreadTimeline).not.toHaveBeenCalled();
      expect(matrixClientMock.paginateEventTimeline).not.toHaveBeenCalled();
      expect(staleThreadTimeline.getPaginationToken(Direction.Backward)).toBeNull();
      expect(vi.mocked(saveThreadEventsToCache)).toHaveBeenCalledWith(
        expect.any(String),
        room.roomId,
        threadId,
        expect.arrayContaining([
          expect.objectContaining({ event_id: threadId }),
          expect.objectContaining({ event_id: '$thread-reply-1' }),
          expect.objectContaining({ event_id: '$thread-reply-2' }),
          expect.objectContaining({ event_id: '$thread-reply-3' }),
        ]),
        expect.objectContaining({ event_id: threadId }),
        null,
        true,
        true,
        3,
        true
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('does not treat an empty relations backfill as complete when the known reply count is still unmet', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents, saveThreadEventsToCache } = await import(
      './threadEventCache'
    );
    const threadId = '$thread-root-empty-backfill';
    const firstReplyId = '$thread-reply-1-empty-backfill';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 3,
          },
        },
      },
    });
    const firstReply = makeEvent(firstReplyId, {
      content: { body: 'reply-1' },
      threadRootId: threadId,
      ts: 2,
    });
    const threadTimeline = makeTimeline([rootEvent, firstReply]);
    const threadTimelineSet = {
      getLiveTimeline: () => threadTimeline,
      getTimelineForEvent: (eventId: string) =>
        eventId === threadId || eventId === firstReplyId ? threadTimeline : undefined,
    };
    const room = makeRoom({
      findEventById: (eventId: string) => {
        if (eventId === threadId) return rootEvent;
        if (eventId === firstReplyId) return firstReply;
        return undefined;
      },
    });
    room.getThread = () =>
      ({
        events: [rootEvent, firstReply],
        getUnfilteredTimelineSet: () => threadTimelineSet,
        rootEvent,
      }) as never;
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    matrixClientMock.getEventMapper.mockImplementation(
      () =>
        (
          rawEvent: {
            content?: Record<string, unknown>;
            event_id?: string;
            origin_server_ts?: number;
            ['m.thread.root']?: string;
            unsigned?: Record<string, unknown>;
          }
        ) =>
          typeof rawEvent?.event_id === 'string'
            ? makeEvent(rawEvent.event_id, {
                content: rawEvent.content,
                ts: rawEvent.origin_server_ts ?? 0,
                threadRootId: rawEvent['m.thread.root'],
                unsigned: rawEvent.unsigned,
              })
            : rawEvent
    );
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply-1',
            'm.relates_to': {
              event_id: threadId,
              rel_type: 'm.thread',
            },
            msgtype: 'm.text',
          },
          event_id: firstReplyId,
          origin_server_ts: 2,
          'm.thread.root': threadId,
        },
      ],
      hasMoreBefore: false,
      expectedReplyCount: 3,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
        unsigned: {
          'm.relations': {
            'm.thread': {
              count: 3,
            },
          },
        },
      },
      relationSnapshotComplete: true,
      snapshotComplete: false,
      tailLoaded: true,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      expect(matrixClientMock.fetchRelations).toHaveBeenCalledTimes(1);
      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(vi.mocked(saveThreadEventsToCache)).toHaveBeenCalledWith(
        expect.any(String),
        room.roomId,
        threadId,
        expect.arrayContaining([expect.objectContaining({ event_id: firstReplyId })]),
        expect.objectContaining({ event_id: threadId }),
        null,
        true,
        false,
        3,
        true
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('clears stale sdk backward tokens on complete cached thread hydrate', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const threadReply = makeEvent('$thread-reply-1', {
      threadRootId: threadId,
      ts: 2,
    });
    const staleThreadTimeline = makeTimeline([rootEvent, threadReply], {
      backwardToken: 'stale-backward-token',
    });
    const threadTimelineSet = {
      getLiveTimeline: () => staleThreadTimeline,
      getTimelineForEvent: (eventId: string) =>
        eventId === threadId || eventId === '$thread-reply-1' ? staleThreadTimeline : undefined,
    };
    (
      staleThreadTimeline as ReturnType<typeof makeTimeline> & {
        getTimelineSet?: () => typeof threadTimelineSet;
      }
    ).getTimelineSet = () => threadTimelineSet;
    const room = makeRoom({
      findEventById: (eventId: string) => {
        if (eventId === threadId) return rootEvent;
        if (eventId === '$thread-reply-1') return threadReply;
        return undefined;
      },
    });
    room.getThread = () =>
      ({
        events: [rootEvent, threadReply],
        getUnfilteredTimelineSet: () => threadTimelineSet,
        rootEvent,
      }) as never;
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'root',
            msgtype: 'm.text',
          },
          event_id: threadId,
          origin_server_ts: 1,
        },
        {
          content: {
            body: 'reply',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
        },
      ],
      hasMoreBefore: false,
      rootEvent: undefined,
      relationSnapshotComplete: true,
      snapshotComplete: true,
      tailLoaded: true,
    } as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () => staleThreadTimeline.getPaginationToken(Direction.Backward) === null,
        50
      );

      expect(staleThreadTimeline.getPaginationToken(Direction.Backward)).toBeNull();
      expect(() => getClickableByText(renderer!, 'Load Older Messages')).toThrow();
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('does not treat a sparse cached thread page as complete without a loaded tail marker', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { loadLatestCachedThreadEvents } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const room = makeRoom();
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    vi.mocked(loadLatestCachedThreadEvents).mockResolvedValueOnce({
      beforeToken: null,
      events: [
        {
          content: {
            body: 'reply',
            msgtype: 'm.text',
          },
          event_id: '$thread-reply-1',
          origin_server_ts: 2,
        },
      ],
      hasMoreBefore: false,
      rootEvent: {
        content: {
          body: 'root',
          msgtype: 'm.text',
        },
        event_id: threadId,
        origin_server_ts: 1,
      },
      snapshotComplete: false,
      tailLoaded: false,
    } as never);
    matrixClientMock.fetchRelations.mockResolvedValueOnce({
      chunk: [],
      next_batch: null,
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => matrixClientMock.fetchRelations.mock.calls.length > 0, 50);
      expect(matrixClientMock.fetchRelations).toHaveBeenCalled();
      expect(matrixClientMock.getEventTimeline).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('marks room-derived thread cache snapshots complete only when the known reply count is satisfied', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 1,
          },
        },
      },
    });
    const threadedReply = makeEvent('$thread-reply-1', {
      content: { body: 'reply' },
      threadRootId: threadId,
      ts: 2,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, threadedReply]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(vi.mocked(saveThreadEventsToCache)).toHaveBeenCalledWith(
        expect.any(String),
        room.roomId,
        threadId,
        expect.arrayContaining([
          expect.objectContaining({ event_id: threadId }),
          expect.objectContaining({ event_id: '$thread-reply-1' }),
        ]),
        expect.objectContaining({ event_id: threadId }),
        null,
        true,
        true,
        1,
        undefined
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('keeps room-derived thread cache snapshots incomplete when only a subset of replies is loaded', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 5,
          },
        },
      },
    });
    const firstReply = makeEvent('$thread-reply-1', {
      content: { body: 'reply-1' },
      threadRootId: threadId,
      ts: 2,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      content: { body: 'reply-2' },
      threadRootId: threadId,
      ts: 3,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, firstReply, secondReply]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(vi.mocked(saveThreadEventsToCache)).toHaveBeenCalledWith(
        expect.any(String),
        room.roomId,
        threadId,
        expect.arrayContaining([
          expect.objectContaining({ event_id: threadId }),
          expect.objectContaining({ event_id: '$thread-reply-1' }),
          expect.objectContaining({ event_id: '$thread-reply-2' }),
        ]),
        expect.objectContaining({ event_id: threadId }),
        undefined,
        true,
        false,
        5,
        undefined
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('does not downgrade room-derived thread cache completeness when the room tail is still unknown', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
      unsigned: {
        'm.relations': {
          'm.thread': {
            count: 5,
          },
        },
      },
    });
    const firstReply = makeEvent('$thread-reply-1', {
      content: { body: 'reply-1' },
      threadRootId: threadId,
      ts: 2,
    });
    const secondReply = makeEvent('$thread-reply-2', {
      content: { body: 'reply-2' },
      threadRootId: threadId,
      ts: 3,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, firstReply, secondReply], {
        forwardToken: 'forward-gap',
      }),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(vi.mocked(saveThreadEventsToCache)).toHaveBeenCalledWith(
        expect.any(String),
        room.roomId,
        threadId,
        expect.arrayContaining([
          expect.objectContaining({ event_id: threadId }),
          expect.objectContaining({ event_id: '$thread-reply-1' }),
          expect.objectContaining({ event_id: '$thread-reply-2' }),
        ]),
        expect.objectContaining({ event_id: threadId }),
        undefined,
        undefined,
        undefined,
        5,
        undefined
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('does not treat sdk thread length as authoritative when root counts are sparse', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const threadedReply = makeEvent('$thread-reply-1', {
      content: { body: 'reply' },
      threadRootId: threadId,
      ts: 2,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, threadedReply]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    room.getThread = () =>
      ({
        length: 1,
      }) as never;
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(vi.mocked(saveThreadEventsToCache)).toHaveBeenCalledWith(
        expect.any(String),
        room.roomId,
        threadId,
        expect.arrayContaining([
          expect.objectContaining({ event_id: threadId }),
          expect.objectContaining({ event_id: '$thread-reply-1' }),
        ]),
        expect.objectContaining({ event_id: threadId }),
        undefined,
        true,
        undefined,
        undefined,
        undefined
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('persists root-targeted relations into the thread cache during room cache persistence', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const reactionEvent = makeEvent('$thread-root-reaction', {
      associatedId: threadId,
      relation: { event_id: threadId, rel_type: 'm.annotation' },
      ts: 2,
      type: 'm.reaction',
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, reactionEvent]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(
        vi
          .mocked(saveThreadEventsToCache)
          .mock.calls.some(
            ([, , expectedThreadId, rawEvents]) =>
              expectedThreadId === threadId &&
              Array.isArray(rawEvents) &&
              rawEvents.some(
                (rawEvent) =>
                  typeof rawEvent?.event_id === 'string' &&
                  rawEvent.event_id === '$thread-root-reaction'
              )
          )
      ).toBe(true);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('persists redactions targeting thread replies into the thread cache during room cache persistence', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const replyEvent = makeEvent('$thread-reply-1', {
      content: { body: 'reply' },
      threadRootId: threadId,
      ts: 2,
    });
    const redactionEvent = makeEvent('$thread-reply-1-redaction', {
      associatedId: '$thread-reply-1',
      isRedaction: true,
      ts: 3,
      type: 'm.room.redaction',
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent, replyEvent, redactionEvent]),
      findEventById: (eventId: string) =>
        eventId === threadId ? rootEvent : eventId === '$thread-reply-1' ? replyEvent : undefined,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      await waitForCondition(() => vi.mocked(saveThreadEventsToCache).mock.calls.length > 0, 50);
      expect(
        vi
          .mocked(saveThreadEventsToCache)
          .mock.calls.some(
            ([, , expectedThreadId, rawEvents]) =>
              expectedThreadId === threadId &&
              Array.isArray(rawEvents) &&
              rawEvents.some(
                (rawEvent) =>
                  typeof rawEvent?.event_id === 'string' &&
                  rawEvent.event_id === '$thread-reply-1-redaction'
              )
          )
      ).toBe(true);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('persists paginated thread-only room events into the thread cache', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const { saveThreadEventsToCache } = await import('./threadEventCache');
    const threadId = '$thread-root';
    const rootEvent = makeEvent(threadId, {
      isThreadRoot: true,
      ts: 1,
    });
    const paginatedReply = makeEvent('$thread-reply-paginated', {
      content: { body: 'older reply' },
      threadRootId: threadId,
      ts: 2,
    });
    const room = makeRoom({
      liveTimeline: makeTimeline([rootEvent]),
      findEventById: (eventId: string) => (eventId === threadId ? rootEvent : undefined),
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
          })
        );
        await flushAsyncWork(10);
      });

      const timelineHandler = room.__listeners.get(RoomEvent.Timeline);
      expect(timelineHandler).toBeTypeOf('function');

      await act(async () => {
        timelineHandler?.(paginatedReply, room, true, false, {
          liveEvent: false,
        });
        await flushAsyncWork(10);
      });

      await waitForCondition(
        () =>
          vi.mocked(saveThreadEventsToCache).mock.calls.some(
            ([, , expectedThreadId, rawEvents]) =>
              expectedThreadId === threadId &&
              Array.isArray(rawEvents) &&
              rawEvents.some(
                (rawEvent) =>
                  typeof rawEvent?.event_id === 'string' &&
                  rawEvent.event_id === '$thread-reply-paginated'
              )
          ),
        50
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(2);
      });
    }
  });

  it('filters room events by thread resolution state', async () => {
    const { getThreadFilteredEvents } = await import('./RoomTimeline');
    const room = makeRoom();
    const unresolvedEvent = makeEvent('$thread-unresolved', { isThreadRoot: true });
    const resolvedEvent = makeEvent('$thread-resolved', { isThreadRoot: true });
    const messageEvent = makeEvent('$message');
    const renderableEvents = [messageEvent, unresolvedEvent, resolvedEvent];
    const resolutionMap = new Map([['$thread-resolved', { isResolved: true }]]);
    const threadMetadataMap = new Map<string, import('./roomThreadOverviewModel').ThreadOverviewMetadata>([
      ['$thread-unresolved', { isResolved: false, isUnread: false, isStreaming: false, scheduledTaskCount: 0, lastActivityTs: 0, absoluteIndex: 0, lastSenderId: undefined, lastSenderDisplayName: undefined, participantDisplayName: undefined, summaryText: undefined, rootPreviewText: undefined, messageCount: 0, tags: [] }],
      ['$thread-resolved', { isResolved: true, isUnread: false, isStreaming: false, scheduledTaskCount: 0, lastActivityTs: 0, absoluteIndex: 0, lastSenderId: undefined, lastSenderDisplayName: undefined, participantDisplayName: undefined, summaryText: undefined, rootPreviewText: undefined, messageCount: 0, tags: [] }],
    ]);

    expect(
      getThreadFilteredEvents(
        renderableEvents as never,
        room as never,
        resolutionMap,
        undefined,
        { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'exclude' as const, tags: new Map() },
        undefined,
        threadMetadataMap
      ).map((event) => event.getId())
    ).toEqual(['$thread-unresolved']);
    expect(
      getThreadFilteredEvents(
        renderableEvents as never,
        room as never,
        resolutionMap,
        undefined,
        { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'include' as const, tags: new Map() },
        undefined,
        threadMetadataMap
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
    const makeMeta = (isResolved: boolean): import('./roomThreadOverviewModel').ThreadOverviewMetadata => ({
      isResolved, isUnread: false, isStreaming: false, scheduledTaskCount: 0, lastActivityTs: 0, absoluteIndex: 0, lastSenderId: undefined, lastSenderDisplayName: undefined, participantDisplayName: undefined, summaryText: undefined, rootPreviewText: undefined, messageCount: 0, tags: [],
    });

    expect(
      getThreadFilteredEvents(
        [messageEvent, fallbackRoot] as never,
        room as never,
        resolutionMap,
        undefined,
        { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'exclude' as const, tags: new Map() },
        fallbackCounts,
        new Map([['$thread-root', makeMeta(false)]])
      ).map((event) => event.getId())
    ).toEqual(['$thread-root']);

    resolutionMap.set(fallbackRoot.getId(), { isResolved: true, tags: null });
    expect(
      getThreadFilteredEvents(
        [messageEvent, fallbackRoot] as never,
        room as never,
        resolutionMap,
        undefined,
        { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'include' as const, tags: new Map() },
        fallbackCounts,
        new Map([['$thread-root', makeMeta(true)]])
      ).map((event) => event.getId())
    ).toEqual(['$thread-root']);
  });

  it('does not treat thread replies as visible thread roots for filtering', async () => {
    const { getThreadFilteredEvents } = await import('./RoomTimeline');
    const room = makeRoom();
    const fakeReply = makeEvent('$reply-event', {
      threadRootId: '$actual-root',
    });
    const actualRoot = makeEvent('$actual-root');
    const fallbackCounts = new Map([
      [fakeReply.getId(), 1],
      [actualRoot.getId(), 1],
    ]);
    const resolutionMap = new Map<string, { isResolved: boolean }>([
      ['$reply-event', { isResolved: false, tags: null }],
      ['$actual-root', { isResolved: false, tags: null }],
    ]);
    const makeMeta = (): import('./roomThreadOverviewModel').ThreadOverviewMetadata => ({
      isResolved: false,
      isUnread: false,
      isStreaming: false,
      scheduledTaskCount: 0,
      lastActivityTs: 0,
      absoluteIndex: 0,
      lastSenderId: undefined,
      lastSenderDisplayName: undefined,
      participantDisplayName: undefined,
      summaryText: undefined,
      rootPreviewText: undefined,
      messageCount: 0,
      tags: [],
    });

    expect(
      getThreadFilteredEvents(
        [fakeReply, actualRoot] as never,
        room as never,
        resolutionMap,
        undefined,
        { ...DEFAULT_THREAD_FILTER_STATE, resolved: 'exclude' as const, tags: new Map() },
        fallbackCounts,
        new Map([
          ['$reply-event', makeMeta()],
          ['$actual-root', makeMeta()],
        ])
      ).map((event) => event.getId())
    ).toEqual(['$actual-root']);
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

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
      renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
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

    await waitForCondition(
      () =>
        virtualPaginatorState.lastOptions?.count === 3 &&
        virtualPaginatorState.lastOptions?.range?.start === 0 &&
        virtualPaginatorState.lastOptions?.range?.end === 3,
      50
    );
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

    await act(async () => {
      virtualPaginatorState.lastOptions?.onRangeChange({ start: 0, end: 10 });
      await flushAsyncWork(1);
    });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
      renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
      await flushAsyncWork(1);
    });

    expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 0, end: 1 });

    await act(async () => {
      renderer?.root.findByType(roomThreadOverviewType).props.onReset();
      await flushAsyncWork(1);
    });

    await waitForCondition(
      () =>
        virtualPaginatorState.lastOptions?.range?.start === 5 &&
        virtualPaginatorState.lastOptions?.range?.end === 305,
      50
    );
    expect(virtualPaginatorState.lastOptions?.range).toEqual({ start: 5, end: 305 });
  });

  it('keeps the active filter when jumping to an unread event hidden by the overview', async () => {
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
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true, tags: null });
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
      renderer?.root.findByType(roomThreadOverviewType).props.onToggle('resolved');
      await flushAsyncWork(1);
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('include');

    const jumpToUnread = getClickableByText(renderer!, 'Jump to Unread');

    await act(async () => {
      jumpToUnread.props.onClick();
      await flushAsyncWork();
    });

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('include');
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
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true, tags: null });
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

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('include');
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
    threadResolutionMapMock.set(visibleResolvedThread.getId(), { isResolved: true, tags: null });
    threadResolutionMapMock.set(olderResolvedThread.getId(), { isResolved: true, tags: null });
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

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('include');
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

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('exclude');
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

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('exclude');
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
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true, tags: null });
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

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('include');
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
    threadResolutionMapMock.set(visibleResolvedThread.getId(), { isResolved: true, tags: null });
    threadResolutionMapMock.set(olderResolvedThread.getId(), { isResolved: true, tags: null });
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

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('include');
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

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('exclude');
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

    expect(renderer?.root.findByType(roomThreadOverviewType).props.state.resolved).toBe('exclude');
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
        threadResolutionMap: threadResolutionMapMock as never,
        threadId: undefined,
        threadFilterState: {
          ...DEFAULT_THREAD_FILTER_STATE,
          resolved: 'exclude' as const,
          tags: new Map(),
        },
        scheduledTaskCounts: new Map(),
        threadReplyCountMapForMeta: new Map(),
        threadParticipantMap: new Map(),
        summaryMap: new Map(),
        currentUserId: '@alice:example.org',
        readUpToTs: undefined,
      })
    ).toEqual({
      index: 1,
      count: 2,
      canFocus: true,
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

  it('does not focus room events hidden by the active filter', async () => {
    const { getRoomEventFocusTarget } = await import('./RoomTimeline');
    const unresolvedThread = makeEvent('$thread-unresolved', { isThreadRoot: true });
    const resolvedThread = makeEvent('$thread-resolved', { isThreadRoot: true });
    const room = makeRoom();
    threadResolutionMapMock.set(resolvedThread.getId(), { isResolved: true, tags: null });

    expect(
      getRoomEventFocusTarget({
        eventId: resolvedThread.getId(),
        renderableEvents: [unresolvedThread, resolvedThread] as never,
        room: room as never,
        threadResolutionMap: threadResolutionMapMock,
        threadId: undefined,
        threadFilterState: {
          ...DEFAULT_THREAD_FILTER_STATE,
          resolved: 'exclude' as const,
          tags: new Map(),
        },
        scheduledTaskCounts: new Map(),
        threadReplyCountMapForMeta: new Map(),
        threadParticipantMap: new Map(),
        summaryMap: new Map(),
        currentUserId: '@alice:example.org',
        readUpToTs: undefined,
      })
    ).toEqual({
      index: 0,
      count: 1,
      canFocus: false,
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

  it('shows Jump to Latest when timeline is not at live end (non-live navigation)', async () => {
    isTimelineAtLiveEndMock.mockReturnValue(false);
    const { RoomTimeline } = await import('./RoomTimeline');
    const room = makeRoom({ liveEvents: [makeEvent('$1')] });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    try {
      await act(async () => {
        renderer = create(React.createElement(ControlledRoomTimeline, { room }));
        await flushAsyncWork();
      });

      const jumpLabels = renderer!.root.findAll(
        (node) => {
          try {
            return node.children.includes('Jump to Latest');
          } catch {
            return false;
          }
        }
      );
      expect(jumpLabels.length).toBeGreaterThan(0);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    }
  });

  it('recovery effect hides Jump to Latest when anchor is visible and timelineAtLiveEnd flips to true', async () => {
    isTimelineAtLiveEndMock.mockReturnValue(false);
    const { RoomTimeline } = await import('./RoomTimeline');
    const room = makeRoom({ liveEvents: [makeEvent('$1')] });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    const createNodeMock = (element: { type: string }) => {
      if (element.type === scrollType) {
        return { getBoundingClientRect: () => ({ bottom: 500 }) };
      }
      if (element.type === 'span') {
        return { getBoundingClientRect: () => ({ top: 400 }) };
      }
      return null;
    };

    try {
      // Render with timelineAtLiveEnd=false → atBottom=false → button visible
      await act(async () => {
        renderer = create(React.createElement(ControlledRoomTimeline, { room }), {
          createNodeMock,
        });
        await flushAsyncWork();
      });

      const findJumpLabels = () =>
        renderer!.root.findAll((node) => {
          try {
            return node.children.includes('Jump to Latest');
          } catch {
            return false;
          }
        });

      expect(findJumpLabels().length).toBeGreaterThan(0);

      // Flip timelineAtLiveEnd to true and re-render.
      // The recovery useEffect sees anchor visible → setAtBottom(true) → button hides.
      isTimelineAtLiveEndMock.mockReturnValue(true);
      await act(async () => {
        renderer!.update(React.createElement(ControlledRoomTimeline, { room }));
        await flushAsyncWork();
      });

      expect(findJumpLabels().length).toBe(0);
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    }
  });

  it('isAnchorVisibleInScroll returns true when anchor is within scroll bounds plus margin', async () => {
    const { isAnchorVisibleInScroll } = await import('./RoomTimeline');

    const anchor = { getBoundingClientRect: () => ({ top: 500 }) } as Element;
    const scroll = { getBoundingClientRect: () => ({ bottom: 450 }) } as Element;
    expect(isAnchorVisibleInScroll(anchor, scroll, 100)).toBe(true);
  });

  it('isAnchorVisibleInScroll returns false when anchor is below scroll bounds plus margin', async () => {
    const { isAnchorVisibleInScroll } = await import('./RoomTimeline');

    const anchor = { getBoundingClientRect: () => ({ top: 600 }) } as Element;
    const scroll = { getBoundingClientRect: () => ({ bottom: 450 }) } as Element;
    expect(isAnchorVisibleInScroll(anchor, scroll, 100)).toBe(false);
  });
});

describe('fetchAllThreadRelations', () => {
  const makeRawEvent = (eventId: string, ts: number) => ({
    event_id: eventId,
    origin_server_ts: ts,
    content: { body: eventId },
  });

  const makeFetchMx = () => {
    const mapper = (raw: { event_id?: string; origin_server_ts?: number }) =>
      makeEvent(raw.event_id ?? '', { ts: raw.origin_server_ts ?? 0 });
    return {
      ...matrixClientMock,
      fetchRelations: vi.fn(),
      getEventMapper: () => mapper,
    };
  };

  it('returns null when the first page fails', async () => {
    const { fetchAllThreadRelations } = await import('./RoomTimeline');
    const mx = makeFetchMx();
    mx.fetchRelations.mockRejectedValue(new Error('network'));

    const result = await fetchAllThreadRelations(mx as never, '!room:x', '$thread', 200, () => false);

    expect(result).toBeNull();
    expect(mx.fetchRelations).toHaveBeenCalledTimes(1);
  });

  it('returns partial data when a later page fails', async () => {
    const { fetchAllThreadRelations } = await import('./RoomTimeline');
    const mx = makeFetchMx();
    mx.fetchRelations
      .mockResolvedValueOnce({
        chunk: [makeRawEvent('$e2', 200), makeRawEvent('$e1', 100)],
        next_batch: 'tok1',
      })
      .mockRejectedValueOnce(new Error('network'));

    const result = await fetchAllThreadRelations(mx as never, '!room:x', '$thread', 200, () => false);

    expect(result).not.toBeNull();
    expect(result!.events.map((e) => e.getId())).toEqual(['$e1', '$e2']);
    expect(result!.nextBatchToken).toBe('tok1');
    expect(mx.fetchRelations).toHaveBeenCalledTimes(2);
  });

  it('follows next_batch tokens across multiple pages', async () => {
    const { fetchAllThreadRelations } = await import('./RoomTimeline');
    const mx = makeFetchMx();
    mx.fetchRelations
      .mockResolvedValueOnce({
        chunk: [makeRawEvent('$e3', 300), makeRawEvent('$e2', 200)],
        next_batch: 'tok1',
      })
      .mockResolvedValueOnce({
        chunk: [makeRawEvent('$e1', 100)],
        next_batch: null,
      });

    const result = await fetchAllThreadRelations(mx as never, '!room:x', '$thread', 2, () => false);

    expect(result).not.toBeNull();
    expect(result!.events.map((e) => e.getId())).toEqual(['$e1', '$e2', '$e3']);
    expect(result!.nextBatchToken).toBeUndefined();
    expect(mx.fetchRelations).toHaveBeenCalledTimes(2);
    expect(mx.fetchRelations.mock.calls[1][4]).toEqual(
      expect.objectContaining({ from: 'tok1' })
    );
  });

  it('returns events in chronological order across batches', async () => {
    const { fetchAllThreadRelations } = await import('./RoomTimeline');
    const mx = makeFetchMx();
    mx.fetchRelations
      .mockResolvedValueOnce({
        chunk: [makeRawEvent('$e5', 500), makeRawEvent('$e4', 400)],
        next_batch: 'tok1',
      })
      .mockResolvedValueOnce({
        chunk: [makeRawEvent('$e3', 300), makeRawEvent('$e2', 200)],
        next_batch: 'tok2',
      })
      .mockResolvedValueOnce({
        chunk: [makeRawEvent('$e1', 100)],
        next_batch: null,
      });

    const result = await fetchAllThreadRelations(mx as never, '!room:x', '$thread', 2, () => false);

    expect(result!.events.map((e) => e.getId())).toEqual([
      '$e1', '$e2', '$e3', '$e4', '$e5',
    ]);
  });

  it('stops when there is no next_batch token', async () => {
    const { fetchAllThreadRelations } = await import('./RoomTimeline');
    const mx = makeFetchMx();
    mx.fetchRelations.mockResolvedValueOnce({
      chunk: [makeRawEvent('$e1', 100)],
      next_batch: null,
    });

    const result = await fetchAllThreadRelations(mx as never, '!room:x', '$thread', 200, () => false);

    expect(result).not.toBeNull();
    expect(result!.events).toHaveLength(1);
    expect(result!.nextBatchToken).toBeUndefined();
    expect(mx.fetchRelations).toHaveBeenCalledTimes(1);
  });

  it('returns empty events for a thread with no replies', async () => {
    const { fetchAllThreadRelations } = await import('./RoomTimeline');
    const mx = makeFetchMx();
    mx.fetchRelations.mockResolvedValueOnce({
      chunk: [],
      next_batch: null,
    });

    const result = await fetchAllThreadRelations(mx as never, '!room:x', '$thread', 200, () => false);

    expect(result).not.toBeNull();
    expect(result!.events).toHaveLength(0);
  });

  it('returns null when isAborted returns true mid-loop', async () => {
    const { fetchAllThreadRelations } = await import('./RoomTimeline');
    const mx = makeFetchMx();
    let aborted = false;
    mx.fetchRelations.mockImplementation(async () => {
      aborted = true;
      return { chunk: [makeRawEvent('$e1', 100)], next_batch: 'tok1' };
    });

    const result = await fetchAllThreadRelations(
      mx as never, '!room:x', '$thread', 200, () => aborted
    );

    expect(result).toBeNull();
    expect(mx.fetchRelations).toHaveBeenCalledTimes(1);
  });

  it('preserves the final next_batch token from the last successful page', async () => {
    const { fetchAllThreadRelations, MAX_THREAD_FETCH_EVENTS } = await import('./RoomTimeline');
    const mx = makeFetchMx();
    const largeBatch = Array.from({ length: MAX_THREAD_FETCH_EVENTS }, (_, i) =>
      makeRawEvent(`$e${i}`, i)
    );
    mx.fetchRelations.mockResolvedValueOnce({
      chunk: largeBatch,
      next_batch: 'should-be-preserved',
    });

    const result = await fetchAllThreadRelations(mx as never, '!room:x', '$thread', MAX_THREAD_FETCH_EVENTS + 1, () => false);

    expect(result).not.toBeNull();
    expect(result!.nextBatchToken).toBe('should-be-preserved');
    expect(mx.fetchRelations).toHaveBeenCalledTimes(1);
  });

  it('passes the correct limit parameter to fetchRelations', async () => {
    const { fetchAllThreadRelations } = await import('./RoomTimeline');
    const mx = makeFetchMx();
    mx.fetchRelations.mockResolvedValueOnce({
      chunk: [],
      next_batch: null,
    });

    await fetchAllThreadRelations(mx as never, '!room:x', '$thread', 200, () => false);

    expect(mx.fetchRelations).toHaveBeenCalledWith(
      '!room:x',
      '$thread',
      null,
      null,
      expect.objectContaining({ limit: 200, recurse: true })
    );
  });

  it('backfills visible room thread summaries from cached thread events', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const rootEvent = makeEvent('$root', {
      content: { body: 'Root prompt', msgtype: 'm.text' },
      isThreadRoot: true,
      ts: 100,
    });
    const replyEvent = makeEvent('$reply', {
      content: { body: 'Reply', msgtype: 'm.text' },
      threadRootId: '$root',
      ts: 200,
    });
    const room = makeRoom({ liveEvents: [rootEvent, replyEvent] });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    loadLatestCachedThreadSummaryInfoMock.mockResolvedValue({
      summaryText: 'Cached summary text',
      generatedTs: 123,
      messageCount: 12,
    });

    try {
      await act(async () => {
        renderer = create(React.createElement(ControlledRoomTimeline, { room }));
        await flushAsyncWork();
      });

      await act(async () => {
        await flushAsyncWork(5);
      });

      expect(loadLatestCachedThreadSummaryInfoMock).toHaveBeenCalledWith(
        expect.any(String),
        '!room:example.org',
        '$root'
      );
      expect(saveCachedThreadSummaryMock).toHaveBeenCalledWith(
        expect.any(String),
        '!room:example.org',
        '$root',
        expect.objectContaining({ summaryText: 'Cached summary text' })
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    }
  });

  it('backfills visible room thread summaries beyond the first 24 summaryless roots', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const liveEvents = Array.from({ length: 30 }, (_, index) => {
      const rootId = `$root-${index}`;
      return [
        makeEvent(rootId, {
          content: { body: `Root ${index}`, msgtype: 'm.text' },
          isThreadRoot: true,
          ts: index * 100,
        }),
        makeEvent(`$reply-${index}`, {
          content: { body: `Reply ${index}`, msgtype: 'm.text' },
          threadRootId: rootId,
          ts: index * 100 + 50,
        }),
      ];
    }).flat();
    const room = makeRoom({ liveEvents });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer: ReturnType<typeof create> | undefined;

    loadLatestCachedThreadSummaryInfoMock.mockImplementation(async (_sessionId, _roomId, threadId) =>
      threadId === '$root-29'
        ? {
            summaryText: 'Later cached summary text',
            generatedTs: 999,
            messageCount: 30,
          }
        : undefined
    );

    try {
      await act(async () => {
        renderer = create(React.createElement(ControlledRoomTimeline, { room }));
        await flushAsyncWork();
      });

      await act(async () => {
        await flushAsyncWork(10);
      });

      expect(loadLatestCachedThreadSummaryInfoMock).toHaveBeenCalledWith(
        expect.any(String),
        '!room:example.org',
        '$root-29'
      );
      expect(saveCachedThreadSummaryMock).toHaveBeenCalledWith(
        expect.any(String),
        '!room:example.org',
        '$root-29',
        expect.objectContaining({ summaryText: 'Later cached summary text' })
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
        await flushAsyncWork(1);
      });
    }
  });
});
