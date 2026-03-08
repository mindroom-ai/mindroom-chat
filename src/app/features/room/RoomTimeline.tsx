/* eslint-disable react/destructuring-assignment */
import React, {
  Dispatch,
  MouseEventHandler,
  RefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Direction,
  EventTimeline,
  EventTimelineSet,
  EventTimelineSetHandlerMap,
  IContent,
  MatrixClient,
  MatrixEvent,
  RelationType,
  Room,
  RoomEvent,
  RoomEventHandlerMap,
} from 'matrix-js-sdk';
import { HTMLReactParserOptions } from 'html-react-parser';
import classNames from 'classnames';
import { ReactEditor } from 'slate-react';
import { Editor } from 'slate';
import to from 'await-to-js';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  Badge,
  Box,
  Chip,
  ContainerColor,
  Icon,
  Icons,
  Line,
  Scroll,
  Text,
  as,
  color,
  config,
  toRem,
} from 'folds';
import { isKeyHotkey } from 'is-hotkey';
import { Opts as LinkifyOpts } from 'linkifyjs';
import { useTranslation } from 'react-i18next';
import { eventWithShortcode, factoryEventSentBy, getMxIdLocalPart } from '../../utils/matrix';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useVirtualPaginator, ItemRange } from '../../hooks/useVirtualPaginator';
import { useAlive } from '../../hooks/useAlive';
import { editableActiveElement, scrollToBottom } from '../../utils/dom';
import {
  DefaultPlaceholder,
  CompactPlaceholder,
  Reply,
  ThreadIndicator,
  MessageBase,
  MessageUnsupportedContent,
  Time,
  MessageNotDecryptedContent,
  RedactedContent,
  MSticker,
  ImageContent,
  EventContent,
} from '../../components/message';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
  makeMentionCustomProps,
  renderMatrixMention,
} from '../../plugins/react-custom-html-parser';
import {
  canEditEvent,
  decryptAllTimelineEvent,
  getEditedEvent,
  getEventReactions,
  getLatestEditableEvt,
  getMemberDisplayName,
  getReactionContent,
  isMembershipChanged,
  logEditDebug,
  reactionOrEditEvent,
} from '../../utils/room';
import { useSetting } from '../../state/hooks/settings';
import { MessageLayout, settingsAtom } from '../../state/settings';
import { useMatrixEventRenderer } from '../../hooks/useMatrixEventRenderer';
import { Reactions, Message, Event, EncryptedContent } from './message';
import { useMemberEventParser } from '../../hooks/useMemberEventParser';
import * as customHtmlCss from '../../styles/CustomHtml.css';
import { RoomIntro } from '../../components/room-intro';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../hooks/useIntersectionObserver';
import { markAsRead } from '../../utils/notifications';
import { useDebounce } from '../../hooks/useDebounce';
import { getResizeObserverEntry, useResizeObserver } from '../../hooks/useResizeObserver';
import * as css from './RoomTimeline.css';
import { inSameDay, minuteDifference, timeDayMonthYear, today, yesterday } from '../../utils/time';
import { createMentionElement, isEmptyEditor, moveCursor } from '../../components/editor';
import { roomIdToReplyDraftAtomFamily } from '../../state/room/roomInputDrafts';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { GetContentCallback, MessageEvent, StateEvent } from '../../../types/matrix/room';
import { useKeyDown } from '../../hooks/useKeyDown';
import { useDocumentFocusChange } from '../../hooks/useDocumentFocusChange';
import { RenderMessageContent } from '../../components/RenderMessageContent';
import { Image } from '../../components/media';
import { ImageViewer } from '../../components/image-viewer';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { useMentionClickHandler } from '../../hooks/useMentionClickHandler';
import { useSpoilerClickHandler } from '../../hooks/useSpoilerClickHandler';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useIgnoredUsers } from '../../hooks/useIgnoredUsers';
import { useImagePackRooms } from '../../hooks/useImagePackRooms';
import { useIsDirectRoom } from '../../hooks/useRoom';
import { useOpenUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useAccessiblePowerTagColors, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { useTheme } from '../../hooks/useTheme';
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';
import {
  buildThreadParticipantMap,
  buildThreadReplyCountMap,
  eventBelongsToThread,
  isThreadReplyEvent,
} from './threadUtils';
import {
  isScrollNearBottom,
  isTimelineAtLiveEnd,
  shouldAutoScrollThreadOnLiveEvent,
} from './timelineScrollUtils';

const TimelineFloat = as<'div', css.TimelineFloatVariants>(
  ({ position, className, ...props }, ref) => (
    <Box
      className={classNames(css.TimelineFloat({ position }), className)}
      justifyContent="Center"
      alignItems="Center"
      gap="200"
      {...props}
      ref={ref}
    />
  )
);

const TimelineDivider = as<'div', { variant?: ContainerColor | 'Inherit' }>(
  ({ variant, children, ...props }, ref) => (
    <Box gap="100" justifyContent="Center" alignItems="Center" {...props} ref={ref}>
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
      {children}
      <Line style={{ flexGrow: 1 }} variant={variant} size="300" />
    </Box>
  )
);

export const getLiveTimeline = (room: Room): EventTimeline =>
  room.getUnfilteredTimelineSet().getLiveTimeline();

export const getEventTimeline = (room: Room, eventId: string): EventTimeline | undefined => {
  const timelineSet = room.getUnfilteredTimelineSet();
  return timelineSet.getTimelineForEvent(eventId) ?? undefined;
};

export const getFirstLinkedTimeline = (
  timeline: EventTimeline,
  direction: Direction
): EventTimeline => {
  const linkedTm = timeline.getNeighbouringTimeline(direction);
  if (!linkedTm) return timeline;
  return getFirstLinkedTimeline(linkedTm, direction);
};

export const getLinkedTimelines = (timeline: EventTimeline): EventTimeline[] => {
  const firstTimeline = getFirstLinkedTimeline(timeline, Direction.Backward);
  const timelines: EventTimeline[] = [];

  for (
    let nextTimeline: EventTimeline | null = firstTimeline;
    nextTimeline;
    nextTimeline = nextTimeline.getNeighbouringTimeline(Direction.Forward)
  ) {
    timelines.push(nextTimeline);
  }
  return timelines;
};

export const timelineToEventsCount = (t: EventTimeline) => t.getEvents().length;
export const getTimelinesEventsCount = (timelines: EventTimeline[]): number => {
  const timelineEventCountReducer = (count: number, tm: EventTimeline) =>
    count + timelineToEventsCount(tm);
  return timelines.reduce(timelineEventCountReducer, 0);
};

const getThreadReplyCount = (
  room: Room,
  mEvent: MatrixEvent,
  fallbackReplyCount?: number
): number | undefined => {
  const threadMeta = mEvent.getUnsigned()?.['m.relations']?.['m.thread'] as
    | { count?: unknown; c?: unknown }
    | undefined;
  if (typeof threadMeta?.count === 'number') return threadMeta.count;
  if (typeof threadMeta?.c === 'number') return threadMeta.c;

  // Prefer SDK thread model when available.
  const eventId = mEvent.getId();
  if (!eventId) return undefined;
  const thread = room.getThread(eventId);
  const threadLength = thread?.length;
  if (threadLength > 0) return threadLength;

  // Runtime fallback for threadSupport-disabled mode:
  // derive counts from loaded room timeline events.
  if (typeof fallbackReplyCount === 'number' && fallbackReplyCount > 0) {
    return fallbackReplyCount;
  }

  return undefined;
};

const THREAD_PARTICIPANT_LIMIT = 3;

const getThreadParticipantIds = (
  room: Room,
  mEvent: MatrixEvent,
  fallbackParticipantIds?: string[]
): string[] | undefined => {
  const eventId = mEvent.getId();
  if (eventId) {
    const thread = room.getThread(eventId);
    if (thread?.events?.length) {
      const participants =
        buildThreadParticipantMap(thread.events, THREAD_PARTICIPANT_LIMIT).get(eventId) ?? [];
      if (participants.length > 0) return participants;
    }
  }

  if (fallbackParticipantIds && fallbackParticipantIds.length > 0) {
    return fallbackParticipantIds.slice(0, THREAD_PARTICIPANT_LIMIT);
  }

  return undefined;
};

export const getTimelineAndBaseIndex = (
  timelines: EventTimeline[],
  index: number
): [EventTimeline | undefined, number] => {
  let uptoTimelineLen = 0;
  const timeline = timelines.find((t) => {
    uptoTimelineLen += t.getEvents().length;
    if (index < uptoTimelineLen) return true;
    return false;
  });
  if (!timeline) return [undefined, 0];
  return [timeline, uptoTimelineLen - timeline.getEvents().length];
};

export const getTimelineRelativeIndex = (absoluteIndex: number, timelineBaseIndex: number) =>
  absoluteIndex - timelineBaseIndex;

export const getTimelineEvent = (timeline: EventTimeline, index: number): MatrixEvent | undefined =>
  timeline.getEvents()[index];

export const getEventIdAbsoluteIndex = (
  timelines: EventTimeline[],
  eventTimeline: EventTimeline,
  eventId: string
): number | undefined => {
  const timelineIndex = timelines.findIndex((t) => t === eventTimeline);
  if (timelineIndex === -1) return undefined;
  const eventIndex = eventTimeline.getEvents().findIndex((evt) => evt.getId() === eventId);
  if (eventIndex === -1) return undefined;
  const baseIndex = timelines
    .slice(0, timelineIndex)
    .reduce((accValue, timeline) => timeline.getEvents().length + accValue, 0);
  return baseIndex + eventIndex;
};

type RoomTimelineProps = {
  room: Room;
  eventId?: string;
  threadId?: string;
  roomInputRef: RefObject<HTMLElement>;
  editor: Editor;
};

const PAGINATION_LIMIT = 80;

const getEventElementById = (
  container: ParentNode | null | undefined,
  eventId: string
): HTMLElement | null => {
  if (!container) return null;
  const messageItems = container.querySelectorAll<HTMLElement>('[data-message-id]');
  for (const item of messageItems) {
    if (item.getAttribute('data-message-id') === eventId) {
      return item;
    }
  }
  return null;
};

type Timeline = {
  linkedTimelines: EventTimeline[];
  range: ItemRange;
};

const useEventTimelineLoader = (
  mx: MatrixClient,
  room: Room,
  onLoad: (eventId: string, linkedTimelines: EventTimeline[], evtAbsIndex: number) => void,
  onError: (err: Error | null) => void
) => {
  const loadEventTimeline = useCallback(
    async (eventId: string) => {
      const [err, replyEvtTimeline] = await to(
        mx.getEventTimeline(room.getUnfilteredTimelineSet(), eventId)
      );
      if (!replyEvtTimeline) {
        onError(err ?? null);
        return;
      }
      const linkedTimelines = getLinkedTimelines(replyEvtTimeline);
      const absIndex = getEventIdAbsoluteIndex(linkedTimelines, replyEvtTimeline, eventId);

      if (absIndex === undefined) {
        onError(err ?? null);
        return;
      }

      onLoad(eventId, linkedTimelines, absIndex);
    },
    [mx, room, onLoad, onError]
  );

  return loadEventTimeline;
};

const useTimelinePagination = (
  mx: MatrixClient,
  timeline: Timeline,
  setTimeline: Dispatch<SetStateAction<Timeline>>,
  limit: number
) => {
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const alive = useAlive();

  const handleTimelinePagination = useMemo(() => {
    let fetching = false;

    const recalibratePagination = (
      linkedTimelines: EventTimeline[],
      timelinesEventsCount: number[],
      backwards: boolean
    ) => {
      const topTimeline = linkedTimelines[0];
      const timelineMatch = (mt: EventTimeline) => (t: EventTimeline) => t === mt;

      const newLTimelines = getLinkedTimelines(topTimeline);
      const topTmIndex = newLTimelines.findIndex(timelineMatch(topTimeline));
      const topAddedTm = topTmIndex === -1 ? [] : newLTimelines.slice(0, topTmIndex);

      const topTmAddedEvt =
        timelineToEventsCount(newLTimelines[topTmIndex]) - timelinesEventsCount[0];
      const offsetRange = getTimelinesEventsCount(topAddedTm) + (backwards ? topTmAddedEvt : 0);

      setTimeline((currentTimeline) => ({
        linkedTimelines: newLTimelines,
        range:
          offsetRange > 0
            ? {
                start: currentTimeline.range.start + offsetRange,
                end: currentTimeline.range.end + offsetRange,
              }
            : { ...currentTimeline.range },
      }));
    };

    return async (backwards: boolean) => {
      if (fetching) return;
      const { linkedTimelines: lTimelines } = timelineRef.current;
      const timelinesEventsCount = lTimelines.map(timelineToEventsCount);

      const timelineToPaginate = backwards ? lTimelines[0] : lTimelines[lTimelines.length - 1];
      if (!timelineToPaginate) return;

      const paginationToken = timelineToPaginate.getPaginationToken(
        backwards ? Direction.Backward : Direction.Forward
      );
      if (
        !paginationToken &&
        getTimelinesEventsCount(lTimelines) !==
          getTimelinesEventsCount(getLinkedTimelines(timelineToPaginate))
      ) {
        recalibratePagination(lTimelines, timelinesEventsCount, backwards);
        return;
      }

      fetching = true;
      const [err] = await to(
        mx.paginateEventTimeline(timelineToPaginate, {
          backwards,
          limit,
        })
      );
      if (err) {
        // TODO: handle pagination error.
        return;
      }
      const fetchedTimeline =
        timelineToPaginate.getNeighbouringTimeline(
          backwards ? Direction.Backward : Direction.Forward
        ) ?? timelineToPaginate;
      // Decrypt all event ahead of render cycle
      const roomId = fetchedTimeline.getRoomId();
      const room = roomId ? mx.getRoom(roomId) : null;

      if (room?.hasEncryptionStateEvent()) {
        await to(decryptAllTimelineEvent(mx, fetchedTimeline));
      }

      fetching = false;
      if (alive()) {
        recalibratePagination(lTimelines, timelinesEventsCount, backwards);
      }
    };
  }, [mx, alive, setTimeline, limit]);
  return handleTimelinePagination;
};

const useLiveEventArrive = (room: Room, onArrive: (mEvent: MatrixEvent) => void) => {
  useEffect(() => {
    const handleTimelineEvent: EventTimelineSetHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      eventRoom,
      toStartOfTimeline,
      removed,
      data
    ) => {
      if (eventRoom?.roomId !== room.roomId || !data.liveEvent) return;
      onArrive(mEvent);
    };
    const handleRedaction: RoomEventHandlerMap[RoomEvent.Redaction] = (mEvent, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return;
      onArrive(mEvent);
    };

    room.on(RoomEvent.Timeline, handleTimelineEvent);
    room.on(RoomEvent.Redaction, handleRedaction);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimelineEvent);
      room.removeListener(RoomEvent.Redaction, handleRedaction);
    };
  }, [room, onArrive]);
};

