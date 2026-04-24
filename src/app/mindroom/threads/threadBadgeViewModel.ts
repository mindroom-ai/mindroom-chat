import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import {
  pickLatestThreadSummaryInfo,
  type MindroomThreadSummaryInfo,
} from '../../components/message/mindroomThreadSummary';
import { resolveRecentThreadSummaryText } from '../../features/recent-threads/recentThreadSummaryUtils';
import { isZeroReplyStandaloneThreadRootEvent } from '../../features/room/compactThreadRootData';
import { resolveThreadSummaryInfo } from '../../features/room/threadPresentation';
import {
  buildVisibleThreadParticipantMap,
  buildVisibleThreadReplyCountMap,
  isThreadReplyEvent,
} from '../../features/room/threadUtils';
import type { ThreadBadgeViewModel } from './types';

type BuildThreadBadgeViewModelOptions = {
  room: Room;
  threadRootEvent: MatrixEvent;
  threadRootId: string;
  activeThreadId?: string;
  eventThreadRootId?: string;
  replyCount?: number;
  participantIds?: string[];
  isResolved?: boolean;
  fallbackSummaryInfo?: MindroomThreadSummaryInfo;
  cachedSummaryInfo?: MindroomThreadSummaryInfo;
};

type BuildTimelineThreadBadgeViewModelOptions = {
  room: Room;
  threadRootEvent: MatrixEvent;
  activeThreadId?: string;
  fallbackReplyCount?: number;
  fallbackParticipantIds?: string[];
  isResolved?: boolean;
  fallbackSummaryInfo?: MindroomThreadSummaryInfo;
  cachedSummaryInfo?: MindroomThreadSummaryInfo;
};

const THREAD_BADGE_PARTICIPANT_LIMIT = 3;

export const getThreadReplyCount = (
  room: Room,
  mEvent: MatrixEvent,
  fallbackReplyCount?: number,
  allowZeroReplyCount = false
): number | undefined => {
  const eventId = mEvent.getId();
  if (!eventId) return undefined;

  const thread = room.getThread(eventId);
  const loadedThreadEvents =
    thread?.events && thread.events.length > 0
      ? thread.events
      : thread?.timeline && thread.timeline.length > 0
      ? thread.timeline
      : undefined;
  if (loadedThreadEvents && loadedThreadEvents.length > 0) {
    const visibleThreadReplyCount =
      buildVisibleThreadReplyCountMap(loadedThreadEvents).get(eventId) ?? 0;
    if (visibleThreadReplyCount > 0 || allowZeroReplyCount) {
      return visibleThreadReplyCount;
    }
  }

  const threadMeta = mEvent.getUnsigned()?.['m.relations']?.['m.thread'] as
    | { count?: unknown; c?: unknown }
    | undefined;
  if (typeof threadMeta?.count === 'number') return threadMeta.count;
  if (typeof threadMeta?.c === 'number') return threadMeta.c;

  const threadLength = thread?.length;
  if (typeof threadLength === 'number' && (threadLength > 0 || allowZeroReplyCount)) {
    return threadLength;
  }

  if (typeof fallbackReplyCount === 'number' && (fallbackReplyCount > 0 || allowZeroReplyCount)) {
    return fallbackReplyCount;
  }

  return allowZeroReplyCount ? 0 : undefined;
};

export const getKnownThreadReplyCount = (mEvent: MatrixEvent): number | undefined => {
  const threadMeta = mEvent.getUnsigned()?.['m.relations']?.['m.thread'] as
    | { count?: unknown; c?: unknown }
    | undefined;
  if (typeof threadMeta?.count === 'number') return threadMeta.count;
  if (typeof threadMeta?.c === 'number') return threadMeta.c;

  return undefined;
};

