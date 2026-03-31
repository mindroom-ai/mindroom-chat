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
  ThreadEvent,
  THREAD_RELATION_TYPE,
  MsgType,
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
import { MessageLayout, sanitizePaginationLimit, settingsAtom, THREAD_BATCH_SIZE } from '../../state/settings';
import { useMatrixEventRenderer } from '../../hooks/useMatrixEventRenderer';
import { Reactions, Message, Event, EncryptedContent } from './message';
import { useMemberEventParser } from '../../hooks/useMemberEventParser';
import * as customHtmlCss from '../../styles/CustomHtml.css';
import { RoomIntro } from '../../components/room-intro';
import {
  getIntersectionObserverEntry,
  useIntersectionObserver,
} from '../../hooks/useIntersectionObserver';
import {
  markMainTimelineAsRead,
  markRoomAndThreadsAsRead,
  markThreadAsRead,
} from '../../utils/notifications';
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
  isThreadOnlyRoomActivity,
  shouldPinThreadToBottomOnOpen,
} from './threadRenderUtils';
import { useThreadRenderState } from './useThreadRenderState';
import { createTimelineDebugTrace, logTimelineDebug } from './timelineDebug';
import { RoomThreadOverview } from './RoomThreadOverview';
import type { ThreadFilterKey } from './RoomThreadOverview';
import {
  type ThreadFilterState,
  type ThreadOverviewMetadata,
  type FilterPreset,
  buildThreadMetadataMap,
  filterThreadRootEvents,
  filterThreadsBySearch,
  sortThreadRootEvents,
  getRoomScheduledTaskCounts,
  isRoomThreadOverviewActive,
  matchesThreadFilterState,
  hasActiveThreadFilters,
  collectAvailableRoomTags,
  computeStatusCounts,
  computeTagCounts,
} from './roomThreadOverviewModel';
import type { RoomViewMode } from '../../state/room/roomViewMode';
import { useStateEvents } from '../../hooks/useStateEvents';
import {
  getThreadCursorAnchor,
  loadCachedThreadEventsBefore,
  loadLatestCachedThreadEvents,
  normalizeCachedThreadEvents,
  saveThreadEventsToCache,
} from './threadEventCache';
import { compareCachedPaginationAnchors } from './eventCacheTokenUtils';
import {
  computeReconciliationToken,
  findEarliestLoadedThreadReplyByCacheOrder,
  reconcileThreadBackwardPagination,
} from './threadPaginationUtils';
import {
  getRoomCursorAnchor,
  loadCachedRoomEventsBefore,
  loadCachedRoomPaginationToken,
  loadLatestCachedRoomEvents,
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
  shouldAutoScrollRoomOnLiveEvent,
  shouldAutoScrollThreadOnLiveEvent,
} from './timelineScrollUtils';
import {
  markThreadEditBackfillAttempted,
  shouldFetchThreadEditBackfill,
} from './threadEditBackfillUtils';
import { useRoomThreadResolutionMap } from './useRoomThreadTags';
import { getThreadOpenSeedSnapshot, saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';

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

type RoomPreloadCounts = {
  cacheCount: number;
  renderableCount: number;
  surfaceCount: number;
};

const getLinkedTimelineEvents = (linkedTimelines: EventTimeline[]): MatrixEvent[] =>
  linkedTimelines.flatMap((timeline) => timeline.getEvents());

export const getRoomPreloadCounts = (
  linkedTimelines: EventTimeline[],
  room: Room,
  filterOpts: {
    threadId: string | undefined;
    ignoredUsersSet: Set<string>;
    showHiddenEvents: boolean;
    hideMembershipEvents: boolean;
    hideNickAvatarEvents: boolean;
  }
): RoomPreloadCounts => {
  const loadedTimelineEvents = getLinkedTimelineEvents(linkedTimelines);
  const renderableEventEntries = getRenderableEventEntries(
    linkedTimelines,
    room,
    filterOpts.threadId,
    filterOpts.ignoredUsersSet,
    filterOpts.showHiddenEvents,
    filterOpts.hideMembershipEvents,
    filterOpts.hideNickAvatarEvents
  );
  const threadReplyCountMap = buildThreadReplyCountMap(loadedTimelineEvents);
  const surfaceEntries =
    filterOpts.threadId || threadReplyCountMap.size === 0
      ? renderableEventEntries
      : buildRoomSurfaceEventEntries({
          renderableEventEntries,
          linkedTimelines,
          room,
          ignoredUsersSet: filterOpts.ignoredUsersSet,
          showHiddenEvents: filterOpts.showHiddenEvents,
          hideMembershipEvents: filterOpts.hideMembershipEvents,
          hideNickAvatarEvents: filterOpts.hideNickAvatarEvents,
          threadReplyCountMap,
        });

  return {
    cacheCount: loadedTimelineEvents.filter((mEvent) => !isThreadOnlyRoomActivity(room, mEvent))
      .length,
    renderableCount: renderableEventEntries.length,
    surfaceCount: surfaceEntries.length,
  };
};

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

const buildRoomSurfaceEventEntries = ({
  renderableEventEntries,
  linkedTimelines,
  room,
  ignoredUsersSet,
  showHiddenEvents,
  hideMembershipEvents,
  hideNickAvatarEvents,
  threadReplyCountMap,
  threadResolutionMap,
}: {
  renderableEventEntries: TimelineEventEntry[];
  linkedTimelines: EventTimeline[];
  room: Room;
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  threadReplyCountMap: Map<string, number>;
  threadResolutionMap?: Map<string, { isResolved: boolean }>;
}): TimelineEventEntry[] => {
  const surfaceEntryMap = new Map<string, TimelineEventEntry>();
  renderableEventEntries.forEach((entry) => {
    const eventId = entry.event.getId();
    if (eventId) {
      surfaceEntryMap.set(eventId, entry);
    }
  });

  let absoluteIndex = 0;
  linkedTimelines.forEach((timeline) => {
    timeline.getEvents().forEach((mEvent) => {
      const eventId = mEvent.getId();
      const threadRootId = mEvent.threadRootId;
      if (!eventId || !threadRootId || threadRootId === eventId) {
        absoluteIndex += 1;
        return;
      }

      if (surfaceEntryMap.has(threadRootId)) {
        absoluteIndex += 1;
        return;
      }

      const rootEvent = room.getThread(threadRootId)?.rootEvent ?? room.findEventById(threadRootId);
      if (
        !rootEvent ||
        !isRenderableEvent(
          rootEvent,
          room,
          undefined,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents
        ) ||
        !isVisibleThreadRootEvent(
          rootEvent,
          room,
          threadResolutionMap ?? new Map<string, { isResolved: boolean }>(),
          threadReplyCountMap
        )
      ) {
        absoluteIndex += 1;
        return;
      }

      const existingEntry = surfaceEntryMap.get(threadRootId);
      if (!existingEntry || absoluteIndex < existingEntry.absoluteIndex) {
        surfaceEntryMap.set(threadRootId, {
          event: rootEvent,
          absoluteIndex,
        });
      }

      absoluteIndex += 1;
    });
  });

  return Array.from(surfaceEntryMap.values()).sort((entryA, entryB) => {
    const absoluteIndexDiff = entryA.absoluteIndex - entryB.absoluteIndex;
    if (absoluteIndexDiff !== 0) return absoluteIndexDiff;
    return (entryA.event.getId() ?? '').localeCompare(entryB.event.getId() ?? '');
  });
};

export const getThreadFilteredEvents = (
  renderableEvents: MatrixEvent[],
  room: Room,
  threadResolutionMap: Map<string, { isResolved: boolean }>,
  threadId: string | undefined,
  threadFilterState: ThreadFilterState,
  threadReplyCountMap?: Map<string, number>,
  threadMetadataMap?: Map<string, ThreadOverviewMetadata>
): MatrixEvent[] => {
  if (threadId || !hasActiveThreadFilters(threadFilterState)) return renderableEvents;

  return renderableEvents.filter((event) => {
    const eventId = event.getId();
    if (!eventId) return false;
    if (!isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)) {
      return false;
    }

    const meta = threadMetadataMap?.get(eventId);
    if (!meta) {
      // Fallback: derive minimal metadata from the resolution map when no
      // prebuilt metadata map is available (e.g. during initial render before
      // the full metadata map is constructed).
      const resolution = threadResolutionMap.get(eventId);
      const fallback: ThreadOverviewMetadata = {
        isResolved: resolution?.isResolved ?? false,
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
      };
      return matchesThreadFilterState(fallback, threadFilterState);
    }
    return matchesThreadFilterState(meta, threadFilterState);
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

const getKnownThreadReplyCount = (mEvent: MatrixEvent): number | undefined => {
  const threadMeta = mEvent.getUnsigned()?.['m.relations']?.['m.thread'] as
    | { count?: unknown; c?: unknown }
    | undefined;
  if (typeof threadMeta?.count === 'number') return threadMeta.count;
  if (typeof threadMeta?.c === 'number') return threadMeta.c;

  return undefined;
};

const getRoomDerivedThreadSnapshotState = ({
  room,
  threadId,
  rootEvent,
  threadEvents,
  roomStartKnown,
  roomTailLoaded,
}: {
  room: Room;
  threadId: string;
  rootEvent: MatrixEvent | undefined;
  threadEvents: MatrixEvent[];
  roomStartKnown: boolean;
  roomTailLoaded: boolean;
}) => {
  const loadedReplyCount = buildThreadReplyCountMap(threadEvents).get(threadId) ?? 0;
  const expectedReplyCount = rootEvent ? getKnownThreadReplyCount(rootEvent) : undefined;
  const snapshotComplete =
    roomStartKnown && roomTailLoaded && typeof expectedReplyCount === 'number'
      ? loadedReplyCount >= expectedReplyCount
      : undefined;

  return {
    beforeTokenForEarliest: snapshotComplete === true ? null : undefined,
    expectedReplyCount,
    loadedReplyCount,
    snapshotComplete,
    tailLoaded: roomTailLoaded ? true : undefined,
  };
};

const isCompleteCachedThreadSnapshot = ({
  room,
  threadId,
  rootEvent,
  cachedRootEvent,
  cachedEvents,
  beforeToken,
  hasMoreBefore,
  expectedReplyCount,
  snapshotComplete,
  tailLoaded,
}: {
  room: Room;
  threadId: string;
  rootEvent?: MatrixEvent;
  cachedRootEvent?: MatrixEvent;
  cachedEvents: MatrixEvent[];
  beforeToken: string | null | undefined;
  hasMoreBefore: boolean;
  expectedReplyCount?: number;
  snapshotComplete: boolean;
  tailLoaded: boolean;
}): boolean => {
  if (beforeToken != null || hasMoreBefore || !tailLoaded) {
    return false;
  }

  const authoritativeExpectedReplyCount =
    (rootEvent ? getKnownThreadReplyCount(rootEvent) : undefined) ??
    (cachedRootEvent ? getKnownThreadReplyCount(cachedRootEvent) : undefined) ??
    expectedReplyCount;
  if (typeof authoritativeExpectedReplyCount !== 'number') {
    return snapshotComplete;
  }

  const loadedReplyCount = buildThreadReplyCountMap(cachedEvents).get(threadId) ?? 0;
  return loadedReplyCount >= authoritativeExpectedReplyCount;
};

const getAuthoritativeCachedThreadReplyCount = ({
  rootEvent,
  cachedRootEvent,
  expectedReplyCount,
}: {
  rootEvent?: MatrixEvent;
  cachedRootEvent?: MatrixEvent;
  expectedReplyCount?: number;
}): number | undefined =>
  (rootEvent ? getKnownThreadReplyCount(rootEvent) : undefined) ??
  (cachedRootEvent ? getKnownThreadReplyCount(cachedRootEvent) : undefined) ??
  expectedReplyCount;

const mergeThreadBackfillEvents = (
  existingEvents: MatrixEvent[],
  incomingEvents: MatrixEvent[]
): MatrixEvent[] => {
  const eventsById = new Map<string, MatrixEvent>();

  [...existingEvents, ...incomingEvents].forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (!eventId) return;
    eventsById.set(eventId, mEvent);
  });

  return Array.from(eventsById.values()).sort((left, right) => {
    const tsDiff = left.getTs() - right.getTs();
    if (tsDiff !== 0) return tsDiff;
    return (left.getId() ?? '').localeCompare(right.getId() ?? '');
  });
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
  threadFilterState: ThreadFilterState;
  onToggle: (key: ThreadFilterKey) => void;
  onSortDirectionChange: () => void;
  onCycleTag: (tag: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onReset: () => void;
  onApplyPreset: (preset: FilterPreset) => void;
  onSearchQueryChange: (query: string) => void;
  viewMode: RoomViewMode;
  onViewModeChange: (viewMode: RoomViewMode) => void;
  roomInputRef: RefObject<HTMLElement>;
  editor: Editor;
};

const ROOM_FOCUS_SCROLL_RETRY_MAX_ATTEMPTS = 10;
const ROOM_FOCUS_OBSERVER_IDLE_MS = 200;
const ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS = 2000;
const ROOM_FOCUS_NEAR_START_THRESHOLD = 5;
const ROOM_FOCUS_NEAR_END_THRESHOLD = 5;
const ROOM_FOCUS_START_MARGIN_PX = 32;
const ROOM_FOCUS_END_MARGIN_PX = 32;

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

export const isRoomFocusNearTimelineStart = (
  focusIndex: number,
  threshold = ROOM_FOCUS_NEAR_START_THRESHOLD
): boolean => focusIndex < threshold;

export const isRoomFocusNearTimelineEnd = (
  focusIndex: number,
  itemCount: number,
  threshold = ROOM_FOCUS_NEAR_END_THRESHOLD
): boolean => itemCount - focusIndex <= threshold;

export const getRoomFocusScrollOptions = (focusIndex: number, itemCount: number) => {
  const nearStart = isRoomFocusNearTimelineStart(focusIndex);
  const nearEnd = isRoomFocusNearTimelineEnd(focusIndex, itemCount);

  if (nearStart) {
    return {
      behavior: 'instant' as const,
      align: 'start' as const,
      offset: ROOM_FOCUS_START_MARGIN_PX,
    };
  }

  if (nearEnd) {
    return {
      behavior: 'instant' as const,
      align: 'end' as const,
      offset: -ROOM_FOCUS_END_MARGIN_PX,
    };
  }

  return {
    behavior: 'instant' as const,
    align: 'center' as const,
    offset: undefined,
  };
};

export const getRoomFocusScrollToItemOptions = (focusIndex: number, itemCount: number) => ({
  ...getRoomFocusScrollOptions(focusIndex, itemCount),
  stopInView: false,
});

export const setupFocusObserver = (opts: {
  scrollContainer: HTMLElement;
  target: HTMLElement;
  onRecenter: () => void;
  onDone: () => void;
  idleMs?: number;
  hardMs?: number;
}): (() => void) => {
  if (typeof ResizeObserver === 'undefined') {
    opts.onDone();
    return () => undefined;
  }

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  let rafId: number | undefined;
  let done = false;

  let ro: ResizeObserver | undefined;

  const finish = () => {
    if (done) return;
    done = true;
    ro?.disconnect();
    if (idleTimer) clearTimeout(idleTimer);
    if (hardTimer) clearTimeout(hardTimer);
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    opts.onDone();
  };

  const scheduleRecenter = () => {
    if (done) return;
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      opts.onRecenter();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, opts.idleMs ?? ROOM_FOCUS_OBSERVER_IDLE_MS);
    });
  };

  ro = new ResizeObserver(scheduleRecenter);
  ro.observe(opts.target);
  ro.observe(opts.scrollContainer);

  idleTimer = setTimeout(finish, opts.idleMs ?? ROOM_FOCUS_OBSERVER_IDLE_MS);
  hardTimer = setTimeout(() => {
    opts.onRecenter();
    finish();
  }, opts.hardMs ?? ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS);

  return finish;
};

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

