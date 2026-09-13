import React, { createRef } from 'react';
import { Editor } from 'slate';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageEvent } from '../../../types/matrix/room';
import { createDefaultThreadFilterState } from './roomThreadOverviewModel';

const RELATION_ANNOTATION = 'm.annotation';
const RELATION_REPLACE = 'm.replace';
const ROOM_TIMELINE_EVENT = 'Room.timeline';

const {
  passthrough,
  scrollType,
  roomThreadOverviewType,
  messageType,
  messageTestId,
  collapsibleType,
  collapsibleTestId,
  matrixClientMock,
  shouldAutoScrollRoomOnLiveEventMock,
  threadResolutionMapMock,
  threadRenderStateControl,
} = vi.hoisted(() => ({
  passthrough: 'div',
  scrollType: 'room-timeline-scroll',
  roomThreadOverviewType: 'room-thread-overview',
  messageType: 'div',
  messageTestId: 'mock-message',
  collapsibleType: 'div',
  collapsibleTestId: 'mock-collapsible',
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
  shouldAutoScrollRoomOnLiveEventMock: vi.fn(() => true),
  threadResolutionMapMock: new Map<string, { isResolved: boolean }>(),
  threadRenderStateControl: {
    currentThreadEvents: [] as unknown[],
    initialThreadEvents: [] as unknown[],
    threadInitialRenderMode: 'live' as 'loading' | 'cached' | 'live',
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
      CheckTwice: 'CheckTwice',
      ChevronBottom: 'ChevronBottom',
      ChevronTop: 'ChevronTop',
      Code: 'Code',
      MessageUnread: 'MessageUnread',
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
        S100: '4px',
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
      case 'paginationLimit':
        return [300];
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
  useVirtualPaginator: (options: { range: { start: number; end: number } }) => ({
    getItems: () =>
      Array.from(
        { length: Math.max(options.range.end - options.range.start, 0) },
        (_, index) => options.range.start + index
      ),
    scrollToItem: vi.fn(() => false),
    scrollToElement: vi.fn(() => false),
    observeBackAnchor: vi.fn(),
    observeFrontAnchor: vi.fn(),
  }),
}));

vi.mock('../../hooks/useMatrixEventRenderer', () => ({
  useMatrixEventRenderer:
    (
      typeToRenderer: Record<string, (...args: unknown[]) => unknown>,
      renderStateEvent?: (...args: unknown[]) => unknown,
      renderEvent?: (...args: unknown[]) => unknown
    ) =>
    (eventType: string, isStateEvent: boolean, ...args: unknown[]) => {
      const renderer = typeToRenderer[eventType];
      if (renderer) return renderer(...args);
      if (isStateEvent && renderStateEvent) return renderStateEvent(...args);
      if (!isStateEvent && renderEvent) return renderEvent(...args);
      return null;
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

vi.mock('../../hooks/useStateEvents', () => ({
  useStateEvents: () => [],
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
  getEditedEvent: (_eventId: string, mEvent: { __editedEvent?: unknown }) => mEvent.__editedEvent,
  getEventReactions: () => undefined,
  getLatestEdit: () => undefined,
  getLatestEditableEvt: () => undefined,
  getLatestMessageContent: (
    mEvent: { getContent: () => Record<string, unknown> },
    editedEvent?: { getContent: () => Record<string, unknown> }
  ) => editedEvent?.getContent() ?? mEvent.getContent(),
  getMemberDisplayName: () => 'Alice',
  getReactionContent: () => undefined,
  isMembershipChanged: () => false,
  logEditDebug: vi.fn(),
  reactionOrEditEvent: (mEvent: { getRelation: () => { rel_type?: string } | undefined }) => {
    const relationType = mEvent.getRelation()?.rel_type;
    return relationType === RELATION_ANNOTATION || relationType === RELATION_REPLACE;
  },
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
  MindroomThreadSummaryCard: passthrough,
}));

vi.mock('./message', async () => {
  const ReactImport = await import('react');

  return {
    Reactions: passthrough,
    Message: ({ children, reactions, reply, ...props }: Record<string, unknown>) =>
      ReactImport.createElement(
        messageType,
        {
          ...props,
          'data-testid': messageTestId,
        },
        reply as never,
        children as never,
        reactions as never
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
      if (typeof children !== 'function') return children;

      const renderType = mEvent.__renderInsideEncryptedContentAs;
      if (!renderType) return children();

      const getType = mEvent.getType;
      mEvent.getType = () => renderType;
      try {
        return children();
      } finally {
        mEvent.getType = getType;
      }
    },
  };
});

vi.mock('../../components/room-intro', () => ({
  RoomIntro: passthrough,
}));

vi.mock('../../components/RenderMessageContent', () => ({
  RenderMessageContent: passthrough,
}));

vi.mock('../../components/CollapsibleMessage', async () => {
  const ReactImport = await import('react');

  return {
    expandAllMessages: vi.fn(),
    collapseAllMessages: vi.fn(),
    CollapsibleMessage: ({
      children,
      collapseMode = 'default',
      onInitialExpandConsumed,
    }: {
      children: React.ReactNode;
      collapseMode?: string;
      onInitialExpandConsumed?: () => void;
    }) => {
      const previousCollapseModeRef = ReactImport.useRef<string | undefined>(undefined);

      ReactImport.useEffect(() => {
        if (
          collapseMode === 'initially-expanded' &&
          previousCollapseModeRef.current !== 'initially-expanded'
        ) {
          onInitialExpandConsumed?.();
        }
        previousCollapseModeRef.current = collapseMode;
      }, [collapseMode, onInitialExpandConsumed]);

      return ReactImport.createElement(
        collapsibleType,
        {
          collapseMode,
          'data-testid': collapsibleTestId,
        },
        children
      );
    },
  };
});

vi.mock('../../components/media', () => ({
  Image: passthrough,
}));

vi.mock('../../components/image-viewer', () => ({
  ImageViewer: passthrough,
}));

vi.mock('../../utils/notifications', () => ({
  markAsRead: vi.fn(),
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
  today: () => true,
  yesterday: () => false,
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
  eventBelongsToThread: (
    mEvent: { getId: () => string; threadRootId?: string },
    threadId: string
  ) => !!threadId && mEvent.threadRootId === threadId && mEvent.getId() !== threadId,
  isThreadReplyEvent: (eventId?: string, threadRootId?: string) =>
    !!eventId && !!threadRootId && eventId !== threadRootId,
}));

vi.mock('./useThreadRenderState', async () => {
  const ReactImport = await import('react');

  return {
    useThreadRenderState: () => {
      const [threadEvents, setThreadEvents] = ReactImport.useState(
        threadRenderStateControl.initialThreadEvents as Array<{ getId: () => string }>
      );

      threadRenderStateControl.currentThreadEvents = threadEvents;

      const threadEventIndexMapRef = ReactImport.useRef(new Map<string, number>());
      threadEventIndexMapRef.current = new Map(
        threadEvents.map((event, index) => [event.getId(), index])
      );

      return {
        threadEventIndexMapRef,
        threadEvents,
        threadInitialRenderMode: threadRenderStateControl.threadInitialRenderMode,
        setSupplementalThreadEvents: (
          _threadId: string,
          events: Array<{ getId: () => string }>
        ) => {
          setThreadEvents((prev) => [...prev, ...events]);
        },
        resetThreadRenderState: vi.fn(),
      };
    },
  };
});

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
  loadLatestCachedRoomEvents: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
  loadCachedRoomPaginationToken: vi.fn(async () => undefined),
  normalizeCachedRoomEvents: (events: unknown[]) => events,
  saveRoomEventsToCache: vi.fn(async () => undefined),
}));

vi.mock('./threadSummaryCache', () => ({
  loadCachedThreadSummaries: vi.fn(async () => new Map()),
  saveCachedThreadSummary: vi.fn(async () => undefined),
}));

vi.mock('./eventCacheEditUtils', () => ({
  aggregateCachedRelationEvents: vi.fn(),
  hydrateCachedEvents: vi.fn(),
  serializeEventsForCache: () => [],
}));

vi.mock('./timelineScrollUtils', () => ({
  isScrollNearBottom: () => true,
  isTimelineAtLiveEnd: () => true,
  shouldAutoScrollRoomOnLiveEvent: shouldAutoScrollRoomOnLiveEventMock,
  shouldAutoScrollThreadOnLiveEvent: () => false,
}));

vi.mock('./threadEditBackfillUtils', () => ({
  markThreadEditBackfillAttempted: vi.fn(),
  shouldFetchThreadEditBackfill: () => false,
}));

vi.mock('./RoomThreadOverview', () => ({
  RoomThreadOverview: roomThreadOverviewType,
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

const ROOM_ID = '!room:example.org';

type MockEvent = {
  __editedEvent?: { getContent: () => Record<string, unknown> };
  __renderInsideEncryptedContentAs?: string;
  event: { event_id: string };
  getAssociatedId: () => string | undefined;
  getContent: () => Record<string, unknown>;
  getId: () => string;
  getRelation: () => { event_id?: string; rel_type?: string } | undefined;
  getRoomId: () => string;
  getSender: () => string;
  getStateKey: () => string | undefined;
  getTs: () => number;
  getType: () => string;
  getUnsigned: () => Record<string, unknown>;
  isRedacted: () => boolean;
  isRedaction: () => boolean;
  isThreadRoot: boolean;
  replyEventId?: string;
  threadRootId?: string;
};

const makeEvent = (
  eventId: string,
  opts: {
    content?: Record<string, unknown>;
    editedContent?: Record<string, unknown>;
    isThreadRoot?: boolean;
    relation?: { event_id?: string; rel_type?: string };
    renderInsideEncryptedContentAs?: string;
    sender?: string;
    threadRootId?: string;
    ts?: number;
    type?: string;
  } = {}
): MockEvent => ({
  __editedEvent: opts.editedContent
    ? {
        getContent: () => opts.editedContent as Record<string, unknown>,
      }
    : undefined,
  __renderInsideEncryptedContentAs: opts.renderInsideEncryptedContentAs,
  event: { event_id: eventId },
  getAssociatedId: () => opts.relation?.event_id,
  getContent: () =>
    opts.content ?? {
      body: eventId,
      msgtype: 'm.text',
    },
  getId: () => eventId,
  getRelation: () => opts.relation,
  getRoomId: () => ROOM_ID,
  getSender: () => opts.sender ?? '@alice:example.org',
  getStateKey: () => undefined,
  getTs: () => opts.ts ?? 1,
  getType: () => opts.type ?? MessageEvent.RoomMessage,
  getUnsigned: () => ({}),
  isRedacted: () => false,
  isRedaction: () => false,
  isThreadRoot: opts.isThreadRoot ?? false,
  threadRootId: opts.threadRootId,
});

const makeTimeline = (getEvents: () => MockEvent[]) => ({
  getEvents,
  getNeighbouringTimeline: () => null,
  getPaginationToken: () => null,
  getRoomId: () => ROOM_ID,
  getTimelineSet: (() => undefined) as () => unknown,
});

const makeRoom = ({
  liveEvents = [],
  threadRootEvent,
}: {
  liveEvents?: MockEvent[];
  threadRootEvent?: MockEvent;
} = {}) => {
  const listeners = new Map<string | symbol, (...args: unknown[]) => void>();
  const getThreadEvents = () => {
    if (!threadRootEvent) return [];

    const replyEvents = (threadRenderStateControl.currentThreadEvents as MockEvent[]).filter(
      (event) => event.getId() !== threadRootEvent.getId()
    );

    return [threadRootEvent, ...replyEvents];
  };
  const liveTimeline = makeTimeline(() => liveEvents);
  const threadTimeline = makeTimeline(getThreadEvents);
  const roomTimelineSet = {
    getLiveTimeline: () => liveTimeline,
    getTimelineForEvent: (eventId: string) =>
      liveEvents.some((event) => event.getId() === eventId)
        ? liveTimeline
        : undefined,
  };
  const threadTimelineSet = {
    getLiveTimeline: () => threadTimeline,
    getTimelineForEvent: (eventId: string) =>
      getThreadEvents().some((event) => event.getId() === eventId)
        ? threadTimeline
        : undefined,
  };

  liveTimeline.getTimelineSet = () => roomTimelineSet;
  threadTimeline.getTimelineSet = () => threadTimelineSet;

  return {
    __listeners: listeners,
    roomId: ROOM_ID,
    client: {
      getUserId: () => '@alice:example.org',
    },
    findEventById: (eventId: string) =>
      liveEvents.find((event) => event.getId() === eventId) ??
      getThreadEvents().find((event) => event.getId() === eventId),
    getEventReadUpTo: () => undefined,
    getThread: (eventId: string) => {
      if (!threadRootEvent || eventId !== threadRootEvent.getId()) return null;

      return {
        rootEvent: threadRootEvent,
        get events() {
          return getThreadEvents();
        },
        get length() {
          return Math.max(getThreadEvents().length - 1, 0);
        },
        getUnfilteredTimelineSet: () => threadTimelineSet,
      };
    },
    getUnfilteredTimelineSet: () => roomTimelineSet,
    hasEncryptionStateEvent: () => false,
    on: vi.fn((event, handler) => {
      listeners.set(event, handler as (...args: unknown[]) => void);
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

const createControlledRoomTimelineHarness = (
  RoomTimelineComponent: (props: Record<string, unknown>) => React.ReactElement | null
) => {
  const roomInputRef = createRef<HTMLElement>();
  const editor = {} as Editor;

  return function ControlledRoomTimelineHarness({
    room,
    threadId,
  }: {
    room: ReturnType<typeof makeRoom>;
    threadId?: string;
  }) {
    return React.createElement(RoomTimelineComponent, {
      room,
      threadId,
      threadFilterState: createDefaultThreadFilterState(),
      onToggle: vi.fn(),
      onSortDirectionChange: vi.fn(),
      onCycleTag: vi.fn(),
      onAddTag: vi.fn(),
      onRemoveTag: vi.fn(),
      onReset: vi.fn(),
      viewMode: 'normal',
      onViewModeChange: vi.fn(),
      roomInputRef,
      editor,
    });
  };
};

const findCollapseModeForEvent = (renderer: ReactTestRenderer, eventId: string) =>
  renderer.root
    .find(
      (node) =>
        node.type === messageType &&
        node.props['data-testid'] === messageTestId &&
        node.props['data-message-id'] === eventId
    )
    .find(
      (node) => node.type === collapsibleType && node.props['data-testid'] === collapsibleTestId
    ).props.collapseMode;

const emitLiveTimelineEvent = async (room: ReturnType<typeof makeRoom>, event: MockEvent) => {
  const handler = room.__listeners.get(ROOM_TIMELINE_EVENT);

  act(() => {
    handler?.(event, room, false, false, { liveEvent: true });
  });

  await flushAsyncWork(2);
};

beforeEach(() => {
  vi.clearAllMocks();
  matrixClientMock.fetchRelations.mockResolvedValue({
    chunk: [],
    next_batch: null,
  });
  matrixClientMock.getEventTimeline.mockResolvedValue(undefined);
  matrixClientMock.getThreadTimeline.mockResolvedValue(undefined);
  shouldAutoScrollRoomOnLiveEventMock.mockReturnValue(true);
  threadResolutionMapMock.clear();
  threadRenderStateControl.initialThreadEvents = [];
  threadRenderStateControl.currentThreadEvents = [];
  threadRenderStateControl.threadInitialRenderMode = 'live';
});

describe('RoomTimeline collapsible wiring', () => {
  it('uses always-expanded mode for thread summary messages resolved from edits', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const summaryEvent = makeEvent('$summary', {
      content: {
        body: 'Original summary',
        msgtype: 'm.notice',
      },
      editedContent: {
        body: 'Edited summary',
        msgtype: 'm.notice',
        'io.mindroom.thread_summary': {
          version: 1,
          summary: 'Edited summary',
        },
      },
    });
    const room = makeRoom({ liveEvents: [summaryEvent] });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$summary')).toBe('always-expanded');
  });

  it('uses always-expanded mode for legacy boolean thread summaries', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const summaryEvent = makeEvent('$legacy-summary', {
      content: {
        body: 'Legacy summary',
        msgtype: 'm.notice',
        'io.mindroom.thread_summary': true,
      },
    });
    const room = makeRoom({ liveEvents: [summaryEvent] });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$legacy-summary')).toBe('always-expanded');
  });

  it('uses default mode for historical messages', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const historicalEvent = makeEvent('$historical', {
      content: {
        body: 'Historical message',
        msgtype: 'm.text',
      },
    });
    const room = makeRoom({ liveEvents: [historicalEvent] });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$historical')).toBe('default');
  });

  it('uses initially-expanded mode for visible live messages and consumes it after mount', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const historicalEvent = makeEvent('$historical');
    const liveEvent = makeEvent('$live', {
      content: {
        body: 'Live message',
        msgtype: 'm.text',
      },
    });
    const liveEvents = [historicalEvent];
    const room = makeRoom({ liveEvents });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    liveEvents.push(liveEvent);
    await emitLiveTimelineEvent(room, liveEvent);

    expect(findCollapseModeForEvent(renderer, '$live')).toBe('initially-expanded');

    await act(async () => {
      renderer.update(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$live')).toBe('default');
  });

  it('marks live edit targets for initially-expanded mode and consumes the flag after rerender', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const targetEvent = makeEvent('$target', {
      content: {
        body: 'Original message',
        msgtype: 'm.text',
      },
      editedContent: {
        body: 'Expanded message after streaming edit',
        msgtype: 'm.text',
      },
    });
    const liveEvents = [targetEvent];
    const room = makeRoom({ liveEvents });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    liveEvents.push(
      makeEvent('$replace', {
        content: {
          body: 'Expanded message after streaming edit',
          msgtype: 'm.text',
          'm.new_content': {
            body: 'Expanded message after streaming edit',
            msgtype: 'm.text',
          },
        },
        relation: {
          event_id: '$target',
          rel_type: RELATION_REPLACE,
        },
      })
    );
    await emitLiveTimelineEvent(room, liveEvents[liveEvents.length - 1]);

    expect(findCollapseModeForEvent(renderer, '$target')).toBe('initially-expanded');

    await act(async () => {
      renderer.update(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$target')).toBe('default');
  });

  it('uses always-expanded mode through the encrypted room-message render path', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const encryptedSummaryEvent = makeEvent('$encrypted-summary', {
      type: MessageEvent.RoomMessageEncrypted,
      renderInsideEncryptedContentAs: MessageEvent.RoomMessage,
      content: {
        body: 'Encrypted original summary',
        msgtype: 'm.notice',
      },
      editedContent: {
        body: 'Encrypted edited summary',
        msgtype: 'm.notice',
        'io.mindroom.thread_summary': {
          version: 1,
          summary: 'Encrypted edited summary',
        },
      },
    });
    const room = makeRoom({ liveEvents: [encryptedSummaryEvent] });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$encrypted-summary')).toBe('always-expanded');
  });

  it('marks visible live thread replies for initially-expanded mode', async () => {
    const { getCollapsibleMessageMode, shouldTrackLiveCollapsibleMessage } = await import(
      './RoomTimeline'
    );
    const threadRootEvent = makeEvent('$thread-root', {
      content: {
        body: 'Thread root',
        msgtype: 'm.text',
      },
      isThreadRoot: true,
    });
    const liveThreadReply = makeEvent('$thread-reply', {
      content: {
        body: 'Live thread reply',
        msgtype: 'm.text',
      },
      threadRootId: '$thread-root',
    });
    const room = makeRoom({
      liveEvents: [threadRootEvent],
      threadRootEvent,
    });
    const liveExpandOnceIds = new Set<string>();

    expect(
      shouldTrackLiveCollapsibleMessage({
        mEvent: liveThreadReply as never,
        room: room as never,
        threadId: '$thread-root',
        threadFilterState: createDefaultThreadFilterState(),
        threadResolutionMap: threadResolutionMapMock,
        ignoredUsersSet: new Set(),
        showHiddenEvents: false,
        hideMembershipEvents: false,
        hideNickAvatarEvents: false,
      })
    ).toBe(true);

    liveExpandOnceIds.add(liveThreadReply.getId());

    expect(
      getCollapsibleMessageMode(
        liveThreadReply.getId(),
        liveThreadReply.getContent(),
        liveExpandOnceIds
      )
    ).toBe('initially-expanded');
  });

  it('keeps cached-mode thread replies in default collapse mode on first paint', async () => {
    const { RoomTimeline } = await import('./RoomTimeline');
    const threadRootEvent = makeEvent('$thread-root', {
      content: {
        body: 'Thread root',
        msgtype: 'm.text',
      },
      isThreadRoot: true,
      ts: 1,
    });
    const cachedReply = makeEvent('$cached-reply', {
      content: {
        body:
          'This is a long cached thread reply that should stay collapsed by default on first paint. '.repeat(
            6
          ),
        msgtype: 'm.text',
      },
      threadRootId: '$thread-root',
      ts: 2,
    });
    const room = makeRoom({
      liveEvents: [threadRootEvent],
      threadRootEvent,
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    threadRenderStateControl.initialThreadEvents = [threadRootEvent, cachedReply];
    threadRenderStateControl.threadInitialRenderMode = 'cached';

    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(ControlledRoomTimeline, {
            room,
            threadId: '$thread-root',
          })
        );
        await flushAsyncWork(2);
      });

      expect(findCollapseModeForEvent(renderer, '$cached-reply')).toBe('default');
    } finally {
      renderer?.unmount();
    }
  });
});
