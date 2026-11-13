import React, { createRef } from 'react';
import { Editor } from 'slate';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageEvent } from '../../matrix/types/room';
import { createDefaultThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
import {
  createBackfillScheduler,
  createEnginePersistFacade,
  SyncEngineProvider,
  type SyncEngine,
} from '../../event-store/engine';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

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

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => matrixClientMock,
}));

vi.mock('../../lib/hooks/useAlive', () => ({
  useAlive: () => () => true,
}));

vi.mock('../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../preferences/useSetting', () => ({
  useSetting: (_atom: unknown, key: string) => {
    switch (key) {
      case 'messageLayout':
        return ['Compact'];
      case 'messageSpacing':
        return ['400'];
      case 'dateFormatString':
        return ['MMM D'];
      case 'prefetchDepth':
        return [300];
      case 'prefetchScope':
        return ['my-server'];
      default:
        return [false];
    }
  },
}));

vi.mock('../../preferences/settings', () => ({
  MessageLayout: {
    Compact: 'Compact',
    Bubble: 'Bubble',
    Modern: 'Modern',
  },
  settingsAtom: {},
}));

vi.mock('../../event-store/engine/prefetchSettings', () => ({
  prefetchSettingsAtom: {},
}));

vi.mock('../../matrix/hooks/useRoom', () => ({
  useIsDirectRoom: () => false,
}));

vi.mock('../../matrix/hooks/useIgnoredUsers', () => ({
  useIgnoredUsers: () => [],
}));

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>();

  return {
    ...actual,
    useAtomValue: () => [],
    useSetAtom: () => vi.fn(),
  };
});

vi.mock('../../matrix/hooks/usePowerLevels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../matrix/hooks/usePowerLevels')>()),
  usePowerLevelsContext: () => ({}),
}));

vi.mock('../../matrix/hooks/useRoomCreators', () => ({
  useRoomCreators: () => new Set(),
}));

vi.mock('../../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    action: () => true,
    event: () => true,
    stateEvent: () => true,
  }),
  getRoomPermissionsAPI: () => ({
    action: () => true,
    event: () => true,
    stateEvent: () => true,
  }),
}));

vi.mock('../../matrix/state/useUnread', () => ({
  useRoomUnread: () => false,
}));

vi.mock('../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoom: vi.fn(),
    navigateRoomThread: vi.fn(),
  }),
}));

vi.mock('../../messages/useMentionClickHandler', () => ({
  useMentionClickHandler: () => vi.fn(),
}));

vi.mock('../../navigation/useUserRoomProfileState', () => ({
  useOpenUserRoomProfile: () => vi.fn(),
}));

vi.mock('../../matrix/hooks/useSpace', () => ({
  useSpaceOptionally: () => undefined,
}));

vi.mock('../../emoji/useImagePackRooms', () => ({
  useImagePackRooms: () => [],
}));

vi.mock('../../messages/useMemberEventParser', () => ({
  useMemberEventParser: () => () => undefined,
}));

