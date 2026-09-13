import React, { createRef } from 'react';
import { Editor } from 'slate';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { passthrough } = vi.hoisted(() => ({
  passthrough: 'div',
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
    Scroll: passthrough,
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
  useMatrixClient: () => ({
    getHomeserverUrl: () => 'https://example.org',
    getSafeUserId: () => '@alice:example.org',
    getUserId: () => '@alice:example.org',
    getEventMapper: () => (rawEvent: unknown) => rawEvent,
    getRoom: () => null,
    paginateEventTimeline: vi.fn(),
    processAggregatedTimelineEvents: vi.fn(),
    fetchRelations: vi.fn(),
    getEventTimeline: vi.fn(),
    getThreadTimeline: vi.fn(),
    relations: vi.fn(),
  }),
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

vi.mock('./useThreadRenderState', () => ({
  useThreadRenderState: () => ({
    threadEventIndexMapRef: { current: new Map() },
    threadEvents: [],
    threadInitialRenderMode: 'live',
    setSupplementalThreadEvents: vi.fn(),
    resetThreadRenderState: vi.fn(),
  }),
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

  return {
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
    on: vi.fn(),
    removeListener: vi.fn(),
  };
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
});
