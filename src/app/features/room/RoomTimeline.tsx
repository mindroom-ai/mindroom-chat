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
  IEvent,
  IContent,
  MatrixClient,
  MatrixEvent,
  RelationType,
  Room,
  RoomEvent,
  RoomEventHandlerMap,
  THREAD_RELATION_TYPE,
  MsgType,
} from 'matrix-js-sdk';
import { HTMLReactParserOptions } from 'html-react-parser';
import classNames from 'classnames';
import { ReactEditor } from 'slate-react';
import { Editor } from 'slate';
import { SessionMembershipData } from 'matrix-js-sdk/lib/matrixrtc/CallMembership';
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
  MindroomThreadSummaryCard,
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
  getLatestMessageContent,
  getLatestEdit,
  getLatestEditableEvt,
  getMemberDisplayName,
  getReactionContent,
  isMembershipChanged,
  logEditDebug,
  reactionOrEditEvent,
} from '../../utils/room';
import { useSetting } from '../../state/hooks/settings';
import { MessageLayout, sanitizePaginationLimit, settingsAtom } from '../../state/settings';
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
import {
  CollapsibleMessage,
  expandAllMessages,
  collapseAllMessages,
} from '../../components/CollapsibleMessage';
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
import { createSessionId } from '../../state/sessions';
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
  buildThreadSummaryMap,
  findLatestThreadSummaryEvent,
  getThreadSummaryEventInfo,
  hasMindroomThreadSummary,
  isMindroomThreadSummaryEvent,
  MindroomThreadSummaryInfo,
} from '../../components/message/mindroomThreadSummary';
import {
  buildResolveConfirmedEventId,
  dedupeThreadRenderEventEntries,
  shouldPinThreadToBottomOnOpen,
} from './threadRenderUtils';
import { useThreadRenderState } from './useThreadRenderState';
import {
  RoomThreadOverview,
  type RoomThreadOverviewCounts,
  type ThreadFilter,
} from './RoomThreadOverview';
import {
  getThreadCursorAnchor,
  loadCachedThreadEventsBefore,
  loadLatestCachedThreadEvents,
  normalizeCachedThreadEvents,
  saveThreadEventsToCache,
} from './threadEventCache';
import { compareCachedPaginationAnchors } from './eventCacheTokenUtils';
import {
  getRoomCursorAnchor,
  loadCachedRoomEventsBefore,
  loadCachedRoomPaginationToken,
  normalizeCachedRoomEvents,
  saveRoomEventsToCache,
} from './roomEventCache';
import {
  loadCachedThreadSummaries,
  saveCachedThreadSummary,
} from './threadSummaryCache';
import {
  aggregateCachedRelationEvents,
  hydrateCachedEvents,
  serializeEventsForCache,
} from './eventCacheEditUtils';
import {
  isScrollNearBottom,
  isTimelineAtLiveEnd,
  shouldAutoScrollThreadOnLiveEvent,
} from './timelineScrollUtils';
import {
  markThreadEditBackfillAttempted,
  shouldFetchThreadEditBackfill,
} from './threadEditBackfillUtils';
import { useRoomThreadResolutionMap } from './useRoomThreadResolution';

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

const withStateTargetEvents = (room: Room, events: MatrixEvent[]): MatrixEvent[] => {
  const eventsById = new Map<string, MatrixEvent>();

  events.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (eventId) {
      eventsById.set(eventId, mEvent);
    }

    const targetEventId =
      mEvent.getRelation()?.rel_type === RelationType.Replace || mEvent.isRedaction()
        ? mEvent.getAssociatedId()
        : undefined;
    if (!targetEventId || eventsById.has(targetEventId)) return;

    const targetEvent = room.findEventById(targetEventId);
    if (targetEvent?.getId()) {
      eventsById.set(targetEventId, targetEvent);
    }
  });

  return Array.from(eventsById.values());
};

const KNOWN_EVENT_TYPES = new Set<string>([
  MessageEvent.RoomMessage,
  MessageEvent.RoomMessageEncrypted,
  MessageEvent.Sticker,
  StateEvent.RoomMember,
  StateEvent.RoomName,
  StateEvent.RoomTopic,
  StateEvent.RoomAvatar,
]);

export type TimelineEventEntry = {
  event: MatrixEvent;
  absoluteIndex: number;
};

export const isRenderableEvent = (
  mEvent: MatrixEvent,
  _room: Room,
  threadId: string | undefined,
  ignoredUsersSet: Set<string>,
  showHiddenEvents: boolean,
  hideMembershipEvents: boolean,
  hideNickAvatarEvents: boolean
): boolean => {
  const mEventId = mEvent.getId();
  if (!mEvent || !mEventId) return false;
  const eventSender = mEvent.getSender();
  if (eventSender && ignoredUsersSet.has(eventSender)) return false;
  if (!threadId && mEvent.threadRootId && mEvent.threadRootId !== mEventId) return false;
  if (mEvent.isRedacted() && !showHiddenEvents) return false;
  if (reactionOrEditEvent(mEvent)) return false;
  if (mEvent.isRedaction()) return false;

  // Membership / nick-avatar filtering
  if (mEvent.getType() === StateEvent.RoomMember) {
    const membershipChanged = isMembershipChanged(mEvent);
    if (membershipChanged && hideMembershipEvents) return false;
    if (!membershipChanged && hideNickAvatarEvents) return false;
  }

  // Unknown event types: only renderable when showHiddenEvents is true
  if (!KNOWN_EVENT_TYPES.has(mEvent.getType()) && !showHiddenEvents) return false;

  // Unknown message fallback filters (apply when showHiddenEvents is true)
  if (!KNOWN_EVENT_TYPES.has(mEvent.getType()) && typeof mEvent.getStateKey() !== 'string') {
    if (Object.keys(mEvent.getContent()).length === 0) return false;
    if (mEvent.getRelation()) return false;
  }

  return true;
};

export const getRenderableEventEntries = (
  linkedTimelines: EventTimeline[],
  room: Room,
  threadId: string | undefined,
  ignoredUsersSet: Set<string>,
  showHiddenEvents: boolean,
  hideMembershipEvents: boolean,
  hideNickAvatarEvents: boolean
): TimelineEventEntry[] => {
  const entries: TimelineEventEntry[] = [];
  let absoluteIndex = 0;

  linkedTimelines.forEach((timeline) => {
    timeline.getEvents().forEach((mEvent) => {
      if (
        isRenderableEvent(
          mEvent,
          room,
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents
        )
      ) {
        entries.push({ event: mEvent, absoluteIndex });
      }

      absoluteIndex += 1;
    });
  });

  return entries;
};

const getRenderableEvents = (
  linkedTimelines: EventTimeline[],
  room: Room,
  threadId: string | undefined,
  ignoredUsersSet: Set<string>,
  showHiddenEvents: boolean,
  hideMembershipEvents: boolean,
  hideNickAvatarEvents: boolean
): MatrixEvent[] =>
  getRenderableEventEntries(
    linkedTimelines,
    room,
    threadId,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents
  ).map(({ event }) => event);

const isVisibleThreadRootEvent = (
  event: MatrixEvent,
  room: Room,
  threadResolutionMap: Map<string, { isResolved: boolean }>,
  threadReplyCountMap?: Map<string, number>
): boolean => {
  const eventId = event.getId();
  if (!eventId) return false;

  return (
    event.isThreadRoot ||
    !!room.getThread(eventId) ||
    threadResolutionMap.has(eventId) ||
    (threadReplyCountMap?.get(eventId) ?? 0) > 0
  );
};

const isKnownThreadRootEventId = (
  room: Room,
  threadResolutionMap: Map<string, { isResolved: boolean }>,
  eventId: string,
  threadReplyCountMap?: Map<string, number>
): boolean =>
  !!room.getThread(eventId) ||
  threadResolutionMap.has(eventId) ||
  (threadReplyCountMap?.get(eventId) ?? 0) > 0;

const matchesRoomThreadFilter = (
  room: Room,
  threadResolutionMap: Map<string, { isResolved: boolean }>,
  eventId: string,
  threadFilter: Exclude<ThreadFilter, 'all'>,
  threadReplyCountMap?: Map<string, number>
): boolean | undefined => {
  const targetEvent = room.findEventById(eventId);

  if (targetEvent) {
    if (!isVisibleThreadRootEvent(targetEvent, room, threadResolutionMap, threadReplyCountMap)) {
      return false;
    }
  } else if (!isKnownThreadRootEventId(room, threadResolutionMap, eventId, threadReplyCountMap)) {
    return undefined;
  }

  const isResolved = threadResolutionMap.get(eventId)?.isResolved ?? false;
  return threadFilter === 'resolved' ? isResolved : !isResolved;
};

export const getThreadFilteredEvents = (
  renderableEvents: MatrixEvent[],
  room: Room,
  threadResolutionMap: Map<string, { isResolved: boolean }>,
  threadId: string | undefined,
  threadFilter: ThreadFilter,
  threadReplyCountMap?: Map<string, number>
): MatrixEvent[] => {
  if (threadId || threadFilter === 'all') return renderableEvents;

  return renderableEvents.filter((event) => {
    const eventId = event.getId();
    if (!eventId) return false;
    if (!isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)) {
      return false;
    }

    const resolution = threadResolutionMap.get(eventId);
    const isResolved = resolution?.isResolved ?? false;

    return threadFilter === 'resolved' ? isResolved : !isResolved;
  });
};

const getEventEntryIndex = (entries: TimelineEventEntry[], eventId: string): number =>
  entries.findIndex(({ event }) => event.getId() === eventId);

const getTimelineEventById = (
  linkedTimelines: EventTimeline[],
  eventId: string
): MatrixEvent | undefined => {
  for (const timeline of linkedTimelines) {
    const event = timeline.getEvents().find((mEvent) => mEvent.getId() === eventId);
    if (event) {
      return event;
    }
  }

  return undefined;
};

const getLinkedTimelinesEventAbsoluteIndex = (
  linkedTimelines: EventTimeline[],
  eventId: string
): number | undefined => {
  let absoluteIndex = 0;

  for (const timeline of linkedTimelines) {
    const relativeIndex = timeline.getEvents().findIndex((mEvent) => mEvent.getId() === eventId);
    if (relativeIndex !== -1) {
      return absoluteIndex + relativeIndex;
    }

    absoluteIndex += timeline.getEvents().length;
  }

  return undefined;
};

const getVisibleAnchorCandidateIds = (mEvent: MatrixEvent): string[] => {
  const eventId = mEvent.getId();
  if (!eventId) return [];

  const candidateIds = new Set<string>();
  const associatedEventId = mEvent.getAssociatedId() ?? mEvent.getRelation()?.event_id;
  if (associatedEventId && associatedEventId !== eventId) {
    candidateIds.add(associatedEventId);
  }

  const threadRootId = mEvent.threadRootId;
  if (threadRootId && threadRootId !== eventId) {
    candidateIds.add(threadRootId);
  }

  return Array.from(candidateIds);
};

const getClosestRenderableEntryIndex = (
  entries: TimelineEventEntry[],
  absoluteIndex: number
): number | undefined => {
  if (entries.length === 0) return undefined;

  const nextIndex = entries.findIndex((entry) => entry.absoluteIndex > absoluteIndex);
  if (nextIndex === -1) return entries.length - 1;
  if (nextIndex === 0) return 0;

  const previousIndex = nextIndex - 1;
  const previousDistance = absoluteIndex - entries[previousIndex].absoluteIndex;
  const nextDistance = entries[nextIndex].absoluteIndex - absoluteIndex;

  return nextDistance < previousDistance ? nextIndex : previousIndex;
};