const getThreadCacheTargetId = (room: Room, mEvent: MatrixEvent): string | undefined => {
  const eventId = mEvent.getId();
  if (!eventId) return undefined;

  const threadRootId = mEvent.threadRootId;
  if (threadRootId && threadRootId !== eventId) {
    return threadRootId;
  }

  const relationTargetId = mEvent.getAssociatedId() ?? mEvent.getRelation()?.event_id;
  if (!relationTargetId) return undefined;

  const relatedEvent = room.findEventById(relationTargetId);
  if (!relatedEvent) return undefined;
  const relatedEventId = relatedEvent.getId();
  if (!relatedEventId) return undefined;

  if (relatedEvent.threadRootId && relatedEvent.threadRootId !== relatedEventId) {
    return relatedEvent.threadRootId;
  }

  return relatedEvent.isThreadRoot || room.getThread(relatedEventId)?.rootEvent?.getId() === relatedEventId
    ? relatedEventId
    : undefined;
};

const groupThreadCacheEvents = (
  room: Room,
  events: MatrixEvent[]
): Map<string, MatrixEvent[]> => {
  const grouped = new Map<string, MatrixEvent[]>();

  events.forEach((mEvent) => {
    const threadCacheTargetId = getThreadCacheTargetId(room, mEvent);
    if (!threadCacheTargetId) return;
    const cachedThreadEvents = grouped.get(threadCacheTargetId);
    if (cachedThreadEvents) {
      cachedThreadEvents.push(mEvent);
      return;
    }
    grouped.set(threadCacheTargetId, [mEvent]);
  });

  return grouped;
};

export const getLoadedRoomThreadEvents = (room: Room, threadId: string): MatrixEvent[] => {
  const eventsById = new Map<string, MatrixEvent>();
  const rootEvent = room.findEventById(threadId);
  const rootEventId = rootEvent?.getId();
  if (rootEvent && rootEventId) {
    eventsById.set(rootEventId, rootEvent);
  }

  getLinkedTimelines(getLiveTimeline(room)).forEach((timeline) => {
    timeline.getEvents().forEach((mEvent) => {
      const eventId = mEvent.getId();
      if (!eventId) return;
      if (eventId === threadId) {
        eventsById.set(eventId, mEvent);
        return;
      }
      if (!eventBelongsToThread(mEvent, threadId)) return;
      if (mEvent.getRelation()?.rel_type === RelationType.Replace) return;
      if (reactionOrEditEvent(mEvent) || mEvent.isRedaction()) return;
      eventsById.set(eventId, mEvent);
    });
  });

  return Array.from(eventsById.values()).sort((left, right) => {
    const tsDiff = left.getTs() - right.getTs();
    if (tsDiff !== 0) return tsDiff;
    return (left.getId() ?? '').localeCompare(right.getId() ?? '');
  });
};

export const getLoadedRoomThreadSeedEvents = (room: Room, threadId: string): MatrixEvent[] => {
  const seedEventsById = new Map<string, MatrixEvent>();
  const loadedThreadEvents = getLoadedRoomThreadEvents(room, threadId);
  const linkedTimelineEvents = getLinkedTimelines(getLiveTimeline(room)).flatMap((timeline) =>
    timeline.getEvents()
  );

  loadedThreadEvents.forEach((mEvent) => {
    const eventId = mEvent.getId();
    if (!eventId) return;
    seedEventsById.set(eventId, mEvent);
  });

  if (seedEventsById.size === 0) return [];

  let addedEvent = true;
  while (addedEvent) {
    addedEvent = false;

    linkedTimelineEvents.forEach((mEvent) => {
      const eventId = mEvent.getId();
      if (!eventId || seedEventsById.has(eventId)) return;

      if (mEvent.isRedaction()) {
        const targetEventId = mEvent.getAssociatedId();
        if (targetEventId && seedEventsById.has(targetEventId)) {
          seedEventsById.set(eventId, mEvent);
          addedEvent = true;
        }
        return;
      }

      const relation = mEvent.getRelation();
      if (relation?.rel_type !== RelationType.Replace) return;

      if (relation.event_id && seedEventsById.has(relation.event_id)) {
        seedEventsById.set(eventId, mEvent);
        addedEvent = true;
      }
    });
  }

  return Array.from(seedEventsById.values()).sort((left, right) => {
    const tsDiff = left.getTs() - right.getTs();
    if (tsDiff !== 0) return tsDiff;
    return (left.getId() ?? '').localeCompare(right.getId() ?? '');
  });
};

export const getLoadedThreadModelSeedEvents = (room: Room, threadId: string): MatrixEvent[] => {
  const cachedThreadSeedEvents = getThreadOpenSeedSnapshot(room, threadId);
  const eventsById = new Map<string, MatrixEvent>();
  const thread = room.getThread(threadId);
  if (!thread || thread.events.length === 0) {
    return cachedThreadSeedEvents;
  }

  const addThreadEvent = (mEvent?: MatrixEvent | null) => {
    if (!mEvent) return;
    const eventId = mEvent.getId();
    if (!eventId) return;
    if (reactionOrEditEvent(mEvent) || mEvent.isRedaction()) return;
    eventsById.set(eventId, mEvent);
  };

  addThreadEvent(thread?.rootEvent ?? room.findEventById(threadId));
  thread?.events.forEach((mEvent) => addThreadEvent(mEvent));

  const modelSeedEvents = Array.from(eventsById.values()).sort((left, right) => {
    const tsDiff = left.getTs() - right.getTs();
    if (tsDiff !== 0) return tsDiff;
    return (left.getId() ?? '').localeCompare(right.getId() ?? '');
  });

  if (cachedThreadSeedEvents.length === 0) {
    return modelSeedEvents;
  }

  return mergeThreadBackfillEvents(cachedThreadSeedEvents, modelSeedEvents);
};

const isCollapsibleTextMessageEvent = (mEvent: MatrixEvent): boolean =>
  mEvent.getType() === MessageEvent.RoomMessage ||
  mEvent.getType() === MessageEvent.RoomMessageEncrypted;

type ShouldTrackLiveCollapsibleMessage = {
  mEvent: MatrixEvent;
  room: Room;
  threadId: string | undefined;
  threadFilterState: ThreadFilterState;
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
  threadFilterState,
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
    getThreadFilteredEvents([mEvent], room, threadResolutionMap, threadId, threadFilterState).length > 0
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

const getLatestLoadedRoomEvent = (
  room: Room,
  linkedTimelines: EventTimeline[]
): MatrixEvent | undefined => {
  const loadedEvents = getMainTimelineCacheEvents(room, linkedTimelines);
  return loadedEvents[loadedEvents.length - 1];
};

export const isAnchorVisibleInScroll = (
  anchor: Element,
  scroll: Element,
  marginPx = 100
): boolean => {
  const anchorRect = anchor.getBoundingClientRect();
  const scrollRect = scroll.getBoundingClientRect();
  return anchorRect.top <= scrollRect.bottom + marginPx;
};

export const shouldHydrateLatestRoomCache = (
  loadedLatestEvent: Partial<IEvent> | undefined,
  cachedLatestEvent: Partial<IEvent> | undefined
): boolean =>
  compareCachedPaginationAnchors(
    getRoomCursorAnchor(cachedLatestEvent),
    getRoomCursorAnchor(loadedLatestEvent)
  ) > 0;

export const filterLatestRoomCacheHydrationEvents = (
  rawCachedEvents: Partial<IEvent>[],
  loadedEvents: MatrixEvent[]
): Partial<IEvent>[] => {
  const loadedEventIds = new Set(
    loadedEvents
      .map((mEvent) => mEvent.getId())
      .filter((eventId): eventId is string => !!eventId)
  );

  return rawCachedEvents.filter(
    (rawEvent) =>
      typeof rawEvent.event_id === 'string' && !loadedEventIds.has(rawEvent.event_id)
  );
};

export const MAX_THREAD_FETCH_EVENTS = 5000;
export const MAX_THREAD_FETCH_ITERATIONS = 50;
const VISIBLE_THREAD_CACHE_PREWARM_LIMIT = 8;
const VISIBLE_THREAD_CACHE_PREWARM_MIN_REPLY_COUNT = 20;
const VISIBLE_THREAD_CACHE_PREWARM_OVERSCAN = 8;
const THREAD_OPEN_PREWARM_WAIT_MS = 400;

type ThreadSeedPrewarmTarget = {
  threadId: string;
  replyCount: number;
  visible: boolean;
};

export const collectPriorityThreadSeedPrewarmRoots = ({
  room,
  threadFilteredEventEntries,
  threadId,
  threadReplyCountMap,
  threadResolutionMap,
  rangeEnd,
  rangeStart,
}: {
  room: Room;
  threadFilteredEventEntries: TimelineEventEntry[];
  threadId?: string;
  threadReplyCountMap: Map<string, number>;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
  rangeStart: number;
  rangeEnd: number;
}): ThreadSeedPrewarmTarget[] => {
  if (threadId) return [];

  const candidateRoots = new Map<string, ThreadSeedPrewarmTarget>();

  const recordCandidate = (expectedThreadId: string, replyCount: number, visible: boolean) => {
    if (replyCount < VISIBLE_THREAD_CACHE_PREWARM_MIN_REPLY_COUNT) return;
    const existingCandidate = candidateRoots.get(expectedThreadId);
    if (!existingCandidate) {
      candidateRoots.set(expectedThreadId, {
        threadId: expectedThreadId,
        replyCount,
        visible,
      });
      return;
    }

    candidateRoots.set(expectedThreadId, {
      threadId: expectedThreadId,
      replyCount: Math.max(existingCandidate.replyCount, replyCount),
      visible: existingCandidate.visible || visible,
    });
  };

  const overscanStart = Math.max(0, rangeStart - VISIBLE_THREAD_CACHE_PREWARM_OVERSCAN);
  const overscanEnd = Math.min(
    threadFilteredEventEntries.length,
    rangeEnd + VISIBLE_THREAD_CACHE_PREWARM_OVERSCAN + 1
  );

  for (const entry of threadFilteredEventEntries.slice(overscanStart, overscanEnd)) {
    const event = entry.event;
    const eventId = event.getId();
    if (!eventId) continue;
    if (!isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)) continue;

    const replyCount = threadReplyCountMap.get(eventId) ?? getKnownThreadReplyCount(event) ?? 0;
    recordCandidate(eventId, replyCount, true);
  }

  const roomThreads = typeof room.getThreads === 'function' ? room.getThreads() : [];
  roomThreads.forEach((thread) => {
    const expectedThreadId = thread.id;
    if (!expectedThreadId) return;
    const threadRootEvent = thread.rootEvent ?? room.findEventById(expectedThreadId);
    const replyCount =
      threadReplyCountMap.get(expectedThreadId) ??
      (typeof thread.length === 'number' && thread.length > 0 ? thread.length : undefined) ??
      (threadRootEvent ? getKnownThreadReplyCount(threadRootEvent) : undefined) ??
      0;
    recordCandidate(expectedThreadId, replyCount, false);
  });

  return [...candidateRoots.values()]
    .sort((left, right) => {
      if (left.visible !== right.visible) return left.visible ? -1 : 1;
      return right.replyCount - left.replyCount;
    })
    .slice(0, VISIBLE_THREAD_CACHE_PREWARM_LIMIT);
};

export type ThreadRelationPageResult = {
  events: MatrixEvent[];
  nextBatchToken: string | undefined;
};

export async function fetchAllThreadRelations(
  mx: MatrixClient,
  roomId: string,
  threadId: string,
  batchSize: number,
  isAborted: () => boolean
): Promise<ThreadRelationPageResult | null> {
  const mapper = mx.getEventMapper();
  const allBatches: MatrixEvent[][] = [];
  let nextBatchToken: string | undefined;
  let totalEventCount = 0;

  for (let iteration = 0; iteration < MAX_THREAD_FETCH_ITERATIONS; iteration++) {
    const [err, relData] = await to(
      mx.fetchRelations(roomId, threadId, null, null, {
        dir: Direction.Backward,
        limit: batchSize,
        recurse: true,
        ...(nextBatchToken ? { from: nextBatchToken } : {}),
      })
    );
    if (err || !relData) {
      if (iteration === 0) return null;
      break;
    }
    if (isAborted()) return null;

    const batchEvents = relData.chunk
      .slice()
      .reverse()
      .map((rawEvent) => mapper(rawEvent));
    allBatches.push(batchEvents);
    totalEventCount += batchEvents.length;
    nextBatchToken = relData.next_batch ?? undefined;

    if (!nextBatchToken || totalEventCount >= MAX_THREAD_FETCH_EVENTS) break;
  }

  if (isAborted()) return null;

  const events = allBatches
    .flat()
    .sort((left, right) => {
      const tsDiff = left.getTs() - right.getTs();
      if (tsDiff !== 0) return tsDiff;
      return (left.getId() ?? '').localeCompare(right.getId() ?? '');
    });

  return { events, nextBatchToken };
}

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

type TimelineArriveMeta = {
  liveEvent: boolean;
  toStartOfTimeline: boolean;
};

