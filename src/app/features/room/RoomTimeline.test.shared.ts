/* eslint-disable react/prop-types */
import React, { createRef } from 'react';
import { Direction, RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import { Editor } from 'slate';
import { act, create as baseCreate } from 'react-test-renderer';
import { afterEach, beforeEach, vi } from 'vitest';
import { createDefaultThreadFilterState, cycleSortMode } from './roomThreadOverviewModel';
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
  directRoomState,
  aliveFn,
  reactionOrEditEventMock,
  isMembershipChangedMock,
  matrixClientMock,
  navigateRoomMock,
  navigateRoomThreadMock,
  threadRenderStateMock,
  threadLastActivityTsMapMock,
  threadResolutionMapMock,
  roomThreadListThreadsMock,
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
  directRoomState: { value: false },
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
  navigateRoomMock: vi.fn(),
  navigateRoomThreadMock: vi.fn(),
  threadRenderStateMock: {
    threadEventIndexMapRef: { current: new Map() },
    threadEvents: [],
    threadInitialRenderMode: 'live',
    setSupplementalThreadEvents: vi.fn(),
    resetThreadRenderState: vi.fn(),
  },
  threadLastActivityTsMapMock: new Map<string, number>(),
  threadResolutionMapMock: new Map<string, { isResolved: boolean; tags: Record<string, unknown> | null }>(),
  roomThreadListThreadsMock: [] as Array<{ id?: string; rootEvent?: unknown }>,
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
  useIsDirectRoom: () => directRoomState.value,
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
    navigateRoom: navigateRoomMock,
    navigateRoomThread: navigateRoomThreadMock,
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
  useMatrixEventRenderer:
    (
      typeToRenderer: Record<string, (...args: unknown[]) => React.ReactNode>,
      renderStateEvent?: (...args: unknown[]) => React.ReactNode,
      renderEvent?: (...args: unknown[]) => React.ReactNode
    ) =>
    (eventType: string, isStateEvent: boolean, ...args: unknown[]) => {
      const renderer = typeToRenderer[eventType];
      if (renderer) return renderer(...args);
      if (isStateEvent && renderStateEvent) return renderStateEvent(...args);
      if (!isStateEvent && renderEvent) return renderEvent(...args);
      return React.createElement('mock-event', {
        eventId: args[0],
        key: String(args[0]),
      });
    },
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
  MindroomThreadSummaryCard: passthrough,
  ImageContent: passthrough,
  EventContent: passthrough,
}));

vi.mock('./message', () => ({
  Reactions: passthrough,
  Message: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) =>
    React.createElement(
      passthrough,
      {
        ...props,
        eventId:
          typeof props['data-message-id'] === 'string' ? props['data-message-id'] : props.eventId,
      },
      children
    ),
  Event: passthrough,
  EncryptedContent: ({
    mEvent,
    children,
  }: {
    mEvent: {
      __renderInsideEncryptedContentAs?: string;
      getType: () => string;
    };
    children: (() => React.ReactNode) | React.ReactNode;
  }) => {
    if (typeof children !== 'function') return React.createElement(React.Fragment, null, children);

    const renderType = mEvent.__renderInsideEncryptedContentAs;
    if (!renderType) return React.createElement(React.Fragment, null, children());

    const getType = mEvent.getType;
    mEvent.getType = () => renderType;

    try {
      return React.createElement(React.Fragment, null, children());
    } finally {
      mEvent.getType = getType;
    }
  },
}));

