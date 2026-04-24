import { useMemo } from 'react';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { StateEvent } from '../../../types/matrix/room';
import type { MindroomThreadSummaryInfo } from '../../components/message/mindroomThreadSummary';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useStateEvents } from '../../hooks/useStateEvents';
import { getThreadHeaderScheduledDisplayText } from '../../hooks/useThreadHeaderInfo';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { formatScheduledTime } from '../../features/room/compactThreadCardUtils';
import {
  getRoomScheduledTaskCounts,
  type ThreadOverviewMetadata,
} from '../../features/room/roomThreadOverviewModel';
import { getThreadPrimarySummaryText } from '../../features/room/threadPresentation';
import {
  useRoomThreadResolutionMap,
  type ThreadResolutionState,
} from '../../features/room/useRoomThreadTags';
import type {
  CompactThreadAttentionState,
  CompactThreadCardViewModel,
  ThreadRecord,
  ThreadParticipantViewModel,
} from './types';
import { buildThreadRecord } from './threadRecord';

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

const getCompactThreadParticipants = ({
  room,
  mx,
  useAuthentication,
  participantIds,
}: {
  room: Room;
  mx: MatrixClient;
  useAuthentication: boolean;
  participantIds: string[];
}): ThreadParticipantViewModel[] =>
  participantIds.map((userId) => {
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

type BuildCompactThreadCardViewModelFromRecordOptions = {
  record: ThreadRecord;
  room: Room;
  currentUserId?: string;
  mx: MatrixClient;
  useAuthentication: boolean;
};

export const buildCompactThreadCardViewModelFromRecord = ({
  record,
  room,
  currentUserId,
  mx,
  useAuthentication,
}: BuildCompactThreadCardViewModelFromRecordOptions): CompactThreadCardViewModel => {
  const { presentation, status } = record;
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
  const attentionState = getCompactThreadAttentionState({
    isResolved: status.isResolved,
    isStreaming: status.isStreaming,
    lastSenderId,
    currentUserId,
  });
  const scheduledTaskLabel =
    status.scheduledTaskCount > 0
      ? `${status.scheduledTaskCount} pending scheduled ${
          status.scheduledTaskCount === 1 ? 'task' : 'tasks'
        }${
          status.nextScheduledTs === undefined
            ? ''
            : `, ${formatScheduledTime(status.nextScheduledTs)}`
        }`
      : undefined;
  const scheduledDisplayText = getThreadHeaderScheduledDisplayText(
    status.scheduledTaskCount,
    status.nextScheduledTs
  );

  return {
    id: {
      roomId: record.roomId,
      threadRootId: record.threadRootId,
    },
    titleText,
    displayTitleText: truncateText(titleText, TITLE_TEXT_LIMIT),
    previewText,
    primarySummaryText: getThreadPrimarySummaryText(presentation),
    recentThreadSummaryText: presentation.recentThreadSummaryText,
    messageCount: presentation.messageCount,
    messageCountLabel: getCompactThreadMessageCountLabel(presentation.messageCount),
    attentionState,
    attentionStatusText: getCompactThreadAttentionStatusText(attentionState),
    participants: getCompactThreadParticipants({
      room,
      mx,
      useAuthentication,
      participantIds: presentation.participantIds,
    }),
    tags: status.tags,
    isResolved: status.isResolved,
    isUnread: status.isUnread,
    isStreaming: status.isStreaming,
    scheduledDisplayText,
    scheduledTaskLabel,
    lastActivityTs: status.lastActivityTs,
    lastActivityTitle:
      status.lastActivityTs !== undefined
        ? new Date(status.lastActivityTs).toLocaleString()
        : undefined,
  };
};

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
  const record = buildThreadRecord({
    room,
    threadRootId,
    threadRootEvent,
    metadata,
    summaryInfo,
    currentUserId,
    scheduledTaskEvents,
    scheduledTaskCount: Math.max(
      scheduledTaskCounts.get(threadRootId) ?? 0,
      metadata?.scheduledTaskCount ?? 0
    ),
    threadResolution: threadResolutionMap.get(threadRootId),
  });

  return buildCompactThreadCardViewModelFromRecord({
    record,
    room,
    currentUserId,
    mx,
    useAuthentication,
  });
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
