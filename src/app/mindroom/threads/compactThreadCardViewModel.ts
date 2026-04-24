import { useMemo } from 'react';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { StateEvent } from '../../../types/matrix/room';
import type { MindroomThreadSummaryInfo } from '../../components/message/mindroomThreadSummary';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useStateEvents } from '../../hooks/useStateEvents';
import {
  getNextThreadScheduledTs,
  getThreadHeaderScheduledDisplayText,
} from '../../hooks/useThreadHeaderInfo';
import { getThreadLastActivityTs } from '../../hooks/useThreadLastActivityTs';
import { getThreadStreamingState } from '../../hooks/useThreadStreamingState';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { resolveRecentThreadSummaryText } from '../../features/recent-threads/recentThreadSummaryUtils';
import { formatScheduledTime } from '../../features/room/compactThreadCardUtils';
import { getThreadUnread } from '../../features/room/roomThreadList';
import {
  getRoomScheduledTaskCounts,
  type ThreadOverviewMetadata,
} from '../../features/room/roomThreadOverviewModel';
import {
  getThreadPrimarySummaryText,
  resolveThreadPresentationSnapshot,
} from '../../features/room/threadPresentation';
import { getVisibleThreadParticipantIds } from '../../features/room/threadUtils';
import {
  useRoomThreadResolutionMap,
  type ThreadResolutionState,
} from '../../features/room/useRoomThreadTags';
import type {
  CompactThreadAttentionState,
  CompactThreadCardViewModel,
  ThreadParticipantViewModel,
} from './types';

const numberFormatter = new Intl.NumberFormat();
const TITLE_FALLBACK = 'Thread started';
const LAST_MESSAGE_FALLBACK = 'No replies yet';
const TITLE_TEXT_LIMIT = 160;
const PREVIEW_TEXT_LIMIT = 96;