const getNextRenderableEntryIndex = (
  entries: TimelineEventEntry[],
  absoluteIndex: number
): number | undefined => {
  const nextIndex = entries.findIndex((entry) => entry.absoluteIndex > absoluteIndex);
  return nextIndex === -1 ? undefined : nextIndex;
};

const getEntryAnchor = (
  entries: TimelineEventEntry[],
  entryIndex: number
):
  | {
      eventId: string;
      index: number;
      absoluteIndex: number;
    }
  | undefined => {
  const entry = entries[entryIndex];
  const eventId = entry?.event.getId();
  if (!entry || !eventId) return undefined;

  return {
    eventId,
    index: entryIndex,
    absoluteIndex: entry.absoluteIndex,
  };
};

export const getTimelineTargetAnchor = ({
  linkedTimelines,
  renderableEntries,
  eventId,
  absoluteIndex,
}: {
  linkedTimelines: EventTimeline[];
  renderableEntries: TimelineEventEntry[];
  eventId: string;
  absoluteIndex: number;
}) => {
  const visibleIndex = getEventEntryIndex(renderableEntries, eventId);
  if (visibleIndex !== -1) {
    return getEntryAnchor(renderableEntries, visibleIndex);
  }

  const targetEvent = getTimelineEventById(linkedTimelines, eventId);
  if (targetEvent) {
    for (const candidateId of getVisibleAnchorCandidateIds(targetEvent)) {
      const candidateIndex = getEventEntryIndex(renderableEntries, candidateId);
      if (candidateIndex !== -1) {
        return getEntryAnchor(renderableEntries, candidateIndex);
      }
    }
  }

  const closestIndex = getClosestRenderableEntryIndex(renderableEntries, absoluteIndex);
  if (closestIndex === undefined) return undefined;

  return getEntryAnchor(renderableEntries, closestIndex);
};

export const getUnreadTargetAnchor = ({
  renderableEntries,
  eventId,
  absoluteIndex,
}: {
  renderableEntries: TimelineEventEntry[];
  eventId: string;
  absoluteIndex: number;
}) => {
  const visibleIndex = getEventEntryIndex(renderableEntries, eventId);
  if (visibleIndex !== -1) {
    return getEntryAnchor(renderableEntries, visibleIndex);
  }

  const nextIndex = getNextRenderableEntryIndex(renderableEntries, absoluteIndex);
  if (nextIndex !== undefined) {
    return getEntryAnchor(renderableEntries, nextIndex);
  }

  const closestIndex = getClosestRenderableEntryIndex(renderableEntries, absoluteIndex);
  if (closestIndex === undefined) return undefined;

  return getEntryAnchor(renderableEntries, closestIndex);
};

export const shouldRenderUnreadDividerAt = ({
  readUptoAbsoluteIndex,
  eventAbsoluteIndex,
  prevRenderedEventAbsoluteIndex,
}: {
  readUptoAbsoluteIndex: number | undefined;
  eventAbsoluteIndex: number | undefined;
  prevRenderedEventAbsoluteIndex: number | undefined;
}): boolean =>
  readUptoAbsoluteIndex !== undefined &&
  eventAbsoluteIndex !== undefined &&
  eventAbsoluteIndex > readUptoAbsoluteIndex &&
  (prevRenderedEventAbsoluteIndex === undefined ||
    prevRenderedEventAbsoluteIndex <= readUptoAbsoluteIndex);

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
  if ((threadLength ?? 0) > 0) return threadLength;

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

const getThreadSummaryInfo = (
  room: Room,
  mEvent: MatrixEvent,
  fallbackInfo?: MindroomThreadSummaryInfo,
  cachedInfo?: MindroomThreadSummaryInfo
): MindroomThreadSummaryInfo | undefined => {
  const eventId = mEvent.getId();
  if (eventId) {
    const thread = room.getThread(eventId);
    if (thread?.events?.length) {
      const summaryEvent = findLatestThreadSummaryEvent(thread.events);
      if (summaryEvent) {
        const info = getThreadSummaryEventInfo(summaryEvent);
        if (info?.summaryText) return info;
      }
    }
  }

  return fallbackInfo ?? cachedInfo;
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
  threadFilter: ThreadFilter;
  onThreadFilterChange: (filter: ThreadFilter) => void;
  roomInputRef: RefObject<HTMLElement>;
  editor: Editor;
};

const ROOM_FOCUS_SCROLL_RETRY_MAX_ATTEMPTS = 10;
const ROOM_FOCUS_SCROLL_OBSERVER_TIMEOUT_MS = 2000;

type RoomFocusRetry = {
  eventId: string;
  attempts: number;
};

type PendingRoomFocus = {
  eventId: string;
};

export const getNextRoomFocusRetry = ({
  focusEventId,
  pendingRetry,
  scrolled,
  targetFound,
}: {
  focusEventId: string | undefined;
  pendingRetry: RoomFocusRetry | undefined;
  scrolled: boolean;
  targetFound: boolean;
}): RoomFocusRetry | undefined => {
  if (!focusEventId || targetFound || !scrolled) {
    return undefined;
  }

  const attempts = pendingRetry?.eventId === focusEventId ? pendingRetry.attempts + 1 : 1;

  if (attempts > ROOM_FOCUS_SCROLL_RETRY_MAX_ATTEMPTS) {
    return undefined;
  }

  return {
    eventId: focusEventId,
    attempts,
  };
};

export const isContinuingRoomFocusRetry = (
  focusEventId: string | undefined,
  pendingRetry: RoomFocusRetry | undefined
): boolean => !!focusEventId && pendingRetry?.eventId === focusEventId;

export const getRoomFocusScrollToItemOptions = () => ({
  behavior: 'instant' as const,
  align: 'center' as const,
  stopInView: false,
});

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

const getEarliestLoadedThreadReply = (
  events: MatrixEvent[],
  threadId: string
): MatrixEvent | undefined =>
  events.find((mEvent) => {
    const eventId = mEvent.getId();
    return !!eventId && eventId !== threadId && eventBelongsToThread(mEvent, threadId);
  });

const isThreadOnlyRoomActivity = (room: Room, mEvt: MatrixEvent): boolean => {
  const mEventId = mEvt.getId();
  const relationTargetId = mEvt.getRelation()?.event_id;
  const relatedEvent = relationTargetId ? room.findEventById(relationTargetId) : undefined;
  const relatedEventId = relatedEvent?.getId();
  const isThreadReplyMessage = !!mEventId && !!mEvt.threadRootId && mEvt.threadRootId !== mEventId;
  const isThreadReplyRelatedEvent =
    !!relatedEventId &&
    !!relatedEvent?.threadRootId &&
    relatedEvent.threadRootId !== relatedEventId;
  return isThreadReplyMessage || isThreadReplyRelatedEvent;
};

const isCollapsibleTextMessageEvent = (mEvent: MatrixEvent): boolean =>
  mEvent.getType() === MessageEvent.RoomMessage ||
  mEvent.getType() === MessageEvent.RoomMessageEncrypted;

type ShouldTrackLiveCollapsibleMessage = {
  mEvent: MatrixEvent;
  room: Room;
  threadId: string | undefined;
  threadFilter: ThreadFilter;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
};

export const shouldTrackLiveCollapsibleMessage = ({
  mEvent,
  room,
  threadId,
  threadFilter,
  threadResolutionMap,
  ignoredUsersSet,
  showHiddenEvents,
  hideMembershipEvents,
  hideNickAvatarEvents,
}: ShouldTrackLiveCollapsibleMessage): boolean => {
  const mEventId = mEvent.getId();
  if (!mEventId || !isCollapsibleTextMessageEvent(mEvent)) return false;

  if (
    !isRenderableEvent(
      mEvent,
      room,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents
    )
  ) {
    return false;
  }

  if (threadId) {
    return mEventId === threadId || eventBelongsToThread(mEvent, threadId);
  }

  if (isThreadOnlyRoomActivity(room, mEvent)) {
    return false;
  }

  return (
    getThreadFilteredEvents([mEvent], room, threadResolutionMap, threadId, threadFilter).length > 0
  );
};

export const getLiveCollapsibleMessageExpandId = (
  opts: ShouldTrackLiveCollapsibleMessage
): string | undefined => {
  const { mEvent, room } = opts;
  const mEventId = mEvent.getId();
  if (!mEventId || !isCollapsibleTextMessageEvent(mEvent)) return undefined;

  const relation = mEvent.getRelation();
  if (relation?.rel_type === RelationType.Replace) {
    const targetEventId = relation.event_id;
    if (!targetEventId) return undefined;

    const targetEvent = room.findEventById(targetEventId);
    if (
      targetEvent &&
      isCollapsibleTextMessageEvent(targetEvent) &&
      shouldTrackLiveCollapsibleMessage({
        ...opts,
        mEvent: targetEvent,
      })
    ) {
      return targetEventId;
    }

    return undefined;
  }

  return shouldTrackLiveCollapsibleMessage(opts) ? mEventId : undefined;
};

export const getCollapsibleMessageMode = (
  mEventId: string,
  resolvedContent: IContent,
  liveExpandOnceIds: Set<string>
) =>
  hasMindroomThreadSummary(resolvedContent as Record<string, unknown>)
    ? 'always-expanded'
    : liveExpandOnceIds.has(mEventId)
      ? 'initially-expanded'
      : 'default';

export const consumeLiveExpandOnceId = (liveExpandOnceIds: Set<string>, mEventId: string) => {
  liveExpandOnceIds.delete(mEventId);
};

const getMainTimelineCacheEvents = (room: Room, linkedTimelines: EventTimeline[]): MatrixEvent[] =>
  linkedTimelines.flatMap((timeline) =>
    timeline.getEvents().filter((mEvent) => !isThreadOnlyRoomActivity(room, mEvent))
  );

const findEarliestLoadedRoomEventByCacheOrder = (
  cacheEvents: MatrixEvent[]
): MatrixEvent | undefined => {
  const earliestEventId = normalizeCachedRoomEvents(
    cacheEvents.map((mEvent) => mEvent.event as Partial<IEvent>)
  )[0]?.event_id;

  return earliestEventId
    ? cacheEvents.find((mEvent) => mEvent.getId() === earliestEventId)
    : undefined;
};

const getEarliestLoadedRoomEvent = (
  room: Room,
  linkedTimelines: EventTimeline[]
): MatrixEvent | undefined =>
  findEarliestLoadedRoomEventByCacheOrder(getMainTimelineCacheEvents(room, linkedTimelines));

const resolveHydratedRoomBeforeToken = (
  cachedBeforeToken: string | null | undefined,
  paginationToken: string | null
): string | null => (cachedBeforeToken !== undefined ? cachedBeforeToken : paginationToken);

const resolvePersistedRoomBeforeToken = (
  paginationToken: string | null | undefined,
  cachedBeforeToken: string | null | undefined
): string | null | undefined => {
  if (paginationToken === null || cachedBeforeToken === null) return null;
  if (typeof paginationToken === 'string') return paginationToken;
  return cachedBeforeToken;
};