const useLiveTimelineRefresh = (room: Room, onRefresh: () => void) => {
  useEffect(() => {
    const handleTimelineRefresh: RoomEventHandlerMap[RoomEvent.TimelineRefresh] = (r) => {
      if (r.roomId !== room.roomId) return;
      onRefresh();
    };

    room.on(RoomEvent.TimelineRefresh, handleTimelineRefresh);
    return () => {
      room.removeListener(RoomEvent.TimelineRefresh, handleTimelineRefresh);
    };
  }, [room, onRefresh]);
};

const getInitialTimeline = (room: Room) => {
  const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
  const evLength = getTimelinesEventsCount(linkedTimelines);
  return {
    linkedTimelines,
    range: {
      start: Math.max(evLength - PAGINATION_LIMIT, 0),
      end: evLength,
    },
  };
};

const getEmptyTimeline = () => ({
  range: { start: 0, end: 0 },
  linkedTimelines: [],
});

const getRoomUnreadInfo = (room: Room, scrollTo = false) => {
  const readUptoEventId = room.getEventReadUpTo(room.client.getUserId() ?? '');
  if (!readUptoEventId) return undefined;
  const evtTimeline = getEventTimeline(room, readUptoEventId);
  const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
  return {
    readUptoEventId,
    inLiveTimeline: latestTimeline === room.getLiveTimeline(),
    scrollTo,
  };
};