vi.mock('../useVirtualPaginator', () => ({
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

vi.mock('../../ui/VirtualTile', () => ({
  VirtualTile: React.forwardRef<
    HTMLDivElement,
    {
      children?: React.ReactNode;
      virtualItem?: {
        index: number;
      };
    }
  >(({ children, virtualItem }, ref) =>
    React.createElement('div', { ref, 'data-virtual-index': virtualItem?.index }, children)
  ),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: { count: number; estimateSize?: () => number }) => {
    const estimatedSize = options.estimateSize?.() ?? 100;
    return {
      getTotalSize: () => options.count * estimatedSize,
      getVirtualItems: () =>
        Array.from({ length: options.count }, (_value, index) => ({
          end: (index + 1) * estimatedSize,
          index,
          key: index,
          lane: 0,
          size: estimatedSize,
          start: index * estimatedSize,
        })),
      measureElement: vi.fn(),
      scrollToIndex: vi.fn(),
      scrollToOffset: vi.fn(),
    };
  },
}));

// This suite owns collapsible prop wiring; its virtualizer above does not
// measure DOM rows. Initial measured reveal is covered by the real scroll
// policy/controller contracts and the classic-room browser regression.
vi.mock('../roomAutomaticFill', () => {
  const owner = {
    cancel: () => {},
    defer: (retry: () => boolean) => retry(),
    isActive: () => false,
    hideInitialRows: false,
    geometryReader: { current: () => undefined },
  };
  return { useRoomAutomaticFill: () => owner };
});

vi.mock('../../lib/hooks/useIntersectionObserver', () => ({
  getIntersectionObserverEntry: () => undefined,
  useIntersectionObserver: vi.fn(),
}));

vi.mock('../../lib/hooks/useDebounce', () => ({
  useDebounce: (fn: (...args: unknown[]) => unknown) => fn,
}));

vi.mock('../../matrix/hooks/useStateEvents', () => ({
  useStateEvents: () => [],
}));
vi.mock('../../threads/usePinnedThreadEvents', () => ({ usePinnedThreadEvents: () => [] }));

vi.mock('../../event-store/threads/useThreadLastActivityTs', () => ({
  getThreadLastActivityTs: () => 0,
  useThreadLastActivityTs: () => 0,
}));

vi.mock('../../event-store/threads/useThreadStreamingState', () => ({
  getThreadStreamingState: () => false,
  useThreadStreamingState: () => false,
}));

vi.mock('../../matrix/protocol/scheduledTaskContract', () => ({
  MINDROOM_SCHEDULED_TASK_EVENT: 'com.mindroom.scheduled.task',
  parseScheduledTaskStateEvent: () => null,
}));

vi.mock('../../lib/hooks/useDocumentFocusChange', () => ({
  useDocumentFocusChange: vi.fn(),
}));

vi.mock('../../lib/hooks/useKeyDown', () => ({
  useKeyDown: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}));

vi.mock('../../messages/html/react-custom-html-parser', () => ({
  LINKIFY_OPTS: {},
  factoryRenderLinkifyWithMention: () => vi.fn(),
  getReactCustomHtmlParser: () => ({}),
  makeMentionCustomProps: () => ({}),
  renderMatrixMention: () => null,
}));

vi.mock('../../rich-text/CustomHtml.css', () => ({
  Code: 'Code',
}));

vi.mock('../RoomTimeline.css', () => ({
  ExpandAllToggle: 'ExpandAllToggle',
  FloatingAction: 'FloatingAction',
  TimelineFloat: () => 'TimelineFloat',
}));

vi.mock('../TimelineMinimap.css', () => ({
  MinimapContainer: 'MinimapContainer',
  MinimapBody: 'MinimapBody',
  MinimapRail: 'MinimapRail',
  MinimapStrip: {
    Rest: 'MinimapStripRest',
    Near: 'MinimapStripNear',
    Close: 'MinimapStripClose',
    Active: 'MinimapStripActive',
  },
  MinimapPreviewCard: 'MinimapPreviewCard',
  MinimapPreviewTitle: 'MinimapPreviewTitle',
  MinimapPreviewBody: 'MinimapPreviewBody',
}));

vi.mock('../../matrix/matrix', () => ({
  getMxIdLocalPart: (userId: string) => /^@([^:]+):/.exec(userId)?.[1] ?? userId,
}));

vi.mock('../../matrix/room', () => ({
  getStateEvent: () => undefined,
  canEditEvent: () => false,
  decryptAllTimelineEvent: vi.fn(),
  getEditedEvent: (_eventId: string, mEvent: { __editedEvent?: unknown }) => mEvent.__editedEvent,
  getEventReactions: () => undefined,
  getLatestEdit: () => undefined,
  getLatestMessageContent: (
    mEvent: { getContent: () => Record<string, unknown> },
    editedEvent?: { getContent: () => Record<string, unknown> }
  ) => editedEvent?.getContent() ?? mEvent.getContent(),
  getMemberDisplayName: () => 'Alice',
  hasUndecryptedNewerEdit: () => false,
  getPendingEdits: () => [],
  isHiddenReferenceEvent: () => false,
  isMembershipChanged: () => false,
  reactionOrEditEvent: (mEvent: { getRelation: () => { rel_type?: string } | undefined }) => {
    const relationType = mEvent.getRelation()?.rel_type;
    return relationType === RELATION_ANNOTATION || relationType === RELATION_REPLACE;
  },
  trimReplyFromBody: (body: string) => body,
}));

vi.mock('../../messages/content/MsgTypeRenderers', () => ({
  MSticker: passthrough,
}));
vi.mock('../../messages/reply/Reply', () => ({
  Reply: passthrough,
}));
vi.mock('../../messages/Time', () => ({
  Time: passthrough,
}));
vi.mock('../../messages/layout/layout', () => ({
  MessageBase: passthrough,
}));
vi.mock('../../messages/content/FallbackContent', () => ({
  MessageUnsupportedContent: passthrough,
  MessageNotDecryptedContent: passthrough,
}));
vi.mock('../../messages/content/ImageContent', () => ({
  ImageContent: passthrough,
}));

vi.mock('../../messages/ThreadIndicator', () => ({
  ThreadIndicator: passthrough,
}));

vi.mock('../../messages/thread-summary/ThreadSummaryCard', () => ({
  ThreadSummaryCard: passthrough,
}));

vi.mock('../../messages/thread-summary/ThreadSummaryMarker.css', () => ({
  Marker: 'Marker',
  MarkerTrigger: 'MarkerTrigger',
  MarkerDetails: 'MarkerDetails',
}));

vi.mock('../../messages/reactions/Reactions', () => ({
  Reactions: passthrough,
}));

vi.mock('../../messages/Message', async () => {
  const ReactImport = await import('react');

  return {
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
  };
});

vi.mock('../RoomIntro', () => ({
  RoomIntro: passthrough,
}));

// No plugin hides a row here (MessageRenderer.hidden); the real module would load the app's i18n.
vi.mock('../../plugins/messageRenderers', () => ({ useMessageRowHidden: () => undefined }));

vi.mock('../../messages/content/RenderMessageContent', () => ({
  RenderMessageContent: passthrough,
}));

vi.mock('../CollapsibleMessage', async () => {
  const ReactImport = await import('react');

  return {
    ExpandAllInitContext: ReactImport.createContext<boolean | undefined>(undefined),
    CollapsibleMessageStateProvider: ({
      children,
      expandAllInit,
      manualExpansionState,
    }: {
      children: React.ReactNode;
      expandAllInit: boolean | undefined;
      manualExpansionState: Map<string, boolean>;
    }) =>
      ReactImport.createElement(
        'collapsible-message-state-provider',
        { expandAllInit, manualExpansionState },
        children
      ),
    CollapsibleMessage: ({
      children,
      collapseMode = 'default',
      expansionKey,
      forceOverflowing,
      onInitialExpandConsumed,
    }: {
      children:
        | React.ReactNode
        | ((state: { expanded: boolean; loadFullContent: boolean }) => React.ReactNode);
      collapseMode?: string;
      expansionKey?: string;
      forceOverflowing?: boolean;
      onInitialExpandConsumed?: () => void;
    }) => {
      const previousCollapseModeRef = ReactImport.useRef<string | undefined>(undefined);
      const expanded = collapseMode !== 'default';
      const renderedChildren =
        typeof children === 'function' ? children({ expanded, loadFullContent: true }) : children;

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
          expansionKey,
          forceOverflowing,
          'data-testid': collapsibleTestId,
        },
        renderedChildren
      );
    },
  };
});