const recalibrateTimelinePagination = (
  setTimeline: Dispatch<
    SetStateAction<{
      linkedTimelines: EventTimeline[];
      range: ItemRange;
    }>
  >,
  linkedTimelines: EventTimeline[],
  timelinesEventsCount: number[],
  backwards: boolean,
  filterOpts?: {
    room: Room;
    threadId: string | undefined;
    ignoredUsersSet: Set<string>;
    showHiddenEvents: boolean;
    hideMembershipEvents: boolean;
    hideNickAvatarEvents: boolean;
  },
  timelinesRenderableCounts?: number[]
) => {
  const topTimeline = linkedTimelines[0];
  const timelineMatch = (mt: EventTimeline) => (t: EventTimeline) => t === mt;

  const newLTimelines = getLinkedTimelines(topTimeline);
  const topTmIndex = newLTimelines.findIndex(timelineMatch(topTimeline));
  const topAddedTm = topTmIndex === -1 ? [] : newLTimelines.slice(0, topTmIndex);

  let offsetRange: number;
  if (filterOpts) {
    const countRenderable = (tms: EventTimeline[]) =>
      getRenderableEvents(
        tms,
        filterOpts.room,
        filterOpts.threadId,
        filterOpts.ignoredUsersSet,
        filterOpts.showHiddenEvents,
        filterOpts.hideMembershipEvents,
        filterOpts.hideNickAvatarEvents
      ).length;
    const oldTopRenderableCount =
      timelinesRenderableCounts?.[0] ?? countRenderable([linkedTimelines[0]]);
    const newTopRenderableCount = countRenderable([newLTimelines[topTmIndex]]);
    const topTmAddedRenderable = newTopRenderableCount - oldTopRenderableCount;
    const addedTmRenderable = countRenderable(topAddedTm);
    offsetRange = addedTmRenderable + (backwards ? topTmAddedRenderable : 0);
  } else {
    const topTmAddedEvt =
      timelineToEventsCount(newLTimelines[topTmIndex]) - timelinesEventsCount[0];
    offsetRange = getTimelinesEventsCount(topAddedTm) + (backwards ? topTmAddedEvt : 0);
  }

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
    async (eventId: string): Promise<EventTimeline[] | undefined> => {
      const [err, replyEvtTimeline] = await to(
        mx.getEventTimeline(room.getUnfilteredTimelineSet(), eventId)
      );
      if (!replyEvtTimeline) {
        onError(err ?? null);
        return undefined;
      }
      const linkedTimelines = getLinkedTimelines(replyEvtTimeline);
      const absIndex = getEventIdAbsoluteIndex(linkedTimelines, replyEvtTimeline, eventId);

      if (absIndex === undefined) {
        onError(err ?? null);
        return undefined;
      }

      onLoad(eventId, linkedTimelines, absIndex);
      return linkedTimelines;
    },
    [mx, room, onLoad, onError]
  );

  return loadEventTimeline;
};

type RecalibrateFilterOpts = {
  room: Room;
  threadId: string | undefined;
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
};

const useTimelinePagination = (
  mx: MatrixClient,
  timeline: Timeline,
  setTimeline: Dispatch<SetStateAction<Timeline>>,
  limit: number,
  filterOptsRef: RefObject<RecalibrateFilterOpts | undefined>
) => {
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const alive = useAlive();

  const handleTimelinePagination = useMemo(() => {
    let fetching = false;

    return async (backwards: boolean) => {
      if (fetching) return;
      const { linkedTimelines: lTimelines } = timelineRef.current;
      const timelinesEventsCount = lTimelines.map(timelineToEventsCount);
      const fOpts = filterOptsRef.current ?? undefined;
      const timelinesRenderableCounts = fOpts
        ? lTimelines.map(
            (tl) =>
              getRenderableEvents(
                [tl],
                fOpts.room,
                fOpts.threadId,
                fOpts.ignoredUsersSet,
                fOpts.showHiddenEvents,
                fOpts.hideMembershipEvents,
                fOpts.hideNickAvatarEvents
              ).length
          )
        : undefined;

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
        recalibrateTimelinePagination(
          setTimeline,
          lTimelines,
          timelinesEventsCount,
          backwards,
          fOpts,
          timelinesRenderableCounts
        );
        return;
      }

      fetching = true;
      try {
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

        if (alive()) {
          recalibrateTimelinePagination(
            setTimeline,
            lTimelines,
            timelinesEventsCount,
            backwards,
            fOpts,
            timelinesRenderableCounts
          );
        }
      } finally {
        fetching = false;
      }
    };
  }, [mx, alive, setTimeline, limit, filterOptsRef]);
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

type UseThreadAwareTimelineRefresh = {
  room: Room;
  threadId?: string;
  liveTimelineLinked: boolean;
  refreshLatestThreadSlice: (threadId: string) => Promise<boolean>;
  onRoomRefresh: () => void;
};

export const useThreadAwareTimelineRefresh = ({
  room,
  threadId,
  liveTimelineLinked,
  refreshLatestThreadSlice,
  onRoomRefresh,
}: UseThreadAwareTimelineRefresh) => {
  const threadRefreshInFlightRef = useRef<string>();
  const pendingRefreshRef = useRef(false);
  const activeThreadIdRef = useRef(threadId);

  if (activeThreadIdRef.current !== threadId) {
    activeThreadIdRef.current = threadId;
    pendingRefreshRef.current = false;
  }

  useLiveTimelineRefresh(
    room,
    useCallback(() => {
      if (threadId) {
        if (threadRefreshInFlightRef.current === threadId) {
          pendingRefreshRef.current = true;
          return;
        }
        const runRefresh = (tid: string) => {
          threadRefreshInFlightRef.current = tid;
          pendingRefreshRef.current = false;
          void refreshLatestThreadSlice(tid).finally(() => {
            if (threadRefreshInFlightRef.current !== tid) return;
            if (pendingRefreshRef.current && activeThreadIdRef.current === tid) {
              runRefresh(tid);
            } else {
              pendingRefreshRef.current = false;
              threadRefreshInFlightRef.current = undefined;
            }
          });
        };
        runRefresh(threadId);
      } else if (liveTimelineLinked) {
        onRoomRefresh();
      }
    }, [liveTimelineLinked, onRoomRefresh, refreshLatestThreadSlice, threadId])
  );
};

const getInitialTimeline = (
  room: Room,
  paginationLimit: number,
  filterOpts?: {
    threadId: string | undefined;
    ignoredUsersSet: Set<string>;
    showHiddenEvents: boolean;
    hideMembershipEvents: boolean;
    hideNickAvatarEvents: boolean;
  }
) => {
  const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
  const count = filterOpts
    ? getRenderableEvents(
        linkedTimelines,
        room,
        filterOpts.threadId,
        filterOpts.ignoredUsersSet,
        filterOpts.showHiddenEvents,
        filterOpts.hideMembershipEvents,
        filterOpts.hideNickAvatarEvents
      ).length
    : getTimelinesEventsCount(linkedTimelines);
  return {
    linkedTimelines,
    range: {
      start: Math.max(count - paginationLimit, 0),
      end: count,
    },
  };
};

const getEmptyTimeline = () => ({
  range: { start: 0, end: 0 },
  linkedTimelines: [],
});

const getLatestTimelineRange = (count: number, paginationLimit: number): ItemRange => ({
  start: Math.max(count - paginationLimit, 0),
  end: count,
});

const getVisibleTimelineRange = (
  range: ItemRange,
  count: number,
  paginationLimit: number
): ItemRange => {
  if (count === 0) {
    return { start: 0, end: 0 };
  }

  if (range.start >= count || range.start >= range.end) {
    return getLatestTimelineRange(count, paginationLimit);
  }

  const start = Math.max(range.start, 0);
  const end = Math.min(Math.max(range.end, start + 1), count);

  return { start, end };
};

export const isRoomThreadFilterActive = (
  threadId: string | undefined,
  threadFilter: ThreadFilter
): boolean => !threadId && threadFilter !== 'all';

export const getActiveTimelineRange = (
  threadId: string | undefined,
  threadFilter: ThreadFilter,
  range: ItemRange,
  count: number,
  paginationLimit: number
): ItemRange => {
  if (threadId) {
    return { start: 0, end: 0 };
  }

  if (isRoomThreadFilterActive(threadId, threadFilter)) {
    return { start: 0, end: count };
  }

  return getVisibleTimelineRange(range, count, paginationLimit);
};

export const shouldResetRoomThreadFilterForEvent = (
  threadId: string | undefined,
  threadFilter: ThreadFilter,
  filteredEvents: MatrixEvent[],
  room: Room,
  threadResolutionMap: Map<string, { isResolved: boolean }>,
  eventId: string,
  threadReplyCountMap?: Map<string, number>
): boolean | undefined => {
  if (!isRoomThreadFilterActive(threadId, threadFilter)) {
    return false;
  }

  if (filteredEvents.findIndex((event) => event.getId() === eventId) !== -1) {
    return false;
  }

  const matchesThreadFilter = matchesRoomThreadFilter(
    room,
    threadResolutionMap,
    eventId,
    threadFilter as Exclude<ThreadFilter, 'all'>,
    threadReplyCountMap
  );

  if (matchesThreadFilter === undefined) {
    return undefined;
  }

  return !matchesThreadFilter;
};

export const getRoomEventFocusTarget = ({
  eventId,
  renderableEvents,
  room,
  threadResolutionMap,
  threadId,
  threadFilter,
  threadReplyCountMap,
}: {
  eventId: string;
  renderableEvents: MatrixEvent[];
  room: Room;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
  threadId: string | undefined;
  threadFilter: ThreadFilter;
  threadReplyCountMap?: Map<string, number>;
}): {
  index: number;
  count: number;
  resetThreadFilter: boolean;
} => {
  const filteredEvents = getThreadFilteredEvents(
    renderableEvents,
    room,
    threadResolutionMap,
    threadId,
    threadFilter,
    threadReplyCountMap
  );
  const filteredIndex = filteredEvents.findIndex((event) => event.getId() === eventId);
  if (filteredIndex !== -1) {
    return {
      index: filteredIndex,
      count: filteredEvents.length,
      resetThreadFilter: false,
    };
  }

  const renderableIndex = renderableEvents.findIndex((event) => event.getId() === eventId);
  const resetThreadFilter =
    renderableIndex !== -1 &&
    shouldResetRoomThreadFilterForEvent(
      threadId,
      threadFilter,
      filteredEvents,
      room,
      threadResolutionMap,
      eventId,
      threadReplyCountMap
    ) === true;
  if (resetThreadFilter) {
    return {
      index: renderableIndex,
      count: renderableEvents.length,
      resetThreadFilter: true,
    };
  }

  return {
    index: 0,
    count: isRoomThreadFilterActive(threadId, threadFilter)
      ? filteredEvents.length
      : renderableEvents.length,
    resetThreadFilter: false,
  };
};

const getFocusedRoomEventIndex = (
  filteredEvents: MatrixEvent[],
  eventId: string | undefined,
  fallbackIndex: number
): number => {
  if (!eventId) return fallbackIndex;
  const filteredIndex = filteredEvents.findIndex((event) => event.getId() === eventId);
  return filteredIndex === -1 ? fallbackIndex : filteredIndex;
};
const shouldResetRoomThreadFilterForLoadedEvent = (
  threadId: string | undefined,
  threadFilter: ThreadFilter,
  room: Room,
  threadResolutionMap: Map<string, { isResolved: boolean }>,
  eventId: string,
  linkedTimelines: EventTimeline[] | undefined
): boolean => {
  if (!isRoomThreadFilterActive(threadId, threadFilter) || !linkedTimelines) {
    return false;
  }

  const targetEvent = room.findEventById(eventId);
  if (!targetEvent) {
    return false;
  }

  const loadedThreadReplyCountMap = buildThreadReplyCountMap(
    linkedTimelines.flatMap((timeline) => timeline.getEvents())
  );

  if (!isVisibleThreadRootEvent(targetEvent, room, threadResolutionMap, loadedThreadReplyCountMap)) {
    return true;
  }

  const isResolved = threadResolutionMap.get(eventId)?.isResolved ?? false;
  const matchesThreadFilter = threadFilter === 'resolved' ? isResolved : !isResolved;

  return !matchesThreadFilter;
};

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

