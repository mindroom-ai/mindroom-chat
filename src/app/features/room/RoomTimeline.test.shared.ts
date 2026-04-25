/* eslint-disable react/prop-types */
import React, { createRef } from 'react';
import { Direction, RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import { Editor } from 'slate';
import { act, create as baseCreate } from 'react-test-renderer';
import { afterEach, beforeEach, vi } from 'vitest';
import {
  createDefaultThreadFilterState,
  cycleSortMode,
  resetThreadFilterState,
  updateThreadFilterKey,
} from '../../mindroom/threads/roomThreadOverviewModel';
import {
  applyParsedThreadFilterQuery,
  parseThreadFilterQuery,
  serializeThreadFilterQuery,
} from '../../mindroom/threads/threadFilterDsl';
import {
  clearThreadOpenSeedSnapshotsForTests,
  getThreadOpenSeedSnapshot,
  saveThreadOpenSeedSnapshot,
} from '../../mindroom/threads/threadOpenSeedCache';

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
  threadStreamingStateMock,
  threadResolutionMapMock,
  stateEventsByTypeMock,
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
    getSyncState: vi.fn(() => 'SYNCING'),
    getThreadTimeline: vi.fn(),
    getUserId: vi.fn(() => '@alice:example.org'),
    on: vi.fn(),
    paginateEventTimeline: vi.fn(),
    processAggregatedTimelineEvents: vi.fn(),
    removeListener: vi.fn(),
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
  threadStreamingStateMock: new Map<string, boolean>(),
  threadResolutionMapMock: new Map<string, { isResolved: boolean; tags: Record<string, unknown> | null }>(),
  stateEventsByTypeMock: new Map<string, unknown[]>(),
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

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>();

  return {
    ...actual,
    useAtomValue: () => [],
    useSetAtom: () => vi.fn(),
  };
});

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
  useStateEvents: (_room: unknown, eventType: string) => stateEventsByTypeMock.get(eventType) ?? [],
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

vi.mock('../../mindroom/threads/ThreadIndicator', () => ({
  ThreadIndicator: passthrough,
}));