const truncateText = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 3).trimEnd()}...`;

export const getCompactThreadMessageCountLabel = (messageCount: number): string => {
  if (messageCount === 0) return '0 replies';

  const formattedCount = numberFormatter.format(messageCount);
  return `${formattedCount} ${messageCount === 1 ? 'msg' : 'msgs'}`;
};

export const getCompactThreadAttentionState = ({
  isResolved,
  isStreaming,
  lastSenderId,
  currentUserId,
}: {
  isResolved: boolean;
  isStreaming: boolean;
  lastSenderId: string | undefined;
  currentUserId: string | undefined;
}): CompactThreadAttentionState => {
  if (isStreaming) return 'streaming';
  if (isResolved) return 'resolved';
  if (!lastSenderId) return 'idle';
  if (currentUserId && lastSenderId === currentUserId) return 'waiting';
  return 'needs-attention';
};

export const getCompactThreadAttentionStatusText = (
  attentionState: CompactThreadAttentionState
): string => {
  switch (attentionState) {
    case 'needs-attention':
      return 'Needs attention';
    case 'waiting':
      return 'Waiting on response';
    case 'streaming':
      return 'Agent streaming';
    case 'resolved':
      return 'Resolved';
    case 'idle':
    default:
      return 'Idle';
  }
};

type BuildCompactThreadCardViewModelOptions = {
  room: Room;
  threadRootId: string;
  threadRootEvent?: MatrixEvent;
  metadata?: ThreadOverviewMetadata;
  summaryInfo?: MindroomThreadSummaryInfo;
  currentUserId?: string;
  mx: MatrixClient;
  useAuthentication: boolean;
  scheduledTaskEvents: MatrixEvent[];
  scheduledTaskCounts: Map<string, number>;
  threadResolutionMap: Map<string, ThreadResolutionState>;
};

const getMetadataSummaryInfo = (
  metadata: ThreadOverviewMetadata | undefined
): MindroomThreadSummaryInfo | undefined =>
  metadata?.summaryText || metadata?.messageCount
    ? {
        summaryText: metadata?.summaryText,
        messageCount:
          typeof metadata?.messageCount === 'number' && metadata.messageCount > 0
            ? metadata.messageCount
            : undefined,
      }
    : undefined;

const getCompactThreadParticipants = ({
  room,
  mx,
  useAuthentication,
  thread,
  threadRootEvent,
}: {
  room: Room;
  mx: MatrixClient;
  useAuthentication: boolean;
  thread: ReturnType<Room['getThread']>;
  threadRootEvent?: MatrixEvent;
}): ThreadParticipantViewModel[] =>
  getVisibleThreadParticipantIds(thread, threadRootEvent).map((userId) => {
    const displayName = getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
    const avatarMxc = getMemberAvatarMxc(room, userId);

    return {
      userId,
      displayName,
      avatarUrl: avatarMxc
        ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 32, 32, 'crop') ?? undefined
        : undefined,
    };
  });

export const buildCompactThreadCardViewModel = ({
  room,
  threadRootId,
  threadRootEvent,
  metadata,
  summaryInfo,
  currentUserId,
  mx,
  useAuthentication,
  scheduledTaskEvents,
  scheduledTaskCounts,
  threadResolutionMap,
}: BuildCompactThreadCardViewModelOptions): CompactThreadCardViewModel => {
  const thread = room.getThread(threadRootId);
  const resolvedThreadRootEvent =
    threadRootEvent ?? thread?.rootEvent ?? room.findEventById(threadRootId);
  const metadataSummaryInfo = getMetadataSummaryInfo(metadata);
  const resolvedSummaryInfo = summaryInfo ?? metadataSummaryInfo;
  const resolutionState = threadResolutionMap.get(threadRootId);
  const isResolved = metadata?.isResolved ?? resolutionState?.isResolved ?? false;
  const tags =
    metadata?.tags?.filter((tagName) => tagName !== 'resolved') ??
    (resolutionState?.tags
      ? Object.keys(resolutionState.tags).filter((tagName) => tagName !== 'resolved')
      : []);
  const liveLastActivityTs = getThreadLastActivityTs(room, threadRootId) ?? 0;
  const lastActivityTs = Math.max(liveLastActivityTs, metadata?.lastActivityTs ?? 0) || undefined;
  const isStreaming = metadata?.isStreaming ?? getThreadStreamingState(room, threadRootId);
  const scheduledTaskCount = Math.max(
    scheduledTaskCounts.get(threadRootId) ?? 0,
    metadata?.scheduledTaskCount ?? 0
  );
  const presentation = resolveThreadPresentationSnapshot({
    room,
    threadRootId,
    thread,
    rootEvent: resolvedThreadRootEvent,
    preferredSummaryInfo: resolvedSummaryInfo,
    preferredRootPreviewText: metadata?.rootPreviewText,
    fallbackLatestReplyPreviewText: metadata?.latestReplyPreviewText,
    fallbackLastSenderId: metadata?.lastSenderId,
    fallbackLastSenderDisplayName: metadata?.lastSenderDisplayName,
    fallbackMessageCount: metadata?.messageCount,
  });
  const titleText = getThreadPrimarySummaryText(presentation) ?? TITLE_FALLBACK;
  const latestPreviewText =
    presentation.latestReplyPreviewText ??
    presentation.rootPreviewText ??
    (presentation.messageCount > 0 ? titleText : LAST_MESSAGE_FALLBACK);
  const lastSenderId = presentation.lastSenderId;
  const lastSenderName =
    presentation.lastSenderDisplayName ??
    (lastSenderId ? getMxIdLocalPart(lastSenderId) ?? lastSenderId : undefined);
  const previewText = lastSenderName
    ? `${lastSenderName}: ${truncateText(latestPreviewText, PREVIEW_TEXT_LIMIT)}`
    : truncateText(latestPreviewText, PREVIEW_TEXT_LIMIT);
  const fallbackIsUnread =
    thread && currentUserId ? getThreadUnread(room, thread, currentUserId) : false;
  const isUnread = metadata?.isUnread ?? fallbackIsUnread;
  const attentionState = getCompactThreadAttentionState({
    isResolved,
    isStreaming,
    lastSenderId,
    currentUserId,
  });
  const nextScheduledTs =
    scheduledTaskCount > 0
      ? getNextThreadScheduledTs(scheduledTaskEvents, threadRootId)
      : undefined;
  const scheduledTaskLabel =
    scheduledTaskCount > 0
      ? `${scheduledTaskCount} pending scheduled ${scheduledTaskCount === 1 ? 'task' : 'tasks'}${
          nextScheduledTs === undefined ? '' : `, ${formatScheduledTime(nextScheduledTs)}`
        }`
      : undefined;
  const scheduledDisplayText = getThreadHeaderScheduledDisplayText(
    scheduledTaskCount,
    nextScheduledTs
  );
  const recentThreadSummaryText =
    resolvedSummaryInfo?.summaryText ??
    metadata?.rootPreviewText ??
    resolveRecentThreadSummaryText({
      room,
      threadRootId,
      rootEvent: resolvedThreadRootEvent,
      summaryInfo: resolvedSummaryInfo,
    });

  return {
    id: {
      roomId: room.roomId,
      threadRootId,
    },
    titleText,
    displayTitleText: truncateText(titleText, TITLE_TEXT_LIMIT),
    previewText,
    primarySummaryText: getThreadPrimarySummaryText(presentation),
    recentThreadSummaryText,
    messageCount: presentation.messageCount,
    messageCountLabel: getCompactThreadMessageCountLabel(presentation.messageCount),
    attentionState,
    attentionStatusText: getCompactThreadAttentionStatusText(attentionState),
    participants: getCompactThreadParticipants({
      room,
      mx,
      useAuthentication,
      thread,
      threadRootEvent: resolvedThreadRootEvent,
    }),
    tags,
    isResolved,
    isUnread,
    isStreaming,
    scheduledDisplayText,
    scheduledTaskLabel,
    lastActivityTs,
    lastActivityTitle:
      lastActivityTs !== undefined ? new Date(lastActivityTs).toLocaleString() : undefined,
  };
};

type UseCompactThreadCardViewModelsOptions = {
  room: Room;
  threadRootIds: string[];
  metadataMap: Map<string, ThreadOverviewMetadata>;
  summaryMap?: Map<string, MindroomThreadSummaryInfo>;
};

export const useCompactThreadCardViewModels = ({
  room,
  threadRootIds,
  metadataMap,
  summaryMap,
}: UseCompactThreadCardViewModelsOptions): CompactThreadCardViewModel[] => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const scheduledTaskEvents = useStateEvents(room, StateEvent.MindRoomScheduledTask);
  const scheduledTaskCounts = useMemo(
    () => getRoomScheduledTaskCounts(scheduledTaskEvents),
    [scheduledTaskEvents]
  );
  const threadResolutionMap = useRoomThreadResolutionMap(room);
  const currentUserId = mx.getUserId() ?? undefined;

  return useMemo(
    () =>
      threadRootIds.map((threadRootId) =>
        buildCompactThreadCardViewModel({
          room,
          threadRootId,
          threadRootEvent:
            room.findEventById(threadRootId) ?? room.getThread(threadRootId)?.rootEvent,
          metadata: metadataMap.get(threadRootId),
          summaryInfo: summaryMap?.get(threadRootId),
          currentUserId,
          mx,
          useAuthentication,
          scheduledTaskEvents,
          scheduledTaskCounts,
          threadResolutionMap,
        })
      ),
    [
      currentUserId,
      metadataMap,
      mx,
      room,
      scheduledTaskCounts,
      scheduledTaskEvents,
      summaryMap,
      threadResolutionMap,
      threadRootIds,
      useAuthentication,
    ]
  );
};