export function RoomTimeline({
  room,
  eventId,
  threadId,
  threadFilter,
  onThreadFilterChange,
  roomInputRef,
  editor,
}: RoomTimelineProps) {
  const mx = useMatrixClient();
  const sessionId = useMemo(() => createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId()), [mx]);
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
  const [paginationLimitSetting] = useSetting(settingsAtom, 'paginationLimit');
  const safePaginationLimit = sanitizePaginationLimit(paginationLimitSetting);
  const safePaginationLimitRef = useRef(safePaginationLimit);
  safePaginationLimitRef.current = safePaginationLimit;

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
  const [allExpanded, setAllExpanded] = useState(false);
  const atBottomRef = useRef(atBottom);
  const liveExpandOnceIds = useRef(new Set<string>());
  atBottomRef.current = atBottom;

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBottomRef = useRef({
    count: 0,
    smooth: true,
  });

  const [focusItem, setFocusItem] = useState<
    | {
        eventId?: string;
        index: number;
        scrollTo: boolean;
        highlight: boolean;
      }
    | undefined
  >();
  const [threadLoadError, setThreadLoadError] = useState(false);
  const [roomHasMoreCachedBack, setRoomHasMoreCachedBack] = useState(false);
  const [threadHasMoreCachedBack, setThreadHasMoreCachedBack] = useState(false);
  const [threadTailLoaded, setThreadTailLoaded] = useState(false);
  const [threadPaginatingBack, setThreadPaginatingBack] = useState(false);
  const [threadPaginatingFront, setThreadPaginatingFront] = useState(false);
  const [threadInitialCacheHydrated, setThreadInitialCacheHydrated] = useState(false);
  const [threadLatestOpenPending, setThreadLatestOpenPending] = useState(false);
  const [threadTimelineTick, setThreadTimelineTick] = useState(0);
  const [pendingThreadOpenTick, setPendingThreadOpenTick] = useState(0);
  const roomIdRef = useRef(room.roomId);
  const roomPaginatingBackRef = useRef(false);
  const threadPaginatingBackRef = useRef(false);
  const threadPaginatingFrontRef = useRef(false);
  const threadIdRef = useRef(threadId);
  const threadFilterRef = useRef(threadFilter);
  const threadEditFetchAttemptedRef = useRef<WeakMap<MatrixEvent, number>>(
    new WeakMap<MatrixEvent, number>()
  );
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
  const pendingRoomFocusRef = useRef<PendingRoomFocus | undefined>();
  const skipNextRoomTimelineResetRef = useRef(false);
  const suppressFocusPaginationRef = useRef(false);
  const alive = useAlive();
  roomIdRef.current = room.roomId;
  threadPaginatingBackRef.current = threadPaginatingBack;
  threadPaginatingFrontRef.current = threadPaginatingFront;
  threadIdRef.current = threadId;
  threadFilterRef.current = threadFilter;

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
    eventId
      ? getEmptyTimeline()
      : getInitialTimeline(room, safePaginationLimit, {
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
        })
  );
  const eventsLength = getTimelinesEventsCount(timeline.linkedTimelines);
  const threadResolutionMap = useRoomThreadResolutionMap(room);
  useEffect(() => {
    liveExpandOnceIds.current.clear();
  }, [room.roomId, threadId]);
  const rawRenderableEventEntries = useMemo(
    () =>
      getRenderableEventEntries(
        timeline.linkedTimelines,
        room,
        threadId,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      timeline.linkedTimelines,
      eventsLength,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
    ]
  );
  const resolveConfirmedRoomEventId = useMemo(
    () =>
      threadId
        ? undefined
        : buildResolveConfirmedEventId(
            room,
            rawRenderableEventEntries.map(({ event }) => event)
          ),
    [threadId, room, rawRenderableEventEntries]
  );
  const renderableEventEntries = useMemo(
    () =>
      threadId
        ? rawRenderableEventEntries
        : dedupeThreadRenderEventEntries(
            rawRenderableEventEntries,
            resolveConfirmedRoomEventId
          ),
    [threadId, rawRenderableEventEntries, resolveConfirmedRoomEventId]
  );
  const renderableEvents = useMemo(
    () => renderableEventEntries.map(({ event }) => event),
    [renderableEventEntries]
  );
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
  const threadSummaryInfoMap = useMemo(
    () =>
      threadId
        ? new Map<string, MindroomThreadSummaryInfo>()
        : buildThreadSummaryMap(loadedTimelineEvents),
    [threadId, loadedTimelineEvents]
  );
  const visibleThreadCounts = useMemo<RoomThreadOverviewCounts>(() => {
    let unresolved = 0;
    let resolved = 0;

    for (const event of renderableEvents) {
      const eventId = event.getId();
      if (!eventId) continue;

      if (!isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)) {
        continue;
      }

      const resolution = threadResolutionMap.get(eventId);
      if (resolution?.isResolved) {
        resolved += 1;
      } else {
        unresolved += 1;
      }
    }

    return {
      unresolved,
      resolved,
      all: unresolved + resolved,
    };
  }, [renderableEvents, room, threadReplyCountMap, threadResolutionMap]);
  const roomThreadFilterActive = isRoomThreadFilterActive(threadId, threadFilter);
  const threadFilteredEvents = useMemo(
    () =>
      getThreadFilteredEvents(
        renderableEvents,
        room,
        threadResolutionMap,
        threadId,
        threadFilter,
        threadReplyCountMap
      ),
    [renderableEvents, room, threadResolutionMap, threadId, threadFilter, threadReplyCountMap]
  );
  const threadFilteredEventsRef = useRef(threadFilteredEvents);
  threadFilteredEventsRef.current = threadFilteredEvents;
  const threadFilteredEventEntries = useMemo(() => {
    const filteredEventIds = new Set<string>();
    threadFilteredEvents.forEach((event) => {
      const filteredEventId = event.getId();
      if (filteredEventId) {
        filteredEventIds.add(filteredEventId);
      }
    });

    return renderableEventEntries.filter(({ event }) => {
      const filteredEventId = event.getId();
      return !!filteredEventId && filteredEventIds.has(filteredEventId);
    });
  }, [renderableEventEntries, threadFilteredEvents]);
  const readUptoAbsoluteIndex = useMemo(() => {
    if (threadId) return undefined;
    const currentReadUptoEventId = unreadInfo?.readUptoEventId;
    if (!currentReadUptoEventId) return undefined;

    return getLinkedTimelinesEventAbsoluteIndex(
      timeline.linkedTimelines,
      currentReadUptoEventId
    );
  }, [threadId, timeline.linkedTimelines, unreadInfo?.readUptoEventId]);
  const unreadScrollAnchorIndex = useMemo(() => {
    const currentReadUptoEventId = unreadInfo?.readUptoEventId;
    if (threadId || !currentReadUptoEventId) return undefined;

    const visibleIndex = getEventEntryIndex(threadFilteredEventEntries, currentReadUptoEventId);
    if (visibleIndex !== -1) {
      return visibleIndex;
    }

    if (readUptoAbsoluteIndex === undefined) return undefined;
    return getNextRenderableEntryIndex(threadFilteredEventEntries, readUptoAbsoluteIndex);
  }, [threadFilteredEventEntries, threadId, unreadInfo?.readUptoEventId, readUptoAbsoluteIndex]);
  const filteredLength = threadFilteredEvents.length;
  const activeTimelineRange = useMemo(
    () =>
      getActiveTimelineRange(
        threadId,
        threadFilter,
        timeline.range,
        filteredLength,
        safePaginationLimit
      ),
    [threadId, threadFilter, timeline.range, filteredLength, safePaginationLimit]
  );
  const prevThreadFilterRef = useRef(threadFilter);
  const liveTimelineLinked =
    timeline.linkedTimelines[timeline.linkedTimelines.length - 1] === getLiveTimeline(room);
  const canPaginateBack =
    typeof timeline.linkedTimelines[0]?.getPaginationToken(Direction.Backward) === 'string';
  const rangeAtStart = activeTimelineRange.start === 0;
  const rangeAtEnd = activeTimelineRange.end === filteredLength;
  const thread = threadId ? room.getThread(threadId) : null;
  const roomTimelineSet = room.getUnfilteredTimelineSet();
  const threadTimelineSet = thread?.getUnfilteredTimelineSet();
  const threadLinkedTimelines = threadTimelineSet
    ? getLinkedTimelines(threadTimelineSet.getLiveTimeline())
    : [];
  const lastThreadTimeline = threadLinkedTimelines[threadLinkedTimelines.length - 1];
  const {
    threadEventIndexMapRef,
    threadEvents,
    threadInitialRenderMode,
    setSupplementalThreadEvents,
    resetThreadRenderState,
  } = useThreadRenderState({
    room,
    roomTimelineSet,
    threadTimelineSet,
    threadId,
    thread,
    threadInitialCacheHydrated,
  });
  const canPaginateThreadBack =
    typeof threadLinkedTimelines[0]?.getPaginationToken(Direction.Backward) === 'string';
  const canPaginateThreadFront =
    typeof lastThreadTimeline?.getPaginationToken(Direction.Forward) === 'string';

  useEffect(() => {
    const prevThreadFilter = prevThreadFilterRef.current;
    prevThreadFilterRef.current = threadFilter;

    if (prevThreadFilter !== 'all' && threadFilter === 'all' && !threadId) {
      if (skipNextRoomTimelineResetRef.current) {
        skipNextRoomTimelineResetRef.current = false;
        return;
      }
      setTimeline(
        getInitialTimeline(room, safePaginationLimit, {
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
        })
      );
    }
  }, [
    threadFilter,
    threadId,
    room,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    safePaginationLimit,
  ]);

  const timelineAtLiveEnd = isTimelineAtLiveEnd({
    threadId,
    liveTimelineLinked,
    rangeAtEnd,
    canPaginateThreadFront,
    threadTailLoaded,
  });
  const atLiveEndRef = useRef(timelineAtLiveEnd);
  atLiveEndRef.current = timelineAtLiveEnd;

  const recalibrateFilterOptsRef = useRef<RecalibrateFilterOpts | undefined>({
    room,
    threadId,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
  });
  recalibrateFilterOptsRef.current = {
    room,
    threadId,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
  };

  const handleTimelinePagination = useTimelinePagination(
    mx,
    timeline,
    setTimeline,
    safePaginationLimit,
    recalibrateFilterOptsRef
  );

  const handleRoomTimelinePagination = useCallback(
    async (backwards: boolean) => {
      if (threadId) return;
      if (!backwards) {
        await handleTimelinePagination(false);
        return;
      }
      if (roomPaginatingBackRef.current) return;

      roomPaginatingBackRef.current = true;
      try {
        const currentLinkedTimelines = timeline.linkedTimelines;
        const firstTimeline = currentLinkedTimelines[0];
        if (!firstTimeline) return;

        const timelinesEventsCount = currentLinkedTimelines.map(timelineToEventsCount);
        const rFilterOpts = recalibrateFilterOptsRef.current;
        const timelinesRenderableCounts = rFilterOpts
          ? currentLinkedTimelines.map(
              (tl) =>
                getRenderableEvents(
                  [tl],
                  rFilterOpts.room,
                  rFilterOpts.threadId,
                  rFilterOpts.ignoredUsersSet,
                  rFilterOpts.showHiddenEvents,
                  rFilterOpts.hideMembershipEvents,
                  rFilterOpts.hideNickAvatarEvents
                ).length
            )
          : undefined;
        const earliestLoadedEvent = getEarliestLoadedRoomEvent(room, currentLinkedTimelines);
        const cachedBeforeToken = await loadCachedRoomPaginationToken(
          sessionId,
          room.roomId,
          earliestLoadedEvent?.getId()
        );

        if (!alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

        if (cachedBeforeToken === null) {
          if (firstTimeline.getPaginationToken(Direction.Backward) !== null) {
            firstTimeline.setPaginationToken(null, Direction.Backward);
            setTimeline((currentTimeline) =>
              currentTimeline.linkedTimelines === currentLinkedTimelines
                ? { ...currentTimeline }
                : currentTimeline
            );
          }
          setRoomHasMoreCachedBack(false);
          return;
        }

        const cachedPage = await loadCachedRoomEventsBefore(
          sessionId,
          room.roomId,
          getRoomCursorAnchor(earliestLoadedEvent?.event as Partial<IEvent> | undefined),
          safePaginationLimitRef.current
        );

        if (!alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

        if (cachedPage.events.length > 0) {
          const mapper = mx.getEventMapper();
          const cachedEvents = normalizeCachedRoomEvents(cachedPage.events)
            .map((rawEvent) => mapper(rawEvent))
            .reverse();
          hydrateCachedEvents({
            room,
            events: cachedEvents,
          });
          const paginationToken = firstTimeline.getPaginationToken(Direction.Backward);
          const [timelineEvents, , unknownRelations] = room.partitionThreadedEvents(cachedEvents);

          (
            room.addEventsToTimeline as (
              events: MatrixEvent[],
              toStartOfTimeline: boolean,
              addToState: boolean,
              timeline: EventTimeline,
              paginationToken?: string | null
            ) => void
          )(
            timelineEvents,
            true,
            false,
            firstTimeline,
            resolveHydratedRoomBeforeToken(cachedPage.beforeToken, paginationToken)
          );
          mx.processAggregatedTimelineEvents(room, timelineEvents);
          room.processThreadRoots(
            timelineEvents.filter((mEvent) =>
              mEvent.getServerAggregatedRelation(THREAD_RELATION_TYPE.name)
            ),
            false
          );
          unknownRelations.forEach((mEvent) => room.relations.aggregateChildEvent(mEvent));

          const fetchedTimeline =
            firstTimeline.getNeighbouringTimeline(Direction.Backward) ?? firstTimeline;
          if (room.hasEncryptionStateEvent()) {
            await to(decryptAllTimelineEvent(mx, fetchedTimeline));
          }

          if (alive() && roomIdRef.current === room.roomId && !threadIdRef.current) {
            recalibrateTimelinePagination(
              setTimeline,
              currentLinkedTimelines,
              timelinesEventsCount,
              true,
              recalibrateFilterOptsRef.current ?? undefined,
              timelinesRenderableCounts
            );
            setRoomHasMoreCachedBack(cachedPage.hasMoreBefore);
          }
          return;
        }

        setRoomHasMoreCachedBack(false);
        await handleTimelinePagination(true);
      } finally {
        roomPaginatingBackRef.current = false;
      }
    },
    [alive, handleTimelinePagination, mx, room, sessionId, threadId, timeline.linkedTimelines]
  );

  const persistThreadEventCache = useCallback(
    (
      expectedThreadId: string,
      events: MatrixEvent[],
      rootEvent?: MatrixEvent | null,
      beforeTokenForEarliest?: string | null
    ) => {
      const cacheEvents = withStateTargetEvents(room, rootEvent ? [rootEvent, ...events] : events);
      const rawEvents = serializeEventsForCache(room, cacheEvents);
      const rawRootEvent = rootEvent
        ? rawEvents.find((rawEvent) => rawEvent.event_id === rootEvent.getId())
        : undefined;
      saveThreadEventsToCache(
        sessionId,
        room.roomId,
        expectedThreadId,
        rawEvents,
        rawRootEvent,
        beforeTokenForEarliest
      ).catch(() => undefined);
    },
    [room, sessionId]
  );

  const persistRoomEventCache = useCallback(
    (events: MatrixEvent[], beforeTokenForEarliest?: string | null) => {
      const rawEvents = serializeEventsForCache(
        room,
        withStateTargetEvents(room, events).filter(
          (mEvent) => !isThreadOnlyRoomActivity(room, mEvent)
        )
      );
      saveRoomEventsToCache(sessionId, room.roomId, rawEvents, beforeTokenForEarliest).catch(
        () => undefined
      );
    },
    [room, sessionId]
  );

  const hydrateThreadFromCache = useCallback(
    async (expectedThreadId: string) => {
      const cachedPage = await loadLatestCachedThreadEvents(
        sessionId,
        room.roomId,
        expectedThreadId,
        safePaginationLimitRef.current
      );
      if (!alive() || threadIdRef.current !== expectedThreadId) return undefined;

      const mapper = mx.getEventMapper();
      const cachedEvents = normalizeCachedThreadEvents(cachedPage.events, cachedPage.rootEvent).map(
        (rawEvent) => mapper(rawEvent)
      );
      setThreadHasMoreCachedBack(
        cachedPage.hasMoreBefore || typeof cachedPage.beforeToken === 'string'
      );
      if (cachedEvents.length === 0) return cachedPage;

      setSupplementalThreadEvents(expectedThreadId, cachedEvents);
      setTimeline((ct) => ({ ...ct }));
      setThreadTimelineTick((val) => val + 1);
      return cachedPage;
    },
    [alive, mx, room.roomId, sessionId, setSupplementalThreadEvents]
  );

  const refreshLatestThreadSlice = useCallback(
    async (expectedThreadId: string): Promise<boolean> => {
      const [err, relData] = await to(
        mx.fetchRelations(room.roomId, expectedThreadId, 'm.thread' as any, null, {
          dir: Direction.Backward,
          limit: safePaginationLimitRef.current,
        })
      );
      if (err || !relData) return false;
      if (threadIdRef.current !== expectedThreadId) return false;

      const mapper = mx.getEventMapper();
      const latestEvents = relData.chunk
        .slice()
        .reverse()
        .map((rawEvent) => mapper(rawEvent));
      const currentThread = room.getThread(expectedThreadId);
      const rootEvent = currentThread?.rootEvent ?? room.findEventById(expectedThreadId);
      const firstThreadTimeline = currentThread
        ? getLinkedTimelines(currentThread.getUnfilteredTimelineSet().getLiveTimeline())[0]
        : undefined;
      setThreadHasMoreCachedBack(
        (currentHasMoreCachedBack) =>
          currentHasMoreCachedBack || typeof relData.next_batch === 'string'
      );

      if (latestEvents.length > 0) {
        currentThread?.addEvents(latestEvents, false);
        setSupplementalThreadEvents(expectedThreadId, latestEvents);
        if (firstThreadTimeline) {
          firstThreadTimeline.setPaginationToken(relData.next_batch ?? null, Direction.Backward);
        }
        persistThreadEventCache(
          expectedThreadId,
          latestEvents,
          rootEvent,
          firstThreadTimeline?.getPaginationToken(Direction.Backward) ?? relData.next_batch
        );
        setTimeline((ct) => ({ ...ct }));
        setThreadTimelineTick((val) => val + 1);
      }

      setThreadTailLoaded(true);
      return true;
    },
    [mx, persistThreadEventCache, room, setSupplementalThreadEvents]
  );

  const getScrollElement = useCallback(() => scrollRef.current, []);

  const { getItems, scrollToItem, scrollToElement, observeBackAnchor, observeFrontAnchor } =
    useVirtualPaginator({
      count: threadId ? 0 : filteredLength,
      limit: safePaginationLimit,
      range: activeTimelineRange,
      onRangeChange: useCallback(
        (r) => {
          if (threadId || roomThreadFilterActive) return;
          setTimeline((cs) => ({ ...cs, range: r }));
        },
        [threadId, roomThreadFilterActive]
      ),
      getScrollElement,
      getItemElement: useCallback(
        (index: number) =>
          (scrollRef.current?.querySelector(`[data-message-item="${index}"]`) as HTMLElement) ??
          undefined,
        []
      ),
      onEnd: handleRoomTimelinePagination,
      shouldSuppressPagination: useCallback(() => suppressFocusPaginationRef.current, []),
    });

  const loadEventTimeline = useEventTimelineLoader(
    mx,
    room,
    useCallback(
      (evtId, lTimelines, evtAbsIndex) => {
        if (!alive()) return;
        const renderableEntries = getRenderableEventEntries(
          lTimelines,
          room,
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents
        );
        const loadedRenderableEvents = renderableEntries.map(({ event }) => event);
        const loadedThreadReplyCountMap = buildThreadReplyCountMap(
          lTimelines.flatMap((timeline) => timeline.getEvents())
        );
        const anchor =
          evtId === readUptoEventIdRef.current
            ? getUnreadTargetAnchor({
                renderableEntries,
                eventId: evtId,
                absoluteIndex: evtAbsIndex,
              })
            : getTimelineTargetAnchor({
                linkedTimelines: lTimelines,
                renderableEntries,
                eventId: evtId,
                absoluteIndex: evtAbsIndex,
              });
        const {
          index: idx,
          count,
          resetThreadFilter,
        } = anchor
          ? getRoomEventFocusTarget({
              eventId: anchor.eventId,
              renderableEvents: loadedRenderableEvents,
              room,
              threadResolutionMap,
              threadId,
              threadFilter,
              threadReplyCountMap: loadedThreadReplyCountMap,
            })
          : {
              index: 0,
              count: loadedRenderableEvents.length,
              resetThreadFilter: false,
            };

        if (resetThreadFilter) {
          onThreadFilterChange('all');
        }

        setFocusItem(
          anchor
            ? {
                eventId: anchor.eventId,
                index: idx,
                scrollTo: !threadId,
                highlight: evtId !== readUptoEventIdRef.current,
              }
            : undefined
        );
        setTimeline({
          linkedTimelines: lTimelines,
          range: {
            start: Math.max(idx - safePaginationLimitRef.current, 0),
            end: Math.min(idx + safePaginationLimitRef.current, count),
          },
        });
      },
      [
        alive,
        onThreadFilterChange,
        threadId,
        threadFilter,
        threadResolutionMap,
        room,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
      ]
    ),
    useCallback(() => {
      if (!alive()) return;
      setTimeline(
        getInitialTimeline(room, safePaginationLimit, {
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
        })
      );
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
    }, [
      alive,
      room,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      safePaginationLimit,
    ])
  );

  useLiveEventArrive(
    room,
    useCallback(
      (mEvt: MatrixEvent) => {
        const mEventId = mEvt.getId();
        const relation = mEvt.getRelation();
        const relationTargetId = relation?.event_id;
        const liveExpandOnceId = getLiveCollapsibleMessageExpandId({
          mEvent: mEvt,
          room,
          threadId,
          threadFilter,
          threadResolutionMap,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
        });
        const isThreadOnlyActivity = isThreadOnlyRoomActivity(room, mEvt);
        const isVisibleThreadActivity =
          mEventId === threadId ||
          eventBelongsToThread(mEvt, threadId ?? '') ||
          !!(relationTargetId && threadEventIndexMapRef.current.has(relationTargetId));
        if (liveExpandOnceId) {
          liveExpandOnceIds.current.add(liveExpandOnceId);
        }

        if (threadId) {
          if (isVisibleThreadActivity) {
            setSupplementalThreadEvents(threadId, [mEvt]);
            persistThreadEventCache(
              threadId,
              [mEvt],
              room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId)
            );
            if (
              (mEventId === threadId || eventBelongsToThread(mEvt, threadId)) &&
              atLiveEndRef.current
            ) {
              setThreadTailLoaded(true);
            }

            setThreadTimelineTick((val) => val + 1);

            const scrollElement = scrollRef.current;
            if (scrollElement) {
              const isNearBottom = isScrollNearBottom({
                scrollHeight: scrollElement.scrollHeight,
                scrollTop: scrollElement.scrollTop,
                clientHeight: scrollElement.clientHeight,
              });
              if (
                shouldAutoScrollThreadOnLiveEvent({
                  relationType: relation?.rel_type,
                  isNearBottom,
                  isTimelineAtLiveEnd: timelineAtLiveEnd,
                })
              ) {
                scrollToBottomRef.current.count += 1;
                scrollToBottomRef.current.smooth = true;
              } else if (atLiveEndRef.current && (atBottomRef.current || isNearBottom)) {
                // Relation updates can change message height above the viewport.
                // Keep the thread pinned when the user was already reading the latest reply.
                scrollToBottomRef.current.count += 1;
                scrollToBottomRef.current.smooth = false;
              }
            }
          }
          return;
        }

        // Ignore thread-only live activity in the main room timeline for auto-scroll.
        // These events are hidden there, so forcing bottom jumps is disruptive.
        // Only re-render when at bottom so thread previews update without causing
        // scroll jumps for users reading history.
        if (isThreadOnlyActivity) {
          // Cache summary events arriving via sync for persistence across sessions
          if (isMindroomThreadSummaryEvent(mEvt)) {
            const rootId = mEvt.threadRootId;
            if (rootId) {
              const info = getThreadSummaryEventInfo(mEvt);
              if (info?.summaryText) {
                setCachedSummaryMap((prev) => {
                  const next = new Map(prev);
                  next.set(rootId, info);
                  return next;
                });
                saveCachedThreadSummary(sessionId, room.roomId, rootId, info).catch(() => {});
              }
            }
          }
          if (atBottomRef.current) {
            setTimeline((ct) => ({ ...ct }));
          }
          if (!unreadInfo) {
            setUnreadInfo(getRoomUnreadInfo(room));
          }
          return;
        }

        persistRoomEventCache([mEvt]);

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

          const renderableLiveEvent = isRenderableEvent(
            mEvt,
            room,
            threadId,
            ignoredUsersSet,
            showHiddenEvents,
            hideMembershipEvents,
            hideNickAvatarEvents
          );

          if (renderableLiveEvent) {
            if (roomThreadFilterActive) {
              setTimeline((ct) => ({ ...ct }));
            } else {
              setTimeline((ct) => ({
                ...ct,
                range: {
                  start: ct.range.start + 1,
                  end: ct.range.end + 1,
                },
              }));
            }
          } else {
            setTimeline((ct) => ({ ...ct }));
          }
          return;
        }
        setTimeline((ct) => ({ ...ct }));
        if (!unreadInfo) {
          setUnreadInfo(getRoomUnreadInfo(room));
        }
      },
      [
        mx,
        persistRoomEventCache,
        persistThreadEventCache,
        room,
        setSupplementalThreadEvents,
        unreadInfo,
        hideActivity,
        threadId,
        timelineAtLiveEnd,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
        roomThreadFilterActive,
        threadFilter,
        threadResolutionMap,
        sessionId,
      ]
    )
  );

  useEffect(() => {
    if (threadId) return;
    let cancelled = false;

    const persistCurrentRoomCache = async () => {
      const currentLinkedTimelines = timeline.linkedTimelines;
      const cacheEvents = getMainTimelineCacheEvents(room, currentLinkedTimelines);
      const earliestLoadedEvent = findEarliestLoadedRoomEventByCacheOrder(cacheEvents);
      const firstTimeline = currentLinkedTimelines[0];
      const cachedBeforeToken = await loadCachedRoomPaginationToken(
        sessionId,
        room.roomId,
        earliestLoadedEvent?.getId()
      );

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      if (firstTimeline && cachedBeforeToken === null) {
        const currentBeforeToken = firstTimeline.getPaginationToken(Direction.Backward);
        if (currentBeforeToken !== null) {
          firstTimeline.setPaginationToken(null, Direction.Backward);
          setTimeline((currentTimeline) =>
            currentTimeline.linkedTimelines === currentLinkedTimelines
              ? { ...currentTimeline }
              : currentTimeline
          );
        }
      }

      persistRoomEventCache(
        cacheEvents,
        resolvePersistedRoomBeforeToken(
          firstTimeline?.getPaginationToken(Direction.Backward),
          cachedBeforeToken
        )
      );
    };

    persistCurrentRoomCache();

    return () => {
      cancelled = true;
    };
  }, [alive, eventsLength, persistRoomEventCache, room, sessionId, threadId, timeline.linkedTimelines]);

  useEffect(() => {
    if (threadId) {
      setRoomHasMoreCachedBack(false);
      return undefined;
    }

    let cancelled = false;
    const refreshRoomCachedBackState = async () => {
      const currentLinkedTimelines = timeline.linkedTimelines;
      const earliestLoadedEvent = getEarliestLoadedRoomEvent(room, currentLinkedTimelines);
      const [cachedPage, cachedBeforeToken] = await Promise.all([
        loadCachedRoomEventsBefore(
          sessionId,
          room.roomId,
          getRoomCursorAnchor(earliestLoadedEvent?.event as Partial<IEvent> | undefined),
          1
        ),
        loadCachedRoomPaginationToken(sessionId, room.roomId, earliestLoadedEvent?.getId()),
      ]);
      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      const firstTimeline = currentLinkedTimelines[0];
      if (firstTimeline && cachedBeforeToken === null) {
        const currentBeforeToken = firstTimeline.getPaginationToken(Direction.Backward);
        if (currentBeforeToken !== null) {
          firstTimeline.setPaginationToken(null, Direction.Backward);
          setTimeline((currentTimeline) =>
            currentTimeline.linkedTimelines === currentLinkedTimelines
              ? { ...currentTimeline }
              : currentTimeline
          );
        }
      }

      setRoomHasMoreCachedBack(cachedPage.events.length > 0);
    };

    refreshRoomCachedBackState();
    return () => {
      cancelled = true;
    };
  }, [alive, eventId, eventsLength, room, sessionId, threadId, timeline.linkedTimelines]);

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
            eventId: evtId,
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

      const filteredIndex = threadFilteredEvents.findIndex((e) => e.getId() === evtId);

      if (filteredIndex !== -1) {
        const scrolled = scrollToItem(filteredIndex, {
          behavior: 'smooth',
          align: 'center',
          stopInView: true,
        });
        if (onScroll) onScroll(scrolled);
        setFocusItem({
          eventId: evtId,
          index: filteredIndex,
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
        const shouldResetRoomThreadFilter = shouldResetRoomThreadFilterForEvent(
          threadId,
          threadFilter,
          threadFilteredEvents,
          room,
          threadResolutionMap,
          evtId,
          threadReplyCountMap
        );

        if (shouldResetRoomThreadFilter === true) {
          onThreadFilterChange('all');
        }
        setTimeline(getEmptyTimeline());
        const loadedEventTimelines = await loadEventTimeline(evtId);

        if (
          shouldResetRoomThreadFilter === undefined &&
          alive() &&
          roomIdRef.current === room.roomId &&
          !threadIdRef.current &&
          shouldResetRoomThreadFilterForLoadedEvent(
            threadIdRef.current,
            threadFilterRef.current,
            room,
            threadResolutionMap,
            evtId,
            loadedEventTimelines
          ) === true
        ) {
          skipNextRoomTimelineResetRef.current = true;
          onThreadFilterChange('all');
        }
      }
    },
    [
      alive,
      mx,
      room,
      threadFilteredEvents,
      threadResolutionMap,
      threadReplyCountMap,
      scrollToItem,
      scrollToElement,
      loadEventTimeline,
      onThreadFilterChange,
      threadId,
      threadFilter,
    ]
  );
  const handleOpenEventRef = useRef(handleOpenEvent);

  useEffect(() => {
    handleOpenEventRef.current = handleOpenEvent;
  }, [handleOpenEvent]);

  useThreadAwareTimelineRefresh({
    room,
    threadId,
    liveTimelineLinked,
    refreshLatestThreadSlice,
    onRoomRefresh: useCallback(() => {
      setTimeline(
        getInitialTimeline(room, safePaginationLimit, {
          threadId,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
        })
      );
    }, [
      room,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      safePaginationLimit,
    ]),
  });

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
      handleOpenEventRef.current(eventId);
    }
  }, [eventId]);

  useEffect(() => {
    if (!threadId) return;
    setFocusItem(undefined);
    setThreadLoadError(false);
    setThreadHasMoreCachedBack(false);
    setThreadInitialCacheHydrated(false);
    setThreadTailLoaded(false);
    setThreadTimelineTick(0);
    setPendingThreadOpenTick(0);
    threadEditFetchAttemptedRef.current = new WeakMap<MatrixEvent, number>();
    pendingThreadOpenRef.current = undefined;
    resetThreadRenderState(threadId);
    let mounted = true;
    const shouldScrollToLatestOnOpen = !eventId;
    setThreadLatestOpenPending(shouldScrollToLatestOnOpen);
    const loadThreadTimeline = async () => {
      try {
        let hydratedCachedPage;
        try {
          hydratedCachedPage = await hydrateThreadFromCache(threadId);
        } catch {
          if (!mounted || threadIdRef.current !== threadId) return;
          hydratedCachedPage = undefined;
        }
        if (!mounted || threadIdRef.current !== threadId) return;
        setThreadInitialCacheHydrated(true);

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
            const mappedEvents = relData.chunk
              .slice()
              .reverse()
              .map((evt) => mapper(evt));
            setSupplementalThreadEvents(threadId, mappedEvents);
            persistThreadEventCache(
              threadId,
              mappedEvents,
              room.findEventById(threadId),
              relData.next_batch
            );
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
          const firstThreadTimeline = getLinkedTimelines(
            loadedThreadTimelineSet.getLiveTimeline()
          )[0];
          const cachedEarliestAnchor = getThreadCursorAnchor(hydratedCachedPage?.events[0]);
          const earliestThreadReply = getEarliestLoadedThreadReply(threadModel.events, threadId);
          const threadTimelineAnchor = getThreadCursorAnchor(
            earliestThreadReply?.event as Partial<IEvent> | undefined
          );
          if (
            firstThreadTimeline &&
            hydratedCachedPage?.beforeToken !== undefined &&
            cachedEarliestAnchor &&
            (!threadTimelineAnchor ||
              compareCachedPaginationAnchors(threadTimelineAnchor, cachedEarliestAnchor) >= 0)
          ) {
            firstThreadTimeline.setPaginationToken(
              hydratedCachedPage.beforeToken ?? null,
              Direction.Backward
            );
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
              const mappedEvents = relData.chunk
                .slice()
                .reverse()
                .map((evt) => mapper(evt));
              threadModel.addEvents(mappedEvents, true);
              firstThreadTimeline?.setPaginationToken(
                relData.next_batch ?? null,
                Direction.Backward
              );
            }
          }
          persistThreadEventCache(
            threadId,
            threadModel.events,
            threadModel.rootEvent,
            firstThreadTimeline?.getPaginationToken(Direction.Backward)
          );
        } else {
          console.warn('Could not create thread object for', threadId);
        }

        if (shouldScrollToLatestOnOpen) {
          await refreshLatestThreadSlice(threadId);
          if (!mounted || threadIdRef.current !== threadId) return;
        } else {
          const hasForwardGap = !!room
            .getThread(threadId)
            ?.getUnfilteredTimelineSet()
            .getLiveTimeline()
            .getPaginationToken(Direction.Forward);
          if (!hasForwardGap) {
            setThreadTailLoaded(true);
          }
        }

        setTimeline((ct) => ({ ...ct }));
        setThreadTimelineTick((val) => val + 1);
        if (shouldScrollToLatestOnOpen) {
          scrollToBottomRef.current.count += 1;
          scrollToBottomRef.current.smooth = false;
          setAtBottom(true);
        }
      } finally {
        if (mounted && threadIdRef.current === threadId) {
          setThreadLatestOpenPending(false);
        }
      }
    };

    loadThreadTimeline();

    return () => {
      mounted = false;
    };
  }, [
    eventId,
    hydrateThreadFromCache,
    mx,
    persistThreadEventCache,
    resetThreadRenderState,
    refreshLatestThreadSlice,
    room,
    setSupplementalThreadEvents,
    threadId,
  ]);

  useEffect(() => {
    if (threadId) return;
    setThreadLoadError(false);
    setThreadHasMoreCachedBack(false);
    setThreadInitialCacheHydrated(false);
    setThreadTailLoaded(false);
    setThreadLatestOpenPending(false);
    setThreadTimelineTick(0);
    setThreadPaginatingBack(false);
    setThreadPaginatingFront(false);
    setPendingThreadOpenTick(0);
    threadEditFetchAttemptedRef.current = new WeakMap<MatrixEvent, number>();
    pendingThreadOpenRef.current = undefined;
    resetThreadRenderState(undefined);
  }, [resetThreadRenderState, threadId]);

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
    if (readUptoEventId && inLiveTimeline && scrollTo && unreadScrollAnchorIndex !== undefined) {
      scrollToItem(unreadScrollAnchorIndex, {
        behavior: 'instant',
        align: 'start',
        stopInView: true,
      });
    }
  }, [room, unreadInfo, unreadScrollAnchorIndex, scrollToItem, threadId]);

  useEffect(() => {
    if (threadId || !focusItem?.eventId) return;

    const nextIndex = threadFilteredEventsRef.current.findIndex(
      (event) => event.getId() === focusItem.eventId
    );
    if (nextIndex === -1 || nextIndex === focusItem.index) return;

    setFocusItem((currentItem) => {
      if (
        !currentItem ||
        currentItem.eventId !== focusItem.eventId ||
        currentItem.index === nextIndex
      ) {
        return currentItem;
      }

      return {
        ...currentItem,
        index: nextIndex,
      };
    });
  }, [focusItem, threadFilter, threadId]);

  // scroll to focused message
  useLayoutEffect(() => {
    let clearFocusTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let roomFocusObserver: MutationObserver | undefined;
    let roomFocusObserverTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const focusEventId = focusItem?.eventId;

    const clearPendingRoomFocus = () => {
      roomFocusObserver?.disconnect();
      roomFocusObserver = undefined;

      if (roomFocusObserverTimeoutId !== undefined) {
        clearTimeout(roomFocusObserverTimeoutId);
        roomFocusObserverTimeoutId = undefined;
      }

      if (pendingRoomFocusRef.current?.eventId === focusEventId) {
        pendingRoomFocusRef.current = undefined;
      }

      suppressFocusPaginationRef.current = false;
    };

    if (!threadId && focusItem && focusItem.scrollTo) {
      const focusIndex = getFocusedRoomEventIndex(
        threadFilteredEventsRef.current,
        focusEventId,
        focusItem.index
      );
      suppressFocusPaginationRef.current = true;

      scrollToItem(focusIndex, getRoomFocusScrollToItemOptions());
      const target = focusEventId ? getEventElementById(scrollRef.current, focusEventId) : null;

      if (target) {
        scrollToElement(target, {
          behavior: 'instant',
          align: 'center',
        });
        clearPendingRoomFocus();
      } else if (focusEventId && scrollRef.current && typeof MutationObserver !== 'undefined') {
        pendingRoomFocusRef.current = {
          eventId: focusEventId,
        };
        roomFocusObserver = new MutationObserver(() => {
          if (!alive()) {
            clearPendingRoomFocus();
            return;
          }

          if (pendingRoomFocusRef.current?.eventId !== focusEventId) return;

          const observedTarget = getEventElementById(scrollRef.current, focusEventId);
          if (!observedTarget) return;

          scrollToElement(observedTarget, {
            behavior: 'instant',
            align: 'center',
          });
          clearPendingRoomFocus();
        });
        roomFocusObserver.observe(scrollRef.current, {
          childList: true,
          subtree: true,
        });
        roomFocusObserverTimeoutId = setTimeout(() => {
          if (pendingRoomFocusRef.current?.eventId !== focusEventId) return;
          clearPendingRoomFocus();
        }, ROOM_FOCUS_SCROLL_OBSERVER_TIMEOUT_MS);
      } else {
        pendingRoomFocusRef.current = undefined;
        suppressFocusPaginationRef.current = false;
      }
    } else {
      pendingRoomFocusRef.current = undefined;
      suppressFocusPaginationRef.current = false;
    }

    if (focusItem) {
      clearFocusTimeoutId = setTimeout(() => {
        if (!alive()) return;
        setFocusItem((currentItem) => {
          if (currentItem === focusItem) return undefined;
          return currentItem;
        });
      }, 2000);
    }

    return () => {
      clearPendingRoomFocus();
      if (clearFocusTimeoutId !== undefined) {
        clearTimeout(clearFocusTimeoutId);
      }
    };
  }, [alive, focusItem, scrollToElement, scrollToItem, threadFilter, threadId]);

  useLayoutEffect(() => {
    if (!threadId) return;
    if (
      !shouldPinThreadToBottomOnOpen({
        threadId,
        threadLatestOpenPending,
        threadInitialRenderMode,
        threadEventCount: threadEvents.length,
      })
    ) {
      return;
    }
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    scrollToBottom(scrollEl, 'instant');
    setAtBottom(true);
  }, [threadEvents.length, threadId, threadInitialRenderMode, threadLatestOpenPending]);

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
        eventId: pendingOpen.eventId,
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

      const didPaginateToLatest = await refreshLatestThreadSlice(threadId);
      if (threadIdRef.current !== threadId) return;
      if (didPaginateToLatest) {
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
    setTimeline(
      getInitialTimeline(room, safePaginationLimit, {
        threadId,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
      })
    );
    scrollToBottomRef.current.count += 1;
    scrollToBottomRef.current.smooth = false;
  }, [
    eventId,
    navigateRoom,
    navigateRoomThread,
    refreshLatestThreadSlice,
    room,
    threadId,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    safePaginationLimit,
  ]);

  const handleJumpToUnread = () => {
    if (unreadInfo?.readUptoEventId) {
      void handleOpenEvent(unreadInfo.readUptoEventId, false);
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

  // Persistent cache for thread summaries (survives page reloads / room re-entry)
  const [cachedSummaryMap, setCachedSummaryMap] = useState<Map<string, MindroomThreadSummaryInfo>>(
    () => new Map()
  );

  // Load cached summaries from IndexedDB on room entry
  useEffect(() => {
    if (threadId) return;
    let cancelled = false;
    loadCachedThreadSummaries(sessionId, room.roomId).then((cached) => {
      if (!cancelled && cached.size > 0) setCachedSummaryMap(cached);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId, room.roomId, threadId]);

  // Write-through: persist newly discovered summaries to IndexedDB
  useEffect(() => {
    if (threadId) return;
    threadSummaryInfoMap.forEach((info, threadRootId) => {
      if (!info.summaryText) return;
      const cached = cachedSummaryMap.get(threadRootId);
      if (cached?.summaryText === info.summaryText) return;
      setCachedSummaryMap((prev) => {
        const next = new Map(prev);
        next.set(threadRootId, info);
        return next;
      });
      saveCachedThreadSummary(sessionId, room.roomId, threadRootId, info).catch(() => {});
    });
  }, [threadId, threadSummaryInfoMap, cachedSummaryMap, sessionId, room.roomId]);

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
        const resolvedContent = getLatestMessageContent(mEvent, editedEvent);
        const getContent = (() => resolvedContent) as GetContentCallback;
        const collapseMode = getCollapsibleMessageMode(
          mEventId,
          resolvedContent,
          liveExpandOnceIds.current
        );
        const onInitialExpandConsumed =
          collapseMode === 'initially-expanded'
            ? () => {
                consumeLiveExpandOnceId(liveExpandOnceIds.current, mEventId);
              }
            : undefined;

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
        const threadResolved = mEventId
          ? threadResolutionMap.get(mEventId)?.isResolved ?? false
          : false;
        const isThreadReply = isThreadReplyEvent(mEventId, threadRootId);
        const summaryInfo =
          !threadId && !isThreadReply && mEventId
            ? getThreadSummaryInfo(room, mEvent, threadSummaryInfoMap.get(mEventId), cachedSummaryMap.get(mEventId))
            : undefined;
        const threadSummary =
          !threadId &&
          !isThreadReply &&
          mEventId &&
          typeof threadReplyCount === 'number' &&
          threadReplyCount > 0 ? (
            <>
              {summaryInfo && (
                <Box style={{ marginTop: config.space.S200 }}>
                  <MindroomThreadSummaryCard
                    compact
                    summaryInfo={summaryInfo}
                    renderBody={({ body }) => <>{body}</>}
                  />
                </Box>
              )}
              <ThreadIndicator
                as="button"
                style={{ marginTop: summaryInfo ? config.space.S100 : config.space.S200 }}
                data-thread-root-id={mEventId}
                data-event-id={mEventId}
                threadReplyCount={threadReplyCount}
                threadParticipantIds={threadParticipantIds}
                isResolved={threadResolved}
                room={room}
                onClick={handleOpenReply}
              />
            </>
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
            {(() => {
              if (mEvent.isRedacted()) {
                return (
                  <RedactedContent reason={mEvent.getUnsigned().redacted_because?.content.reason} />
                );
              }
              const msgType = mEvent.getContent().msgtype;
              const isVisualMedia = msgType === MsgType.Image || msgType === MsgType.Video;
              const content = (
                <RenderMessageContent
                  displayName={senderDisplayName}
                  msgType={msgType ?? ''}
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
              if (isVisualMedia) return content;
              return (
                <CollapsibleMessage
                  collapseMode={collapseMode}
                  onInitialExpandConsumed={onInitialExpandConsumed}
                >
                  {content}
                </CollapsibleMessage>
              );
            })()}
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
        const threadResolved = mEventId
          ? threadResolutionMap.get(mEventId)?.isResolved ?? false
          : false;
        const isThreadReply = isThreadReplyEvent(mEventId, threadRootId);
        const encSummaryInfo =
          !threadId && !isThreadReply && mEventId
            ? getThreadSummaryInfo(room, mEvent, threadSummaryInfoMap.get(mEventId), cachedSummaryMap.get(mEventId))
            : undefined;
        const threadSummary =
          !threadId &&
          !isThreadReply &&
          mEventId &&
          typeof threadReplyCount === 'number' &&
          threadReplyCount > 0 ? (
            <>
              {encSummaryInfo && (
                <Box style={{ marginTop: config.space.S200 }}>
                  <MindroomThreadSummaryCard
                    compact
                    summaryInfo={encSummaryInfo}
                    renderBody={({ body }) => <>{body}</>}
                  />
                </Box>
              )}
              <ThreadIndicator
                as="button"
                style={{ marginTop: encSummaryInfo ? config.space.S100 : config.space.S200 }}
                data-thread-root-id={mEventId}
                data-event-id={mEventId}
                threadReplyCount={threadReplyCount}
                threadParticipantIds={threadParticipantIds}
                isResolved={threadResolved}
                room={room}
                onClick={handleOpenReply}
              />
            </>
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
                  const resolvedContent = getLatestMessageContent(mEvent, editedEvent);
                  const getContent = (() => resolvedContent) as GetContentCallback;
                  const collapseMode = getCollapsibleMessageMode(
                    mEventId,
                    resolvedContent,
                    liveExpandOnceIds.current
                  );
                  const onInitialExpandConsumed =
                    collapseMode === 'initially-expanded'
                      ? () => {
                          consumeLiveExpandOnceId(liveExpandOnceIds.current, mEventId);
                        }
                      : undefined;

                  const senderId = mEvent.getSender() ?? '';
                  const senderDisplayName =
                    getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
                  const messageContent = (
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

                  const encMsgType = mEvent.getContent().msgtype;
                  const isEncVisualMedia =
                    encMsgType === MsgType.Image || encMsgType === MsgType.Video;
                  if (isEncVisualMedia) return messageContent;
                  return (
                    <CollapsibleMessage
                      collapseMode={collapseMode}
                      onInitialExpandConsumed={onInitialExpandConsumed}
                    >
                      {messageContent}
                    </CollapsibleMessage>
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
      [StateEvent.GroupCallMemberPrefix]: (mEventId, mEvent, item) => {
        const highlighted = focusItem?.index === item && focusItem.highlight;
        const senderId = mEvent.getSender() ?? '';
        const senderName = getMemberDisplayName(room, senderId) || getMxIdLocalPart(senderId);

        const content = mEvent.getContent<SessionMembershipData>();
        const prevContent = mEvent.getPrevContent();

        const callJoined = content.application;
        if (callJoined && 'application' in prevContent) {
          return null;
        }

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
              iconSrc={callJoined ? Icons.Phone : Icons.PhoneDown}
              content={
                <Box grow="Yes" direction="Column">
                  <Text size="T300" priority="300">
                    <b>{senderName}</b>
                    {callJoined ? ' joined the call' : ' ended the call'}
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

  useEffect(() => {
    if (!threadId || threadEvents.length === 0) return;

    const missingEditEvents = threadEvents.filter((mEvent) =>
      shouldFetchThreadEditBackfill(mEvent, threadEditFetchAttemptedRef.current, threadTailLoaded)
    );
    if (missingEditEvents.length === 0) {
      logEditDebug('threadBackfill:noneMissing', {
        threadId,
        threadEventCount: threadEvents.length,
        threadTailLoaded,
      });
      return;
    }

    logEditDebug('threadBackfill:start', {
      threadId,
      threadEventCount: threadEvents.length,
      missingEditCount: missingEditEvents.length,
      threadTailLoaded,
    });

    missingEditEvents.forEach((mEvent) => {
      markThreadEditBackfillAttempted(
        mEvent,
        threadEditFetchAttemptedRef.current,
        threadTailLoaded
      );
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
          const currentReplacement = mEvent.replacingEvent() ?? undefined;
          const relationEvents = relData?.events ?? [];
          if (relationEvents.length === 0 && !currentReplacement) {
            logEditDebug('threadBackfill:noRelations', {
              threadId,
              eventId,
            });
            continue;
          }

          const latestEdit = getLatestEdit(
            mEvent,
            currentReplacement ? [currentReplacement, ...relationEvents] : relationEvents
          );
          if (!latestEdit) continue;
          if (latestEdit === currentReplacement) {
            logEditDebug('threadBackfill:alreadyLatest', {
              threadId,
              eventId,
              editEventId: currentReplacement?.getId(),
              relationCount: relationEvents.length,
            });
            continue;
          }

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
            previousEditEventId: currentReplacement?.getId(),
            relationCount: relationEvents.length,
          });
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      if (didUpdate && !cancelled && threadIdRef.current === threadId) {
        const currentThread = room.getThread(threadId);
        const currentThreadTimelineSet = currentThread?.getUnfilteredTimelineSet();
        const firstThreadTimeline = currentThreadTimelineSet
          ? getLinkedTimelines(currentThreadTimelineSet.getLiveTimeline())[0]
          : undefined;

        logEditDebug('threadBackfill:updated', {
          threadId,
          updatedCount,
        });
        const scrollElement = scrollRef.current;
        if (
          atLiveEndRef.current &&
          ((scrollElement &&
            isScrollNearBottom({
              scrollHeight: scrollElement.scrollHeight,
              scrollTop: scrollElement.scrollTop,
              clientHeight: scrollElement.clientHeight,
            })) ||
            atBottomRef.current)
        ) {
          scrollToBottomRef.current.count += 1;
          scrollToBottomRef.current.smooth = false;
        }
        persistThreadEventCache(
          threadId,
          threadEvents,
          currentThread?.rootEvent ?? room.findEventById(threadId),
          firstThreadTimeline?.getPaginationToken(Direction.Backward)
        );
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
  }, [mx, persistThreadEventCache, room, room.roomId, threadId, threadEvents, threadTailLoaded]);

  const handleThreadPaginateBack = useCallback(async () => {
    if (!threadId || threadPaginatingBackRef.current) return;
    const expectedThreadId = threadId;
    setThreadPaginatingBack(true);
    threadPaginatingBackRef.current = true;
    try {
      const earliestThreadReply = getEarliestLoadedThreadReply(threadEvents, expectedThreadId);
      const cachedPage = await loadCachedThreadEventsBefore(
        sessionId,
        room.roomId,
        expectedThreadId,
        getThreadCursorAnchor(earliestThreadReply?.event as Partial<IEvent> | undefined),
        safePaginationLimitRef.current
      );
      if (threadIdRef.current !== expectedThreadId) return;

      const mapper = mx.getEventMapper();
      const cachedEvents = normalizeCachedThreadEvents(cachedPage.events, cachedPage.rootEvent).map(
        (rawEvent) => mapper(rawEvent)
      );
      if (cachedEvents.length > 0) {
        const currentThreadTimelineSet = thread?.getUnfilteredTimelineSet();
        const currentFirstThreadTimeline = currentThreadTimelineSet
          ? getLinkedTimelines(currentThreadTimelineSet.getLiveTimeline())[0]
          : undefined;
        if (currentFirstThreadTimeline && cachedPage.beforeToken !== undefined) {
          currentFirstThreadTimeline.setPaginationToken(
            cachedPage.beforeToken ?? null,
            Direction.Backward
          );
        }
        setSupplementalThreadEvents(expectedThreadId, cachedEvents);
        setThreadHasMoreCachedBack(
          cachedPage.hasMoreBefore || typeof cachedPage.beforeToken === 'string'
        );
        setTimeline((ct) => ({ ...ct }));
        setThreadTimelineTick((val) => val + 1);
        return;
      }

      setThreadHasMoreCachedBack(false);
      if (!thread) return;

      const currentThreadTimelineSet = thread.getUnfilteredTimelineSet();
      const firstThreadTimeline = getLinkedTimelines(currentThreadTimelineSet.getLiveTimeline())[0];
      if (!firstThreadTimeline?.getPaginationToken(Direction.Backward)) return;

      const [err] = await to(
        mx.paginateEventTimeline(firstThreadTimeline, {
          backwards: true,
          limit: safePaginationLimitRef.current,
        })
      );
      if (!err && threadIdRef.current === expectedThreadId) {
        persistThreadEventCache(
          expectedThreadId,
          thread.events,
          thread.rootEvent,
          firstThreadTimeline.getPaginationToken(Direction.Backward)
        );
        setTimeline((ct) => ({ ...ct }));
        setThreadTimelineTick((val) => val + 1);
      }
    } finally {
      setThreadPaginatingBack(false);
      threadPaginatingBackRef.current = false;
    }
  }, [
    mx,
    persistThreadEventCache,
    room.roomId,
    sessionId,
    setSupplementalThreadEvents,
    thread,
    threadEvents,
    threadId,
  ]);
  const handleThreadPaginateFront = useCallback(async () => {
    if (!threadId || !thread || threadPaginatingFrontRef.current) return;
    const currentThreadTimelineSet = thread.getUnfilteredTimelineSet();
    const currentThreadLinkedTimelines = getLinkedTimelines(
      currentThreadTimelineSet.getLiveTimeline()
    );
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
        limit: safePaginationLimitRef.current,
      })
    );
    setThreadPaginatingFront(false);
    threadPaginatingFrontRef.current = false;
    if (!err && threadIdRef.current === expectedThreadId) {
      persistThreadEventCache(expectedThreadId, thread.events, thread.rootEvent);
      setThreadTailLoaded(!currentLastThreadTimeline.getPaginationToken(Direction.Forward));
      setTimeline((ct) => ({ ...ct }));
      setThreadTimelineTick((val) => val + 1);
    }
  }, [mx, persistThreadEventCache, thread, threadId]);

  let prevEvent: MatrixEvent | undefined;
  let prevRenderedEventAbsoluteIndex: number | undefined;
  let isPrevRendered = false;
  let newDivider = false;
  let dayDivider = false;
  const renderResolvedEvent = (
    mEvent: MatrixEvent,
    item: number,
    timelineSet: EventTimelineSet,
    eventAbsoluteIndex?: number
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

    if (!newDivider) {
      newDivider = shouldRenderUnreadDividerAt({
        readUptoAbsoluteIndex,
        eventAbsoluteIndex,
        prevRenderedEventAbsoluteIndex,
      });
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
    if (eventJSX) {
      prevRenderedEventAbsoluteIndex = eventAbsoluteIndex;
    }

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
    const eventEntry = threadFilteredEventEntries[item];
    const mEvent = eventEntry?.event;
    if (!mEvent) return null;
    const mEventId = mEvent.getId();
    if (!mEventId) return null;
    const evtTimeline = room.getUnfilteredTimelineSet().getTimelineForEvent(mEventId);
    const timelineSet = evtTimeline?.getTimelineSet() ?? room.getUnfilteredTimelineSet();

    return renderResolvedEvent(mEvent, item, timelineSet, eventEntry.absoluteIndex);
  };

  return (
    <Box grow="Yes" direction="Column">
      {!threadId && (
        <RoomThreadOverview
          counts={visibleThreadCounts}
          filter={threadFilter}
          onFilterChange={onThreadFilterChange}
        />
      )}
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
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (allExpanded) {
              collapseAllMessages();
              setAllExpanded(false);
            } else {
              expandAllMessages();
              setAllExpanded(true);
            }
          }}
          style={{
            position: 'absolute',
            top: config.space.S200,
            right: config.space.S400,
            zIndex: 2,
            color: color.Primary.Main,
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            opacity: 0.7,
          }}
        >
          {allExpanded ? '[-all]' : '[+all]'}
        </a>
        <Scroll ref={scrollRef} visibility="Hover" style={{ overflowAnchor: 'auto' }}>
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
            {!threadId &&
              !roomHasMoreCachedBack &&
              !canPaginateBack &&
              rangeAtStart &&
              timelineItems.length > 0 && (
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
            {threadId && (threadHasMoreCachedBack || canPaginateThreadBack) && (
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
            {threadId &&
              threadInitialRenderMode === 'loading' &&
              !threadLoadError &&
              (messageLayout === MessageLayout.Compact ? (
                <>
                  <MessageBase>
                    <CompactPlaceholder />
                  </MessageBase>
                  <MessageBase>
                    <CompactPlaceholder />
                  </MessageBase>
                  <MessageBase>
                    <CompactPlaceholder />
                  </MessageBase>
                </>
              ) : (
                <>
                  <MessageBase>
                    <DefaultPlaceholder />
                  </MessageBase>
                  <MessageBase>
                    <DefaultPlaceholder />
                  </MessageBase>
                </>
              ))}
            {!threadId &&
              (roomHasMoreCachedBack || canPaginateBack || !rangeAtStart) &&
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
    </Box>
  );
}