vi.mock('../../ui/media/Media', () => ({
  Image: passthrough,
}));

vi.mock('../../messages/viewers/ImageViewer', () => ({
  ImageViewer: passthrough,
}));

vi.mock('../../notifications/readReceipts', () => ({
  markMainTimelineAsRead: vi.fn(),
  markRoomAndThreadsAsRead: vi.fn(),
  markThreadAsRead: vi.fn(),
}));

vi.mock('../../lib/dom', () => ({
  editableActiveElement: () => null,
  scrollToBottom: vi.fn(),
}));

vi.mock('../../lib/time', () => ({
  inSameDay: () => true,
  minuteDifference: () => 0,
  timeDayMonthYear: () => 'time',
  today: () => true,
  yesterday: () => false,
}));

vi.mock('../../editor/utils', () => ({
  createMentionElement: () => ({}),
  isEmptyEditor: () => true,
  moveCursor: vi.fn(),
}));

vi.mock('../../composer/roomInputDrafts', () => ({
  composerReplyDraftAtom: () => ({}),
}));

vi.mock('../../matrix/state/roomToParents', () => ({
  roomToParentsAtom: {},
}));

vi.mock('../../matrix/state/roomToUnread', () => ({
  roomToUnreadAtom: {},
}));

vi.mock('../../event-store/threads/threadUtils', () => ({
  buildThreadParticipantMap: () => new Map(),
  buildThreadReplyCountMap: () => new Map(),
  buildVisibleThreadParticipantMap: () => new Map(),
  buildVisibleThreadReplyCountMap: () => new Map(),
  eventBelongsToThread: (
    mEvent: { getId: () => string; threadRootId?: string },
    threadId: string
  ) => !!threadId && mEvent.threadRootId === threadId && mEvent.getId() !== threadId,
  getLatestRenderableVisibleThreadReplyEvent: () => undefined,
  getPreferredVisibleThreadReplyEvents: () => [],
  getVisibleThreadEventBodyPreviewText: () => undefined,
  getVisibleThreadMessageCount: () => 0,
  getVisibleThreadParticipantIds: () => [],
  isVisibleThreadTextMessageEventType: (eventType?: string) =>
    eventType === 'm.room.message' || eventType === 'm.room.encrypted',
  isThreadReplyEvent: (eventId?: string, threadRootId?: string) =>
    !!eventId && !!threadRootId && eventId !== threadRootId,
}));

