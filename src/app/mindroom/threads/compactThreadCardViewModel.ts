import { useMemo, useRef } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { getThreadScheduledDisplayText, getThreadScheduledLabel } from './compactThreadCardUtils';
import { getThreadPrimarySummaryText } from './threadPresentation';
import type {
  CompactThreadAttentionState,
  CompactThreadCardViewModel,
  ThreadRecord,
  ThreadParticipantViewModel,
} from './types';
import { getThreadResolverDisplayName } from './threadResolutionAttribution';

const numberFormatter = new Intl.NumberFormat();
const TITLE_FALLBACK = 'Thread started';
const LAST_MESSAGE_FALLBACK = 'No replies yet';
const TITLE_TEXT_LIMIT = 160;
const PREVIEW_TEXT_LIMIT = 96;
const MATRIX_USER_ID_CANDIDATE_REGEXP = /@[^\s:]+:\S+/g;
const MATRIX_USER_ID_TRAILING_PUNCTUATION_REGEXP = /[.,!?;:)\]}'"`*_~>]+$/;

const truncateText = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 3).trimEnd()}...`;

export const replaceMatrixUserIdsWithDisplayNames = (room: Room, text: string): string =>
  text.replace(MATRIX_USER_ID_CANDIDATE_REGEXP, (candidate) => {
    const exactDisplayName = getMemberDisplayName(room, candidate);
    if (exactDisplayName) return exactDisplayName;

    const trailingPunctuation =
      candidate.match(MATRIX_USER_ID_TRAILING_PUNCTUATION_REGEXP)?.[0] ?? '';
    for (let length = 1; length <= trailingPunctuation.length; length += 1) {
      const userId = candidate.slice(0, -length);
      const displayName = getMemberDisplayName(room, userId);
      if (displayName) return `${displayName}${candidate.slice(-length)}`;
    }

    return candidate;
  });

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
  const titleText = replaceMatrixUserIdsWithDisplayNames(
    room,
    getThreadPrimarySummaryText(presentation) ?? TITLE_FALLBACK
  );
  const latestPreviewText = replaceMatrixUserIdsWithDisplayNames(
    room,
    presentation.latestReplyPreviewText ??
      presentation.rootPreviewText ??
      (presentation.messageCount > 0 ? titleText : LAST_MESSAGE_FALLBACK)
  );
  const lastSenderId = presentation.lastSenderId;
  const lastSenderName =
    (lastSenderId ? getMemberDisplayName(room, lastSenderId) : undefined) ??
    (presentation.lastSenderDisplayName
      ? lastSenderId
        ? presentation.lastSenderDisplayName
        : replaceMatrixUserIdsWithDisplayNames(room, presentation.lastSenderDisplayName)
      : undefined) ??
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
  const scheduledDisplayText = getThreadScheduledDisplayText(
    status.scheduledTaskCount,
    status.nextScheduledTs,
    status.cronDescription
  );
  const scheduledTaskLabel = getThreadScheduledLabel(
    status.scheduledTaskCount,
    status.nextScheduledTs,
    status.cronDescription,
    scheduledDisplayText
  );
  const resolvedByDisplayName = getThreadResolverDisplayName(room, status.resolvedByUserId);

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
    resolvedByDisplayName,
    isUnread: status.isUnread,
    isStreaming: status.isStreaming,
    hasPendingSend: status.hasPendingSend === true,
    hasFailedSend: status.hasFailedSend === true,
    scheduledDisplayText,
    scheduledTaskLabel,
    lastActivityTs: status.lastActivityTs,
    lastActivityTitle:
      status.lastActivityTs !== undefined
        ? new Date(status.lastActivityTs).toLocaleString()
        : undefined,
  };
};

type UseCompactThreadCardViewModelsOptions = {
  room: Room;
  threadRootIds: string[];
  threadRecordMap: ReadonlyMap<string, ThreadRecord>;
};

export const useCompactThreadCardViewModels = ({
  room,
  threadRootIds,
  threadRecordMap,
}: UseCompactThreadCardViewModelsOptions): CompactThreadCardViewModel[] => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const currentUserId = mx.getUserId() ?? undefined;
  // The thread index rebuilds records wholesale on every refresh (e.g. each
  // streaming edit anywhere in the room), so freshly built view models get new
  // identities even when their content is unchanged. Reusing the previous
  // instance for content-identical view models lets memoized cards skip
  // re-rendering.
  const viewModelCacheRef = useRef(
    new Map<string, { signature: string; viewModel: CompactThreadCardViewModel }>()
  );

  return useMemo(() => {
    const previousCache = viewModelCacheRef.current;
    const nextCache = new Map<
      string,
      { signature: string; viewModel: CompactThreadCardViewModel }
    >();
    const viewModels: CompactThreadCardViewModel[] = [];

    threadRootIds.forEach((threadRootId) => {
      const record = threadRecordMap.get(threadRootId);
      if (!record) return;

      const freshViewModel = buildCompactThreadCardViewModelFromRecord({
        record,
        room,
        currentUserId,
        mx,
        useAuthentication,
      });
      const signature = JSON.stringify(freshViewModel);
      const cached = previousCache.get(threadRootId);
      const viewModel = cached?.signature === signature ? cached.viewModel : freshViewModel;
      nextCache.set(threadRootId, { signature, viewModel });
      viewModels.push(viewModel);
    });

    viewModelCacheRef.current = nextCache;
    return viewModels;
  }, [currentUserId, mx, room, threadRecordMap, threadRootIds, useAuthentication]);
};