vi.mock('../../mindroom/messages/MindroomThreadSummaryCard', () => ({
  MindroomThreadSummaryCard: passthrough,
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

vi.mock('../../mindroom/notifications/readReceipts', () => ({
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

vi.mock('../../mindroom/threads/threadUtils', () => ({
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
  buildVisibleThreadParticipantMap: (
    events: Array<{
      getId(): string | undefined;
      getSender?(): string | undefined;
      getType?(): string | undefined;
      threadRootId?: string;
    }>,
    maxParticipants = 3
  ) => {
    const participants = new Map<string, string[]>();
    [...events].reverse().forEach((event) => {
      const eventId = event.getId();
      const senderId = event.getSender?.();
      const { threadRootId } = event;
      if (
        !eventId ||
        !threadRootId ||
        eventId === threadRootId ||
        !senderId ||
        event.getType?.() === 'com.mindroom.thread.tag'
      ) {
        return;
      }
      const current = participants.get(threadRootId) ?? [];
      if (current.includes(senderId) || current.length >= maxParticipants) return;
      participants.set(threadRootId, [...current, senderId]);
    });
    return participants;
  },
  buildVisibleThreadReplyCountMap: (
    events: Array<{
      getId(): string | undefined;
      getType?(): string | undefined;
      threadRootId?: string;
    }>
  ) => {
    const counts = new Map<string, number>();
    events.forEach((event) => {
      const eventId = event.getId();
      const { threadRootId } = event;
      if (
        !eventId ||
        !threadRootId ||
        eventId === threadRootId ||
        event.getType?.() === 'com.mindroom.thread.tag'
      ) {
        return;
      }
      counts.set(threadRootId, (counts.get(threadRootId) ?? 0) + 1);
    });
    return counts;
  },
  eventBelongsToThread: (
    event: { getId(): string | undefined; threadRootId?: string },
    threadId: string
  ) => event.getId() === threadId || event.threadRootId === threadId,
  isVisibleThreadTextMessageEventType: (eventType?: string) =>
    eventType === 'm.room.message' || eventType === 'm.room.encrypted',
  isVisibleThreadReplyEvent: (event: {
    getId(): string | undefined;
    getType?(): string | undefined;
    threadRootId?: string;
  }) => {
    const eventId = event.getId();
    return (
      !!eventId &&
      !!event.threadRootId &&
      eventId !== event.threadRootId &&
      event.getType?.() !== 'com.mindroom.thread.tag'
    );
  },
  getPreferredVisibleThreadReplyEvents: (
    thread:
      | {
          events?: Array<{
            getId(): string | undefined;
            getType?(): string | undefined;
            threadRootId?: string;
          }>;
          timeline?: Array<{
            getId(): string | undefined;
            getType?(): string | undefined;
            threadRootId?: string;
          }>;
        }
      | null
      | undefined
  ) => {
    const replyEvents = thread?.events?.length
      ? thread.events
      : thread?.timeline?.length
        ? thread.timeline
        : thread?.events ?? thread?.timeline ?? [];
    return replyEvents.filter(
      (event) =>
        !!event.getId() &&
        !!event.threadRootId &&
        event.getId() !== event.threadRootId &&
        event.getType?.() !== 'com.mindroom.thread.tag'
    );
  },
  getLatestRenderableVisibleThreadReplyEvent: (
    replyEvents: Array<{
      getContent?: () => Record<string, unknown> | undefined;
      getType?(): string | undefined;
    }>
  ) => {
    for (let i = replyEvents.length - 1; i >= 0; i -= 1) {
      const body = replyEvents[i].getContent?.()?.body;
      if (typeof body === 'string' && body.trim().length > 0) {
        return replyEvents[i];
      }
    }
    return undefined;
  },
  hasLoadedThreadReplyEvents: (
    thread:
      | {
          events?: unknown[];
          timeline?: unknown[];
        }
      | null
      | undefined
  ) => {
    if (thread?.events && thread.events.length > 0) return true;
    return !!thread?.timeline && thread.timeline.length > 0;
  },
  getVisibleThreadMessageCount: (
    thread:
      | {
          length?: number;
          events?: Array<{
            getId(): string | undefined;
            getType?(): string | undefined;
            threadRootId?: string;
          }>;
          timeline?: Array<{
            getId(): string | undefined;
            getType?(): string | undefined;
            threadRootId?: string;
          }>;
        }
      | null
      | undefined,
    fallbackMessageCount?: number
  ) => {
    const replyEvents = thread?.events?.length
      ? thread.events
      : thread?.timeline?.length
        ? thread.timeline
        : thread?.events ?? thread?.timeline ?? [];
    const visibleReplies = replyEvents.filter(
      (event) =>
        !!event.getId() &&
        !!event.threadRootId &&
        event.getId() !== event.threadRootId &&
        event.getType?.() !== 'com.mindroom.thread.tag'
    );
    if (visibleReplies.length > 0) return visibleReplies.length;
    if ((thread?.events?.length ?? 0) > 0 || (thread?.timeline?.length ?? 0) > 0) return 0;
    if (typeof thread?.length === 'number' && thread.length > 0) return thread.length;
    if (typeof fallbackMessageCount === 'number' && fallbackMessageCount > 0) {
      return fallbackMessageCount;
    }
    return 0;
  },
  getVisibleThreadEventBodyPreviewText: (
    event:
      | {
          getContent?: () => Record<string, unknown> | undefined;
        }
      | undefined
  ) => {
    const body = event?.getContent?.()?.body;
    return typeof body === 'string' && body.trim().length > 0 ? body.trim() : undefined;
  },
  getVisibleThreadParticipantIds: (
    thread:
      | {
          events?: Array<{
            getId(): string | undefined;
            getSender?(): string | undefined;
            getType?(): string | undefined;
            threadRootId?: string;
          }>;
          timeline?: Array<{
            getId(): string | undefined;
            getSender?(): string | undefined;
            getType?(): string | undefined;
            threadRootId?: string;
          }>;
        }
      | null
      | undefined,
    threadRootEvent?: { getSender?(): string | undefined },
    maxParticipants = 3
  ) => {
    const participantIds: string[] = [];
    const seenParticipantIds = new Set<string>();
    const replyEvents = thread?.events?.length
      ? thread.events
      : thread?.timeline?.length
        ? thread.timeline
        : thread?.events ?? thread?.timeline ?? [];

    for (let i = replyEvents.length - 1; i >= 0 && participantIds.length < maxParticipants; i -= 1) {
      const event = replyEvents[i];
      const senderId = event.getSender?.();
      if (
        !event.getId() ||
        !event.threadRootId ||
        event.getId() === event.threadRootId ||
        event.getType?.() === 'com.mindroom.thread.tag' ||
        !senderId ||
        seenParticipantIds.has(senderId)
      ) {
        continue;
      }
      seenParticipantIds.add(senderId);
      participantIds.push(senderId);
    }

    const rootSenderId = threadRootEvent?.getSender?.();
    if (participantIds.length < maxParticipants && rootSenderId && !seenParticipantIds.has(rootSenderId)) {
      participantIds.push(rootSenderId);
    }

    return participantIds;
  },
  isThreadReplyEvent: (eventId: string, threadRootId?: string) =>
    !!threadRootId && threadRootId !== eventId,
}));

vi.mock('../../mindroom/messages/threadSummary', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../mindroom/messages/threadSummary')>();
  return {
    ...actual,
    buildThreadSummaryMap: () => new Map(),
    findLatestThreadSummaryEvent: () => undefined,
    getThreadSummaryEventInfo: () => undefined,
  };
});

vi.mock('../../mindroom/threads/useThreadRenderState', () => ({
  useThreadRenderState: () => threadRenderStateMock,
}));

vi.mock('../../mindroom/threads/threadEventCache', () => ({
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

vi.mock('../../mindroom/threads/threadPaginationUtils', () => ({
  computeReconciliationToken: () => undefined,
  findEarliestLoadedThreadReplyByCacheOrder: () => undefined,
  reconcileThreadBackwardPagination: vi.fn(),
}));

vi.mock('../../mindroom/threads/eventCacheTokenUtils', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../mindroom/threads/eventCacheTokenUtils')>();
  return actual;
});

vi.mock('./threadSummaryCache', () => ({
  loadCachedThreadSummaries: loadCachedThreadSummariesMock,
  saveCachedThreadSummary: saveCachedThreadSummaryMock,
}));


vi.mock('../../mindroom/threads/roomEventCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../mindroom/threads/roomEventCache')>();
  return {
    ...actual,
    loadCachedRoomEventsBefore: loadCachedRoomEventsBeforeMock,
    loadCachedRoomPaginationToken: loadCachedRoomPaginationTokenMock,
    loadLatestCachedRoomEvents: loadLatestCachedRoomEventsMock,
    saveRoomEventsToCache: saveRoomEventsToCacheMock,
  };
});

vi.mock('../../mindroom/threads/eventCacheEditUtils', () => ({
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

vi.mock('../../mindroom/threads/timelineScrollUtils', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../mindroom/threads/timelineScrollUtils')>();
  return {
    ...actual,
    isScrollNearBottom: () => true,
    isTimelineAtLiveEnd: isTimelineAtLiveEndMock,
    shouldAutoScrollRoomOnLiveEvent: () => false,
    shouldAutoScrollThreadOnLiveEvent: () => false,
  };
});

vi.mock('../../mindroom/threads/threadEditBackfill', () => ({
  hasLikelyIncompleteStreamingBody: (value: unknown) =>
    typeof value === 'string' && /^thinking(?:\.{3}|…)(?:\s*⋯)?$/i.test(value.trim()),
  markThreadEditBackfillAttempted: vi.fn(),
  shouldFetchThreadEditBackfill: () => false,
}));

vi.mock('../../mindroom/threads/threadEditBackfill', () => ({
  hasLikelyIncompleteStreamingBody: (value: unknown) =>
    typeof value === 'string' && /^thinking(?:\.{3}|…)(?:\s*⋯)?$/i.test(value.trim()),
  markThreadEditBackfillAttempted: vi.fn(),
  shouldFetchThreadEditBackfill: () => false,
}));

vi.mock('../../mindroom/threads/RoomThreadOverview', () => ({
  RoomThreadOverview: roomThreadOverviewType,
}));

vi.mock('../../mindroom/threads/CompactRoomView', () => ({
  CompactRoomView: compactPlaceholderType,
}));

vi.mock('../../mindroom/threads/useRoomThreadList', () => ({
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

vi.mock('../../mindroom/threads/useThreadLastActivityTs', () => ({
  getThreadLastActivityTs: (_room: unknown, threadRootId: string) =>
    threadLastActivityTsMapMock.get(threadRootId) ?? 0,
  useThreadLastActivityTs: () => 0,
}));

vi.mock('../../mindroom/threads/useThreadStreamingState', () => ({
  getThreadStreamingState: (_room: unknown, threadRootId: string) =>
    threadStreamingStateMock.get(threadRootId) ?? false,
  useThreadStreamingState: () => false,
}));

vi.mock('../../mindroom/threads/scheduledTaskContract', () => ({
  MINDROOM_SCHEDULED_TASK_EVENT: 'com.mindroom.scheduled.task',
  parseScheduledTaskStateEvent: () => null,
}));

vi.mock('../../mindroom/threads/useRoomThreadTags', () => ({
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
    isSending?: boolean;
    txnId?: string;
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
  getTxnId: () => opts.txnId,
  getType: () => opts.type ?? 'm.room.message',
  getUnsigned: () => opts.unsigned ?? {},
  isSending: () => opts.isSending ?? false,
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

const emitClientSync = (current = 'SYNCING', previous = 'SYNCING') => {
  const syncHandler = matrixClientMock.on.mock.calls.find(([event]) => event === 'sync')?.[1] as
    | ((currentState: string, previousState: string) => void)
    | undefined;
  syncHandler?.(current, previous);
};

beforeEach(() => {
  vi.clearAllMocks();
  clearThreadOpenSeedSnapshotsForTests();
  threadRenderStateMock.threadEventIndexMapRef.current = new Map();
  threadRenderStateMock.threadEvents = [];
  threadRenderStateMock.threadInitialRenderMode = 'live';
  threadLastActivityTsMapMock.clear();
  threadStreamingStateMock.clear();
  threadResolutionMapMock.clear();
  stateEventsByTypeMock.clear();
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
  matrixClientMock.getSyncState.mockReturnValue('SYNCING');
  matrixClientMock.getThreadTimeline.mockResolvedValue(undefined);
  matrixClientMock.on.mockReset();
  matrixClientMock.paginateEventTimeline.mockResolvedValue(false);
  matrixClientMock.removeListener.mockReset();
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

const canonicalizeThreadFilterState = (
  state: import('../../mindroom/threads/roomThreadOverviewModel').ThreadFilterState
): import('../../mindroom/threads/roomThreadOverviewModel').ThreadFilterState => {
  const searchQuery = serializeThreadFilterQuery(state);
  return searchQuery === state.searchQuery ? state : { ...state, searchQuery };
};

const syncQueryState = (
  state: import('../../mindroom/threads/roomThreadOverviewModel').ThreadFilterState,
  updater: (
    nextState: import('../../mindroom/threads/roomThreadOverviewModel').ThreadFilterState
  ) => import('../../mindroom/threads/roomThreadOverviewModel').ThreadFilterState
): import('../../mindroom/threads/roomThreadOverviewModel').ThreadFilterState => {
  const next = updater(
    applyParsedThreadFilterQuery(state, parseThreadFilterQuery(state.searchQuery ?? ''))
  );
  const searchQuery = serializeThreadFilterQuery(next);
  return searchQuery === state.searchQuery ? next : { ...next, searchQuery };
};

const threadFilterStateFromLegacy = (
  filter?: 'all' | 'resolved' | 'unresolved' | 'unread'
): import('../../mindroom/threads/roomThreadOverviewModel').ThreadFilterState => {
  switch (filter) {
    case 'resolved':
      return canonicalizeThreadFilterState({
        ...TEST_DEFAULT_THREAD_FILTER_STATE,
        resolved: 'include' as const,
        tags: new Map(),
      });
    case 'unresolved':
      return canonicalizeThreadFilterState({
        ...TEST_DEFAULT_THREAD_FILTER_STATE,
        resolved: 'exclude' as const,
        tags: new Map(),
      });
    case 'unread':
      return canonicalizeThreadFilterState({
        ...TEST_DEFAULT_THREAD_FILTER_STATE,
        unread: 'include' as const,
        tags: new Map(),
      });
    default:
      return canonicalizeThreadFilterState({
        ...TEST_DEFAULT_THREAD_FILTER_STATE,
        tags: new Map(),
      });
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
    initialThreadFilterState?: import('../../mindroom/threads/roomThreadOverviewModel').ThreadFilterState;
    initialViewMode?: 'normal' | 'compact';
    initialThreadSortFrozen?: boolean;
  }) {
    const [threadFilterState, setThreadFilterState] =
      React.useState<import('../../mindroom/threads/roomThreadOverviewModel').ThreadFilterState>(
        canonicalizeThreadFilterState(
          initialThreadFilterState ?? threadFilterStateFromLegacy(initialThreadFilter)
        )
      );
    const [viewMode, setViewMode] = React.useState<'normal' | 'compact'>(initialViewMode);
    const [threadSortFreezeState, setThreadSortFreezeState] = React.useState<
      import('../../mindroom/threads/roomThreadOverviewModel').ThreadSortFreezeState | null
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
        setThreadFilterState((prev) => syncQueryState(prev, (state) => updateThreadFilterKey(state, key)));
      },
      []
    );

    const onSortDirectionChange = React.useCallback(() => {
      setThreadFilterState((prev) => {
        return { ...prev, ...cycleSortMode(prev) };
      });
    }, []);

    const onReset = React.useCallback(() => {
      setThreadFilterState(resetThreadFilterState());
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
  emitClientSync,
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
  stateEventsByTypeMock,
  TEST_DEFAULT_THREAD_FILTER_STATE,
  threadLastActivityTsMapMock,
  threadStreamingStateMock,
  threadRenderStateMock,
  threadResolutionMapMock,
  TimelineRefreshHarness,
  virtualPaginatorState,
  waitForCondition,
  isTimelineAtLiveEndMock,
};