export const shouldRenderZeroReplyThreadBadge = (room: Room, mEvent: MatrixEvent): boolean => {
  const eventId = mEvent.getId();
  if (eventId) {
    const thread = room.getThread(eventId);
    const loadedThreadEvents =
      thread?.events && thread.events.length > 0
        ? thread.events
        : thread?.timeline && thread.timeline.length > 0
        ? thread.timeline
        : undefined;
    if (loadedThreadEvents && loadedThreadEvents.length > 0) {
      const visibleThreadReplyCount =
        buildVisibleThreadReplyCountMap(loadedThreadEvents).get(eventId) ?? 0;
      if (visibleThreadReplyCount === 0) return true;
    }
  }

  const threadReplyCount = getKnownThreadReplyCount(mEvent);
  if (threadReplyCount === 0) return true;

  return isZeroReplyStandaloneThreadRootEvent(mEvent);
};

export const getThreadParticipantIds = (
  room: Room,
  mEvent: MatrixEvent,
  fallbackParticipantIds?: string[]
): string[] | undefined => {
  const eventId = mEvent.getId();
  if (eventId) {
    const thread = room.getThread(eventId);
    if (thread?.events?.length) {
      const participants =
        buildVisibleThreadParticipantMap(thread.events, THREAD_BADGE_PARTICIPANT_LIMIT).get(
          eventId
        ) ?? [];
      if (participants.length > 0) return participants;
    }
  }

  if (fallbackParticipantIds && fallbackParticipantIds.length > 0) {
    return fallbackParticipantIds.slice(0, THREAD_BADGE_PARTICIPANT_LIMIT);
  }

  return undefined;
};

export const buildThreadBadgeViewModel = ({
  room,
  threadRootEvent,
  threadRootId,
  activeThreadId,
  eventThreadRootId,
  replyCount,
  participantIds,
  isResolved,
  fallbackSummaryInfo,
  cachedSummaryInfo,
}: BuildThreadBadgeViewModelOptions): ThreadBadgeViewModel | undefined => {
  if (activeThreadId) return undefined;
  if (isThreadReplyEvent(threadRootId, eventThreadRootId)) return undefined;
  if (typeof replyCount !== 'number') return undefined;

  const preferredSummaryInfo = pickLatestThreadSummaryInfo(cachedSummaryInfo, fallbackSummaryInfo);
  const summaryInfo = resolveThreadSummaryInfo({
    preferredSummaryInfo,
    thread: room.getThread(threadRootId),
  });

  return {
    id: {
      roomId: room.roomId,
      threadRootId,
    },
    summaryInfo,
    recentThreadSummaryText: resolveRecentThreadSummaryText({
      room,
      threadRootId,
      rootEvent: threadRootEvent,
      summaryInfo,
    }),
    replyCount,
    participantIds,
    isResolved: isResolved ?? false,
  };
};

export const buildTimelineThreadBadgeViewModel = ({
  room,
  threadRootEvent,
  activeThreadId,
  fallbackReplyCount,
  fallbackParticipantIds,
  isResolved,
  fallbackSummaryInfo,
  cachedSummaryInfo,
}: BuildTimelineThreadBadgeViewModelOptions): ThreadBadgeViewModel | undefined => {
  const threadRootId = threadRootEvent.getId();
  if (!threadRootId) return undefined;
  if (activeThreadId) return undefined;
  if (isThreadReplyEvent(threadRootId, threadRootEvent.threadRootId)) return undefined;

  const zeroReplyThreadBadge = shouldRenderZeroReplyThreadBadge(room, threadRootEvent);
  const replyCount = getThreadReplyCount(
    room,
    threadRootEvent,
    fallbackReplyCount,
    zeroReplyThreadBadge
  );
  if (typeof replyCount !== 'number' || (replyCount === 0 && !zeroReplyThreadBadge)) {
    return undefined;
  }

  return buildThreadBadgeViewModel({
    room,
    threadRootEvent,
    threadRootId,
    activeThreadId,
    eventThreadRootId: threadRootEvent.threadRootId,
    replyCount,
    participantIds: getThreadParticipantIds(room, threadRootEvent, fallbackParticipantIds),
    isResolved,
    fallbackSummaryInfo,
    cachedSummaryInfo,
  });
};