vi.mock('../../components/room-intro', () => ({
  RoomIntro: roomIntroType,
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
  buildThreadParticipantMap: (
    events: Array<{
      getId(): string | undefined;
      threadRootId?: string;
      getSender?(): string | undefined;
      getRelation?(): { rel_type?: string } | null | undefined;
    }>,
    maxParticipants = 3
  ) => {
    const participants = new Map<string, string[]>();
    const seenEventIds = new Set<string>();
    const participantSets = new Map<string, Set<string>>();

    [...events].reverse().forEach((event) => {
      const eventId = event.getId();
      const { threadRootId } = event;
      if (!eventId || !threadRootId || eventId === threadRootId || seenEventIds.has(eventId)) {
        return;
      }

      if (event.getRelation?.()?.rel_type === 'm.replace') return;

      seenEventIds.add(eventId);
      const senderId = event.getSender?.();
      if (!senderId) return;

      const threadParticipants = participants.get(threadRootId) ?? [];
      if (threadParticipants.length >= maxParticipants) return;

      const threadParticipantSet = participantSets.get(threadRootId) ?? new Set<string>();
      if (threadParticipantSet.has(senderId)) return;

      threadParticipantSet.add(senderId);
      participantSets.set(threadRootId, threadParticipantSet);
      participants.set(threadRootId, [...threadParticipants, senderId]);
    });

    return participants;
  },
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
  collectRedactedRelationTargetsFromLookup: vi.fn(() => []),
  hydrateCachedEvents: vi.fn(() => []),
  reconcileRelationEventsWithAggregation: vi.fn(),
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

vi.mock('./useRoomThreadList', () => ({
  useRoomThreadList: (
    room: { getThreads?: () => Array<{ id?: string; rootEvent?: unknown }> } | undefined,
    enabled = true
  ) => ({
    threads: enabled
      ? roomThreadListThreadsMock.length > 0
        ? roomThreadListThreadsMock
        : room?.getThreads?.() ?? []
      : [],
  }),
}));

vi.mock('../../hooks/useThreadLastActivityTs', () => ({
  getThreadLastActivityTs: (_room: unknown, threadRootId: string) =>
    threadLastActivityTsMapMock.get(threadRootId) ?? 0,
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
    renderInsideEncryptedContentAs?: string;
    associatedId?: string;
    stateKey?: string;
    unsigned?: Record<string, unknown>;
    isRedacted?: boolean;
    isRedaction?: boolean;
  } = {}
) => ({
  __renderInsideEncryptedContentAs: opts.renderInsideEncryptedContentAs,
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
    getMember: (userId: string) => ({ name: userId }),
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
  threadLastActivityTsMapMock.clear();
  threadResolutionMapMock.clear();
  roomThreadListThreadsMock.length = 0;
  directRoomState.value = false;
  ignoredUsersMock.length = 0;
  roomUnreadState.value = false;
  scrollToItemMock.mockReturnValue(false);
  scrollToElementMock.mockReturnValue(false);
  retryPaginationMock.mockReset();
  matrixClientMock.getEventMapper.mockImplementation(
    () =>
      (rawEvent: unknown) => {
        const event = rawEvent as {
          content?: Record<string, unknown>;
          event_id?: string;
          origin_server_ts?: number;
        };

        return typeof event?.event_id === 'string'
          ? makeEvent(event.event_id, {
              content: event.content,
              ts: event.origin_server_ts ?? 0,
            })
          : rawEvent;
      }
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
  navigateRoomMock.mockReset();
  navigateRoomThreadMock.mockReset();
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

const getRenderedEventIds = (renderer: ReturnType<typeof create>): string[] =>
  Array.from(
    new Set(
      renderer.root
        .findAll(
          (node) =>
            node.type === ('mock-event' as never) || typeof node.props['data-message-id'] === 'string'
        )
        .map((node) =>
          typeof node.props['data-message-id'] === 'string'
            ? node.props['data-message-id']
            : node.props.eventId
        )
    )
  );

const DEFAULT_THREAD_FILTER_STATE = createDefaultThreadFilterState();
const TEST_DEFAULT_THREAD_FILTER_STATE = {
  // Most room-surface assertions in this file are about the normal timeline, not overview sorting.
  ...DEFAULT_THREAD_FILTER_STATE,
  sortBy: 'natural' as const,
  sortDirection: 'desc' as const,
  tags: new Map(),
};

const threadFilterStateFromLegacy = (
  filter?: 'all' | 'resolved' | 'unresolved' | 'unread'
): import('./roomThreadOverviewModel').ThreadFilterState => {
  switch (filter) {
    case 'resolved':
      return { ...TEST_DEFAULT_THREAD_FILTER_STATE, resolved: 'include' as const, tags: new Map() };
    case 'unresolved':
      return { ...TEST_DEFAULT_THREAD_FILTER_STATE, resolved: 'exclude' as const, tags: new Map() };
    case 'unread':
      return { ...TEST_DEFAULT_THREAD_FILTER_STATE, unread: 'include' as const, tags: new Map() };
    default:
      return { ...TEST_DEFAULT_THREAD_FILTER_STATE, tags: new Map() };
  }
};

const createControlledRoomTimelineHarness = (
  RoomTimelineComponent: (props: Record<string, unknown>) => React.ReactElement | null
) => {
  const roomInputRef = createRef<HTMLElement>();
  const editor = {} as Editor;
  const defaultSummaryMap = new Map();
  const defaultOnStoreThreadSummary = vi.fn();

  return function ControlledRoomTimelineHarness({
    room,
    eventId,
    focusEventInRoom,
    threadId,
    summaryMap = defaultSummaryMap,
    onStoreThreadSummary = defaultOnStoreThreadSummary,
    initialThreadFilter,
    initialThreadFilterState,
    initialViewMode = 'normal',
    initialThreadSortFrozen = false,
  }: {
    room: ReturnType<typeof makeRoom>;
    eventId?: string;
    focusEventInRoom?: boolean;
    threadId?: string;
    summaryMap?: Map<string, unknown>;
    onStoreThreadSummary?: (threadRootId: string, info?: unknown) => void;
    initialThreadFilter?: 'all' | 'resolved' | 'unresolved' | 'unread';
    initialThreadFilterState?: import('./roomThreadOverviewModel').ThreadFilterState;
    initialViewMode?: 'normal' | 'compact';
    initialThreadSortFrozen?: boolean;
  }) {
    const [threadFilterState, setThreadFilterState] =
      React.useState<import('./roomThreadOverviewModel').ThreadFilterState>(
        initialThreadFilterState ?? threadFilterStateFromLegacy(initialThreadFilter)
      );
    const [viewMode, setViewMode] = React.useState<'normal' | 'compact'>(initialViewMode);
    const [threadSortFreezeState, setThreadSortFreezeState] = React.useState<
      import('./roomThreadOverviewModel').ThreadSortFreezeState | null
    >(
      initialThreadSortFrozen
        ? {
            controlSignature: null,
            orderedRootIds: [],
          }
        : null
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
        return { ...prev, ...cycleSortMode(prev) };
      });
    }, []);

    const onReset = React.useCallback(() => {
      setThreadFilterState({ ...TEST_DEFAULT_THREAD_FILTER_STATE, tags: new Map() });
    }, []);

    const onToggleThreadSortFreeze = React.useCallback(() => {
      setThreadSortFreezeState((currentState) =>
        currentState
          ? null
          : {
              controlSignature: null,
              orderedRootIds: [],
            }
      );
    }, []);

    return React.createElement(RoomTimelineComponent, {
      room,
      eventId,
      focusEventInRoom,
      threadId,
      summaryMap,
      onStoreThreadSummary,
      threadFilterState,
      threadSortFreezeState,
      onToggle,
      onSortDirectionChange,
      onToggleThreadSortFreeze,
      setThreadSortFreezeState,
      onCycleTag: vi.fn(),
      onAddTag: vi.fn(),
      onRemoveTag: vi.fn(),
      onReset,
      viewMode,
      onViewModeChange: setViewMode,
      roomInputRef,
      editor,
    });
  };
};

const setThreadAwareTimelineRefreshHook = (
  hook: typeof import('./RoomTimeline').useThreadAwareTimelineRefresh | undefined
) => {
  useThreadAwareTimelineRefreshHook = hook;
};

export {
  React,
  Direction,
  RoomEvent,
  ThreadEvent,
  act,
  create,
  compactPlaceholderType,
  createControlledRoomTimelineHarness,
  DEFAULT_THREAD_FILTER_STATE,
  directRoomState,
  flushAsyncWork,
  getClickableByText,
  getRenderedEventIds,
  getThreadOpenSeedSnapshot,
  ignoredUsersMock,
  isMembershipChangedMock,
  loadCachedRoomEventsBeforeMock,
  loadCachedRoomPaginationTokenMock,
  loadCachedThreadSummariesMock,
  loadLatestCachedRoomEventsMock,
  loadLatestCachedThreadSummaryInfoMock,
  makeCachedRoomEvent,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
  navigateRoomMock,
  navigateRoomThreadMock,
  reactionOrEditEventMock,
  roomIntroType,
  roomThreadListThreadsMock,
  roomThreadOverviewType,
  roomUnreadState,
  saveRoomEventsToCacheMock,
  saveThreadOpenSeedSnapshot,
  scrollToItemMock,
  scrollType,
  setThreadAwareTimelineRefreshHook,
  settingsState,
  TEST_DEFAULT_THREAD_FILTER_STATE,
  threadLastActivityTsMapMock,
  threadRenderStateMock,
  threadResolutionMapMock,
  TimelineRefreshHarness,
  virtualPaginatorState,
  waitForCondition,
  isTimelineAtLiveEndMock,
};