const useLiveEventArrive = (
  room: Room,
  onArrive: (mEvent: MatrixEvent, meta: TimelineArriveMeta) => void
) => {
  useEffect(() => {
    const handleTimelineEvent: EventTimelineSetHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      eventRoom,
      toStartOfTimeline,
      removed,
      data
    ) => {
      if (eventRoom?.roomId !== room.roomId || removed) return;
      onArrive(mEvent, {
        liveEvent: data?.liveEvent === true,
        toStartOfTimeline: toStartOfTimeline === true,
      });
    };
    const handleRedaction: RoomEventHandlerMap[RoomEvent.Redaction] = (mEvent, eventRoom) => {
      if (eventRoom?.roomId !== room.roomId) return;
      onArrive(mEvent, {
        liveEvent: true,
        toStartOfTimeline: false,
      });
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

export const getActiveTimelineRange = (
  threadId: string | undefined,
  threadFilterState: ThreadFilterState,
  range: ItemRange,
  count: number,
  paginationLimit: number
): ItemRange => {
  if (threadId) {
    return { start: 0, end: 0 };
  }

  if (isRoomThreadOverviewActive(threadId, threadFilterState)) {
    return { start: 0, end: count };
  }

  return getVisibleTimelineRange(range, count, paginationLimit);
};

const getFilteredRoomOverviewEvents = (
  renderableEvents: MatrixEvent[],
  room: Room,
  threadResolutionMap: Map<string, { isResolved: boolean; tags: Record<string, unknown> | null }>,
  threadFilterState: ThreadFilterState,
  threadReplyCountMap: Map<string, number> | undefined,
  scheduledTaskCounts: Map<string, number>,
  threadReplyCountMapForMeta: Map<string, number>,
  threadParticipantMap: Map<string, string[]>,
  summaryMap: Map<string, MindroomThreadSummaryInfo>,
  currentUserId: string,
  readUpToTs: number | undefined
): MatrixEvent[] => {
  if (!isRoomThreadOverviewActive(undefined, threadFilterState)) {
    return renderableEvents;
  }

  const visibleThreadRootIds: string[] = [];
  const absoluteIndexMap = new Map<string, number>();
  const eventMap = new Map<string, MatrixEvent>();
  const bodyMap = new Map<string, string>();

  renderableEvents.forEach((event, index) => {
    const currentEventId = event.getId();
    if (!currentEventId) return;
    eventMap.set(currentEventId, event);
    if (!isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)) {
      return;
    }

    visibleThreadRootIds.push(currentEventId);
    absoluteIndexMap.set(currentEventId, index);
    const body = event.getContent()?.body;
    if (typeof body === 'string') bodyMap.set(currentEventId, body);
  });

  const metadataMap = buildThreadMetadataMap(
    room,
    visibleThreadRootIds,
    threadResolutionMap,
    scheduledTaskCounts,
    threadReplyCountMapForMeta,
    threadParticipantMap,
    summaryMap,
    currentUserId,
    readUpToTs,
    absoluteIndexMap,
    bodyMap
  );

  const statusFiltered = filterThreadRootEvents(visibleThreadRootIds, threadFilterState, metadataMap);
  const searchFiltered = filterThreadsBySearch(statusFiltered, threadFilterState.searchQuery, metadataMap);
  return sortThreadRootEvents(
    searchFiltered,
    threadFilterState.sortBy,
    threadFilterState.sortDirection,
    metadataMap
  )
    .map((currentEventId) => eventMap.get(currentEventId))
    .filter((event): event is MatrixEvent => event !== undefined);
};

export const getRoomEventFocusTarget = ({
  eventId,
  renderableEvents,
  room,
  threadResolutionMap,
  threadId,
  threadFilterState,
  threadReplyCountMap,
  scheduledTaskCounts,
  threadReplyCountMapForMeta,
  threadParticipantMap,
  summaryMap,
  currentUserId,
  readUpToTs,
}: {
  eventId: string;
  renderableEvents: MatrixEvent[];
  room: Room;
  threadResolutionMap: Map<string, { isResolved: boolean; tags: Record<string, unknown> | null }>;
  threadId: string | undefined;
  threadFilterState: ThreadFilterState;
  threadReplyCountMap?: Map<string, number>;
  scheduledTaskCounts: Map<string, number>;
  threadReplyCountMapForMeta: Map<string, number>;
  threadParticipantMap: Map<string, string[]>;
  summaryMap: Map<string, MindroomThreadSummaryInfo>;
  currentUserId: string;
  readUpToTs: number | undefined;
}): {
  index: number;
  count: number;
  canFocus: boolean;
} => {
  const visibleEvents = threadId
    ? renderableEvents
    : getFilteredRoomOverviewEvents(
        renderableEvents,
        room,
        threadResolutionMap,
        threadFilterState,
        threadReplyCountMap,
        scheduledTaskCounts,
        threadReplyCountMapForMeta,
        threadParticipantMap,
        summaryMap,
        currentUserId,
        readUpToTs
      );
  const visibleIndex = visibleEvents.findIndex((event) => event.getId() === eventId);
  if (visibleIndex !== -1) {
    return {
      index: visibleIndex,
      count: visibleEvents.length,
      canFocus: true,
    };
  }

  return {
    index: 0,
    count: visibleEvents.length,
    canFocus: false,
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
  threadFilterState,
  onToggle,
  onSortDirectionChange,
  onCycleTag,
  onAddTag,
  onRemoveTag,
  onReset,
  onApplyPreset,
  onSearchQueryChange,
  viewMode,
  onViewModeChange,
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
  const [eagerPreloading, setEagerPreloading] = useState(!threadId && !eventId);
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
  const eagerPreloadDoneForRoomRef = useRef<string | null>(null);
  const threadPaginatingBackRef = useRef(false);
  const threadPaginatingFrontRef = useRef(false);
  const threadIdRef = useRef(threadId);
  const threadFilterStateRef = useRef(threadFilterState);
  const roomDebugTraceRef = useRef({
    roomId: room.roomId,
    traceId: createTimelineDebugTrace('room-open', room.roomId),
  });
  const currentThreadTraceKey = threadId ? `${room.roomId}|${threadId}` : undefined;
  const threadDebugTraceRef = useRef<{ traceId?: string; traceKey?: string }>({
    traceId: currentThreadTraceKey
      ? createTimelineDebugTrace('thread-open', room.roomId, threadId)
      : undefined,
    traceKey: currentThreadTraceKey,
  });
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
  const suppressFocusPaginationRef = useRef(false);
  const alive = useAlive();
  roomIdRef.current = room.roomId;
  threadPaginatingBackRef.current = threadPaginatingBack;
  threadPaginatingFrontRef.current = threadPaginatingFront;
  threadIdRef.current = threadId;
  threadFilterStateRef.current = threadFilterState;
  if (roomDebugTraceRef.current.roomId !== room.roomId) {
    roomDebugTraceRef.current = {
      roomId: room.roomId,
      traceId: createTimelineDebugTrace('room-open', room.roomId),
    };
  }
  if (threadDebugTraceRef.current.traceKey !== currentThreadTraceKey) {
    threadDebugTraceRef.current = {
      traceId: currentThreadTraceKey
        ? createTimelineDebugTrace('thread-open', room.roomId, threadId)
        : undefined,
      traceKey: currentThreadTraceKey,
    };
  }
  const roomDebugTraceId = roomDebugTraceRef.current.traceId;
  const threadDebugTraceId = threadDebugTraceRef.current.traceId;

  useEffect(() => {
    logTimelineDebug(roomDebugTraceId, 'init', {
      eventId,
      roomId: room.roomId,
      threadId,
    });
  }, [eventId, room.roomId, roomDebugTraceId, threadId]);

  useEffect(() => {
    if (!threadId) return;
    logTimelineDebug(threadDebugTraceId, 'init', {
      eventId,
      roomId: room.roomId,
      threadId,
    });
  }, [eventId, room.roomId, threadDebugTraceId, threadId]);

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
  // Reset eagerPreloading when transitioning from event-focused view back to room
  // (component is reused since key is roomId:threadId, so useState initializer won't re-run)
  // useLayoutEffect so the reset fires before paint, preventing a single-frame skeleton flash
  useLayoutEffect(() => {
    if (!eventId && !threadId) {
      setEagerPreloading(true);
    }
  }, [eventId, threadId]);
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
    return getLinkedTimelineEvents(timeline.linkedTimelines);
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
  // ── Scheduled task state events (batch) ──
  const scheduledTaskEvents = useStateEvents(room, StateEvent.MindRoomScheduledTask);
  const scheduledTaskCounts = useMemo(
    () => (threadId ? new Map<string, number>() : getRoomScheduledTaskCounts(scheduledTaskEvents)),
    [threadId, scheduledTaskEvents]
  );

  // ── Batch metadata reactivity ──
  // Bump a refresh counter on room-level events that affect overview metadata
  const [overviewRefreshCounter, setOverviewRefreshCounter] = useState(0);
  useEffect(() => {
    if (threadId) return undefined;
    const bumpRefresh = () => setOverviewRefreshCounter((c) => c + 1);
    room.on(RoomEvent.Timeline, bumpRefresh);
    room.on(RoomEvent.Receipt, bumpRefresh);
    room.on(ThreadEvent.New, bumpRefresh);
    room.on(ThreadEvent.Update, bumpRefresh);
    room.on(ThreadEvent.NewReply, bumpRefresh);
    room.on(ThreadEvent.Delete, bumpRefresh);
    return () => {
      room.removeListener(RoomEvent.Timeline, bumpRefresh);
      room.removeListener(RoomEvent.Receipt, bumpRefresh);
      room.removeListener(ThreadEvent.New, bumpRefresh);
      room.removeListener(ThreadEvent.Update, bumpRefresh);
      room.removeListener(ThreadEvent.NewReply, bumpRefresh);
      room.removeListener(ThreadEvent.Delete, bumpRefresh);
    };
  }, [room, threadId]);

  // ── Visible thread root IDs + absoluteIndex map ──
  const roomSurfaceEventEntries = useMemo(() => {
    if (threadId) return renderableEventEntries;
    return buildRoomSurfaceEventEntries({
      renderableEventEntries,
      linkedTimelines: timeline.linkedTimelines,
      room,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      threadReplyCountMap,
      threadResolutionMap,
    });
  }, [
    threadId,
    renderableEventEntries,
    timeline.linkedTimelines,
    room,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    threadReplyCountMap,
    threadResolutionMap,
  ]);

  const visibleThreadRootData = useMemo(() => {
    const ids: string[] = [];
    const indexMap = new Map<string, number>();
    const bodyMap = new Map<string, string>();
    roomSurfaceEventEntries.forEach(({ event, absoluteIndex }) => {
      const evtId = event.getId();
      if (!evtId) return;
      if (isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)) {
        ids.push(evtId);
        indexMap.set(evtId, absoluteIndex);
        const body = event.getContent()?.body;
        if (typeof body === 'string') bodyMap.set(evtId, body);
      }
    });
    return { ids, indexMap, bodyMap };
  }, [roomSurfaceEventEntries, room, threadResolutionMap, threadReplyCountMap]);

  // ── Read-up-to timestamp for unread heuristic ──
  const readUpToTs = useMemo(() => {
    if (threadId) return undefined;
    const readUpToId = room.getEventReadUpTo(mx.getSafeUserId());
    if (!readUpToId) return undefined;
    const readUpToEvent = room.findEventById(readUpToId);
    return readUpToEvent?.getTs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, room, mx, overviewRefreshCounter]);

  // ── Thread metadata map ──
  const threadMetadataMap = useMemo(
    () => {
      if (threadId) return new Map<string, ThreadOverviewMetadata>();
      return buildThreadMetadataMap(
        room,
        visibleThreadRootData.ids,
        threadResolutionMap,
        scheduledTaskCounts,
        threadReplyCountMap,
        threadParticipantMap,
        threadSummaryInfoMap,
        mx.getSafeUserId(),
        readUpToTs,
        visibleThreadRootData.indexMap,
        visibleThreadRootData.bodyMap
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      threadId,
      room,
      visibleThreadRootData,
      threadResolutionMap,
      scheduledTaskCounts,
      threadReplyCountMap,
      threadParticipantMap,
      threadSummaryInfoMap,
      mx,
      readUpToTs,
      overviewRefreshCounter,
    ]
  );

  // ── Debounced search query (300ms) ──
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(threadFilterState.searchQuery);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(threadFilterState.searchQuery), 300);
    return () => clearTimeout(timer);
  }, [threadFilterState.searchQuery]);

  // ── Overview pipeline: filter → sort → Map-based entry construction ──
  const roomThreadFilterActive = isRoomThreadOverviewActive(threadId, threadFilterState);

  // Filtered thread root IDs (status+tag filter → search → used for threadCount prop)
  const filteredThreadRootIds = useMemo(() => {
    if (threadId) return visibleThreadRootData.ids;
    const statusFiltered = filterThreadRootEvents(visibleThreadRootData.ids, threadFilterState, threadMetadataMap);
    return filterThreadsBySearch(statusFiltered, debouncedSearchQuery, threadMetadataMap);
  }, [threadId, visibleThreadRootData.ids, threadFilterState, threadMetadataMap, debouncedSearchQuery]);

  // Per-status counts over ALL threads (unfiltered)
  const statusCounts = useMemo(
    () => computeStatusCounts(visibleThreadRootData.ids, threadMetadataMap),
    [visibleThreadRootData.ids, threadMetadataMap]
  );

  // Tag distribution over ALL threads (unfiltered)
  const tagCounts = useMemo(
    () => computeTagCounts(visibleThreadRootData.ids, threadMetadataMap),
    [visibleThreadRootData.ids, threadMetadataMap]
  );

  // Available tags from resolution map
  const availableRoomTags = useMemo(
    () => collectAvailableRoomTags(threadResolutionMap),
    [threadResolutionMap]
  );

  const threadFilteredEvents = useMemo(() => {
    if (threadId) return renderableEvents;

    // When overview mode is active (any filter or non-default sort), show only thread roots
    if (roomThreadFilterActive) {
      // Filter → Search → Sort
      const statusFiltered = filterThreadRootEvents(
        visibleThreadRootData.ids,
        threadFilterState,
        threadMetadataMap
      );
      const searchFiltered = filterThreadsBySearch(statusFiltered, debouncedSearchQuery, threadMetadataMap);
      const sortedIds = sortThreadRootEvents(searchFiltered, threadFilterState.sortBy, threadFilterState.sortDirection, threadMetadataMap);

      // Map IDs back to MatrixEvents
      const eventMap = new Map<string, MatrixEvent>();
      roomSurfaceEventEntries.forEach(({ event }) => {
        const evtId = event.getId();
        if (evtId) eventMap.set(evtId, event);
      });

      return sortedIds
        .map((id) => eventMap.get(id))
        .filter((evt): evt is MatrixEvent => evt !== undefined);
    }

    return renderableEvents;
  }, [
    renderableEvents,
    roomSurfaceEventEntries,
    threadId,
    roomThreadFilterActive,
    visibleThreadRootData.ids,
    threadFilterState,
    threadMetadataMap,
    debouncedSearchQuery,
  ]);

  const threadFilteredEventsRef = useRef(threadFilteredEvents);
  threadFilteredEventsRef.current = threadFilteredEvents;

  // Map-based entry construction: preserve entry metadata while allowing new display order
  const threadFilteredEventEntries = useMemo(() => {
    if (!roomThreadFilterActive) {
      return renderableEventEntries;
    }

    const entryMap = new Map<string, TimelineEventEntry>();
    roomSurfaceEventEntries.forEach((entry) => {
      const entryEventId = entry.event.getId();
      if (entryEventId) entryMap.set(entryEventId, entry);
    });

    return threadFilteredEvents
      .map((event) => {
        const eventId = event.getId();
        return eventId ? entryMap.get(eventId) : undefined;
      })
      .filter((entry): entry is TimelineEventEntry => entry !== undefined);
  }, [roomSurfaceEventEntries, threadFilteredEvents, roomThreadFilterActive]);
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
        threadFilterState,
        timeline.range,
        filteredLength,
        safePaginationLimit
      ),
    [threadId, threadFilterState, timeline.range, filteredLength, safePaginationLimit]
  );
  const priorityThreadSeedPrewarmRoots = useMemo(() => {
    return collectPriorityThreadSeedPrewarmRoots({
      room,
      threadFilteredEventEntries,
      threadId,
      threadReplyCountMap,
      threadResolutionMap,
      rangeEnd: activeTimelineRange.end,
      rangeStart: activeTimelineRange.start,
    });
  }, [
    activeTimelineRange.end,
    activeTimelineRange.start,
    overviewRefreshCounter,
    room,
    threadFilteredEventEntries,
    threadId,
    threadReplyCountMap,
    threadResolutionMap,
  ]);
  const prevThreadFilterStateRef = useRef(threadFilterState);
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
    debugTraceId: threadDebugTraceId,
  });
  const threadEventMap = useMemo(() => {
    const eventMap = new Map<string, MatrixEvent>();
    threadEvents.forEach((mEvent) => {
      const eventId = mEvent.getId();
      if (eventId) eventMap.set(eventId, mEvent);
    });
    return eventMap;
  }, [threadEvents]);
  const canPaginateThreadBack =
    typeof threadLinkedTimelines[0]?.getPaginationToken(Direction.Backward) === 'string';
  const canPaginateThreadFront =
    typeof lastThreadTimeline?.getPaginationToken(Direction.Forward) === 'string';

  useEffect(() => {
    if (threadId) return;
    logTimelineDebug(roomDebugTraceId, 'room-surface', {
      activeRangeEnd: activeTimelineRange.end,
      activeRangeStart: activeTimelineRange.start,
      cacheCount: eventsLength,
      eagerPreloading,
      renderableCount: renderableEventEntries.length,
      surfaceCount: roomSurfaceEventEntries.length,
      threadOverviewCount: threadFilteredEvents.length,
      visibleCount: activeTimelineRange.end - activeTimelineRange.start,
    });
  }, [
    activeTimelineRange.end,
    activeTimelineRange.start,
    eagerPreloading,
    eventsLength,
    renderableEventEntries.length,
    roomSurfaceEventEntries.length,
    threadFilteredEvents.length,
    threadId,
    roomDebugTraceId,
  ]);

  useEffect(() => {
    if (!threadId) return;
    logTimelineDebug(threadDebugTraceId, 'thread-range', {
      activeRangeEnd: activeTimelineRange.end,
      activeRangeStart: activeTimelineRange.start,
      canPaginateThreadBack,
      canPaginateThreadFront,
      filteredLength,
      initialCacheHydrated: threadInitialCacheHydrated,
      initialRenderMode: threadInitialRenderMode,
      renderedCount: activeTimelineRange.end - activeTimelineRange.start,
      threadEventCount: threadEvents.length,
      threadTailLoaded,
      threadTimelineTick,
    });
  }, [
    activeTimelineRange.end,
    activeTimelineRange.start,
    canPaginateThreadBack,
    canPaginateThreadFront,
    filteredLength,
    threadEvents.length,
    threadDebugTraceId,
    threadId,
    threadInitialCacheHydrated,
    threadInitialRenderMode,
    threadTailLoaded,
    threadTimelineTick,
  ]);

  useEffect(() => {
    const prevThreadFilterState = prevThreadFilterStateRef.current;
    prevThreadFilterStateRef.current = threadFilterState;

    const wasActive = isRoomThreadOverviewActive(threadId, prevThreadFilterState);
    const isActive = isRoomThreadOverviewActive(threadId, threadFilterState);

    if (wasActive && !isActive && !threadId) {
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
    threadFilterState,
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

  // Eager backward preload: on room entry, paginate until paginationLimit is reached
  useEffect(() => {
    if (threadId || eventId) return undefined;
    if (eagerPreloadDoneForRoomRef.current === room.roomId) {
      // Don't clear eagerPreloading here — the cache-hydration effect still needs
      // to reset timeline.range first. It will clear eagerPreloading after setTimeline.
      return undefined;
    }

    let cancelled = false;
    const BATCH_SIZE = 200;
    const MAX_STALLED_BATCHES = 3;

    // Capture the initial backward pagination token before any cache effects can clear it
    const initialLiveTimeline = getLiveTimeline(room);
    const savedPaginationToken = initialLiveTimeline.getPaginationToken(Direction.Backward);

    const preload = async () => {
      setEagerPreloading(true);
      // Let cache hydration effects settle first
      await new Promise<void>((r) => {
        setTimeout(r, 100);
      });
      if (cancelled || !alive()) {
        console.log('[eager-preload] cancelled or unmounted before starting loop');
        logTimelineDebug(roomDebugTraceId, 'eager-preload-cancelled-before-start');
        setEagerPreloading(false);
        return;
      }

      console.log(
        `[eager-preload] starting for room ${room.roomId}, limit=${safePaginationLimitRef.current}, savedToken=${savedPaginationToken ? 'yes' : 'no'}`
      );
      logTimelineDebug(roomDebugTraceId, 'eager-preload-start', {
        limit: safePaginationLimitRef.current,
        savedTokenPresent: !!savedPaginationToken,
      });

      let iterations = 0;
      let stalledBatches = 0;
      let preloadSucceeded = false;
      while (true) {
        if (cancelled || !alive()) {
          console.log(`[eager-preload] cancelled or unmounted at iteration ${iterations}`);
          logTimelineDebug(roomDebugTraceId, 'eager-preload-cancelled', {
            iterations,
          });
          break;
        }
        if (roomIdRef.current !== room.roomId || threadIdRef.current) {
          console.log(`[eager-preload] room/thread changed at iteration ${iterations}`);
          logTimelineDebug(roomDebugTraceId, 'eager-preload-abort-room-change', {
            iterations,
            currentThreadId: threadIdRef.current,
          });
          break;
        }

        // Wait for any ongoing pagination to complete
        if (roomPaginatingBackRef.current) {
          await new Promise<void>((r) => {
            setTimeout(r, 50);
          });
          continue;
        }

        // Get fresh timeline state from SDK
        const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
        const filterOpts = recalibrateFilterOptsRef.current;
        if (!filterOpts) {
          console.log('[eager-preload] missing filter opts, breaking');
          break;
        }

        const counts = getRoomPreloadCounts(linkedTimelines, filterOpts.room, filterOpts);

        const surfacedCount = roomThreadFilterActive ? counts.surfaceCount : counts.renderableCount;

        if (surfacedCount >= safePaginationLimitRef.current) {
          console.log(
            `[eager-preload] done: surfaceCount=${surfacedCount} >= limit=${safePaginationLimitRef.current}`
          );
          logTimelineDebug(roomDebugTraceId, 'eager-preload-target-reached', {
            cacheCount: counts.cacheCount,
            iterations,
            renderableCount: counts.renderableCount,
            surfaceCount: counts.surfaceCount,
            target: safePaginationLimitRef.current,
          });
          preloadSucceeded = true;
          break;
        }

        const firstTimeline = linkedTimelines[0];
        if (!firstTimeline) {
          console.log('[eager-preload] no first timeline, breaking');
          preloadSucceeded = true;
          break;
        }

        let backwardToken = firstTimeline.getPaginationToken(Direction.Backward);
        if (!backwardToken && savedPaginationToken && iterations === 0) {
          console.log('[eager-preload] pagination token was cleared, restoring saved token');
          firstTimeline.setPaginationToken(savedPaginationToken, Direction.Backward);
          backwardToken = savedPaginationToken;
        }
        if (!backwardToken) {
          console.log('[eager-preload] no backward pagination token, breaking');
          logTimelineDebug(roomDebugTraceId, 'eager-preload-no-backward-token', {
            cacheCount: counts.cacheCount,
            iterations,
            renderableCount: counts.renderableCount,
          });
          preloadSucceeded = true;
          break;
        }

        const timelinesEventsCount = linkedTimelines.map(timelineToEventsCount);
        const timelinesRenderableCounts = linkedTimelines.map(
          (tl) =>
            getRenderableEvents(
              [tl],
              filterOpts.room,
              filterOpts.threadId,
              filterOpts.ignoredUsersSet,
              filterOpts.showHiddenEvents,
              filterOpts.hideMembershipEvents,
              filterOpts.hideNickAvatarEvents
            ).length
        );

        roomPaginatingBackRef.current = true;
        try {
          const [err, didPaginate] = await to(
            mx.paginateEventTimeline(firstTimeline, {
              backwards: true,
              limit: BATCH_SIZE,
            })
          );
          if (err) {
            console.log(`[eager-preload] pagination error at iteration ${iterations}:`, err);
            break;
          }
          if (didPaginate === false) {
            console.log(
              `[eager-preload] paginateEventTimeline returned false at iteration ${iterations}`
            );
            preloadSucceeded = true;
            break;
          }

          const fetchedTimeline =
            firstTimeline.getNeighbouringTimeline(Direction.Backward) ?? firstTimeline;
          if (room.hasEncryptionStateEvent()) {
            await to(decryptAllTimelineEvent(mx, fetchedTimeline));
          }

          if (!cancelled && alive() && roomIdRef.current === room.roomId && !threadIdRef.current) {
            recalibrateTimelinePagination(
              setTimeline,
              linkedTimelines,
              timelinesEventsCount,
              true,
              filterOpts,
              timelinesRenderableCounts
            );
          }

          const refreshedLinkedTimelines = getLinkedTimelines(getLiveTimeline(room));
          const refreshedCounts = getRoomPreloadCounts(
            refreshedLinkedTimelines,
            filterOpts.room,
            filterOpts
          );
          const refreshedBackwardToken =
            refreshedLinkedTimelines[0]?.getPaginationToken(Direction.Backward) ?? null;

          const progressed =
            refreshedCounts.cacheCount > counts.cacheCount ||
            refreshedCounts.renderableCount > counts.renderableCount ||
            refreshedCounts.surfaceCount > counts.surfaceCount ||
            refreshedBackwardToken !== backwardToken;

          if (!progressed) {
            stalledBatches += 1;
            console.log(
              `[eager-preload] batch ${iterations + 1}: no progress (cached=${refreshedCounts.cacheCount}, renderable=${refreshedCounts.renderableCount}, surface=${refreshedCounts.surfaceCount}, stalled=${stalledBatches}/${MAX_STALLED_BATCHES})`
            );
            if (stalledBatches >= MAX_STALLED_BATCHES) {
              console.log('[eager-preload] pagination stalled, breaking');
              break;
            }
          } else {
            stalledBatches = 0;
          }

          iterations++;
          console.log(
            `[eager-preload] batch ${iterations}: cached ${refreshedCounts.cacheCount} room events, renderable ${refreshedCounts.renderableCount}, surface ${refreshedCounts.surfaceCount} / ${safePaginationLimitRef.current}`
          );
          logTimelineDebug(roomDebugTraceId, 'eager-preload-batch', {
            backwardTokenChanged: refreshedBackwardToken !== backwardToken,
            cacheCount: refreshedCounts.cacheCount,
            iterations,
            renderableCount: refreshedCounts.renderableCount,
            surfaceCount: refreshedCounts.surfaceCount,
            stalledBatches,
            target: safePaginationLimitRef.current,
          });
        } finally {
          roomPaginatingBackRef.current = false;
        }
      }

      if (!cancelled) {
        setEagerPreloading(false);
        if (preloadSucceeded) {
          eagerPreloadDoneForRoomRef.current = room.roomId;
        }
        const finalLinkedTimelines = getLinkedTimelines(getLiveTimeline(room));
        const finalFilterOpts = recalibrateFilterOptsRef.current;
        const finalCounts = finalFilterOpts
          ? getRoomPreloadCounts(finalLinkedTimelines, finalFilterOpts.room, finalFilterOpts)
          : {
              cacheCount: getTimelinesEventsCount(finalLinkedTimelines),
              renderableCount: getTimelinesEventsCount(finalLinkedTimelines),
              surfaceCount: getTimelinesEventsCount(finalLinkedTimelines),
            };
        console.log(
          `[eager-preload] complete for room ${room.roomId}: ${iterations} batches, ${finalCounts.cacheCount} cached room events, ${finalCounts.renderableCount} renderable events, ${finalCounts.surfaceCount} surface entries`
        );
        logTimelineDebug(roomDebugTraceId, 'eager-preload-complete', {
          cacheCount: finalCounts.cacheCount,
          iterations,
          preloadSucceeded,
          renderableCount: finalCounts.renderableCount,
          surfaceCount: finalCounts.surfaceCount,
        });
      }
    };

    preload();

    return () => {
      cancelled = true;
      setEagerPreloading(false);
    };
  }, [alive, eventId, mx, room, roomDebugTraceId, roomThreadFilterActive, threadId]);

  const persistThreadEventCache = useCallback(
    (
      expectedThreadId: string,
      events: MatrixEvent[],
      rootEvent?: MatrixEvent | null,
      beforeTokenForEarliest?: string | null,
      tailLoaded?: boolean,
      snapshotComplete?: boolean,
      expectedReplyCount?: number,
      relationSnapshotComplete?: boolean
    ) => {
      const loadedReplyCount = buildThreadReplyCountMap(events).get(expectedThreadId) ?? 0;
      const persistedExpectedReplyCount =
        expectedReplyCount ??
        (rootEvent ? getKnownThreadReplyCount(rootEvent) : undefined) ??
        ((snapshotComplete === true || (beforeTokenForEarliest === null && tailLoaded === true))
          ? loadedReplyCount
          : undefined);
      const cacheEvents = withStateTargetEvents(room, rootEvent ? [rootEvent, ...events] : events);
      const rawEvents = serializeEventsForCache(room, cacheEvents);
      const rawRootEvent = rootEvent
        ? rawEvents.find((rawEvent) => rawEvent.event_id === rootEvent.getId())
        : undefined;
      logTimelineDebug(threadDebugTraceId, 'thread-cache-persist', {
        beforeTokenForEarliest: beforeTokenForEarliest ?? null,
        cacheEventCount: cacheEvents.length,
        expectedReplyCount: persistedExpectedReplyCount ?? null,
        loadedReplyCount,
        rawEventCount: rawEvents.length,
        relationSnapshotComplete: relationSnapshotComplete === true,
        rootPresent: !!rootEvent,
        snapshotComplete: snapshotComplete === true,
        tailLoaded: tailLoaded === true,
        threadId: expectedThreadId,
      });
      saveThreadEventsToCache(
        sessionId,
        room.roomId,
        expectedThreadId,
        rawEvents,
        rawRootEvent,
        beforeTokenForEarliest,
        tailLoaded,
        snapshotComplete,
        persistedExpectedReplyCount,
        relationSnapshotComplete
      ).catch(() => undefined);
    },
    [room, sessionId, threadDebugTraceId]
  );

  const persistThreadCacheFromRoomEvents = useCallback(
    (
      events: MatrixEvent[],
      opts?: {
        beforeTokenForEarliest?: string | null;
        roomStartKnown?: boolean;
        roomTailLoaded?: boolean;
        snapshotComplete?: boolean;
        tailLoaded?: boolean;
      }
    ) => {
      const groupedThreadEvents = groupThreadCacheEvents(room, events);
      groupedThreadEvents.forEach((threadEvents, expectedThreadId) => {
        const rootEvent =
          room.getThread(expectedThreadId)?.rootEvent ?? room.findEventById(expectedThreadId);
        const existingThreadSeedEvents = getThreadOpenSeedSnapshot(room, expectedThreadId);
        const roomDerivedThreadSeedEvents = rootEvent
          ? mergeThreadBackfillEvents([rootEvent], threadEvents)
          : threadEvents;
        const nextThreadSeedEvents = mergeThreadBackfillEvents(
          existingThreadSeedEvents,
          roomDerivedThreadSeedEvents
        );
        let beforeTokenForEarliest = opts?.beforeTokenForEarliest;
        let expectedReplyCount: number | undefined;
        let snapshotComplete = opts?.snapshotComplete;
        let tailLoaded = opts?.tailLoaded;

        if (opts?.roomStartKnown !== undefined || opts?.roomTailLoaded !== undefined) {
          const roomDerivedSnapshot = getRoomDerivedThreadSnapshotState({
            room,
            threadId: expectedThreadId,
            rootEvent,
            threadEvents,
            roomStartKnown: opts?.roomStartKnown === true,
            roomTailLoaded: opts?.roomTailLoaded === true,
          });
          beforeTokenForEarliest = roomDerivedSnapshot.beforeTokenForEarliest;
          expectedReplyCount = roomDerivedSnapshot.expectedReplyCount;
          snapshotComplete = roomDerivedSnapshot.snapshotComplete;
          tailLoaded = roomDerivedSnapshot.tailLoaded;
          logTimelineDebug(roomDebugTraceId, 'room-thread-cache-room-snapshot', {
            beforeTokenForEarliest: beforeTokenForEarliest ?? null,
            expectedReplyCount: roomDerivedSnapshot.expectedReplyCount ?? null,
            loadedReplyCount: roomDerivedSnapshot.loadedReplyCount,
            seedCount: nextThreadSeedEvents.length,
            snapshotComplete,
            tailLoaded,
            threadId: expectedThreadId,
          });
        }

        saveThreadOpenSeedSnapshot(room, expectedThreadId, nextThreadSeedEvents);

        persistThreadEventCache(
          expectedThreadId,
          threadEvents,
          rootEvent,
          beforeTokenForEarliest,
          tailLoaded,
          snapshotComplete,
          expectedReplyCount
        );
      });
    },
    [persistThreadEventCache, room, roomDebugTraceId]
  );

  const persistRoomEventCache = useCallback(
    (events: MatrixEvent[], beforeTokenForEarliest?: string | null) => {
      const rawEvents = serializeEventsForCache(
        room,
        withStateTargetEvents(room, events).filter(
          (mEvent) => !isThreadOnlyRoomActivity(room, mEvent)
        )
      );
      logTimelineDebug(roomDebugTraceId, 'room-cache-persist', {
        beforeTokenForEarliest: beforeTokenForEarliest ?? null,
        rawEventCount: rawEvents.length,
        sourceEventCount: events.length,
      });
      saveRoomEventsToCache(sessionId, room.roomId, rawEvents, beforeTokenForEarliest).catch(
        () => undefined
      );
    },
    [room, roomDebugTraceId, sessionId]
  );

  const pendingRoomThreadCacheEventsRef = useRef<MatrixEvent[]>([]);
  const roomThreadCacheFlushQueuedRef = useRef(false);
  const queueRoomThreadCachePersist = useCallback(
    (mEvent: MatrixEvent) => {
      pendingRoomThreadCacheEventsRef.current.push(mEvent);
      if (roomThreadCacheFlushQueuedRef.current) return;
      roomThreadCacheFlushQueuedRef.current = true;
      queueMicrotask(() => {
        roomThreadCacheFlushQueuedRef.current = false;
        const queuedEvents = pendingRoomThreadCacheEventsRef.current;
        pendingRoomThreadCacheEventsRef.current = [];
        if (
          queuedEvents.length === 0 ||
          !alive() ||
          roomIdRef.current !== room.roomId ||
          threadIdRef.current
        ) {
          return;
        }
        persistThreadCacheFromRoomEvents(queuedEvents);
      });
    },
    [alive, persistThreadCacheFromRoomEvents, room.roomId]
  );

  const hydrateThreadFromCache = useCallback(
    async (expectedThreadId: string) => {
      logTimelineDebug(threadDebugTraceId, 'thread-cache-hydrate-start', {
        limit: safePaginationLimitRef.current,
        threadId: expectedThreadId,
      });
      let cachedPage = await loadLatestCachedThreadEvents(
        sessionId,
        room.roomId,
        expectedThreadId,
        safePaginationLimitRef.current
      );
      const mapper = mx.getEventMapper();
      const cachedThreadEvents = [...cachedPage.events];
      let cachedRootEvent = cachedPage.rootEvent;
      let cachedBeforeToken = cachedPage.beforeToken;
      let cachedHasMoreBefore = cachedPage.hasMoreBefore;
      let cachedExpectedReplyCount = cachedPage.expectedReplyCount;
      const cachedSnapshotComplete = cachedPage.snapshotComplete === true;
      const cachedRelationSnapshotComplete = cachedPage.relationSnapshotComplete === true;
      const tailLoaded = cachedPage.tailLoaded === true;

      logTimelineDebug(threadDebugTraceId, 'thread-cache-hydrate-page', {
        beforeToken: cachedPage.beforeToken ?? null,
        cachedCount: cachedPage.events.length,
        expectedReplyCount: cachedExpectedReplyCount ?? null,
        hasMoreBefore: cachedPage.hasMoreBefore,
        pageIndex: 1,
        relationSnapshotComplete: cachedRelationSnapshotComplete,
        rootPresent: !!cachedPage.rootEvent,
        snapshotComplete: cachedSnapshotComplete,
        tailLoaded,
        threadId: expectedThreadId,
      });

      for (
        let pageIndex = 1;
        cachedPage.hasMoreBefore && pageIndex < MAX_THREAD_FETCH_ITERATIONS;
        pageIndex += 1
      ) {
        if (!alive() || threadIdRef.current !== expectedThreadId) return undefined;
        const earliestCachedReply = cachedPage.events[0];
        const beforeAnchor = getThreadCursorAnchor(earliestCachedReply);
        if (!beforeAnchor) break;

        cachedPage = await loadCachedThreadEventsBefore(
          sessionId,
          room.roomId,
          expectedThreadId,
          beforeAnchor,
          safePaginationLimitRef.current
        );
        cachedThreadEvents.unshift(...cachedPage.events);
        cachedRootEvent ??= cachedPage.rootEvent;
        cachedBeforeToken = cachedPage.beforeToken;
        cachedHasMoreBefore = cachedPage.hasMoreBefore;
        cachedExpectedReplyCount = cachedPage.expectedReplyCount ?? cachedExpectedReplyCount;
        logTimelineDebug(threadDebugTraceId, 'thread-cache-hydrate-page', {
          beforeToken: cachedPage.beforeToken ?? null,
          cachedCount: cachedPage.events.length,
          expectedReplyCount: cachedExpectedReplyCount ?? null,
          hasMoreBefore: cachedPage.hasMoreBefore,
          pageIndex: pageIndex + 1,
          relationSnapshotComplete: cachedRelationSnapshotComplete,
          rootPresent: !!cachedPage.rootEvent,
          snapshotComplete: cachedSnapshotComplete,
          tailLoaded,
          threadId: expectedThreadId,
        });
        if (cachedPage.events.length === 0) {
          break;
        }
      }

      if (!alive() || threadIdRef.current !== expectedThreadId) return undefined;

      const cachedEvents = normalizeCachedThreadEvents(cachedThreadEvents, cachedRootEvent).map(
        (rawEvent) => mapper(rawEvent)
      );
      const liveRootMatrixEvent =
        room.getThread(expectedThreadId)?.rootEvent ??
        room.findEventById(expectedThreadId) ??
        undefined;
      const cachedRootMatrixEvent =
        cachedEvents.find((mEvent) => mEvent.getId() === expectedThreadId) ?? undefined;
      const authoritativeExpectedReplyCount = getAuthoritativeCachedThreadReplyCount({
        rootEvent: liveRootMatrixEvent,
        cachedRootEvent: cachedRootMatrixEvent,
        expectedReplyCount: cachedExpectedReplyCount,
      });
      const snapshotComplete = isCompleteCachedThreadSnapshot({
        room,
        threadId: expectedThreadId,
        rootEvent: liveRootMatrixEvent,
        cachedRootEvent: cachedRootMatrixEvent,
        cachedEvents,
        beforeToken: cachedBeforeToken,
        hasMoreBefore: cachedHasMoreBefore,
        expectedReplyCount: authoritativeExpectedReplyCount,
        snapshotComplete: cachedSnapshotComplete,
        tailLoaded,
      });
      const currentThreadTimelineSet = room.getThread(expectedThreadId)?.getUnfilteredTimelineSet();
      const currentFirstThreadTimeline = currentThreadTimelineSet
        ? getLinkedTimelines(currentThreadTimelineSet.getLiveTimeline())[0]
        : undefined;
      const cacheProvesNoBackwardGap =
        snapshotComplete === true && cachedHasMoreBefore === false && cachedBeforeToken == null;
      const hadStaleSdkBackwardToken =
        currentFirstThreadTimeline?.getPaginationToken(Direction.Backward) != null;
      if (cacheProvesNoBackwardGap && currentFirstThreadTimeline && hadStaleSdkBackwardToken) {
        currentFirstThreadTimeline.setPaginationToken(null, Direction.Backward);
        logTimelineDebug(threadDebugTraceId, 'thread-cache-hydrate-clear-backward-gap', {
          threadId: expectedThreadId,
        });
      }
      setThreadHasMoreCachedBack(
        cachedHasMoreBefore || typeof cachedBeforeToken === 'string'
      );
      if (cachedEvents.length === 0) {
        logTimelineDebug(threadDebugTraceId, 'thread-cache-hydrate-empty', {
          tailLoaded,
          threadId: expectedThreadId,
        });
        return {
          ...cachedPage,
          beforeToken: cachedBeforeToken,
          events: cachedThreadEvents,
          hasMoreBefore: cachedHasMoreBefore,
          rootEvent: cachedRootEvent,
          expectedReplyCount: authoritativeExpectedReplyCount,
          relationSnapshotComplete: cachedRelationSnapshotComplete,
          snapshotComplete,
          tailLoaded,
        };
      }

      setSupplementalThreadEvents(expectedThreadId, cachedEvents);
      saveThreadOpenSeedSnapshot(room, expectedThreadId, cachedEvents);
      setTimeline((ct) => ({ ...ct }));
      setThreadTimelineTick((val) => val + 1);
      logTimelineDebug(threadDebugTraceId, 'thread-cache-hydrate-applied', {
        appliedCount: cachedEvents.length,
        expectedReplyCount: authoritativeExpectedReplyCount ?? null,
        hasMoreBefore: cachedHasMoreBefore,
        relationSnapshotComplete: cachedRelationSnapshotComplete,
        snapshotComplete,
        tailLoaded,
        threadId: expectedThreadId,
      });
        return {
          ...cachedPage,
          beforeToken: cachedBeforeToken,
          events: cachedThreadEvents,
          hasMoreBefore: cachedHasMoreBefore,
          rootEvent: cachedRootEvent,
          expectedReplyCount: authoritativeExpectedReplyCount,
          relationSnapshotComplete: cachedRelationSnapshotComplete,
          snapshotComplete,
          tailLoaded,
        };
    },
    [alive, mx, room.roomId, sessionId, setSupplementalThreadEvents, threadDebugTraceId]
  );

  const loadThreadOpenSeedSnapshotFromCache = useCallback(
    async (expectedThreadId: string): Promise<MatrixEvent[]> => {
      let cachedPage = await loadLatestCachedThreadEvents(
        sessionId,
        room.roomId,
        expectedThreadId,
        safePaginationLimitRef.current
      );
      const cachedThreadEvents = [...cachedPage.events];
      let cachedRootEvent = cachedPage.rootEvent;

      for (
        let pageIndex = 1;
        cachedPage.hasMoreBefore && pageIndex < MAX_THREAD_FETCH_ITERATIONS;
        pageIndex += 1
      ) {
        const earliestCachedReply = cachedPage.events[0];
        const beforeAnchor = getThreadCursorAnchor(earliestCachedReply);
        if (!beforeAnchor) break;

        cachedPage = await loadCachedThreadEventsBefore(
          sessionId,
          room.roomId,
          expectedThreadId,
          beforeAnchor,
          safePaginationLimitRef.current
        );
        cachedThreadEvents.unshift(...cachedPage.events);
        cachedRootEvent ??= cachedPage.rootEvent;
        if (cachedPage.events.length === 0) break;
      }

      const mapper = mx.getEventMapper();
      return normalizeCachedThreadEvents(cachedThreadEvents, cachedRootEvent).map((rawEvent) =>
        mapper(rawEvent)
      );
    },
    [mx, room.roomId, sessionId]
  );

  const prewarmedVisibleThreadSeedIdsRef = useRef<Set<string>>(new Set());
  const prewarmingVisibleThreadSeedIdsRef = useRef<Set<string>>(new Set());
  const prewarmingVisibleThreadSeedPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const queuedVisibleThreadSeedIdsRef = useRef<Set<string>>(new Set());
  const visibleThreadSeedPrewarmQueueRef = useRef<string[]>([]);
  const visibleThreadSeedPrewarmRunningRef = useRef(false);
  const visibleThreadSeedPrewarmGenerationRef = useRef(0);
  useEffect(() => {
    visibleThreadSeedPrewarmGenerationRef.current += 1;
    prewarmedVisibleThreadSeedIdsRef.current.clear();
    prewarmingVisibleThreadSeedIdsRef.current.clear();
    prewarmingVisibleThreadSeedPromisesRef.current.clear();
    queuedVisibleThreadSeedIdsRef.current.clear();
    visibleThreadSeedPrewarmQueueRef.current = [];
    visibleThreadSeedPrewarmRunningRef.current = false;
  }, [room.roomId]);

  const ensureThreadSeedPrewarm = useCallback(
    (
      expectedThreadId: string,
      opts?: {
        allowWhileThreadOpen?: boolean;
        generation?: number;
        logPrefix?: string;
        traceId?: string;
      }
    ): Promise<void> => {
      const existingPromise = prewarmingVisibleThreadSeedPromisesRef.current.get(expectedThreadId);
      if (existingPromise) return existingPromise;
      if (prewarmedVisibleThreadSeedIdsRef.current.has(expectedThreadId)) {
        return Promise.resolve();
      }

      const generation = opts?.generation ?? visibleThreadSeedPrewarmGenerationRef.current;
      const traceId = opts?.traceId ?? roomDebugTraceId;
      const logPrefix = opts?.logPrefix ?? 'room-thread-seed-prewarm';
      prewarmingVisibleThreadSeedIdsRef.current.add(expectedThreadId);
      logTimelineDebug(traceId, `${logPrefix}-start`, {
        threadId: expectedThreadId,
      });

      const prewarmPromise = (async () => {
        try {
          const cachedSeedEvents = await loadThreadOpenSeedSnapshotFromCache(expectedThreadId);
          if (generation !== visibleThreadSeedPrewarmGenerationRef.current) return;
          if (!opts?.allowWhileThreadOpen && threadIdRef.current) return;

          if (cachedSeedEvents.length > 0) {
            const nextSeedEvents = mergeThreadBackfillEvents(
              getThreadOpenSeedSnapshot(room, expectedThreadId),
              cachedSeedEvents
            );
            saveThreadOpenSeedSnapshot(room, expectedThreadId, nextSeedEvents);
            logTimelineDebug(traceId, `${logPrefix}-complete`, {
              cachedCount: cachedSeedEvents.length,
              seedCount: nextSeedEvents.length,
              threadId: expectedThreadId,
            });
          } else {
            logTimelineDebug(traceId, `${logPrefix}-empty`, {
              threadId: expectedThreadId,
            });
          }

          prewarmedVisibleThreadSeedIdsRef.current.add(expectedThreadId);
        } catch (error) {
          logTimelineDebug(traceId, `${logPrefix}-error`, {
            error: error instanceof Error ? error.message : String(error),
            threadId: expectedThreadId,
          });
        } finally {
          prewarmingVisibleThreadSeedIdsRef.current.delete(expectedThreadId);
        }
      })();

      prewarmingVisibleThreadSeedPromisesRef.current.set(expectedThreadId, prewarmPromise);
      void prewarmPromise.finally(() => {
        if (prewarmingVisibleThreadSeedPromisesRef.current.get(expectedThreadId) === prewarmPromise) {
          prewarmingVisibleThreadSeedPromisesRef.current.delete(expectedThreadId);
        }
      });

      return prewarmPromise;
    },
    [loadThreadOpenSeedSnapshotFromCache, room, roomDebugTraceId]
  );

  useEffect(() => {
    if (threadId || priorityThreadSeedPrewarmRoots.length === 0) return undefined;

    priorityThreadSeedPrewarmRoots.forEach(({ threadId: expectedThreadId }) => {
      if (prewarmedVisibleThreadSeedIdsRef.current.has(expectedThreadId)) return;
      if (prewarmingVisibleThreadSeedIdsRef.current.has(expectedThreadId)) return;
      if (queuedVisibleThreadSeedIdsRef.current.has(expectedThreadId)) return;
      queuedVisibleThreadSeedIdsRef.current.add(expectedThreadId);
      visibleThreadSeedPrewarmQueueRef.current.push(expectedThreadId);
    });

    if (visibleThreadSeedPrewarmRunningRef.current) return undefined;
    visibleThreadSeedPrewarmRunningRef.current = true;
    const generation = visibleThreadSeedPrewarmGenerationRef.current;

    const prewarmVisibleThreadSeeds = async () => {
      try {
        while (visibleThreadSeedPrewarmQueueRef.current.length > 0) {
          if (generation !== visibleThreadSeedPrewarmGenerationRef.current) return;
          if (threadIdRef.current) return;

          const expectedThreadId = visibleThreadSeedPrewarmQueueRef.current.shift();
          if (!expectedThreadId) continue;
          queuedVisibleThreadSeedIdsRef.current.delete(expectedThreadId);
          if (prewarmedVisibleThreadSeedIdsRef.current.has(expectedThreadId)) continue;
          if (prewarmingVisibleThreadSeedIdsRef.current.has(expectedThreadId)) continue;

          const prewarmPromise = ensureThreadSeedPrewarm(expectedThreadId, {
            generation,
            logPrefix: 'room-thread-seed-prewarm',
            traceId: roomDebugTraceId,
          });

          try {
            await prewarmPromise;
          } finally {
          }
        }
      } finally {
        if (generation === visibleThreadSeedPrewarmGenerationRef.current) {
          visibleThreadSeedPrewarmRunningRef.current = false;
        }
        if (
          generation === visibleThreadSeedPrewarmGenerationRef.current &&
          !threadIdRef.current &&
          visibleThreadSeedPrewarmQueueRef.current.length > 0
        ) {
          queueMicrotask(() => {
            if (visibleThreadSeedPrewarmRunningRef.current) return;
            visibleThreadSeedPrewarmRunningRef.current = true;
            void prewarmVisibleThreadSeeds();
          });
        }
      }
    };

    void prewarmVisibleThreadSeeds();

    return undefined;
  }, [ensureThreadSeedPrewarm, priorityThreadSeedPrewarmRoots, roomDebugTraceId, threadId]);

  const refreshLatestThreadSlice = useCallback(
    async (expectedThreadId: string): Promise<boolean> => {
      const currentThread = room.getThread(expectedThreadId);
      if (!currentThread) return false;

      // Use the SDK's paginateEventTimeline in a loop — the same mechanism used
      // by the working room preload loop and handleThreadPaginateBack.
      // Unlike Thread.addEvents(), paginateEventTimeline uses the SDK's proper
      // timelineSet.addEventsToTimeline() + thread.processEvent() path.
      const threadTimelineSet = currentThread.getUnfilteredTimelineSet();
      for (let iteration = 0; iteration < MAX_THREAD_FETCH_ITERATIONS; iteration++) {
        if (threadIdRef.current !== expectedThreadId) return false;

        const linkedTimelines = getLinkedTimelines(threadTimelineSet.getLiveTimeline());
        const firstTimeline = linkedTimelines[0];
        if (!firstTimeline?.getPaginationToken(Direction.Backward)) break;

        const [err, didPaginate] = await to(
          mx.paginateEventTimeline(firstTimeline, {
            backwards: true,
            limit: THREAD_BATCH_SIZE,
          })
        );
        if (err || didPaginate === false) break;
      }

      if (threadIdRef.current !== expectedThreadId) return false;

      const allEvents = currentThread.events;
      const rootEvent = currentThread.rootEvent ?? room.findEventById(expectedThreadId);
      const firstThreadTimeline = getLinkedTimelines(threadTimelineSet.getLiveTimeline())[0];
      const backwardToken = firstThreadTimeline?.getPaginationToken(Direction.Backward) ?? null;
      const snapshotComplete = isCompleteCachedThreadSnapshot({
        room,
        threadId: expectedThreadId,
        rootEvent: rootEvent ?? undefined,
        cachedRootEvent: rootEvent ?? undefined,
        cachedEvents: rootEvent ? [rootEvent, ...allEvents] : allEvents,
        beforeToken: backwardToken,
        hasMoreBefore: typeof backwardToken === 'string',
        expectedReplyCount: rootEvent ? getKnownThreadReplyCount(rootEvent) : undefined,
        snapshotComplete: typeof backwardToken !== 'string',
        tailLoaded: true,
      });

      if (allEvents.length > 0) {
        setSupplementalThreadEvents(expectedThreadId, allEvents);
        saveThreadOpenSeedSnapshot(room, expectedThreadId, allEvents);
        persistThreadEventCache(
          expectedThreadId,
          allEvents,
          rootEvent,
          backwardToken,
          true,
          snapshotComplete
        );
      }

      if (firstThreadTimeline) {
        reconcileThreadBackwardPagination(
          firstThreadTimeline,
          backwardToken,
          setThreadHasMoreCachedBack
        );
      }

      setTimeline((ct) => ({ ...ct }));
      setThreadTimelineTick((val) => val + 1);
      setThreadTailLoaded(true);
      logTimelineDebug(threadDebugTraceId, 'thread-refresh-latest-complete', {
        snapshotComplete,
        persistedCount: allEvents.length,
        tailLoaded: true,
        threadId: expectedThreadId,
        backwardTokenPresent: typeof backwardToken === 'string',
      });
      return true;
    },
    [mx, persistThreadEventCache, room, setSupplementalThreadEvents, threadDebugTraceId]
  );

  const backfillThreadRelationsIntoCache = useCallback(
    async (
      expectedThreadId: string,
      cachedRootEvent?: Partial<IEvent>,
      baselineEvents: MatrixEvent[] = [],
      expectedReplyCount?: number
    ): Promise<{ completed: boolean; fetchedCount: number } | undefined> => {
      const liveRootEvent =
        room.getThread(expectedThreadId)?.rootEvent ?? room.findEventById(expectedThreadId);
      const mapper = mx.getEventMapper();
      const mappedCachedRootEvent =
        !liveRootEvent && cachedRootEvent ? mapper(cachedRootEvent) : undefined;
      const rootEvent = liveRootEvent ?? mappedCachedRootEvent;
      if (!rootEvent) return undefined;

      logTimelineDebug(threadDebugTraceId, 'thread-relations-backfill-start', {
        threadId: expectedThreadId,
      });

      const relationPageResult = await fetchAllThreadRelations(
        mx,
        room.roomId,
        expectedThreadId,
        THREAD_BATCH_SIZE,
        () => !alive() || threadIdRef.current !== expectedThreadId
      );
      if (!relationPageResult || !alive() || threadIdRef.current !== expectedThreadId) {
        return undefined;
      }

      const relationSnapshotComplete = typeof relationPageResult.nextBatchToken !== 'string';
      const mergedEvents = mergeThreadBackfillEvents(baselineEvents, relationPageResult.events);
      const snapshotComplete = isCompleteCachedThreadSnapshot({
        room,
        threadId: expectedThreadId,
        rootEvent: liveRootEvent,
        cachedRootEvent: mappedCachedRootEvent,
        cachedEvents: mergedEvents,
        beforeToken: relationPageResult.nextBatchToken ?? null,
        hasMoreBefore: typeof relationPageResult.nextBatchToken === 'string',
        expectedReplyCount,
        snapshotComplete: relationSnapshotComplete,
        tailLoaded: true,
      });
      const currentThreadTimelineSet = room.getThread(expectedThreadId)?.getUnfilteredTimelineSet();
      const firstThreadTimeline = currentThreadTimelineSet
        ? getLinkedTimelines(currentThreadTimelineSet.getLiveTimeline())[0]
        : undefined;
      const hadStaleSdkBackwardToken =
        firstThreadTimeline?.getPaginationToken(Direction.Backward) != null;
      if (snapshotComplete && firstThreadTimeline && hadStaleSdkBackwardToken) {
        firstThreadTimeline.setPaginationToken(null, Direction.Backward);
        logTimelineDebug(threadDebugTraceId, 'thread-relations-backfill-clear-backward-gap', {
          threadId: expectedThreadId,
        });
      }
      setSupplementalThreadEvents(expectedThreadId, mergedEvents);
      saveThreadOpenSeedSnapshot(room, expectedThreadId, mergedEvents);
      persistThreadEventCache(
        expectedThreadId,
        mergedEvents,
        rootEvent,
        relationPageResult.nextBatchToken ?? null,
        true,
        snapshotComplete,
        expectedReplyCount,
        relationSnapshotComplete
      );
      setThreadHasMoreCachedBack(typeof relationPageResult.nextBatchToken === 'string');
      setThreadTailLoaded(true);
      setTimeline((ct) => ({ ...ct }));
      setThreadTimelineTick((val) => val + 1);
      logTimelineDebug(threadDebugTraceId, 'thread-relations-backfill-complete', {
        fetchedCount: relationPageResult.events.length,
        mergedCount: mergedEvents.length,
        relationSnapshotComplete,
        snapshotComplete,
        threadId: expectedThreadId,
        nextBatchPresent: typeof relationPageResult.nextBatchToken === 'string',
      });

      return {
        completed: snapshotComplete,
        fetchedCount: relationPageResult.events.length,
      };
    },
    [
      alive,
      mx,
      persistThreadEventCache,
      room,
      setSupplementalThreadEvents,
      threadDebugTraceId,
    ]
  );

  const getScrollElement = useCallback(() => scrollRef.current, []);

  const {
    getItems,
    scrollToItem,
    scrollToElement,
    retryPagination,
    observeBackAnchor,
    observeFrontAnchor,
  } =
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
          canFocus,
        } = anchor
          ? getRoomEventFocusTarget({
              eventId: anchor.eventId,
              renderableEvents: loadedRenderableEvents,
              room,
              threadResolutionMap,
              threadId,
              threadFilterState: threadFilterStateRef.current,
              threadReplyCountMap: loadedThreadReplyCountMap,
              scheduledTaskCounts,
              threadReplyCountMapForMeta: threadReplyCountMap,
              threadParticipantMap,
              summaryMap: threadSummaryInfoMap,
              currentUserId: mx.getSafeUserId(),
              readUpToTs,
            })
          : {
              index: 0,
              count: loadedRenderableEvents.length,
              canFocus: false,
            };

        setFocusItem(
          anchor && canFocus
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
        mx,
        threadId,
        threadResolutionMap,
        room,
        ignoredUsersSet,
        showHiddenEvents,
        hideMembershipEvents,
        hideNickAvatarEvents,
        scheduledTaskCounts,
        threadReplyCountMap,
        threadParticipantMap,
        threadSummaryInfoMap,
        readUpToTs,
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
      (mEvt: MatrixEvent, timelineMeta: TimelineArriveMeta) => {
        const mEventId = mEvt.getId();
        const relation = mEvt.getRelation();
        const relationTargetId = relation?.event_id;
        const liveExpandOnceId = getLiveCollapsibleMessageExpandId({
          mEvent: mEvt,
          room,
          threadId,
          threadFilterState,
          threadResolutionMap,
          ignoredUsersSet,
          showHiddenEvents,
          hideMembershipEvents,
          hideNickAvatarEvents,
        });
        const isThreadOnlyActivity = isThreadOnlyRoomActivity(room, mEvt);
        const threadCacheTargetId = getThreadCacheTargetId(room, mEvt);
        const isVisibleThreadActivity =
          mEventId === threadId ||
          eventBelongsToThread(mEvt, threadId ?? '') ||
          !!(relationTargetId && threadEventIndexMapRef.current.has(relationTargetId));
        if (liveExpandOnceId) {
          liveExpandOnceIds.current.add(liveExpandOnceId);
        }

        if (!timelineMeta.liveEvent) {
          if (!threadId && threadCacheTargetId) {
            queueRoomThreadCachePersist(mEvt);
            logTimelineDebug(roomDebugTraceId, 'room-thread-cache-persist-paginated', {
              eventId: mEventId ?? null,
              threadId: threadCacheTargetId,
              toStartOfTimeline: timelineMeta.toStartOfTimeline,
            });
          }
          return;
        }

        if (threadId) {
          if (isVisibleThreadActivity) {
            // Only add non-edit events to supplemental thread events.
            // m.replace edits modify existing events in-place (via makeReplaced)
            // and are filtered by reactionOrEditEvent() during rendering.
            // Adding them inflates threadEvents with non-renderable entries (CINNY-031).
            if (relation?.rel_type !== RelationType.Replace) {
              setSupplementalThreadEvents(threadId, [mEvt]);
            }
            persistThreadEventCache(
              threadId,
              [mEvt],
              room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId),
              undefined,
              atLiveEndRef.current
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
              } else if (atLiveEndRef.current && isNearBottom) {
                // Use only fresh scroll measurement, not debounced atBottomRef,
                // to prevent streaming edits from trapping user at bottom (CINNY-031).
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
        if (threadCacheTargetId) {
          persistThreadCacheFromRoomEvents([mEvt], {
            tailLoaded: true,
          });
        }
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

        // Use a fresh scroll-position measurement instead of the debounced
        // atBottomRef to decide whether to auto-follow.  The debounced state
        // can be stale-true for up to 1 s after the user scrolls away, which
        // causes streaming m.replace edits to trap the user at the bottom
        // (CINNY-031).
        const shouldAutoFollow = shouldAutoScrollRoomOnLiveEvent({
          scrollElement: scrollRef.current,
          isTimelineAtLiveEnd: atLiveEndRef.current,
        });

        if (shouldAutoFollow) {
          if (document.hasFocus() && (!unreadInfo || mEvt.getSender() === mx.getUserId())) {
            requestAnimationFrame(() =>
              markMainTimelineAsRead(mx, mEvt.getRoomId()!, hideActivity)
            );
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
        persistThreadCacheFromRoomEvents,
        persistThreadEventCache,
        queueRoomThreadCachePersist,
        room,
        roomDebugTraceId,
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
        threadFilterState,
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
      const threadCacheEvents = currentLinkedTimelines.flatMap((timeline) =>
        timeline.getEvents().filter((mEvent) => !!getThreadCacheTargetId(room, mEvent))
      );
      const earliestLoadedEvent = findEarliestLoadedRoomEventByCacheOrder(cacheEvents);
      const firstTimeline = currentLinkedTimelines[0];
      const lastTimeline = currentLinkedTimelines[currentLinkedTimelines.length - 1];
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
      persistThreadCacheFromRoomEvents(threadCacheEvents, {
        roomStartKnown:
          firstTimeline?.getPaginationToken(Direction.Backward) === null || cachedBeforeToken === null,
        roomTailLoaded: !lastTimeline?.getPaginationToken(Direction.Forward),
      });
    };

    persistCurrentRoomCache();

    return () => {
      cancelled = true;
    };
  }, [
    alive,
    eventsLength,
    persistRoomEventCache,
    persistThreadCacheFromRoomEvents,
    room,
    sessionId,
    threadId,
    timeline.linkedTimelines,
  ]);

  useEffect(() => {
    if (threadId || eventId) return undefined;

    let cancelled = false;
    const hydrateRoomFromCache = async () => {
      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-start', {
        limit: safePaginationLimit,
      });
      const cachedPage = await loadLatestCachedRoomEvents(
        sessionId,
        room.roomId,
        safePaginationLimit
      );

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      const currentLinkedTimelines = getLinkedTimelines(getLiveTimeline(room));
      const loadedRoomEvents = getMainTimelineCacheEvents(room, currentLinkedTimelines);
      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-page', {
        cachedCount: cachedPage.events.length,
        hasMoreBefore: cachedPage.hasMoreBefore,
        loadedRoomCount: loadedRoomEvents.length,
      });

      if (
        !shouldHydrateLatestRoomCache(
          getLatestLoadedRoomEvent(room, currentLinkedTimelines)?.event as Partial<IEvent> | undefined,
          cachedPage.events[cachedPage.events.length - 1]
        )
      ) {
        logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-skip-latest-already-loaded', {
          cachedCount: cachedPage.events.length,
          loadedRoomCount: loadedRoomEvents.length,
        });
        return;
      }

      const mapper = mx.getEventMapper();
      const cachedEvents = normalizeCachedRoomEvents(
        filterLatestRoomCacheHydrationEvents(cachedPage.events, loadedRoomEvents)
      ).map((rawEvent) => mapper(rawEvent));
      if (cachedEvents.length === 0) {
        logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-empty-after-filter', {
          cachedCount: cachedPage.events.length,
          loadedRoomCount: loadedRoomEvents.length,
        });
        return;
      }

      hydrateCachedEvents({
        room,
        events: cachedEvents,
      });

      const liveTimeline = getLiveTimeline(room);
      const timelineWasEmpty = liveTimeline.getEvents().length === 0;
      await room.addLiveEvents(cachedEvents, {
        fromCache: true,
        timelineWasEmpty,
        addToState: false,
      });
      mx.processAggregatedTimelineEvents(room, cachedEvents);

      if (room.hasEncryptionStateEvent()) {
        await to(decryptAllTimelineEvent(mx, liveTimeline));
      }

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;
      setTimeline(getInitialTimeline(room, safePaginationLimitRef.current, {
        threadId: undefined,
        ignoredUsersSet: recalibrateFilterOptsRef.current?.ignoredUsersSet ?? new Set(),
        showHiddenEvents: recalibrateFilterOptsRef.current?.showHiddenEvents ?? false,
        hideMembershipEvents: recalibrateFilterOptsRef.current?.hideMembershipEvents ?? false,
        hideNickAvatarEvents: recalibrateFilterOptsRef.current?.hideNickAvatarEvents ?? false,
      }));
      scrollToBottomRef.current.count += 1;
      scrollToBottomRef.current.smooth = false;
      setAtBottom(true);
      logTimelineDebug(roomDebugTraceId, 'room-cache-hydrate-complete', {
        hydratedCount: cachedEvents.length,
        timelineWasEmpty,
      });
    };

    hydrateRoomFromCache().catch((error) => {
      console.error('Failed to hydrate latest room cache for', room.roomId, error);
    }).finally(() => {
      // On re-entry (preload already done for this room), clear eagerPreloading
      // regardless of whether cache hydration ran. On initial mount the preload
      // effect handles clearing it, so only clear when preload is already done.
      if (!cancelled && eagerPreloadDoneForRoomRef.current === room.roomId) {
        setEagerPreloading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [alive, eventId, mx, room, roomDebugTraceId, safePaginationLimit, sessionId, threadId]);

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
        setTimeline(getEmptyTimeline());
        await loadEventTimeline(evtId);
      }
    },
    [
      alive,
      mx,
      room,
      threadReplyCountMap,
      scrollToItem,
      scrollToElement,
      loadEventTimeline,
      threadId,
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
      requestAnimationFrame(() => markMainTimelineAsRead(mx, room.roomId, hideActivity));
      return;
    }
    const evtTimeline = getEventTimeline(room, readUptoEventId);
    const latestTimeline = evtTimeline && getFirstLinkedTimeline(evtTimeline, Direction.Forward);
    if (latestTimeline === room.getLiveTimeline()) {
      requestAnimationFrame(() => markMainTimelineAsRead(mx, room.roomId, hideActivity));
    }
  }, [mx, room, hideActivity]);

  const tryAutoMarkThreadAsRead = useCallback(() => {
    if (
      !threadId ||
      threadTailLoaded === false ||
      threadInitialRenderMode === 'loading' ||
      threadEvents.length === 0
    ) {
      return;
    }

    requestAnimationFrame(() => markThreadAsRead(mx, room.roomId, threadId, hideActivity));
  }, [
    hideActivity,
    mx,
    room.roomId,
    threadEvents.length,
    threadId,
    threadInitialRenderMode,
    threadTailLoaded,
  ]);

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
          if (document.hasFocus()) {
            if (threadId) {
              tryAutoMarkThreadAsRead();
            } else {
              tryAutoMarkAsRead();
            }
          }
        }
      },
      [debounceSetAtBottom, threadId, tryAutoMarkAsRead, tryAutoMarkThreadAsRead]
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
        if (inFocus && atBottomRef.current) {
          if (threadId) {
            if (atLiveEndRef.current) {
              tryAutoMarkThreadAsRead();
            }
            return;
          }
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
      [handleOpenEvent, threadId, tryAutoMarkAsRead, tryAutoMarkThreadAsRead, unreadInfo]
    )
  );

  useEffect(() => {
    if (
      !threadId ||
      !atBottom ||
      !timelineAtLiveEnd ||
      !threadTailLoaded ||
      threadInitialRenderMode === 'loading' ||
      threadEvents.length === 0 ||
      !document.hasFocus()
    ) {
      return;
    }

    tryAutoMarkThreadAsRead();
  }, [
    atBottom,
    threadEvents.length,
    threadId,
    threadInitialRenderMode,
    threadTailLoaded,
    timelineAtLiveEnd,
    tryAutoMarkThreadAsRead,
  ]);

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
    const shouldScrollToLatestOnOpen = !eventId;
    const initialRoomThreadEvents = getLoadedRoomThreadEvents(room, threadId);
    const hasInitialRoomThreadReplies = initialRoomThreadEvents.some((mEvent) => {
      const eventId = mEvent.getId();
      return !!eventId && eventId !== threadId;
    });
    const initialThreadMemorySeedEvents = shouldScrollToLatestOnOpen
      ? getThreadOpenSeedSnapshot(room, threadId)
      : [];
    const initialThreadModelSeedEvents = shouldScrollToLatestOnOpen
      ? getLoadedThreadModelSeedEvents(room, threadId)
      : [];
    const initialRoomThreadSeedEvents = hasInitialRoomThreadReplies
      ? getLoadedRoomThreadSeedEvents(room, threadId)
      : [];
    const buildUntargetedThreadSeedEvents = (memorySeedEvents: MatrixEvent[]) =>
      shouldScrollToLatestOnOpen
        ? mergeThreadBackfillEvents(
            memorySeedEvents,
            mergeThreadBackfillEvents(initialThreadModelSeedEvents, initialRoomThreadSeedEvents)
          )
        : [];
    const initialUntargetedThreadSeedEvents = buildUntargetedThreadSeedEvents(
      initialThreadMemorySeedEvents
    );
    logTimelineDebug(threadDebugTraceId, 'thread-open-seed-scan', {
      localThreadMemorySeedCount: initialThreadMemorySeedEvents.length,
      localThreadModelSeedCount: initialThreadModelSeedEvents.length,
      mergedSeedVisibleCount: initialUntargetedThreadSeedEvents.filter(
        (mEvent) => !reactionOrEditEvent(mEvent) && !mEvent.isRedaction()
      ).length,
      mergedSeedCount: initialUntargetedThreadSeedEvents.length,
      seedRelationCount: Math.max(0, initialRoomThreadSeedEvents.length - initialRoomThreadEvents.length),
      seedVisibleCount: initialRoomThreadEvents.length,
      threadId,
    });
    let untargetedThreadSeedApplied = false;
    let untargetedThreadSeedFallbackTimeout: ReturnType<typeof setTimeout> | undefined;
    const shouldAwaitRoomPrewarm =
      shouldScrollToLatestOnOpen &&
      (prewarmedVisibleThreadSeedIdsRef.current.has(threadId) ||
        prewarmingVisibleThreadSeedIdsRef.current.has(threadId) ||
        queuedVisibleThreadSeedIdsRef.current.has(threadId));
    const threadSeedPrewarmPromise = shouldAwaitRoomPrewarm
      ? prewarmingVisibleThreadSeedPromisesRef.current.get(threadId) ??
        ensureThreadSeedPrewarm(threadId, {
          allowWhileThreadOpen: true,
          logPrefix: 'thread-open-room-prewarm',
          traceId: threadDebugTraceId,
        })
      : undefined;
    const applyInitialUntargetedThreadSeed = (
      memorySeedEvents: MatrixEvent[],
      source: 'initial' | 'room-prewarm'
    ): boolean => {
      if (untargetedThreadSeedApplied) return true;
      if (hasInitialRoomThreadReplies) {
        hydrateCachedEvents({
          room,
          events: initialRoomThreadSeedEvents,
          timelineSets: [roomTimelineSet],
        });
      }
      const nextUntargetedThreadSeedEvents = buildUntargetedThreadSeedEvents(memorySeedEvents);
      if (nextUntargetedThreadSeedEvents.length === 0) return false;
      untargetedThreadSeedApplied = true;
      setSupplementalThreadEvents(threadId, nextUntargetedThreadSeedEvents);
      logTimelineDebug(threadDebugTraceId, 'thread-open-live-seed-applied', {
        memorySeedCount: memorySeedEvents.length,
        modelSeedVisibleCount: initialThreadModelSeedEvents.length,
        roomSeedVisibleCount: initialRoomThreadEvents.length,
        seedCount: nextUntargetedThreadSeedEvents.length,
        source,
        threadId,
      });
      return true;
    };
    const applyInitialRoomThreadSeed = () => {
      if (!hasInitialRoomThreadReplies) return;
      hydrateCachedEvents({
        room,
        events: initialRoomThreadSeedEvents,
        timelineSets: [roomTimelineSet],
      });
      setSupplementalThreadEvents(threadId, initialRoomThreadEvents);
      logTimelineDebug(threadDebugTraceId, 'thread-open-seed-applied', {
        seedRelationCount: Math.max(0, initialRoomThreadSeedEvents.length - initialRoomThreadEvents.length),
        seedVisibleCount: initialRoomThreadEvents.length,
        threadId,
      });
    };
    let mounted = true;
    if (shouldScrollToLatestOnOpen) {
      const maybeApplyPrewarmedUntargetedThreadSeed = () => {
        const prewarmedMemorySeedEvents = getThreadOpenSeedSnapshot(room, threadId);
        if (prewarmedMemorySeedEvents.length > initialThreadMemorySeedEvents.length) {
          return applyInitialUntargetedThreadSeed(prewarmedMemorySeedEvents, 'room-prewarm');
        }
        return false;
      };
      if (threadSeedPrewarmPromise) {
        logTimelineDebug(threadDebugTraceId, 'thread-open-awaiting-room-prewarm', {
          threadId,
        });
        untargetedThreadSeedFallbackTimeout = setTimeout(() => {
          if (!mounted || threadIdRef.current !== threadId) return;
          if (maybeApplyPrewarmedUntargetedThreadSeed()) return;
          applyInitialUntargetedThreadSeed(initialThreadMemorySeedEvents, 'initial');
        }, THREAD_OPEN_PREWARM_WAIT_MS);
        void threadSeedPrewarmPromise.finally(() => {
          if (untargetedThreadSeedFallbackTimeout !== undefined) {
            clearTimeout(untargetedThreadSeedFallbackTimeout);
            untargetedThreadSeedFallbackTimeout = undefined;
          }
          if (!mounted || threadIdRef.current !== threadId) return;
          if (maybeApplyPrewarmedUntargetedThreadSeed()) return;
          applyInitialUntargetedThreadSeed(initialThreadMemorySeedEvents, 'initial');
        });
      } else {
        if (!maybeApplyPrewarmedUntargetedThreadSeed()) {
          applyInitialUntargetedThreadSeed(initialThreadMemorySeedEvents, 'initial');
        }
      }
    }
    if (!shouldScrollToLatestOnOpen) {
      applyInitialRoomThreadSeed();
    }
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
        const cachedThreadHasLocalSnapshot =
          !!hydratedCachedPage &&
          (hydratedCachedPage.events.length > 0 || !!hydratedCachedPage.rootEvent);
        if (shouldScrollToLatestOnOpen && !cachedThreadHasLocalSnapshot) {
          applyInitialUntargetedThreadSeed(initialThreadMemorySeedEvents, 'initial');
        }
        setThreadInitialCacheHydrated(true);
        const hasCompleteCachedThreadSnapshot =
          shouldScrollToLatestOnOpen &&
          !!hydratedCachedPage &&
          hydratedCachedPage.snapshotComplete === true &&
          hydratedCachedPage.relationSnapshotComplete === true &&
          hydratedCachedPage.beforeToken == null &&
          hydratedCachedPage.hasMoreBefore === false &&
          (hydratedCachedPage.events.length > 0 || !!hydratedCachedPage.rootEvent);

        if (hasCompleteCachedThreadSnapshot && hydratedCachedPage) {
          const firstThreadLiveTimeline = room
            .getThread(threadId)
            ?.getUnfilteredTimelineSet()
            .getLiveTimeline();
          const firstThreadTimeline = firstThreadLiveTimeline
            ? getLinkedTimelines(firstThreadLiveTimeline)[0]
            : undefined;
          firstThreadTimeline?.setPaginationToken(null, Direction.Backward);
          setThreadHasMoreCachedBack(false);
          setThreadTailLoaded(true);
          setTimeline((ct) => ({ ...ct }));
          setThreadTimelineTick((val) => val + 1);
          logTimelineDebug(threadDebugTraceId, 'thread-open-complete-cache-hit', {
            cachedCount: hydratedCachedPage.events.length,
            threadId,
          });
          logTimelineDebug(threadDebugTraceId, 'thread-open-complete', {
            shouldScrollToLatestOnOpen,
            skipNetworkBootstrap: true,
            threadId,
          });
          scrollToBottomRef.current.count += 1;
          scrollToBottomRef.current.smooth = false;
          setAtBottom(true);
          return;
        }

        const canBackfillThreadRelations =
          shouldScrollToLatestOnOpen &&
          !!hydratedCachedPage &&
          (hydratedCachedPage.snapshotComplete !== true ||
            hydratedCachedPage.relationSnapshotComplete !== true) &&
          (hydratedCachedPage.events.length > 0 || !!hydratedCachedPage.rootEvent);
        if (canBackfillThreadRelations && hydratedCachedPage) {
          const mapper = mx.getEventMapper();
          const cachedSnapshotEvents = normalizeCachedThreadEvents(
            hydratedCachedPage.events,
            hydratedCachedPage.rootEvent
          ).map((rawEvent) => mapper(rawEvent));
          const baselineBackfillEvents =
            initialRoomThreadSeedEvents.length > 0
              ? mergeThreadBackfillEvents(cachedSnapshotEvents, initialRoomThreadSeedEvents)
              : cachedSnapshotEvents;
          const relationBackfill = await backfillThreadRelationsIntoCache(
            threadId,
            hydratedCachedPage.rootEvent,
            baselineBackfillEvents,
            hydratedCachedPage.expectedReplyCount
          );
          if (!mounted || threadIdRef.current !== threadId) return;
          if (relationBackfill?.completed) {
            logTimelineDebug(threadDebugTraceId, 'thread-open-complete', {
              completedBy: 'relations-backfill',
              shouldScrollToLatestOnOpen,
              skipNetworkBootstrap: true,
              threadId,
            });
            scrollToBottomRef.current.count += 1;
            scrollToBottomRef.current.smooth = false;
            setAtBottom(true);
            return;
          }
        }

        // First, ensure the thread exists in the SDK.
        // room.getThread() may return null if the SDK hasn't seen the thread yet.
        // We need to fetch the root event and let the SDK create the Thread object.
        let threadModel = room.getThread(threadId);
        if (!threadModel) {
          // Fetch the thread root event to make the SDK aware of this thread
          const [ctxErr] = await to(mx.getEventTimeline(room.getUnfilteredTimelineSet(), threadId));
          if (!mounted) return;
          if (ctxErr) {
            logTimelineDebug(threadDebugTraceId, 'thread-sdk-bootstrap-context-error', {
              threadId,
            });
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
            logTimelineDebug(threadDebugTraceId, 'thread-sdk-bootstrap-relations-error', {
              threadId,
            });
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
            // Reconcile backward pagination even without a Thread model so
            // stale cached threadHasMoreCachedBack doesn't show a bogus button.
            reconcileThreadBackwardPagination(
              undefined,
              relData.next_batch ?? null,
              setThreadHasMoreCachedBack
            );
            logTimelineDebug(threadDebugTraceId, 'thread-sdk-bootstrap-relations-fallback', {
              mappedCount: mappedEvents.length,
              nextBatchPresent: typeof relData.next_batch === 'string',
              threadId,
            });
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
            logTimelineDebug(threadDebugTraceId, 'thread-sdk-bootstrap-get-thread-timeline-error', {
              threadId,
            });
          }
          const firstThreadTimeline = getLinkedTimelines(
            loadedThreadTimelineSet.getLiveTimeline()
          )[0];
          const cachedEarliestAnchor = getThreadCursorAnchor(hydratedCachedPage?.events[0]);
          const earliestThreadReply = findEarliestLoadedThreadReplyByCacheOrder(threadModel.events, threadId);
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
              logTimelineDebug(threadDebugTraceId, 'thread-sdk-bootstrap-empty-thread-relations-fill', {
                mappedCount: mappedEvents.length,
                nextBatchPresent: typeof relData.next_batch === 'string',
                threadId,
              });
            }
          }
          logTimelineDebug(threadDebugTraceId, 'thread-sdk-bootstrap-ready', {
            rootPresent: !!threadModel.rootEvent,
            sdkEventCount: threadModel.events.length,
            threadId,
          });
          persistThreadEventCache(
            threadId,
            threadModel.events,
            threadModel.rootEvent,
            firstThreadTimeline?.getPaginationToken(Direction.Backward)
          );

          // Reconcile backward pagination using the SDK token directly,
          // avoiding the async race from persist→read-back through IndexedDB.
          if (firstThreadTimeline) {
            const sdkBackwardToken =
              firstThreadTimeline.getPaginationToken(Direction.Backward) ?? null;
            reconcileThreadBackwardPagination(
              firstThreadTimeline,
              sdkBackwardToken,
              setThreadHasMoreCachedBack
            );
          }
        } else {
          console.warn('Could not create thread object for', threadId);
          logTimelineDebug(threadDebugTraceId, 'thread-sdk-bootstrap-missing-thread-model', {
            threadId,
          });
        }

        if (shouldScrollToLatestOnOpen) {
          await refreshLatestThreadSlice(threadId);
          if (!mounted || threadIdRef.current !== threadId) return;
        } else {
          // Targeted open (permalink/search jump): fetch authoritative backward
          // pagination state from server to clear stale cached tokens on short
          // threads that would otherwise show a spurious "Load Older Messages".
          const currentThread = room.getThread(threadId);
          if (currentThread) {
            const [relErr, relData] = await to(
              mx.fetchRelations(room.roomId, threadId, 'm.thread' as any, null, {
                dir: Direction.Backward,
                limit: THREAD_BATCH_SIZE,
              })
            );
            if (!mounted || threadIdRef.current !== threadId) return;
            if (!relErr && relData) {
              // Merge fetched latest slice into the live thread before trusting
              // relData.next_batch, matching the refreshLatestThreadSlice flow.
              const mapper = mx.getEventMapper();
              const latestEvents = relData.chunk
                .slice()
                .reverse()
                .map((rawEvent: Parameters<typeof mapper>[0]) => mapper(rawEvent));
              if (latestEvents.length > 0) {
                currentThread.addEvents(latestEvents, false);
                setSupplementalThreadEvents(threadId, latestEvents);
              }

              const currentFirstTimeline = getLinkedTimelines(
                currentThread.getUnfilteredTimelineSet().getLiveTimeline()
              )[0];
              // Persist only the fetched slice (not full currentThread.events)
              // to avoid mis-keying the pagination token to an older reply.
              persistThreadEventCache(
                threadId,
                latestEvents,
                currentThread.rootEvent,
                relData.next_batch ?? null
              );

              // Reconcile using in-memory values directly, avoiding
              // the async race from persist→read-back through IndexedDB.
              if (currentFirstTimeline) {
                const reconcileToken = computeReconciliationToken(
                  relData.next_batch ?? null,
                  latestEvents,
                  currentThread.events,
                  threadId
                );
                reconcileThreadBackwardPagination(
                  currentFirstTimeline,
                  reconcileToken,
                  setThreadHasMoreCachedBack
                );
              }
            }
          }

          const hasForwardGap = !!room
            .getThread(threadId)
            ?.getUnfilteredTimelineSet()
            .getLiveTimeline()
            .getPaginationToken(Direction.Forward);
          if (!hasForwardGap) {
            setThreadTailLoaded(true);
          }
          logTimelineDebug(threadDebugTraceId, 'thread-open-forward-gap-check', {
            hasForwardGap,
            threadId,
          });
        }

        setTimeline((ct) => ({ ...ct }));
        setThreadTimelineTick((val) => val + 1);
        logTimelineDebug(threadDebugTraceId, 'thread-open-complete', {
          shouldScrollToLatestOnOpen,
          threadId,
        });
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
      if (untargetedThreadSeedFallbackTimeout !== undefined) {
        clearTimeout(untargetedThreadSeedFallbackTimeout);
      }
    };
  }, [
    ensureThreadSeedPrewarm,
    eventId,
    hydrateThreadFromCache,
    mx,
    backfillThreadRelationsIntoCache,
    persistThreadEventCache,
    resetThreadRenderState,
    refreshLatestThreadSlice,
    room,
    setSupplementalThreadEvents,
    threadDebugTraceId,
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
  }, [focusItem, threadFilterState, threadId]);

  // scroll to focused message
  useLayoutEffect(() => {
    let clearFocusTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let roomFocusObserver: MutationObserver | undefined;
    let roomFocusObserverTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let roomFocusResizeCleanup: (() => void) | undefined;
    let allowObserverPaginationHandoff = true;
    const focusEventId = focusItem?.eventId;
    const focusIndex =
      !threadId && focusItem
        ? getFocusedRoomEventIndex(threadFilteredEventsRef.current, focusEventId, focusItem.index)
        : focusItem?.index ?? 0;
    const focusItemCount = threadFilteredEventsRef.current.length;
    const focusScrollToItemOptions = getRoomFocusScrollToItemOptions(focusIndex, focusItemCount);
    const focusScrollOptions = getRoomFocusScrollOptions(focusIndex, focusItemCount);

    const clearPendingRoomFocus = (resumePagination: boolean) => {
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

      if (resumePagination) {
        retryPagination({
          preserveAnchorIndex: focusIndex,
        });
      }
    };

    const startRoomFocusObserver = (target: HTMLElement) => {
      const scrollContainer = scrollRef.current;
      if (!scrollContainer) {
        clearPendingRoomFocus(true);
        return;
      }

      roomFocusResizeCleanup = setupFocusObserver({
        scrollContainer,
        target,
        onRecenter: () => {
          scrollToElement(target, focusScrollOptions);
        },
        onDone: () => {
          roomFocusResizeCleanup = undefined;
          if (!allowObserverPaginationHandoff) return;
          clearPendingRoomFocus(true);
        },
        idleMs: ROOM_FOCUS_OBSERVER_IDLE_MS,
        hardMs: ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS,
      });
    };

    if (!threadId && focusItem && focusItem.scrollTo) {
      suppressFocusPaginationRef.current = true;

      scrollToItem(focusIndex, focusScrollToItemOptions);
      const target = focusEventId ? getEventElementById(scrollRef.current, focusEventId) : null;

      if (target) {
        scrollToElement(target, focusScrollOptions);
        startRoomFocusObserver(target);
      } else if (focusEventId && scrollRef.current && typeof MutationObserver !== 'undefined') {
        pendingRoomFocusRef.current = {
          eventId: focusEventId,
        };
        roomFocusObserver = new MutationObserver(() => {
          if (!alive()) {
            clearPendingRoomFocus(false);
            return;
          }

          if (pendingRoomFocusRef.current?.eventId !== focusEventId) return;

          const observedTarget = getEventElementById(scrollRef.current, focusEventId);
          if (!observedTarget) return;

          scrollToElement(observedTarget, focusScrollOptions);
          roomFocusObserver?.disconnect();
          roomFocusObserver = undefined;
          if (roomFocusObserverTimeoutId !== undefined) {
            clearTimeout(roomFocusObserverTimeoutId);
            roomFocusObserverTimeoutId = undefined;
          }
          startRoomFocusObserver(observedTarget);
        });
        roomFocusObserver.observe(scrollRef.current, {
          childList: true,
          subtree: true,
        });
        roomFocusObserverTimeoutId = setTimeout(() => {
          if (pendingRoomFocusRef.current?.eventId !== focusEventId) return;
          clearPendingRoomFocus(false);
        }, ROOM_FOCUS_OBSERVER_HARD_TIMEOUT_MS);
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
      allowObserverPaginationHandoff = false;
      roomFocusResizeCleanup?.();
      roomFocusResizeCleanup = undefined;
      clearPendingRoomFocus(false);
      if (clearFocusTimeoutId !== undefined) {
        clearTimeout(clearFocusTimeoutId);
      }
    };
  }, [alive, focusItem, retryPagination, scrollToElement, scrollToItem, threadFilterState, threadId]);

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
    if (!timelineAtLiveEnd) {
      setAtBottom(false);
    } else {
      // Recovery: when timelineAtLiveEnd becomes true and the bottom anchor
      // is already visible, restore atBottom so the jump-to-latest button hides.
      const anchor = atBottomAnchorRef.current;
      const scroll = scrollRef.current;
      if (anchor && scroll && isAnchorVisibleInScroll(anchor, scroll)) {
        setAtBottom(true);
      }
    }
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
    if (threadId) {
      markThreadAsRead(mx, room.roomId, threadId, hideActivity);
      return;
    }
    markRoomAndThreadsAsRead(mx, room.roomId, hideActivity);
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
                          threadRootId={mEventId}
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
                  getLocally={threadId ? () => threadEventMap.get(replyEventId) : undefined}
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
                          threadRootId={mEventId}
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
                  getLocally={threadId ? () => threadEventMap.get(replyEventId) : undefined}
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
    const targetedOpen = !!eventId;

    const missingEditEvents = threadEvents.filter((mEvent) =>
      shouldFetchThreadEditBackfill(
        mEvent,
        threadEditFetchAttemptedRef.current,
        threadTailLoaded,
        targetedOpen
      )
    );
    if (missingEditEvents.length === 0) {
      logEditDebug('threadBackfill:noneMissing', {
        targetedOpen,
        threadId,
        threadEventCount: threadEvents.length,
        threadTailLoaded,
      });
      return;
    }

    logEditDebug('threadBackfill:start', {
      targetedOpen,
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
        // Use only fresh scroll measurement, not debounced atBottomRef (CINNY-031).
        if (
          atLiveEndRef.current &&
          scrollElement &&
          isScrollNearBottom({
            scrollHeight: scrollElement.scrollHeight,
            scrollTop: scrollElement.scrollTop,
            clientHeight: scrollElement.clientHeight,
          })
        ) {
          scrollToBottomRef.current.count += 1;
          scrollToBottomRef.current.smooth = false;
        }
        persistThreadEventCache(
          threadId,
          threadEvents,
          currentThread?.rootEvent ?? room.findEventById(threadId),
          firstThreadTimeline?.getPaginationToken(Direction.Backward),
          threadTailLoaded
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
  }, [
    eventId,
    mx,
    persistThreadEventCache,
    room,
    room.roomId,
    threadId,
    threadEvents,
    threadTailLoaded,
  ]);

  const handleThreadPaginateBack = useCallback(async () => {
    if (!threadId || threadPaginatingBackRef.current) return;
    const expectedThreadId = threadId;
    setThreadPaginatingBack(true);
    threadPaginatingBackRef.current = true;
    try {
      const earliestThreadReply = findEarliestLoadedThreadReplyByCacheOrder(threadEvents, expectedThreadId);
      const cachedPage = await loadCachedThreadEventsBefore(
        sessionId,
        room.roomId,
        expectedThreadId,
        getThreadCursorAnchor(earliestThreadReply?.event as Partial<IEvent> | undefined),
        THREAD_BATCH_SIZE
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
          limit: THREAD_BATCH_SIZE,
        })
      );
      if (!err && threadIdRef.current === expectedThreadId) {
        persistThreadEventCache(
          expectedThreadId,
          thread.events,
          thread.rootEvent,
          firstThreadTimeline.getPaginationToken(Direction.Backward)
        );
        // Reconcile backward pagination after SDK pagination
        reconcileThreadBackwardPagination(
          firstThreadTimeline,
          firstThreadTimeline.getPaginationToken(Direction.Backward),
          setThreadHasMoreCachedBack
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
        limit: THREAD_BATCH_SIZE,
      })
    );
    setThreadPaginatingFront(false);
    threadPaginatingFrontRef.current = false;
    if (!err && threadIdRef.current === expectedThreadId) {
      const tailLoaded = !currentLastThreadTimeline.getPaginationToken(Direction.Forward);
      persistThreadEventCache(
        expectedThreadId,
        thread.events,
        thread.rootEvent,
        undefined,
        tailLoaded
      );
      setThreadTailLoaded(tailLoaded);
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

    // Suppress dividers when overview is active — chronological constructs don't apply
    if (!roomThreadFilterActive) {
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
          threadCount={filteredThreadRootIds.length}
          totalThreadCount={visibleThreadRootData.ids.length}
          statusCounts={statusCounts}
          tagCounts={tagCounts}
          state={threadFilterState}
          availableTags={availableRoomTags}
          onToggle={onToggle}
          onSortDirectionChange={onSortDirectionChange}
          onReset={onReset}
          onCycleTag={onCycleTag}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onApplyPreset={onApplyPreset}
          onSearchQueryChange={onSearchQueryChange}
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
              !eagerPreloading &&
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