vi.mock('../useThreadRenderState', async () => {
  const setSupplementalThreadEvents = (
    _threadId: string,
    events: Array<{ getId: () => string }>
  ) => {
    threadRenderStateControl.initialThreadEvents = [
      ...threadRenderStateControl.initialThreadEvents,
      ...events,
    ];
    threadRenderStateControl.currentThreadEvents = threadRenderStateControl.initialThreadEvents;
  };

  const resetThreadRenderState = vi.fn();
  return {
    useThreadRenderState: () => {
      const threadEvents = threadRenderStateControl.initialThreadEvents as Array<{
        getId: () => string;
      }>;

      threadRenderStateControl.currentThreadEvents = threadEvents;

      const threadEventIndexMapRef = {
        current: new Map(threadEvents.map((event, index) => [event.getId(), index])),
      };

      return {
        threadEventIndexMapRef,
        threadEvents,
        threadInitialRenderMode: threadRenderStateControl.threadInitialRenderMode,
        setSupplementalThreadEvents,
        resetThreadRenderState,
      };
    },
  };
});

// ISSUE-207 P2.3: cache APIs now come from `../cacheStore` (single
// choke point). The legacy `threadEventCache` / `roomEventCache` /
// `threadSummaryCache` shim files were deleted.
vi.mock('../../event-store/cache/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../event-store/cache/db')>();
  return {
    ...actual,
    getThreadCursorAnchor: () => undefined,
    loadCachedThreadEventsBefore: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
    loadLatestCachedThreadEvents: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
    normalizeCachedThreadEvents: (events: unknown[]) => events,
    saveThreadEventsToCache: vi.fn(async () => undefined),
    getRoomCursorAnchor: () => undefined,
    loadCachedRoomEventsBefore: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
    loadLatestCachedRoomEvents: vi.fn(async () => ({ events: [], hasMoreBefore: false })),
    loadCachedRoomPaginationToken: vi.fn(async () => undefined),
    normalizeCachedRoomEvents: (events: unknown[]) => events,
    saveRoomEventsToCache: vi.fn(async () => undefined),
    loadCachedThreadSummaries: vi.fn(async () => new Map()),
    saveCachedThreadSummary: vi.fn(async () => undefined),
  };
});

// ISSUE-207 P2.3: partial mock: the cache store modules import more
// of this module, so a fully synthetic
// mock breaks the `../cacheStore` mock above (which uses
// `importOriginal`). Keep the real module intact and only override
// the comparison helper.
vi.mock('../../event-store/cache/eventCacheTokenUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../event-store/cache/eventCacheTokenUtils')>();
  return {
    ...actual,
    compareCachedPaginationAnchors: () => 0,
  };
});

vi.mock('../../event-store/cache/eventCacheEditUtils', () => ({
  aggregateCachedRelationEvents: vi.fn(),
  hydrateCachedEvents: vi.fn(),
  serializeEventsForCache: () => [],
}));

vi.mock('../../event-store/timeline/timelineScrollUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../event-store/timeline/timelineScrollUtils')>();
  return {
    ...actual,
    isScrollNearBottom: () => true,
    isTimelineAtLiveEnd: () => true,
    shouldAutoScrollRoomOnLiveEvent: shouldAutoScrollRoomOnLiveEventMock,
    shouldAutoScrollThreadOnLiveEvent: () => false,
  };
});

vi.mock('../../event-store/threads/threadEditBackfill', () => ({
  hasLikelyIncompleteStreamingBody: () => false,
  markThreadEditBackfillAttempted: vi.fn(),
  shouldFetchThreadEditBackfill: () => false,
}));

vi.mock('../../event-store/threads/threadEditBackfill', () => ({
  hasLikelyIncompleteStreamingBody: () => false,
  markThreadEditBackfillAttempted: vi.fn(),
  shouldFetchThreadEditBackfill: () => false,
}));

vi.mock('../../threads/overview/RoomThreadOverview', () => ({
  RoomThreadOverview: roomThreadOverviewType,
}));

vi.mock('../../threads/overview/CompactRoomView', () => ({
  CompactRoomView: passthrough,
}));