export function RoomTimeline({ room, eventId, threadId, roomInputRef, editor }: RoomTimelineProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const [messageLayout] = useSetting(settingsAtom, 'messageLayout');
  const [messageSpacing] = useSetting(settingsAtom, 'messageSpacing');
  const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
  const direct = useIsDirectRoom();
  const [hideMembershipEvents] = useSetting(settingsAtom, 'hideMembershipEvents');
  const [hideNickAvatarEvents] = useSetting(settingsAtom, 'hideNickAvatarEvents');
  const [mediaAutoLoad] = useSetting(settingsAtom, 'mediaAutoLoad');
  const [urlPreview] = useSetting(settingsAtom, 'urlPreview');
  const [encUrlPreview] = useSetting(settingsAtom, 'encUrlPreview');
  const showUrlPreview = room.hasEncryptionStateEvent() ? encUrlPreview : urlPreview;
  const [showHiddenEvents] = useSetting(settingsAtom, 'showHiddenEvents');
  const [showDeveloperTools] = useSetting(settingsAtom, 'developerTools');

  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

  const ignoredUsersList = useIgnoredUsers();
  const ignoredUsersSet = useMemo(() => new Set(ignoredUsersList), [ignoredUsersList]);

  const setReplyDraft = useSetAtom(roomIdToReplyDraftAtomFamily(room.roomId));
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const creatorsTag = useRoomCreatorsTag();
  const powerLevelTags = usePowerLevelTags(room, powerLevels);
  const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);

  const theme = useTheme();
  const accessiblePowerTagColors = useAccessiblePowerTagColors(
    theme.kind,
    creatorsTag,
    powerLevelTags
  );

  const permissions = useRoomPermissions(creators, powerLevels);

  const canRedact = permissions.action('redact', mx.getSafeUserId());
  const canDeleteOwn = permissions.event(MessageEvent.RoomRedaction, mx.getSafeUserId());
  const canSendReaction = permissions.event(MessageEvent.Reaction, mx.getSafeUserId());
  const canPinEvent = permissions.stateEvent(StateEvent.RoomPinnedEvents, mx.getSafeUserId());
  const [editId, setEditId] = useState<string>();

  const roomToParents = useAtomValue(roomToParentsAtom);
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const mentionClickHandler = useMentionClickHandler(room.roomId);
  const spoilerClickHandler = useSpoilerClickHandler();
  const openUserRoomProfile = useOpenUserRoomProfile();
  const space = useSpaceOptionally();

  const imagePackRooms: Room[] = useImagePackRooms(room.roomId, roomToParents);

  const [unreadInfo, setUnreadInfo] = useState(() => getRoomUnreadInfo(room, true));
  const readUptoEventIdRef = useRef<string>();
  if (unreadInfo) {
    readUptoEventIdRef.current = unreadInfo.readUptoEventId;
  }

  const atBottomAnchorRef = useRef<HTMLElement>(null);
  const [atBottom, setAtBottom] = useState<boolean>(true);
  const atBottomRef = useRef(atBottom);
  atBottomRef.current = atBottom;

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBottomRef = useRef({
    count: 0,
    smooth: true,
  });

  const [focusItem, setFocusItem] = useState<
    | {
        index: number;
        scrollTo: boolean;
        highlight: boolean;
      }
    | undefined
  >();
  const [threadLoadError, setThreadLoadError] = useState(false);
  const [threadPaginatingBack, setThreadPaginatingBack] = useState(false);
  const [threadPaginatingFront, setThreadPaginatingFront] = useState(false);
  const [threadTimelineTick, setThreadTimelineTick] = useState(0);
  const [pendingThreadOpenTick, setPendingThreadOpenTick] = useState(0);
  const threadPaginatingBackRef = useRef(false);
  const threadPaginatingFrontRef = useRef(false);
  const threadIdRef = useRef(threadId);
  const threadEventIndexMapRef = useRef<Map<string, number>>(new Map());
  const threadEditFetchAttemptedRef = useRef<Set<string>>(new Set());
  // SDK does not create Thread objects from fetchRelations responses, so we keep
  // a local fallback list to render thread replies when room.getThread(...) is null.
  const fallbackThreadEventsRef = useRef<{ threadId?: string; events: MatrixEvent[] }>({
    threadId: undefined,
    events: [],
  });
  const pendingThreadOpenRef = useRef<
    | {
        threadId: string;
        eventId: string;
        highlight: boolean;
        onScroll: ((scrolled: boolean) => void) | undefined;
        attempts: number;
      }
    | undefined
  >();
  const alive = useAlive();
  threadPaginatingBackRef.current = threadPaginatingBack;
  threadPaginatingFrontRef.current = threadPaginatingFront;
  threadIdRef.current = threadId;

  const linkifyOpts = useMemo<LinkifyOpts>(
    () => ({
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention((href) =>
        renderMatrixMention(mx, room.roomId, href, makeMentionCustomProps(mentionClickHandler))
      ),
    }),
    [mx, room, mentionClickHandler]
  );
  const htmlReactParserOptions = useMemo<HTMLReactParserOptions>(
    () =>
      getReactCustomHtmlParser(mx, room.roomId, {
        linkifyOpts,
        useAuthentication,
        handleSpoilerClick: spoilerClickHandler,
        handleMentionClick: mentionClickHandler,
      }),
    [mx, room, linkifyOpts, spoilerClickHandler, mentionClickHandler, useAuthentication]
  );
  const parseMemberEvent = useMemberEventParser();

  const [timeline, setTimeline] = useState<Timeline>(() =>
    eventId ? getEmptyTimeline() : getInitialTimeline(room)
  );
  const eventsLength = getTimelinesEventsCount(timeline.linkedTimelines);
  const liveTimelineLinked =
    timeline.linkedTimelines[timeline.linkedTimelines.length - 1] === getLiveTimeline(room);
  const canPaginateBack =
    typeof timeline.linkedTimelines[0]?.getPaginationToken(Direction.Backward) === 'string';
  const rangeAtStart = timeline.range.start === 0;
  const rangeAtEnd = timeline.range.end === eventsLength;
  const thread = threadId ? room.getThread(threadId) : null;
  const roomTimelineSet = room.getUnfilteredTimelineSet();
  const threadTimelineSet = thread?.getUnfilteredTimelineSet();
  const threadLinkedTimelines = threadTimelineSet
    ? getLinkedTimelines(threadTimelineSet.getLiveTimeline())
    : [];
  const lastThreadTimeline = threadLinkedTimelines[threadLinkedTimelines.length - 1];
  const canPaginateThreadBack =
    typeof threadLinkedTimelines[0]?.getPaginationToken(Direction.Backward) === 'string';
  const canPaginateThreadFront =
    typeof lastThreadTimeline?.getPaginationToken(Direction.Forward) === 'string';
  const timelineAtLiveEnd = isTimelineAtLiveEnd({
    threadId,
    liveTimelineLinked,
    rangeAtEnd,
    canPaginateThreadFront,
  });
  const atLiveEndRef = useRef(timelineAtLiveEnd);
  atLiveEndRef.current = timelineAtLiveEnd;

  const handleTimelinePagination = useTimelinePagination(
    mx,
    timeline,
    setTimeline,
    PAGINATION_LIMIT
  );

  const paginateThreadForwardToLatest = useCallback(
    async (expectedThreadId: string): Promise<boolean> => {
      if (threadPaginatingFrontRef.current) return false;

      setThreadPaginatingFront(true);
      threadPaginatingFrontRef.current = true;

      try {
        const loadMoreToLatest = async (): Promise<boolean> => {
          if (threadIdRef.current !== expectedThreadId) return false;

          const currentThread = room.getThread(expectedThreadId);
          const currentTimelineSet = currentThread?.getUnfilteredTimelineSet();
          const currentLinkedTimelines = currentTimelineSet
            ? getLinkedTimelines(currentTimelineSet.getLiveTimeline())
            : [];
          const currentLastTimeline = currentLinkedTimelines[currentLinkedTimelines.length - 1];
          if (!currentLastTimeline?.getPaginationToken(Direction.Forward)) {
            return false;
          }

          const [err, didLoadMore] = await to(
            mx.paginateEventTimeline(currentLastTimeline, {
              backwards: false,
              limit: PAGINATION_LIMIT,
            })
          );
          if (err || !didLoadMore) return false;

          await loadMoreToLatest();
          return true;
        };

        return loadMoreToLatest();
      } finally {
        setThreadPaginatingFront(false);
        threadPaginatingFrontRef.current = false;
      }
    },
    [mx, room]
  );

  const getScrollElement = useCallback(() => scrollRef.current, []);

  const { getItems, scrollToItem, scrollToElement, observeBackAnchor, observeFrontAnchor } =
    useVirtualPaginator({
      count: threadId ? 0 : eventsLength,
      limit: PAGINATION_LIMIT,
      range: threadId ? { start: 0, end: 0 } : timeline.range,
      onRangeChange: useCallback(
        (r) => {
          if (threadId) return;
          setTimeline((cs) => ({ ...cs, range: r }));
        },
        [threadId]
      ),
      getScrollElement,
      getItemElement: useCallback(
        (index: number) =>
          (scrollRef.current?.querySelector(`[data-message-item="${index}"]`) as HTMLElement) ??
          undefined,
        []
      ),
      onEnd: handleTimelinePagination,
    });

  const loadEventTimeline = useEventTimelineLoader(
    mx,
    room,
    useCallback(
      (evtId, lTimelines, evtAbsIndex) => {
        if (!alive()) return;
        const evLength = getTimelinesEventsCount(lTimelines);

        setFocusItem({
          index: evtAbsIndex,
          scrollTo: !threadId,
          highlight: evtId !== readUptoEventIdRef.current,
        });
        setTimeline({
          linkedTimelines: lTimelines,
          range: {
            start: Math.max(evtAbsIndex - PAGINATION_LIMIT, 0),
            end: Math.min(evtAbsIndex + PAGINATION_LIMIT, evLength),
          },
        });
      },
      [alive, threadId]
    ),
    useCallback(() => {
      if (!alive()) return;
      setTimeline(getInitialTimeline(room));
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
    }, [alive, room])
  );

  useLiveEventArrive(
    room,
    useCallback(
      (mEvt: MatrixEvent) => {
        const mEventId = mEvt.getId();
        const relation = mEvt.getRelation();
        const relationTargetId = relation?.event_id;
        const relatedEvent = relationTargetId ? room.findEventById(relationTargetId) : undefined;
        const relatedEventId = relatedEvent?.getId();
        const isThreadReplyMessage =
          !!mEventId && !!mEvt.threadRootId && mEvt.threadRootId !== mEventId;
        const isThreadReplyRelatedEvent =
          !!relatedEventId &&
          !!relatedEvent?.threadRootId &&
          relatedEvent.threadRootId !== relatedEventId;
        const isThreadOnlyActivity = isThreadReplyMessage || isThreadReplyRelatedEvent;

        if (threadId) {
          // If no thread model exists, keep fallback list in sync so new replies
          // appear immediately while staying in thread view.
          const threadModel = room.getThread(threadId);
          if (!threadModel) {
            const fallback = fallbackThreadEventsRef.current;
            if (
              fallback.threadId === threadId &&
              (mEventId === threadId ||
                relationTargetId === threadId ||
                eventBelongsToThread(mEvt, threadId))
            ) {
              const exists =
                !!mEventId && fallback.events.some((evt) => evt.getId && evt.getId() === mEventId);
              if (!exists) {
                fallback.events.push(mEvt);
              }
            }
          }
          if (
            mEventId === threadId ||
            eventBelongsToThread(mEvt, threadId) ||
            (relationTargetId && threadEventIndexMapRef.current.has(relationTargetId))
          ) {
            setThreadTimelineTick((val) => val + 1);

            const scrollElement = scrollRef.current;
            if (
              scrollElement &&
              shouldAutoScrollThreadOnLiveEvent({
                relationType: relation?.rel_type,
                isNearBottom: isScrollNearBottom({
                  scrollHeight: scrollElement.scrollHeight,
                  scrollTop: scrollElement.scrollTop,
                  clientHeight: scrollElement.clientHeight,
                }),
                isTimelineAtLiveEnd: timelineAtLiveEnd,
              })
            ) {
              scrollToBottomRef.current.count += 1;
              scrollToBottomRef.current.smooth = true;
            }
          }
          return;
        }

        // Ignore thread-only live activity in the main room timeline for auto-scroll.
        // These events are hidden there, so forcing bottom jumps is disruptive.
        if (isThreadOnlyActivity) {
          setTimeline((ct) => ({ ...ct }));
          if (!unreadInfo) {
            setUnreadInfo(getRoomUnreadInfo(room));
          }
          return;
        }

        // if user is at bottom of timeline
        // keep paginating timeline and conditionally mark as read
        // otherwise we update timeline without paginating
        // so timeline can be updated with evt like: edits, reactions etc
        if (atBottomRef.current) {
          if (document.hasFocus() && (!unreadInfo || mEvt.getSender() === mx.getUserId())) {
            // Check if the document is in focus (user is actively viewing the app),
            // and either there are no unread messages or the latest message is from the current user.
            // If either condition is met, trigger the markAsRead function to send a read receipt.
            requestAnimationFrame(() => markAsRead(mx, mEvt.getRoomId()!, hideActivity));
          }

          if (!document.hasFocus() && !unreadInfo) {
            setUnreadInfo(getRoomUnreadInfo(room));
          }

          scrollToBottomRef.current.count += 1;
          scrollToBottomRef.current.smooth = true;

          setTimeline((ct) => ({
            ...ct,
            range: {
              start: ct.range.start + 1,
              end: ct.range.end + 1,
            },
          }));
          return;
        }
        setTimeline((ct) => ({ ...ct }));
        if (!unreadInfo) {
          setUnreadInfo(getRoomUnreadInfo(room));
        }
      },
      [mx, room, unreadInfo, hideActivity, threadId, timelineAtLiveEnd]
    )
  );

  const handleOpenEvent = useCallback(
    async (
      evtId: string,
      highlight = true,
      onScroll: ((scrolled: boolean) => void) | undefined = undefined
    ) => {
      if (threadId && evtId !== threadId) {
        const targetEvent = room.findEventById(evtId);
        if (!targetEvent || !eventBelongsToThread(targetEvent, threadId)) {
          return;
        }
      }

      if (threadId) {
        const threadItemIndex = threadEventIndexMapRef.current.get(evtId);
        if (typeof threadItemIndex === 'number') {
          const target = getEventElementById(scrollRef.current, evtId);
          setFocusItem({
            index: threadItemIndex,
            scrollTo: false,
            highlight,
          });
          if (target) {
            scrollToElement(target, {
              behavior: 'smooth',
              align: 'center',
              stopInView: true,
            });
            if (onScroll) onScroll(true);
            return;
          }
          if (onScroll) onScroll(false);
          return;
        }
      }

      const evtTimeline = getEventTimeline(room, evtId);
      const absoluteIndex =
        evtTimeline && getEventIdAbsoluteIndex(timeline.linkedTimelines, evtTimeline, evtId);

      if (typeof absoluteIndex === 'number') {
        const scrolled = scrollToItem(absoluteIndex, {
          behavior: 'smooth',
          align: 'center',
          stopInView: true,
        });
        if (onScroll) onScroll(scrolled);
        setFocusItem({
          index: absoluteIndex,
          scrollTo: false,
          highlight,
        });
      } else {
        if (threadId) {
          let currentThreadTimelineSet = room.getThread(threadId)?.getUnfilteredTimelineSet();
          const expectedThreadId = threadId;
          if (!currentThreadTimelineSet) {
            const [threadErr] = await to(
              mx.getThreadTimeline(room.getUnfilteredTimelineSet(), threadId)
            );
            if (threadErr) {
              if (onScroll) onScroll(false);
              return;
            }
            currentThreadTimelineSet =
              room.getThread(threadId)?.getUnfilteredTimelineSet() ??
              room.getUnfilteredTimelineSet();
          }
          const [err, threadEventTimeline] = await to(
            mx.getEventTimeline(currentThreadTimelineSet, evtId)
          );
          if (err || !threadEventTimeline) {
            if (onScroll) onScroll(false);
            return;
          }
          pendingThreadOpenRef.current = {
            threadId: expectedThreadId,
            eventId: evtId,
            highlight,
            onScroll,
            attempts: 0,
          };
          setTimeline((ct) => ({ ...ct }));
          setThreadTimelineTick((val) => val + 1);
          setPendingThreadOpenTick((val) => val + 1);
          return;
        }
        setTimeline(getEmptyTimeline());
        loadEventTimeline(evtId);
      }
    },
    [mx, room, timeline, scrollToItem, scrollToElement, loadEventTimeline, threadId]
  );

  useLiveTimelineRefresh(
    room,
    useCallback(() => {
      if (liveTimelineLinked) {
        setTimeline(getInitialTimeline(room));
      }
    }, [room, liveTimelineLinked])
  );

  // Stay at bottom when room editor resize
  useResizeObserver(
    useMemo(() => {
      let mounted = false;
      return (entries) => {
        if (!mounted) {
          // skip initial mounting call
          mounted = true;
          return;
        }
        if (!roomInputRef.current) return;
        const editorBaseEntry = getResizeObserverEntry(roomInputRef.current, entries);
        const scrollElement = getScrollElement();
        if (!editorBaseEntry || !scrollElement) return;

        if (atBottomRef.current) {
          scrollToBottom(scrollElement);
        }
      };
    }, [getScrollElement, roomInputRef]),
    useCallback(() => roomInputRef.current, [roomInputRef])
  );

  const tryAutoMarkAsRead = useCallback(() => {
    const readUptoEventId = readUptoEventIdRef.current;
    if (!readUptoEventId) {
      requestAnimationFrame(() => markAsRead(mx, room.roomId, hideActivity));
      return;
    }
    const evtTimeline = getEventTimeline(room, readUptoEventId);
    const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
    if (latestTimeline === room.getLiveTimeline()) {
      requestAnimationFrame(() => markAsRead(mx, room.roomId, hideActivity));
    }
  }, [mx, room, hideActivity]);

  const debounceSetAtBottom = useDebounce(
    useCallback((entry: IntersectionObserverEntry) => {
      if (!entry.isIntersecting) setAtBottom(false);
    }, []),
    { wait: 1000 }
  );
  useIntersectionObserver(
    useCallback(
      (entries) => {
        const target = atBottomAnchorRef.current;
        if (!target) return;
        const targetEntry = getIntersectionObserverEntry(target, entries);
        if (targetEntry) debounceSetAtBottom(targetEntry);
        if (targetEntry?.isIntersecting && atLiveEndRef.current) {
          setAtBottom(true);
          if (!threadId && document.hasFocus()) {
            tryAutoMarkAsRead();
          }
        }
      },
      [debounceSetAtBottom, tryAutoMarkAsRead, threadId]
    ),
    useCallback(
      () => ({
        root: getScrollElement(),
        rootMargin: '100px',
      }),
      [getScrollElement]
    ),
    useCallback(() => atBottomAnchorRef.current, [])
  );

  useDocumentFocusChange(
    useCallback(
      (inFocus) => {
        if (threadId) return;
        if (inFocus && atBottomRef.current) {
          if (unreadInfo?.inLiveTimeline) {
            handleOpenEvent(unreadInfo.readUptoEventId, false, (scrolled) => {
              // the unread event is already in view
              // so, try mark as read;
              if (!scrolled) {
                tryAutoMarkAsRead();
              }
            });
            return;
          }
          tryAutoMarkAsRead();
        }
      },
      [tryAutoMarkAsRead, unreadInfo, handleOpenEvent, threadId]
    )
  );

  // Handle up arrow edit
  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (
          isKeyHotkey('arrowup', evt) &&
          editableActiveElement() &&
          document.activeElement?.getAttribute('data-editable-name') === 'RoomInput' &&
          isEmptyEditor(editor)
        ) {
          const editableEvt = getLatestEditableEvt(room.getLiveTimeline(), (mEvt) =>
            canEditEvent(mx, mEvt)
          );
          const editableEvtId = editableEvt?.getId();
          if (!editableEvtId) return;
          setEditId(editableEvtId);
          evt.preventDefault();
        }
      },
      [mx, room, editor]
    )
  );

  useEffect(() => {
    if (eventId) {
      setTimeline(getEmptyTimeline());
      loadEventTimeline(eventId);
    }
  }, [eventId, loadEventTimeline]);

  useEffect(() => {
    if (!threadId) return;
    setFocusItem(undefined);
    setThreadLoadError(false);
    setThreadTimelineTick(0);
    setPendingThreadOpenTick(0);
    threadEditFetchAttemptedRef.current.clear();
    pendingThreadOpenRef.current = undefined;
    fallbackThreadEventsRef.current = { threadId, events: [] };
    let mounted = true;
    const shouldScrollToLatestOnOpen = !eventId;
    const loadThreadTimeline = async () => {
      // First, ensure the thread exists in the SDK.
      // room.getThread() may return null if the SDK hasn't seen the thread yet.
      // We need to fetch the root event and let the SDK create the Thread object.
      let threadModel = room.getThread(threadId);
      if (!threadModel) {
        // Fetch the thread root event to make the SDK aware of this thread
        const [ctxErr] = await to(mx.getEventTimeline(room.getUnfilteredTimelineSet(), threadId));
        if (!mounted) return;
        if (ctxErr) {
          setThreadLoadError(true);
          return;
        }
        threadModel = room.getThread(threadId);
      }

      if (!threadModel) {
        // If the SDK still hasn't created a Thread object, try fetching
        // thread relations directly to populate it
        const [relErr, relData] = await to(
          mx.fetchRelations(room.roomId, threadId, 'm.thread' as any, null, {
            dir: Direction.Backward,
            limit: 50,
          })
        );
        if (!mounted) return;
        if (relErr) {
          setThreadLoadError(true);
          return;
        }
        // Check if SDK created a Thread from the fetched relations
        threadModel = room.getThread(threadId);
        if (!threadModel && relData?.chunk?.length) {
          // We need to render something even without a Thread model, so store
          // mapped relation events for thread view fallback rendering.
          const mapper = mx.getEventMapper();
          const mappedEvents = relData.chunk.map((evt) => mapper(evt));
          fallbackThreadEventsRef.current = { threadId, events: mappedEvents };
        }
      }

      if (threadModel) {
        // Use the thread's own timeline set for getThreadTimeline
        const loadedThreadTimelineSet = threadModel.getUnfilteredTimelineSet();
        const [err] = await to(mx.getThreadTimeline(loadedThreadTimelineSet, threadId));
        if (!mounted) return;
        if (err) {
          // Fallback: even if getThreadTimeline fails, the thread events
          // may already be populated from the relations fetch above
          console.warn('getThreadTimeline failed, using fallback:', err);
        }
        if (threadModel.events.length === 0) {
          // Some servers return empty thread timelines even though relations exist.
          // Fetch relations and feed them into the thread so replies render.
          const [relErr, relData] = await to(
            mx.fetchRelations(room.roomId, threadId, 'm.thread' as any, null, {
              dir: Direction.Backward,
              limit: 50,
            })
          );
          if (!mounted) return;
          if (!relErr && relData?.chunk?.length) {
            const mapper = mx.getEventMapper();
            const mappedEvents = relData.chunk.map((evt) => mapper(evt));
            threadModel.addEvents(mappedEvents, true);
          }
        }
        if (fallbackThreadEventsRef.current.threadId === threadId) {
          fallbackThreadEventsRef.current = { threadId, events: [] };
        }
      } else {
        console.warn('Could not create thread object for', threadId);
      }

      if (shouldScrollToLatestOnOpen) {
        await paginateThreadForwardToLatest(threadId);
        if (!mounted || threadIdRef.current !== threadId) return;
      }

      setTimeline((ct) => ({ ...ct }));
      setThreadTimelineTick((val) => val + 1);
      if (shouldScrollToLatestOnOpen) {
        scrollToBottomRef.current.count += 1;
        scrollToBottomRef.current.smooth = false;
        setAtBottom(true);
      }
    };

    loadThreadTimeline();

    return () => {
      mounted = false;
    };
  }, [mx, room, threadId, paginateThreadForwardToLatest]);

  useEffect(() => {
    if (threadId) return;
    setThreadLoadError(false);
    setThreadTimelineTick(0);
    setThreadPaginatingBack(false);
    setThreadPaginatingFront(false);
    setPendingThreadOpenTick(0);
    threadEditFetchAttemptedRef.current.clear();
    pendingThreadOpenRef.current = undefined;
    fallbackThreadEventsRef.current = { threadId: undefined, events: [] };
  }, [threadId]);

  // Scroll to bottom on initial timeline load
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollToBottom(scrollEl);
    }
  }, []);

  // if live timeline is linked and unreadInfo change
  // Scroll to last read message
  useLayoutEffect(() => {
    if (threadId) return;
    const { readUptoEventId, inLiveTimeline, scrollTo } = unreadInfo ?? {};
    if (readUptoEventId && inLiveTimeline && scrollTo) {
      const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
      const evtTimeline = getEventTimeline(room, readUptoEventId);
      const absoluteIndex =
        evtTimeline && getEventIdAbsoluteIndex(linkedTimelines, evtTimeline, readUptoEventId);
      if (absoluteIndex) {
        scrollToItem(absoluteIndex, {
          behavior: 'instant',
          align: 'start',
          stopInView: true,
        });
      }
    }
  }, [room, unreadInfo, scrollToItem, threadId]);

  // scroll to focused message
  useLayoutEffect(() => {
    if (!threadId && focusItem && focusItem.scrollTo) {
      scrollToItem(focusItem.index, {
        behavior: 'instant',
        align: 'center',
        stopInView: true,
      });
    }

    setTimeout(() => {
      if (!alive()) return;
      setFocusItem((currentItem) => {
        if (currentItem === focusItem) return undefined;
        return currentItem;
      });
    }, 2000);
  }, [alive, focusItem, scrollToItem, threadId]);

  useLayoutEffect(() => {
    if (!threadId) return;
    const pendingOpen = pendingThreadOpenRef.current;
    if (!pendingOpen) return;
    if (pendingOpen.threadId !== threadId) {
      pendingThreadOpenRef.current = undefined;
      return;
    }

    const nextItemIndex = threadEventIndexMapRef.current.get(pendingOpen.eventId);
    if (typeof nextItemIndex === 'number') {
      setFocusItem({
        index: nextItemIndex,
        scrollTo: false,
        highlight: pendingOpen.highlight,
      });
    }
    const target = getEventElementById(scrollRef.current, pendingOpen.eventId);
    if (target) {
      scrollToElement(target, {
        behavior: 'smooth',
        align: 'center',
        stopInView: true,
      });
      if (pendingOpen.onScroll) pendingOpen.onScroll(true);
      pendingThreadOpenRef.current = undefined;
      return;
    }

    if (pendingOpen.attempts >= 2) {
      if (pendingOpen.onScroll) pendingOpen.onScroll(false);
      pendingThreadOpenRef.current = undefined;
      return;
    }

    pendingThreadOpenRef.current = {
      ...pendingOpen,
      attempts: pendingOpen.attempts + 1,
    };
    requestAnimationFrame(() => {
      if (!pendingThreadOpenRef.current) return;
      setPendingThreadOpenTick((val) => val + 1);
    });
  }, [threadId, threadTimelineTick, pendingThreadOpenTick, scrollToElement]);

  // scroll to bottom of timeline
  const scrollToBottomCount = scrollToBottomRef.current.count;
  useLayoutEffect(() => {
    if (scrollToBottomCount > 0) {
      const scrollEl = scrollRef.current;
      if (scrollEl)
        scrollToBottom(scrollEl, scrollToBottomRef.current.smooth ? 'smooth' : 'instant');
    }
  }, [scrollToBottomCount]);

  // Remove unreadInfo on mark as read
  useEffect(() => {
    if (!unread) {
      setUnreadInfo(undefined);
    }
  }, [unread]);

  // scroll out of view msg editor in view.
  useEffect(() => {
    if (editId) {
      const editMsgElement = getEventElementById(scrollRef.current, editId) ?? undefined;
      if (editMsgElement) {
        scrollToElement(editMsgElement, {
          align: 'center',
          behavior: 'smooth',
          stopInView: true,
        });
      }
    }
  }, [scrollToElement, editId]);

  useEffect(() => {
    if (timelineAtLiveEnd) return;
    setAtBottom(false);
  }, [timelineAtLiveEnd]);

  const handleJumpToLatest = useCallback(async () => {
    if (threadId) {
      if (eventId) {
        navigateRoomThread(room.roomId, threadId, undefined, { replace: true });
      }

      const didPaginateToLatest = await paginateThreadForwardToLatest(threadId);
      if (threadIdRef.current !== threadId) return;
      if (didPaginateToLatest) {
        setTimeline((ct) => ({ ...ct }));
        setThreadTimelineTick((val) => val + 1);
        scrollToBottomRef.current.count += 1;
        scrollToBottomRef.current.smooth = false;
        setAtBottom(true);
        return;
      }

      const scrollEl = scrollRef.current;
      if (scrollEl) {
        scrollToBottom(scrollEl, 'instant');
        setAtBottom(true);
      }
      return;
    }

    if (eventId) {
      navigateRoom(room.roomId, undefined, { replace: true });
    }
    setTimeline(getInitialTimeline(room));
    scrollToBottomRef.current.count += 1;
    scrollToBottomRef.current.smooth = false;
  }, [
    eventId,
    navigateRoom,
    navigateRoomThread,
    paginateThreadForwardToLatest,
    room,
    threadId,
  ]);

  const handleJumpToUnread = () => {
    if (unreadInfo?.readUptoEventId) {
      setTimeline(getEmptyTimeline());
      loadEventTimeline(unreadInfo.readUptoEventId);
    }
  };

  const handleMarkAsRead = () => {
    markAsRead(mx, room.roomId, hideActivity);
  };

  const handleOpenReply: MouseEventHandler = useCallback(
    async (evt) => {
      const threadRootId = evt.currentTarget.getAttribute('data-thread-root-id');
      if (threadRootId) {
        navigateRoomThread(room.roomId, threadRootId);
        return;
      }
      const targetId = evt.currentTarget.getAttribute('data-event-id');
      if (!targetId) return;
      handleOpenEvent(targetId);
    },
    [handleOpenEvent, navigateRoomThread, room.roomId]
  );

  const handleUserClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const userId = evt.currentTarget.getAttribute('data-user-id');
      if (!userId) {
        console.warn('Button should have "data-user-id" attribute!');
        return;
      }
      openUserRoomProfile(
        room.roomId,
        space?.roomId,
        userId,
        evt.currentTarget.getBoundingClientRect()
      );
    },
    [room, space, openUserRoomProfile]
  );
  const handleUsernameClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt) => {
      evt.preventDefault();
      const userId = evt.currentTarget.getAttribute('data-user-id');
      if (!userId) {
        console.warn('Button should have "data-user-id" attribute!');
        return;
      }
      const name = getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
      editor.insertNode(
        createMentionElement(
          userId,
          name.startsWith('@') ? name : `@${name}`,
          userId === mx.getUserId()
        )
      );
      ReactEditor.focus(editor);
      moveCursor(editor);
    },
    [mx, room, editor]
  );

  const handleReplyClick: MouseEventHandler<HTMLButtonElement> = useCallback(
    (evt, startThread = false) => {
      const replyId = evt.currentTarget.getAttribute('data-event-id');
      if (!replyId) {
        console.warn('Button should have "data-event-id" attribute!');
        return;
      }
      const replyEvt = room.findEventById(replyId);
      if (!replyEvt) return;
      const threadRootId = replyEvt.threadRootId ?? replyId;
      const editedReply = getEditedEvent(replyId, replyEvt, room.getUnfilteredTimelineSet());
      const content: IContent = editedReply?.getContent()['m.new_content'] ?? replyEvt.getContent();
      const { body, formatted_body: formattedBody } = content;
      const { 'm.relates_to': relation } = startThread
        ? { 'm.relates_to': { rel_type: 'm.thread', event_id: threadRootId } }
        : replyEvt.getWireContent();
      const senderId = replyEvt.getSender();
      if (senderId && typeof body === 'string') {
        setReplyDraft({
          userId: senderId,
          eventId: replyId,
          body,
          formattedBody,
          relation,
        });
        if (startThread) {
          navigateRoomThread(room.roomId, threadRootId);
        }
        setTimeout(() => ReactEditor.focus(editor), 100);
      }
    },
    [room, setReplyDraft, editor, navigateRoomThread]
  );

  const handleReactionToggle = useCallback(
    (targetEventId: string, key: string, shortcode?: string) => {
      const relations = getEventReactions(room.getUnfilteredTimelineSet(), targetEventId);
      const allReactions = relations?.getSortedAnnotationsByKey() ?? [];
      const [, reactionsSet] = allReactions.find(([k]) => k === key) ?? [];
      const reactions = reactionsSet ? Array.from(reactionsSet) : [];
      const myReaction = reactions.find(factoryEventSentBy(mx.getUserId()!));

      if (myReaction && !!myReaction?.isRelation()) {
        mx.redactEvent(room.roomId, myReaction.getId()!);
        return;
      }
      const rShortcode =
        shortcode ||
        (reactions.find(eventWithShortcode)?.getContent().shortcode as string | undefined);
      mx.sendEvent(
        room.roomId,
        MessageEvent.Reaction as any,
        getReactionContent(targetEventId, key, rShortcode)
      );
    },
    [mx, room]
  );
  const handleEdit = useCallback(
    (editEvtId?: string) => {
      if (editEvtId) {
        setEditId(editEvtId);
        return;
      }
      setEditId(undefined);
      ReactEditor.focus(editor);
    },
    [editor]
  );
  const { t } = useTranslation();
  const loadedTimelineEvents = useMemo(() => {
    if (threadId) return [] as MatrixEvent[];
    const loadedEvents: MatrixEvent[] = [];
    timeline.linkedTimelines.forEach((linkedTimeline) => {
      loadedEvents.push(...linkedTimeline.getEvents());
    });
    return loadedEvents;
  }, [threadId, timeline]);
  const threadReplyCountMap = useMemo(
    () => (threadId ? new Map<string, number>() : buildThreadReplyCountMap(loadedTimelineEvents)),
    [threadId, loadedTimelineEvents]
  );
  const threadParticipantMap = useMemo(
    () =>
      threadId ? new Map<string, string[]>() : buildThreadParticipantMap(loadedTimelineEvents),
    [threadId, loadedTimelineEvents]
  );

  const renderMatrixEvent = useMatrixEventRenderer<
    [string, MatrixEvent, number, EventTimelineSet, boolean]
  >(
    {
      [MessageEvent.RoomMessage]: (mEventId, mEvent, item, timelineSet, collapse) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
        const hasReactions = reactions && reactions.length > 0;
        const { replyEventId, threadRootId } = mEvent;
        const highlighted = focusItem?.index === item && focusItem.highlight;

        const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
        const getContent = (() =>
          editedEvent?.getContent()['m.new_content'] ?? mEvent.getContent()) as GetContentCallback;

        const senderId = mEvent.getSender() ?? '';
        const senderDisplayName =
          getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
        const threadReplyCount = getThreadReplyCount(
          room,
          mEvent,
          threadReplyCountMap.get(mEventId)
        );
        const threadParticipantIds = getThreadParticipantIds(
          room,
          mEvent,
          threadParticipantMap.get(mEventId)
        );
        const isThreadReply = isThreadReplyEvent(mEventId, threadRootId);
        const threadSummary =
          !threadId &&
          !isThreadReply &&
          mEventId &&
          typeof threadReplyCount === 'number' &&
          threadReplyCount > 0 ? (
            <ThreadIndicator
              as="button"
              style={{ marginTop: config.space.S200 }}
              data-thread-root-id={mEventId}
              data-event-id={mEventId}
              threadReplyCount={threadReplyCount}
              threadParticipantIds={threadParticipantIds}
              room={room}
              onClick={handleOpenReply}
            />
          ) : null;

        return (
          <Message
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            highlight={highlighted}
            edit={editId === mEventId}
            canDelete={canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())}
            canSendReaction={canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUsernameClick}
            onReplyClick={handleReplyClick}
            onReactionToggle={handleReactionToggle}
            onEditId={handleEdit}
            reply={
              !(
                threadId &&
                replyEventId &&
                (replyEventId === prevEvent?.getId() || replyEventId === threadId)
              ) &&
              replyEventId && (
                <Reply
                  room={room}
                  timelineSet={timelineSet}
                  replyEventId={replyEventId}
                  threadRootId={threadRootId}
                  hideThreadIndicator={!!threadId}
                  onClick={handleOpenReply}
                  getMemberPowerTag={getMemberPowerTag}
                  accessibleTagColors={accessiblePowerTagColors}
                  legacyUsernameColor={legacyUsernameColor || direct}
                />
              )
            }
            reactions={
              (threadSummary || reactionRelations) && (
                <>
                  {threadSummary}
                  {reactionRelations && (
                    <Reactions
                      style={{ marginTop: config.space.S200 }}
                      room={room}
                      relations={reactionRelations}
                      mEventId={mEventId}
                      canSendReaction={canSendReaction}
                      onReactionToggle={handleReactionToggle}
                    />
                  )}
                </>
              )
            }
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
            memberPowerTag={getMemberPowerTag(senderId)}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            {mEvent.isRedacted() ? (
              <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
            ) : (
              <RenderMessageContent
                displayName={senderDisplayName}
                msgType={mEvent.getContent().msgtype ?? ''}
                ts={mEvent.getTs()}
                edited={!!editedEvent}
                getContent={getContent}
                mediaAutoLoad={mediaAutoLoad}
                urlPreview={showUrlPreview}
                htmlReactParserOptions={htmlReactParserOptions}
                linkifyOpts={linkifyOpts}
                outlineAttachment={messageLayout === MessageLayout.Bubble}
              />
            )}
          </Message>
        );
      },
      [MessageEvent.RoomMessageEncrypted]: (mEventId, mEvent, item, timelineSet, collapse) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
        const hasReactions = reactions && reactions.length > 0;
        const { replyEventId, threadRootId } = mEvent;
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const threadReplyCount = getThreadReplyCount(
          room,
          mEvent,
          threadReplyCountMap.get(mEventId)
        );
        const threadParticipantIds = getThreadParticipantIds(
          room,
          mEvent,
          threadParticipantMap.get(mEventId)
        );
        const isThreadReply = isThreadReplyEvent(mEventId, threadRootId);
        const threadSummary =
          !threadId &&
          !isThreadReply &&
          mEventId &&
          typeof threadReplyCount === 'number' &&
          threadReplyCount > 0 ? (
            <ThreadIndicator
              as="button"
              style={{ marginTop: config.space.S200 }}
              data-thread-root-id={mEventId}
              data-event-id={mEventId}
              threadReplyCount={threadReplyCount}
              threadParticipantIds={threadParticipantIds}
              room={room}
              onClick={handleOpenReply}
            />
          ) : null;

        return (
          <Message
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            highlight={highlighted}
            edit={editId === mEventId}
            canDelete={canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())}
            canSendReaction={canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUsernameClick}
            onReplyClick={handleReplyClick}
            onReactionToggle={handleReactionToggle}
            onEditId={handleEdit}
            reply={
              !(
                threadId &&
                replyEventId &&
                (replyEventId === prevEvent?.getId() || replyEventId === threadId)
              ) &&
              replyEventId && (
                <Reply
                  room={room}
                  timelineSet={timelineSet}
                  replyEventId={replyEventId}
                  threadRootId={threadRootId}
                  hideThreadIndicator={!!threadId}
                  onClick={handleOpenReply}
                  getMemberPowerTag={getMemberPowerTag}
                  accessibleTagColors={accessiblePowerTagColors}
                  legacyUsernameColor={legacyUsernameColor || direct}
                />
              )
            }
            reactions={
              (threadSummary || reactionRelations) && (
                <>
                  {threadSummary}
                  {reactionRelations && (
                    <Reactions
                      style={{ marginTop: config.space.S200 }}
                      room={room}
                      relations={reactionRelations}
                      mEventId={mEventId}
                      canSendReaction={canSendReaction}
                      onReactionToggle={handleReactionToggle}
                    />
                  )}
                </>
              )
            }
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
            memberPowerTag={getMemberPowerTag(mEvent.getSender() ?? '')}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            <EncryptedContent mEvent={mEvent}>
              {() => {
                if (mEvent.isRedacted()) return <RedactedContent />;
                if (mEvent.getType() === MessageEvent.Sticker)
                  return (
                    <MSticker
                      content={mEvent.getContent()}
                      renderImageContent={(props) => (
                        <ImageContent
                          {...props}
                          autoPlay={mediaAutoLoad}
                          renderImage={(p) => <Image {...p} loading="lazy" />}
                          renderViewer={(p) => <ImageViewer {...p} />}
                        />
                      )}
                    />
                  );
                if (mEvent.getType() === MessageEvent.RoomMessage) {
                  const editedEvent = getEditedEvent(mEventId, mEvent, timelineSet);
                  const getContent = (() =>
                    editedEvent?.getContent()['m.new_content'] ??
                    mEvent.getContent()) as GetContentCallback;

                  const senderId = mEvent.getSender() ?? '';
                  const senderDisplayName =
                    getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
                  return (
                    <RenderMessageContent
                      displayName={senderDisplayName}
                      msgType={mEvent.getContent().msgtype ?? ''}
                      ts={mEvent.getTs()}
                      edited={!!editedEvent}
                      getContent={getContent}
                      mediaAutoLoad={mediaAutoLoad}
                      urlPreview={showUrlPreview}
                      htmlReactParserOptions={htmlReactParserOptions}
                      linkifyOpts={linkifyOpts}
                      outlineAttachment={messageLayout === MessageLayout.Bubble}
                    />
                  );
                }
                if (mEvent.getType() === MessageEvent.RoomMessageEncrypted)
                  return (
                    <Text>
                      <MessageNotDecryptedContent />
                    </Text>
                  );
                return (
                  <Text>
                    <MessageUnsupportedContent />
                  </Text>
                );
              }}
            </EncryptedContent>
          </Message>
        );
      },
      [MessageEvent.Sticker]: (mEventId, mEvent, item, timelineSet, collapse) => {
        const reactionRelations = getEventReactions(timelineSet, mEventId);
        const reactions = reactionRelations && reactionRelations.getSortedAnnotationsByKey();
        const hasReactions = reactions && reactions.length > 0;
        const highlighted = focusItem?.index === item && focusItem.highlight;

        return (
          <Message
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            messageSpacing={messageSpacing}
            messageLayout={messageLayout}
            collapse={collapse}
            highlight={highlighted}
            canDelete={canRedact || (canDeleteOwn && mEvent.getSender() === mx.getUserId())}
            canSendReaction={canSendReaction}
            canPinEvent={canPinEvent}
            imagePackRooms={imagePackRooms}
            relations={hasReactions ? reactionRelations : undefined}
            onUserClick={handleUserClick}
            onUsernameClick={handleUsernameClick}
            onReplyClick={handleReplyClick}
            onReactionToggle={handleReactionToggle}
            reactions={
              reactionRelations && (
                <Reactions
                  style={{ marginTop: config.space.S200 }}
                  room={room}
                  relations={reactionRelations}
                  mEventId={mEventId}
                  canSendReaction={canSendReaction}
                  onReactionToggle={handleReactionToggle}
                />
              )
            }
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
            memberPowerTag={getMemberPowerTag(mEvent.getSender() ?? '')}
            accessibleTagColors={accessiblePowerTagColors}
            legacyUsernameColor={legacyUsernameColor || direct}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          >
            {mEvent.isRedacted() ? (
              <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
            ) : (
              <MSticker
                content={mEvent.getContent()}
                renderImageContent={(props) => (
                  <ImageContent
                    {...props}
                    autoPlay={mediaAutoLoad}
                    renderImage={(p) => <Image {...p} loading="lazy" />}
                    renderViewer={(p) => <ImageViewer {...p} />}
                  />
                )}
              />
            )}
          </Message>
        );
      },
      [StateEvent.RoomMember]: (mEventId, mEvent, item) => {
        const membershipChanged = isMembershipChanged(mEvent);
        if (membershipChanged && hideMembershipEvents) return null;
        if (!membershipChanged && hideNickAvatarEvents) return null;

        const highlighted = focusItem?.index === item && focusItem.highlight;
        const parsed = parseMemberEvent(mEvent);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={parsed.icon}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    {parsed.body}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomName]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={Icons.Hash}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {t('Organisms.RoomCommon.changed_room_name')}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomTopic]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={Icons.Hash}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {' changed room topic'}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
      [StateEvent.RoomAvatar]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const timeJSX = (
          <Time
            ts={mEvent.getTs()}
            compact={messageLayout === MessageLayout.Compact}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        );

        return (
          <Event
            key={mEvent.getId()}
            data-message-item={item}
            data-message-id={mEventId}
            room={room}
            mEvent={mEvent}
            highlight={highlighted}
            messageSpacing={messageSpacing}
            canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
            hideReadReceipts={hideActivity}
            showDeveloperTools={showDeveloperTools}
          >
            <EventContent
              messageLayout={messageLayout}
              time={timeJSX}
              iconSrc={Icons.Hash}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {' changed room avatar'}
                  </Text>
                </Box>
              }
            />
          </Event>
        );
      },
    },
    (mEventId, mEvent, item) => {
      if (!showHiddenEvents) return null;
      const highlighted = focusItem?.index === item && focusItem.highlight;
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={mEvent.getId()}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
          hideReadReceipts={hideActivity}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={Icons.Code}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <b>{senderName}</b>
                  {' sent '}
                  <code className={customHtmlCss.Code}>{mEvent.getType()}</code>
                  {' state event'}
                </Text>
              </Box>
            }
          />
        </Event>
      );
    },
    (mEventId, mEvent, item) => {
      if (!showHiddenEvents) return null;
      if (Object.keys(mEvent.getContent()).length === 0) return null;
      if (mEvent.getRelation()) return null;
      if (mEvent.isRedaction()) return null;

      const highlighted = focusItem?.index === item && focusItem.highlight;
      const senderId = mEvent.getSender() ?? '';
      const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

      const timeJSX = (
        <Time
          ts={mEvent.getTs()}
          compact={messageLayout === MessageLayout.Compact}
          hour24Clock={hour24Clock}
          dateFormatString={dateFormatString}
        />
      );

      return (
        <Event
          key={mEvent.getId()}
          data-message-item={item}
          data-message-id={mEventId}
          room={room}
          mEvent={mEvent}
          highlight={highlighted}
          messageSpacing={messageSpacing}
          canDelete={canRedact || mEvent.getSender() === mx.getUserId()}
          hideReadReceipts={hideActivity}
          showDeveloperTools={showDeveloperTools}
        >
          <EventContent
            messageLayout={messageLayout}
            time={timeJSX}
            iconSrc={Icons.Code}
            content={
              <Box grow="Yes" direction="Column">
                <Text size="T300" priority="300">
                  <b>{senderName}</b>
                  {' sent '}
                  <code className={customHtmlCss.Code}>{mEvent.getType()}</code>
                  {' event'}
                </Text>
              </Box>
            }
          />
        </Event>
      );
    }
  );
  const timelineItems = getItems();
  const threadEvents = useMemo(() => {
    if (!threadId) {
      threadEventIndexMapRef.current = new Map();
      return [];
    }

    const eventsMap = new Map<string, MatrixEvent>();
    const eventOrderMap = new Map<string, number>();
    const addThreadEvent = (mEvent?: MatrixEvent | null, requireThreadMatch = true) => {
      const eventId = mEvent?.getId();
      if (!eventId) return;
      if (requireThreadMatch && eventId !== threadId && !eventBelongsToThread(mEvent, threadId))
        return;
      if (!eventsMap.has(eventId)) {
        eventOrderMap.set(eventId, eventOrderMap.size);
      }
      eventsMap.set(eventId, mEvent);
    };

    const threadModelReady = !!thread;
    addThreadEvent(thread?.rootEvent ?? room.findEventById(threadId), !threadModelReady);
    if (threadModelReady) {
      thread?.events.forEach((mEvent) => addThreadEvent(mEvent, false));
    } else {
      const fallback = fallbackThreadEventsRef.current;
      if (fallback.threadId === threadId && fallback.events.length > 0) {
        fallback.events.forEach((mEvent) => addThreadEvent(mEvent, false));
      }
    }

    const sortedEvents = Array.from(eventsMap.values()).sort((a, b) => {
      const timeDiff = a.getTs() - b.getTs();
      if (timeDiff !== 0) return timeDiff;
      const aId = a.getId();
      const bId = b.getId();
      const aOrder = (aId && eventOrderMap.get(aId)) ?? 0;
      const bOrder = (bId && eventOrderMap.get(bId)) ?? 0;
      return aOrder - bOrder;
    });
    const eventIndexMap = new Map<string, number>();
    sortedEvents.forEach((mEvent, index) => {
      const eventId = mEvent.getId();
      if (eventId) eventIndexMap.set(eventId, index);
    });
    threadEventIndexMapRef.current = eventIndexMap;
    return sortedEvents;
  }, [threadId, thread, room, threadTimelineTick]);

  useEffect(() => {
    if (!threadId || threadEvents.length === 0) return;

    const missingEditEvents = threadEvents.filter((mEvent) => {
      const eventId = mEvent.getId();
      if (!eventId) return false;
      if (threadEditFetchAttemptedRef.current.has(eventId)) return false;
      if (mEvent.isRedacted()) return false;
      if (mEvent.replacingEvent()) return false;
      const eventType = mEvent.getType();
      if (
        eventType !== MessageEvent.RoomMessage &&
        eventType !== MessageEvent.RoomMessageEncrypted
      ) {
        return false;
      }
      return true;
    });
    if (missingEditEvents.length === 0) {
      logEditDebug('threadBackfill:noneMissing', {
        threadId,
        threadEventCount: threadEvents.length,
      });
      return;
    }

    logEditDebug('threadBackfill:start', {
      threadId,
      threadEventCount: threadEvents.length,
      missingEditCount: missingEditEvents.length,
    });

    missingEditEvents.forEach((mEvent) => {
      const eventId = mEvent.getId();
      if (eventId) threadEditFetchAttemptedRef.current.add(eventId);
    });

    let cancelled = false;
    const loadMissingThreadEdits = async () => {
      let didUpdate = false;
      let updatedCount = 0;
      const concurrency = 4;
      let cursor = 0;

      const worker = async () => {
        while (!cancelled && cursor < missingEditEvents.length) {
          const currentIndex = cursor;
          cursor += 1;

          const mEvent = missingEditEvents[currentIndex];
          const eventId = mEvent.getId();
          if (!eventId) continue;

          const [relErr, relData] = await to(
            mx.relations(room.roomId, eventId, RelationType.Replace, mEvent.getType(), {
              dir: Direction.Backward,
              limit: 100,
            })
          );
          if (cancelled) continue;
          if (relErr) {
            logEditDebug('threadBackfill:fetchError', {
              threadId,
              eventId,
              error: String(relErr),
            });
            continue;
          }
          if (!relData?.events?.length) {
            logEditDebug('threadBackfill:noRelations', {
              threadId,
              eventId,
            });
            continue;
          }

          const latestEdit = relData.events.reduce((latest, editEvent) => {
            if (!latest) return editEvent;
            if (editEvent.getTs() > latest.getTs()) return editEvent;
            if (editEvent.getTs() === latest.getTs()) return editEvent;
            return latest;
          }, relData.events[0]);
          if (!latestEdit) continue;

          // Keep sender guard aligned with edit auth semantics.
          if (latestEdit.getSender() !== mEvent.getSender()) {
            logEditDebug('threadBackfill:senderMismatch', {
              threadId,
              eventId,
              editEventId: latestEdit.getId(),
              editSender: latestEdit.getSender(),
              targetSender: mEvent.getSender(),
            });
            continue;
          }

          mEvent.makeReplaced(latestEdit);
          didUpdate = true;
          updatedCount += 1;
          logEditDebug('threadBackfill:applied', {
            threadId,
            eventId,
            editEventId: latestEdit.getId(),
            editTs: latestEdit.getTs(),
            relationCount: relData.events.length,
          });
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      if (didUpdate && !cancelled && threadIdRef.current === threadId) {
        logEditDebug('threadBackfill:updated', {
          threadId,
          updatedCount,
        });
        setTimeline((ct) => ({ ...ct }));
        setThreadTimelineTick((val) => val + 1);
      } else {
        logEditDebug('threadBackfill:noUpdate', {
          threadId,
        });
      }
    };

    loadMissingThreadEdits();

    return () => {
      cancelled = true;
    };
  }, [mx, room.roomId, threadId, threadEvents]);

  const handleThreadPaginateBack = useCallback(async () => {
    if (!threadId || !thread || threadPaginatingBackRef.current) return;
    const currentThreadTimelineSet = thread.getUnfilteredTimelineSet();
    const firstThreadTimeline = getLinkedTimelines(currentThreadTimelineSet.getLiveTimeline())[0];
    if (!firstThreadTimeline) return;
    if (!firstThreadTimeline.getPaginationToken(Direction.Backward)) return;

    const expectedThreadId = threadId;
    setThreadPaginatingBack(true);
    threadPaginatingBackRef.current = true;
    const [err] = await to(
      mx.paginateEventTimeline(firstThreadTimeline, {
        backwards: true,
        limit: PAGINATION_LIMIT,
      })
    );
    setThreadPaginatingBack(false);
    threadPaginatingBackRef.current = false;
    if (!err && threadIdRef.current === expectedThreadId) {
      setTimeline((ct) => ({ ...ct }));
      setThreadTimelineTick((val) => val + 1);
    }
  }, [mx, threadId, thread]);
  const handleThreadPaginateFront = useCallback(async () => {
    if (!threadId || !thread || threadPaginatingFrontRef.current) return;
    const currentThreadTimelineSet = thread.getUnfilteredTimelineSet();
    const currentThreadLinkedTimelines = getLinkedTimelines(currentThreadTimelineSet.getLiveTimeline());
    const currentLastThreadTimeline =
      currentThreadLinkedTimelines[currentThreadLinkedTimelines.length - 1];
    if (!currentLastThreadTimeline) return;
    if (!currentLastThreadTimeline.getPaginationToken(Direction.Forward)) return;

    const expectedThreadId = threadId;
    setThreadPaginatingFront(true);
    threadPaginatingFrontRef.current = true;
    const [err] = await to(
      mx.paginateEventTimeline(currentLastThreadTimeline, {
        backwards: false,
        limit: PAGINATION_LIMIT,
      })
    );
    setThreadPaginatingFront(false);
    threadPaginatingFrontRef.current = false;
    if (!err && threadIdRef.current === expectedThreadId) {
      setTimeline((ct) => ({ ...ct }));
      setThreadTimelineTick((val) => val + 1);
    }
  }, [mx, threadId, thread]);

  let prevEvent: MatrixEvent | undefined;
  let isPrevRendered = false;
  let newDivider = false;
  let dayDivider = false;
  const renderResolvedEvent = (
    mEvent: MatrixEvent,
    item: number,
    timelineSet: EventTimelineSet
  ) => {
    const mEventId = mEvent?.getId();

    if (!mEvent || !mEventId) return null;

    const eventSender = mEvent.getSender();
    if (eventSender && ignoredUsersSet.has(eventSender)) {
      return null;
    }
    if (!threadId && mEvent.threadRootId && mEvent.threadRootId !== mEventId) {
      return null;
    }
    if (mEvent.isRedacted() && !showHiddenEvents) {
      return null;
    }

    if (!newDivider && readUptoEventIdRef.current) {
      newDivider = prevEvent?.getId() === readUptoEventIdRef.current;
    }
    if (!dayDivider) {
      dayDivider = prevEvent ? !inSameDay(prevEvent.getTs(), mEvent.getTs()) : false;
    }

    const collapsed =
      isPrevRendered &&
      !dayDivider &&
      (!newDivider || eventSender === mx.getUserId()) &&
      prevEvent !== undefined &&
      prevEvent.getSender() === eventSender &&
      prevEvent.getType() === mEvent.getType() &&
      minuteDifference(prevEvent.getTs(), mEvent.getTs()) < 2;

    const eventJSX = reactionOrEditEvent(mEvent)
      ? null
      : renderMatrixEvent(
          mEvent.getType(),
          typeof mEvent.getStateKey() === 'string',
          mEventId,
          mEvent,
          item,
          timelineSet,
          collapsed
        );
    prevEvent = mEvent;
    isPrevRendered = !!eventJSX;

    const newDividerJSX =
      newDivider && eventJSX && eventSender !== mx.getUserId() ? (
        <MessageBase space={messageSpacing}>
          <TimelineDivider style={{ color: color.Success.Main }} variant="Inherit">
            <Badge as="span" size="500" variant="Success" fill="Solid" radii="300">
              <Text size="L400">New Messages</Text>
            </Badge>
          </TimelineDivider>
        </MessageBase>
      ) : null;

    const dayDividerJSX =
      dayDivider && eventJSX ? (
        <MessageBase space={messageSpacing}>
          <TimelineDivider variant="Surface">
            <Badge as="span" size="500" variant="Secondary" fill="None" radii="300">
              <Text size="L400">
                {(() => {
                  if (today(mEvent.getTs())) return 'Today';
                  if (yesterday(mEvent.getTs())) return 'Yesterday';
                  return timeDayMonthYear(mEvent.getTs());
                })()}
              </Text>
            </Badge>
          </TimelineDivider>
        </MessageBase>
      ) : null;

    if (eventJSX && (newDividerJSX || dayDividerJSX)) {
      if (newDividerJSX) newDivider = false;
      if (dayDividerJSX) dayDivider = false;

      return (
        <React.Fragment key={mEventId}>
          {newDividerJSX}
          {dayDividerJSX}
          {eventJSX}
        </React.Fragment>
      );
    }

    return eventJSX;
  };

  const eventRenderer = (item: number) => {
    const [eventTimeline, baseIndex] = getTimelineAndBaseIndex(timeline.linkedTimelines, item);
    if (!eventTimeline) return null;
    const timelineSet = eventTimeline.getTimelineSet();
    const mEvent = getTimelineEvent(eventTimeline, getTimelineRelativeIndex(item, baseIndex));
    if (!mEvent) return null;

    return renderResolvedEvent(mEvent, item, timelineSet);
  };

  return (
    <Box grow="Yes" style={{ position: 'relative' }}>
      {!threadId && unreadInfo?.readUptoEventId && !unreadInfo?.inLiveTimeline && (
        <TimelineFloat position="Top">
          <Chip
            variant="Primary"
            radii="Pill"
            outlined
            before={<Icon size="50" src={Icons.MessageUnread} />}
            onClick={handleJumpToUnread}
          >
            <Text size="L400">Jump to Unread</Text>
          </Chip>

          <Chip
            variant="SurfaceVariant"
            radii="Pill"
            outlined
            before={<Icon size="50" src={Icons.CheckTwice} />}
            onClick={handleMarkAsRead}
          >
            <Text size="L400">Mark as Read</Text>
          </Chip>
        </TimelineFloat>
      )}
      <Scroll ref={scrollRef} visibility="Hover">
        <Box
          direction="Column"
          justifyContent="End"
          style={{
            minHeight: '100%',
            padding: `${config.space.S600} 0`,
            position: 'relative',
          }}
        >
          {threadId && (
            <Box
              style={{
                position: 'absolute',
                top: config.space.S600,
                bottom: config.space.S600,
                left: messageLayout === MessageLayout.Compact ? toRem(5) : toRem(7),
                width: config.borderWidth.B300,
                backgroundColor: color.Warning.ContainerLine,
                opacity: 0.7,
                pointerEvents: 'none',
              }}
            />
          )}
          {!threadId && !canPaginateBack && rangeAtStart && timelineItems.length > 0 && (
            <div
              style={{
                padding: `${config.space.S700} ${config.space.S400} ${config.space.S600} ${
                  messageLayout === MessageLayout.Compact ? config.space.S400 : toRem(64)
                }`,
              }}
            >
              <RoomIntro room={room} />
            </div>
          )}
          {threadId && threadLoadError && (
            <MessageBase space={messageSpacing}>
              <TimelineDivider variant="Surface">
                <Badge as="span" size="500" variant="Critical" fill="None" radii="300">
                  <Text size="L400">Failed to load this thread.</Text>
                </Badge>
              </TimelineDivider>
            </MessageBase>
          )}
          {threadId && canPaginateThreadBack && (
            <MessageBase space={messageSpacing}>
              <TimelineDivider variant="Surface">
                <Chip
                  variant="SurfaceVariant"
                  radii="Pill"
                  outlined
                  before={<Icon size="50" src={Icons.ArrowTop} />}
                  onClick={handleThreadPaginateBack}
                >
                  <Text size="L400">
                    {threadPaginatingBack ? 'Loading...' : 'Load Older Messages'}
                  </Text>
                </Chip>
              </TimelineDivider>
            </MessageBase>
          )}
          {!threadId &&
            (canPaginateBack || !rangeAtStart) &&
            (messageLayout === MessageLayout.Compact ? (
              <>
                <MessageBase>
                  <CompactPlaceholder key={timelineItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={timelineItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={timelineItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={timelineItems.length} />
                </MessageBase>
                <MessageBase ref={observeBackAnchor}>
                  <CompactPlaceholder key={timelineItems.length} />
                </MessageBase>
              </>
            ) : (
              <>
                <MessageBase>
                  <DefaultPlaceholder key={timelineItems.length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={timelineItems.length} />
                </MessageBase>
                <MessageBase ref={observeBackAnchor}>
                  <DefaultPlaceholder key={timelineItems.length} />
                </MessageBase>
              </>
            ))}

          {threadId
            ? threadEvents.map((mEvent, index) => {
                const eventId = mEvent.getId();
                if (!eventId) return null;
                const threadTimeline = threadTimelineSet?.getTimelineForEvent(eventId);
                const roomTimeline = roomTimelineSet.getTimelineForEvent(eventId);
                const timelineSet =
                  threadTimeline?.getTimelineSet() ??
                  roomTimeline?.getTimelineSet() ??
                  threadTimelineSet ??
                  roomTimelineSet;
                return renderResolvedEvent(mEvent, index, timelineSet);
              })
            : timelineItems.map(eventRenderer)}
          {threadId && canPaginateThreadFront && (
            <MessageBase space={messageSpacing}>
              <TimelineDivider variant="Surface">
                <Chip
                  variant="SurfaceVariant"
                  radii="Pill"
                  outlined
                  before={<Icon size="50" src={Icons.ArrowBottom} />}
                  onClick={handleThreadPaginateFront}
                >
                  <Text size="L400">
                    {threadPaginatingFront ? 'Loading...' : 'Load Newer Messages'}
                  </Text>
                </Chip>
              </TimelineDivider>
            </MessageBase>
          )}

          {!threadId &&
            (!liveTimelineLinked || !rangeAtEnd) &&
            (messageLayout === MessageLayout.Compact ? (
              <>
                <MessageBase ref={observeFrontAnchor}>
                  <CompactPlaceholder key={timelineItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={timelineItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={timelineItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={timelineItems.length} />
                </MessageBase>
                <MessageBase>
                  <CompactPlaceholder key={timelineItems.length} />
                </MessageBase>
              </>
            ) : (
              <>
                <MessageBase ref={observeFrontAnchor}>
                  <DefaultPlaceholder key={timelineItems.length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={timelineItems.length} />
                </MessageBase>
                <MessageBase>
                  <DefaultPlaceholder key={timelineItems.length} />
                </MessageBase>
              </>
            ))}
          <span ref={atBottomAnchorRef} />
        </Box>
      </Scroll>
      {!atBottom && (
        <TimelineFloat position="Bottom">
          <Chip
            variant="SurfaceVariant"
            radii="Pill"
            outlined
            before={<Icon size="50" src={Icons.ArrowBottom} />}
            onClick={handleJumpToLatest}
          >
            <Text size="L400">Jump to Latest</Text>
          </Chip>
        </TimelineFloat>
      )}
    </Box>
  );
}