vi.mock('../../threads/tags/useRoomThreadTags', () => ({
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
// `makeRoom`'s viewer is the default `makeEvent` sender, so live tests that expect
// expand-once use another person; agent replies always show in full.
const OTHER_PERSON_ID = '@bob:example.org';
const AGENT_USER_ID = '@mindroom_general:example.org';
const mountedRenderers = new Set<ReactTestRenderer>();

const createTrackedRenderer = (element: React.ReactElement) => {
  const renderer = create(element);
  mountedRenderers.add(renderer);
  return renderer;
};

type MockEvent = {
  __editedEvent?: {
    getContent: () => Record<string, unknown>;
    getId: () => string;
    getSender: () => string;
    getTs: () => number;
  };
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
  isEncrypted: () => boolean;
  getUnsigned: () => Record<string, unknown>;
  isRedacted: () => boolean;
  isRedaction: () => boolean;
  isThreadRoot: boolean;
  replacingEvent: () => { getContent: () => Record<string, unknown> } | undefined;
  replyEventId?: string;
  threadRootId?: string;
};

const makeEvent = (
  eventId: string,
  opts: {
    content?: Record<string, unknown>;
    editedContent?: Record<string, unknown>;
    /** Decrypted: its type is the clear one, but it came encrypted. */
    encrypted?: boolean;
    isThreadRoot?: boolean;
    relation?: { event_id?: string; rel_type?: string };
    sender?: string;
    threadRootId?: string;
    ts?: number;
    type?: string;
  } = {}
): MockEvent => ({
  __editedEvent: opts.editedContent
    ? {
        getContent: () => opts.editedContent as Record<string, unknown>,
        getId: () => `${eventId}|edit`,
        getSender: () => opts.sender ?? '@alice:example.org',
        getTs: () => (opts.ts ?? 1) + 1,
      }
    : undefined,
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
  isEncrypted: () => opts.encrypted ?? false,
  getUnsigned: () => ({}),
  isRedacted: () => false,
  isRedaction: () => false,
  isThreadRoot: opts.isThreadRoot ?? false,
  replacingEvent: () => undefined,
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
      liveEvents.some((event) => event.getId() === eventId) ? liveTimeline : undefined,
  };
  const threadTimelineSet = {
    getLiveTimeline: () => threadTimeline,
    getTimelineForEvent: (eventId: string) =>
      getThreadEvents().some((event) => event.getId() === eventId) ? threadTimeline : undefined,
  };

  liveTimeline.getTimelineSet = () => roomTimelineSet;
  threadTimeline.getTimelineSet = () => threadTimelineSet;

  return {
    __listeners: listeners,
    roomId: ROOM_ID,
    myUserId: '@alice:example.org',
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
    getThreads: () => [],
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
  const defaultThreadFilterState = {
    ...createDefaultThreadFilterState(),
    sortBy: 'natural' as const,
    sortDirection: 'desc' as const,
    tags: new Map(),
  };

  return function ControlledRoomTimelineHarness({
    room,
    threadId,
  }: {
    room: ReturnType<typeof makeRoom>;
    threadId?: string;
  }) {
    // ISSUE-207 P3.3: wrap in a SyncEngine provider so the
    // component's `useSyncEngine` resolves. The persist facade
    // is real; its writes route through the mocked cacheStore fns
    // used by these tests' own vi.mock setup.
    // eslint-disable-next-line react/no-children-prop
    return React.createElement(SyncEngineProvider, {
      engine: harnessSyncEngine,
      children: React.createElement(RoomTimelineComponent, {
        room,
        threadId,
        summaryMap: new Map(),
        onStoreThreadSummary: vi.fn(),
        threadFilterState: defaultThreadFilterState,
        threadSortFreezeState: null,
        onToggle: vi.fn(),
        onSortDirectionChange: vi.fn(),
        onToggleThreadSortFreeze: vi.fn(),
        setThreadSortFreezeState: vi.fn(),
        onAddTag: vi.fn(),
        onRemoveTag: vi.fn(),
        onReset: vi.fn(),
        onApplyPreset: vi.fn(),
        onSearchQueryChange: vi.fn(),
        viewMode: 'threaded',
        roomInputRef,
        editor,
      }),
    });
  };
};

const HARNESS_TEST_SESSION_ID = 'test-session';
const harnessSyncEngine: SyncEngine = {
  mx: {} as SyncEngine['mx'],
  sessionId: HARNESS_TEST_SESSION_ID,
  start: () => undefined,
  stop: () => undefined,
  isLiveMode: () => true,
  persist: createEnginePersistFacade({ sessionId: HARNESS_TEST_SESSION_ID }),
  // ISSUE-207 P4.1 / P4.2: harness engine needs a scheduler + a
  // noteRoomFocused no-op so the RoomTimeline useEffect that fires
  // per-mount doesn't crash when TypeScript's structural check happens
  // to pass but the real object lacks the field.
  scheduler: createBackfillScheduler(),
  noteRoomFocused: () => undefined,
  subscribeRoomRecovery: () => () => undefined,
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

const findCollapsibleForEvent = (renderer: ReactTestRenderer, eventId: string) =>
  renderer.root
    .find(
      (node) =>
        node.type === messageType &&
        node.props['data-testid'] === messageTestId &&
        node.props['data-message-id'] === eventId
    )
    .find(
      (node) => node.type === collapsibleType && node.props['data-testid'] === collapsibleTestId
    );

const findRenderMessageContentPropsForEvent = (renderer: ReactTestRenderer, eventId: string) =>
  renderer.root
    .find(
      (node) =>
        node.type === messageType &&
        node.props['data-testid'] === messageTestId &&
        node.props['data-message-id'] === eventId
    )
    .find((node) => node.type === passthrough && typeof node.props.getContent === 'function').props;

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

afterEach(() => {
  mountedRenderers.forEach((renderer) => renderer.unmount());
  mountedRenderers.clear();
});

importBeforeTests(() => import('../RoomTimeline'));

describe('RoomTimeline collapsible wiring', () => {
  it('uses always-expanded mode for thread summary messages resolved from edits', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
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
      renderer = createTrackedRenderer(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$summary')).toBe('always-expanded');
  }, 10000);

  it('uses always-expanded mode for legacy boolean thread summaries', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
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
      renderer = createTrackedRenderer(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$legacy-summary')).toBe('always-expanded');
  });

  it('uses default mode for historical messages', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
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
      renderer = createTrackedRenderer(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$historical')).toBe('default');
    expect(findCollapsibleForEvent(renderer, '$historical').props.expansionKey).toBe('$historical');
  });

  it('starts every timeline with long messages folded', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const room = makeRoom({ liveEvents: [makeEvent('$historical')] });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = createTrackedRenderer(React.createElement(ControlledRoomTimeline, { room }));
      await flushAsyncWork(2);
    });

    expect(renderer.root.findByType('collapsible-message-state-provider').props.expandAllInit).toBe(
      false
    );
  });

  it("shows agent replies in full and folds people's long messages", async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const room = makeRoom({
      liveEvents: [
        makeEvent('$person'),
        makeEvent('$agent', { sender: AGENT_USER_ID }),
        // Detected by sender only, so streamed metadata cannot flip a row's mode mid-life.
        makeEvent('$metadata-only', {
          content: { body: 'Reply', msgtype: 'm.text', 'io.mindroom.tool_trace': [] },
          sender: '@bridged:example.org',
        }),
      ],
    });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = createTrackedRenderer(React.createElement(ControlledRoomTimeline, { room }));
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$person')).toBe('default');
    expect(findCollapseModeForEvent(renderer, '$agent')).toBe('always-expanded');
    expect(findCollapseModeForEvent(renderer, '$metadata-only')).toBe('default');
  });

  it('clears remembered per-message choices before applying an expand-all baseline', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
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
      renderer = createTrackedRenderer(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    const provider = renderer.root.findByType('collapsible-message-state-provider');
    const manualExpansionState = provider.props.manualExpansionState as Map<string, boolean>;
    manualExpansionState.set('$historical', true);
    const expandAllButton = renderer.root.find(
      (node) =>
        node.type === 'button' &&
        node.children.some(
          (child) =>
            typeof child === 'string' &&
            (child === '[+all]' || child === 'Expand all' || child.endsWith('.all2'))
        )
    );

    act(() => {
      expandAllButton.props.onClick({ preventDefault: vi.fn() });
    });

    expect(manualExpansionState.size).toBe(0);
    const refreshedProvider = renderer.root.findByType('collapsible-message-state-provider');
    expect(refreshedProvider.props.expandAllInit).toBe(true);
    expect(refreshedProvider.props.manualExpansionState).toBe(manualExpansionState);
  });

  it('hydrates rich long-text content while a default room message row stays collapsed', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const longTextEvent = makeEvent('$long-text', {
      content: {
        body: 'Long output.txt',
        msgtype: 'm.file',
        url: 'mxc://server/long-text',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
    });
    const room = makeRoom({ liveEvents: [longTextEvent] });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = createTrackedRenderer(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$long-text')).toBe('default');
    expect(findCollapsibleForEvent(renderer, '$long-text').props.forceOverflowing).toBe(true);
    expect(findRenderMessageContentPropsForEvent(renderer, '$long-text').hydrateLongText).toBe(
      true
    );
  });

  it('hydrates rich long-text content in a collapsed decrypted message row', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const encryptedLongTextEvent = makeEvent('$encrypted-long-text', {
      encrypted: true,
      content: {
        body: 'Encrypted long output.txt',
        msgtype: 'm.file',
        url: 'mxc://server/encrypted-long-text',
        'io.mindroom.long_text': {
          version: 2,
          encoding: 'matrix_event_content_json',
        },
      },
    });
    const room = makeRoom({ liveEvents: [encryptedLongTextEvent] });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = createTrackedRenderer(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$encrypted-long-text')).toBe('default');
    expect(findCollapsibleForEvent(renderer, '$encrypted-long-text').props.forceOverflowing).toBe(
      true
    );
    expect(
      findRenderMessageContentPropsForEvent(renderer, '$encrypted-long-text').hydrateLongText
    ).toBe(true);
  });

  it('forces overflow for very long plain text without measuring the collapsed row', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const longPlainTextEvent = makeEvent('$long-plain-text', {
      content: {
        body: Array.from({ length: 120 }, (_value, index) => `long line ${index}`).join('\n'),
        msgtype: 'm.text',
      },
    });
    const room = makeRoom({ liveEvents: [longPlainTextEvent] });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = createTrackedRenderer(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$long-plain-text')).toBe('default');
    expect(findCollapsibleForEvent(renderer, '$long-plain-text').props.forceOverflowing).toBe(true);
  });

  it('uses initially-expanded mode for visible live messages and consumes it after mount', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const historicalEvent = makeEvent('$historical');
    const liveEvent = makeEvent('$live', {
      content: {
        body: 'Live message',
        msgtype: 'm.text',
      },
      sender: OTHER_PERSON_ID,
    });
    const liveEvents = [historicalEvent];
    const room = makeRoom({ liveEvents });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = createTrackedRenderer(
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

  it("keeps the viewer's own live message in default mode", async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const ownLiveEvent = makeEvent('$own-live', {
      content: {
        body: 'Own live message',
        msgtype: 'm.text',
      },
    });
    const liveEvents = [makeEvent('$historical')];
    const room = makeRoom({ liveEvents });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = createTrackedRenderer(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    liveEvents.push(ownLiveEvent);
    await emitLiveTimelineEvent(room, ownLiveEvent);

    expect(findCollapseModeForEvent(renderer, '$own-live')).toBe('default');
  });

  it("keeps the viewer's own message in default mode when its live edit arrives", async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const liveEvents = [
      makeEvent('$own-target', {
        content: {
          body: 'Original message',
          msgtype: 'm.text',
        },
        editedContent: {
          body: 'Edited message',
          msgtype: 'm.text',
        },
      }),
    ];
    const room = makeRoom({ liveEvents });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = createTrackedRenderer(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    const ownEdit = makeEvent('$own-replace', {
      content: {
        body: 'Edited message',
        msgtype: 'm.text',
        'm.new_content': {
          body: 'Edited message',
          msgtype: 'm.text',
        },
      },
      relation: {
        event_id: '$own-target',
        rel_type: RELATION_REPLACE,
      },
    });
    liveEvents.push(ownEdit);
    await emitLiveTimelineEvent(room, ownEdit);

    expect(findCollapseModeForEvent(renderer, '$own-target')).toBe('default');
  });

  it('marks live edit targets for initially-expanded mode and consumes the flag after rerender', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const targetEvent = makeEvent('$target', {
      content: {
        body: 'Original message',
        msgtype: 'm.text',
      },
      editedContent: {
        body: 'Expanded message after streaming edit',
        msgtype: 'm.text',
      },
      sender: OTHER_PERSON_ID,
    });
    const liveEvents = [targetEvent];
    const room = makeRoom({ liveEvents });
    const ControlledRoomTimeline = createControlledRoomTimelineHarness(RoomTimeline as never);
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = createTrackedRenderer(
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
        sender: OTHER_PERSON_ID,
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

  it('uses always-expanded mode for a decrypted room message', async () => {
    const { RoomTimeline } = await import('../RoomTimeline');
    const encryptedSummaryEvent = makeEvent('$encrypted-summary', {
      encrypted: true,
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
      renderer = createTrackedRenderer(
        React.createElement(ControlledRoomTimeline, {
          room,
        })
      );
      await flushAsyncWork(2);
    });

    expect(findCollapseModeForEvent(renderer, '$encrypted-summary')).toBe('always-expanded');
    expect(findCollapsibleForEvent(renderer, '$encrypted-summary').props.expansionKey).toBe(
      '$encrypted-summary'
    );
  });

  it('uses always-expanded mode for messages with MindRoom extras', async () => {
    const { getCollapsibleMessageMode } = await import('../threadCollapsibleMessages');
    const eventWithExtras = makeEvent('$extras', {
      content: {
        body: 'Message with extras',
        msgtype: 'm.text',
        'com.mindroom.message_extras': {
          version: 1,
          sections: [
            {
              title: 'Evidence',
              content_type: 'text/plain',
              content: 'extra payload',
            },
          ],
        },
      },
    });

    expect(
      getCollapsibleMessageMode(eventWithExtras.getId(), eventWithExtras.getContent(), new Set())
    ).toBe('always-expanded');
  });

  it('keeps long-text sidecar messages folded — hydration must not auto-expand them', async () => {
    // Device report 2026-07-06: long-text-replaced messages unfolded by
    // themselves the moment their attachment hydrated, while every other
    // long message stayed folded. They now fold like everything else; the
    // "Show more" affordance is guaranteed by the force-overflow heuristic.
    const { getCollapsibleMessageMode, shouldForceCollapsibleMessageOverflow } = await import(
      '../threadCollapsibleMessages'
    );
    const longTextContent = {
      body: 'Long text sidecar',
      msgtype: 'm.file',
      url: 'mxc://server/long-text',
      'io.mindroom.long_text': {
        version: 2,
        encoding: 'matrix_event_content_json',
      },
    };

    expect(getCollapsibleMessageMode('$long-text', longTextContent, new Set())).toBe('default');
    expect(shouldForceCollapsibleMessageOverflow(longTextContent)).toBe(true);
  });

  it('does not force "Show more" on a canvas answer, which shows as a one-line receipt', async () => {
    const { shouldForceCollapsibleMessageOverflow } = await import('../threadCollapsibleMessages');
    const marker = { version: 1, canvas_event_id: '$canvas' };

    expect(
      shouldForceCollapsibleMessageOverflow({
        msgtype: 'm.text',
        body: `@agent:example.org Canvas response ($canvas, revision $canvas): Draft\n${'x'.repeat(
          2000
        )}`,
        'io.mindroom.canvas_response': marker,
      })
    ).toBe(false);
    expect(
      shouldForceCollapsibleMessageOverflow({
        msgtype: 'm.file',
        body: 'Canvas response',
        url: 'mxc://server/answer',
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        'io.mindroom.canvas_response': marker,
      })
    ).toBe(false);
  });

  it('does not force overflow from markup length alone', async () => {
    const { shouldForceCollapsibleMessageOverflow } = await import('../threadCollapsibleMessages');
    const links = Array.from({ length: 12 }, (_, index) => `source ${index}`);

    expect(
      shouldForceCollapsibleMessageOverflow({ body: 'x'.repeat(1500), msgtype: 'm.text' })
    ).toBe(true);
    // A few short lines of links: the HTML passes the length, the text renders well under a fold.
    expect(
      shouldForceCollapsibleMessageOverflow({
        msgtype: 'm.text',
        body: links.join('\n'),
        format: 'org.matrix.custom.html',
        formatted_body: links
          .map((link) => `<p><a href="https://example.org/${'path/'.repeat(20)}">${link}</a></p>`)
          .join(''),
      })
    ).toBe(false);
  });

  it('marks visible live thread replies for initially-expanded mode', async () => {
    const { getCollapsibleMessageMode, shouldTrackLiveCollapsibleMessage } = await import(
      '../threadCollapsibleMessages'
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
      sender: OTHER_PERSON_ID,
      threadRootId: '$thread-root',
    });
    const ownThreadReply = makeEvent('$own-thread-reply', {
      content: {
        body: 'Own thread reply',
        msgtype: 'm.text',
      },
      threadRootId: '$thread-root',
    });
    const room = makeRoom({
      liveEvents: [threadRootEvent],
      threadRootEvent,
    });
    const liveExpandOnceIds = new Set<string>();
    const trackOptions = {
      room: room as never,
      threadId: '$thread-root',
      threadFilterState: createDefaultThreadFilterState(),
      threadResolutionMap: threadResolutionMapMock,
      ignoredUsersSet: new Set<string>(),
      showHiddenEvents: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
    };

    expect(
      shouldTrackLiveCollapsibleMessage({ ...trackOptions, mEvent: liveThreadReply as never })
    ).toBe(true);
    expect(
      shouldTrackLiveCollapsibleMessage({ ...trackOptions, mEvent: ownThreadReply as never })
    ).toBe(false);

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
    const { getCollapsibleMessageMode } = await import('../threadCollapsibleMessages');
    const threadRootEvent = makeEvent('$thread-root', {
      content: {
        body: 'Thread root',
        msgtype: 'm.text',
      },
      isThreadRoot: true,
    });
    const cachedReply = makeEvent('$cached-reply', {
      content: {
        body: 'This is a long cached thread reply that should stay collapsed by default on first paint. '.repeat(
          6
        ),
        msgtype: 'm.text',
      },
      threadRootId: '$thread-root',
    });

    const liveExpandOnceIds = new Set<string>();

    expect(threadRootEvent.getId()).toBe('$thread-root');
    expect(cachedReply.threadRootId).toBe('$thread-root');
    expect(
      getCollapsibleMessageMode(cachedReply.getId(), cachedReply.getContent(), liveExpandOnceIds)
    ).toBe('default');
  });
});

vi.mock('../../approvals/ThreadApprovalControls', () => ({ ApprovalHistory: () => null }));
