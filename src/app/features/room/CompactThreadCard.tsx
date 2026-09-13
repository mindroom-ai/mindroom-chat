import React, { useMemo } from 'react';
import { Avatar, Badge, Box, Chip, Icon, Icons, Text } from 'folds';
import { IconCalendarEvent } from '@tabler/icons-react';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { StateEvent } from '../../../types/matrix/room';
import {
  findLatestThreadSummaryEvent,
  getThreadSummaryEventInfo,
  isMindroomThreadSummaryEvent,
  pickLatestThreadSummaryInfo,
  type MindroomThreadSummaryInfo,
} from '../../components/message/mindroomThreadSummary';
import * as replyCss from '../../components/message/Reply.css';
import { UserAvatar } from '../../components/user-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { useStateEvents } from '../../hooks/useStateEvents';
import { useThreadLastActivityTs } from '../../hooks/useThreadLastActivityTs';
import { useThreadScheduledTasks } from '../../hooks/useThreadScheduledTasks';
import { useThreadStreamingState } from '../../hooks/useThreadStreamingState';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { getMemberAvatarMxc, getMemberDisplayName, trimReplyFromBody } from '../../utils/room';
import { parseScheduledTaskStateEvent } from '../../utils/scheduledTaskContract';
import { getThreadUnread } from './roomThreadList';
import {
  getCompactThreadRootBodyPreviewText,
  pickPreferredThreadRootPreviewText,
} from './compactThreadRootData';
import { formatScheduledTime } from './compactThreadCardUtils';
import { useThreadResolution } from './useRoomThreadTags';
import * as css from './CompactRoomView.css';

const numberFormatter = new Intl.NumberFormat();
const TITLE_FALLBACK = 'Thread started';
const LAST_MESSAGE_FALLBACK = 'No replies yet';
const TITLE_TEXT_LIMIT = 160;
const PREVIEW_TEXT_LIMIT = 96;
type AttentionState = 'needs-attention' | 'waiting' | 'streaming' | 'resolved' | 'idle';

type ThreadLike =
  | {
      rootEvent?: MatrixEvent;
      length?: number;
      events?: MatrixEvent[];
      timeline?: MatrixEvent[];
    }
  | null
  | undefined;

const tagColor = (tagName: string): string => {
  let hash = 0;
  for (let i = 0; i < tagName.length; i++) {
    hash = tagName.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 82%)`;
};

const truncateText = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}...`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getEventBodyPreviewText = (event: MatrixEvent | undefined): string | undefined => {
  const content =
    event && typeof event.getContent === 'function'
      ? (event.getContent() as Record<string, unknown> | null | undefined)
      : undefined;
  if (!content || !isRecord(content)) return undefined;

  const newContent = isRecord(content['m.new_content'])
    ? (content['m.new_content'] as Record<string, unknown>)
    : undefined;
  const body = typeof newContent?.body === 'string' ? newContent.body : content.body;
  if (typeof body !== 'string') return undefined;

  const normalized = trimReplyFromBody(body).replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : undefined;
};

const getPreferredThreadReplyEvents = (thread: ThreadLike): MatrixEvent[] => {
  if (thread?.events?.length) return thread.events;
  if (thread?.timeline?.length) return thread.timeline;
  return thread?.events ?? thread?.timeline ?? [];
};

const getThreadMessageCount = (
  thread: ThreadLike,
  fallbackMessageCount?: number
): number => {
  if (typeof thread?.length === 'number' && thread.length > 0) return thread.length;

  const replyEvents = getPreferredThreadReplyEvents(thread);
  if (replyEvents.length > 0) return replyEvents.length;
  if (typeof fallbackMessageCount === 'number' && fallbackMessageCount > 0) return fallbackMessageCount;

  return 0;
};

const getLatestRenderableReplyEvent = (replyEvents: MatrixEvent[]): MatrixEvent | undefined => {
  let summaryFallback: MatrixEvent | undefined;

  for (let i = replyEvents.length - 1; i >= 0; i -= 1) {
    const event = replyEvents[i];
    if (!getEventBodyPreviewText(event)) continue;

    if (isMindroomThreadSummaryEvent(event)) {
      summaryFallback ??= event;
      continue;
    }

    return event;
  }

  return summaryFallback;
};

const getLiveSummaryInfo = (thread: ThreadLike): MindroomThreadSummaryInfo | undefined => {
  const replyEvents = getPreferredThreadReplyEvents(thread);
  if (replyEvents.length === 0) return undefined;

  const summaryEvent = findLatestThreadSummaryEvent(replyEvents);
  if (!summaryEvent) return undefined;

  const info = getThreadSummaryEventInfo(summaryEvent);
  return info?.summaryText ? info : undefined;
};

const getThreadParticipantIds = (
  thread: ThreadLike,
  threadRootEvent: MatrixEvent | undefined
): string[] => {
  const participantIds: string[] = [];
  const seenParticipantIds = new Set<string>();
  const replyEvents = getPreferredThreadReplyEvents(thread);

  for (let i = replyEvents.length - 1; i >= 0 && participantIds.length < 3; i -= 1) {
    const senderId = replyEvents[i].getSender?.();
    if (!senderId || seenParticipantIds.has(senderId)) continue;

    seenParticipantIds.add(senderId);
    participantIds.push(senderId);
  }

  const rootSenderId = threadRootEvent?.getSender?.();
  if (participantIds.length < 3 && rootSenderId && !seenParticipantIds.has(rootSenderId)) {
    participantIds.push(rootSenderId);
  }

  return participantIds;
};

const getMessageCountLabel = (messageCount: number): string => {
  const formattedCount = numberFormatter.format(messageCount);
  return `${formattedCount} ${messageCount === 1 ? 'msg' : 'msgs'}`;
};

const getAttentionState = ({
  isResolved,
  isStreaming,
  lastSenderId,
  currentUserId,
}: {
  isResolved: boolean;
  isStreaming: boolean;
  lastSenderId: string | undefined;
  currentUserId: string | undefined;
}): AttentionState => {
  if (isStreaming) return 'streaming';
  if (isResolved) return 'resolved';
  if (!lastSenderId) return 'idle';
  if (currentUserId && lastSenderId === currentUserId) return 'waiting';
  return 'needs-attention';
};

const getAttentionStatusText = (attentionState: AttentionState): string => {
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

export type CompactThreadCardProps = {
  room: Room;
  threadRootId: string;
  threadRootEvent?: MatrixEvent;
  rootPreviewText?: string;
  summaryInfo?: MindroomThreadSummaryInfo;
  lastActivityTs?: number;
  onClick: (threadRootId: string) => void;
};

export function CompactThreadCard({
  room,
  threadRootId,
  threadRootEvent,
  rootPreviewText,
  summaryInfo,
  lastActivityTs: fallbackLastActivityTs,
  onClick,
}: CompactThreadCardProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const { isResolved, tags } = useThreadResolution(room, threadRootId);
  const displayTags = tags
    ? Object.keys(tags).filter((t) => t !== 'resolved')
    : [];
  const liveLastActivityTs = useThreadLastActivityTs(room, threadRootId);
  const lastActivityTs = Math.max(liveLastActivityTs ?? 0, fallbackLastActivityTs ?? 0) || undefined;
  const relativeTime = useRelativeTime(lastActivityTs);
  const isStreaming = useThreadStreamingState(room, threadRootId);
  const scheduledTaskCount = useThreadScheduledTasks(room, threadRootId);
  const scheduledTaskEvents = useStateEvents(room, StateEvent.MindRoomScheduledTask);

  const thread = room.getThread(threadRootId);
  const resolvedThreadRootEvent =
    threadRootEvent ?? thread?.rootEvent ?? room.findEventById(threadRootId);
  const replyEvents = getPreferredThreadReplyEvents(thread);
  const liveSummaryInfo = getLiveSummaryInfo(thread);
  const effectiveSummaryInfo = pickLatestThreadSummaryInfo(summaryInfo, liveSummaryInfo);
  const eventRootPreviewText =
    getCompactThreadRootBodyPreviewText(resolvedThreadRootEvent, {
      eventId: threadRootId,
      room,
    }) ?? getEventBodyPreviewText(resolvedThreadRootEvent);
  const resolvedRootPreviewText = pickPreferredThreadRootPreviewText({
    preferredPreviewText: rootPreviewText,
    fallbackPreviewText: eventRootPreviewText,
  });
  const titleText =
    effectiveSummaryInfo?.summaryText ?? resolvedRootPreviewText ?? TITLE_FALLBACK;
  const latestPreviewEvent = getLatestRenderableReplyEvent(replyEvents);
  const lastMessagePreview = truncateText(
    getEventBodyPreviewText(latestPreviewEvent) ??
      resolvedRootPreviewText ??
      (replyEvents.length > 0 ? titleText : LAST_MESSAGE_FALLBACK),
    PREVIEW_TEXT_LIMIT
  );
  const lastSenderId = latestPreviewEvent?.getSender() ?? replyEvents[replyEvents.length - 1]?.getSender();
  const lastSenderName = lastSenderId
    ? getMemberDisplayName(room, lastSenderId) ?? getMxIdLocalPart(lastSenderId) ?? lastSenderId
    : undefined;
  const messageCount = effectiveSummaryInfo?.messageCount ?? getThreadMessageCount(thread);
  const messageCountLabel = getMessageCountLabel(messageCount);
  const currentUserId = mx.getUserId() ?? undefined;
  const isUnread = useMemo(() => {
    if (!threadRootId) return false;
    const currentThread = room.getThread(threadRootId);
    if (!currentThread) return false;
    const userId = mx.getUserId();
    if (!userId) return false;
    return getThreadUnread(room, currentThread, userId);
  }, [room, threadRootId, mx]);
  const attentionState = getAttentionState({
    isResolved,
    isStreaming,
    lastSenderId,
    currentUserId,
  });
  const attentionStatusText = getAttentionStatusText(attentionState);
  const lastActivityTitle =
    lastActivityTs !== undefined ? new Date(lastActivityTs).toLocaleString() : undefined;

  const threadParticipants = useMemo(() => {
    const participantIds = getThreadParticipantIds(thread, resolvedThreadRootEvent);

    return participantIds.map((userId) => {
      const displayName =
        getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId) ?? userId;
      const avatarMxc = getMemberAvatarMxc(room, userId);

      return {
        userId,
        displayName,
        avatarUrl: avatarMxc
          ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 32, 32, 'crop') ?? undefined
          : undefined,
      };
    });
  }, [mx, room, thread, resolvedThreadRootEvent, useAuthentication]);

  const nextScheduledTs = useMemo(() => {
    if (!threadRootId || scheduledTaskCount <= 0) return undefined;

    const now = Date.now();
    let nextTs: number | undefined;

    scheduledTaskEvents.forEach((event) => {
      const parsedTask = parseScheduledTaskStateEvent(event);
      if (!parsedTask) return;
      if (parsedTask.status !== 'pending') return;
      if (parsedTask.threadId !== threadRootId || parsedTask.newThread) return;
      if (!parsedTask.executeAt) return;

      const executeAtTs = Date.parse(parsedTask.executeAt);
      if (!Number.isFinite(executeAtTs) || executeAtTs <= now) return;

      if (nextTs === undefined || executeAtTs < nextTs) {
        nextTs = executeAtTs;
      }
    });

    return nextTs;
  }, [scheduledTaskCount, scheduledTaskEvents, threadRootId]);

  const scheduledTaskLabel = useMemo(() => {
    if (scheduledTaskCount <= 0) return undefined;

    const taskLabel = `${scheduledTaskCount} pending scheduled ${
      scheduledTaskCount === 1 ? 'task' : 'tasks'
    }`;
    if (nextScheduledTs === undefined) return taskLabel;

    return `${taskLabel}, ${formatScheduledTime(nextScheduledTs)}`;
  }, [scheduledTaskCount, nextScheduledTs]);

  const scheduledDisplayText =
    nextScheduledTs !== undefined
      ? formatScheduledTime(nextScheduledTs)
      : scheduledTaskCount > 0
        ? `${scheduledTaskCount} ${scheduledTaskCount === 1 ? 'task' : 'tasks'}`
        : undefined;

  const previewText = lastSenderName ? `${lastSenderName}: ${lastMessagePreview}` : lastMessagePreview;
  const ariaLabel = [
    `Open thread: ${titleText}`,
    attentionStatusText,
    previewText,
    messageCountLabel,
    isResolved ? 'Resolved thread' : 'Unresolved thread',
    isUnread ? 'Unread messages' : undefined,
    isStreaming ? 'Agent streaming' : undefined,
    scheduledTaskLabel,
    relativeTime ? `Last activity ${relativeTime}` : undefined,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <button
      className={isResolved ? `${css.Card} ${css.CardResolved}` : css.Card}
      type="button"
      onClick={() => onClick(threadRootId)}
      data-thread-root-id={threadRootId}
      aria-label={ariaLabel}
    >
      <Box className={css.TitleRow}>
        <Box className={css.TitleLead}>
          <span
            className={css.AttentionDot({ state: attentionState })}
            data-attention-state={attentionState}
            aria-hidden="true"
          />
          <span className={css.ScreenReaderText}>{`Thread status: ${attentionStatusText}.`}</span>
          <Text className={css.TitleText} size="B300">
            {titleText}
          </Text>
        </Box>
        {relativeTime && (
          <Text
            className={css.TimeText}
            size="T200"
            priority="300"
            title={lastActivityTitle}
            aria-label={lastActivityTitle ? `Last activity ${lastActivityTitle}` : undefined}
          >
            {relativeTime}
          </Text>
        )}
      </Box>

      <Box className={css.MessageRow}>
        <Text className={css.MessageText} size="T200" priority="300" truncate>
          {previewText}
        </Text>
        <Box className={css.Stats}>
          <Badge className={css.StatBadge} variant="Secondary" fill="Soft" radii="Pill">
            <Text as="span" size="T200">
              {messageCountLabel}
            </Text>
          </Badge>
          {scheduledDisplayText && scheduledTaskLabel && (
            <Box
              as="span"
              className={`${css.ScheduledIndicator} ${replyCss.ThreadScheduledIndicator}`}
              alignItems="Center"
              gap="100"
              role="img"
              aria-label={scheduledTaskLabel}
              title={scheduledTaskLabel}
            >
              <IconCalendarEvent
                size={12}
                stroke={1.8}
                className={replyCss.ThreadScheduledIcon}
                aria-hidden="true"
              />
              <Text as="span" size="T200" priority="300" truncate>
                {scheduledDisplayText}
              </Text>
            </Box>
          )}
        </Box>
      </Box>

      <Box className={css.MetadataRow}>
        {threadParticipants.length > 0 && (
          <Box className={css.Participants} alignItems="Center">
            {threadParticipants.map((participant, index) => (
              <Avatar
                key={participant.userId}
                className={`${css.ParticipantAvatar} ${replyCss.ThreadParticipant}`}
                size="200"
                radii="400"
                title={participant.displayName}
                style={
                  index === 0
                    ? { zIndex: threadParticipants.length - index }
                    : {
                        marginInlineStart: '-0.375rem',
                        zIndex: threadParticipants.length - index,
                      }
                }
              >
                <UserAvatar
                  userId={participant.userId}
                  src={participant.avatarUrl}
                  alt={participant.displayName}
                  renderFallback={() => <Icon size="100" src={Icons.User} filled />}
                />
              </Avatar>
            ))}
          </Box>
        )}
        {displayTags.map((tagName) => (
          <Box
            key={tagName}
            as="span"
            style={{
              backgroundColor: tagColor(tagName),
              color: '#1a1a1a',
              fontSize: '0.65rem',
              fontWeight: 500,
              padding: '0.1rem 0.4rem',
              borderRadius: '0.5rem',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            {tagName}
          </Box>
        ))}
        <Chip
          as="span"
          className={css.StatusChip}
          variant={isResolved ? 'Success' : 'SurfaceVariant'}
          fill={isResolved ? 'Soft' : undefined}
          radii="Pill"
          outlined={!isResolved}
        >
          <Box as="span" alignItems="Center" gap="100">
            {isResolved && <Icon size="50" src={Icons.CheckTwice} />}
            <Text as="span" size="T200">
              {isResolved ? 'resolved' : 'unresolved'}
            </Text>
          </Box>
        </Chip>
        {isStreaming && (
          <Chip as="span" className={css.StatusChip} variant="Primary" fill="Soft" radii="Pill">
            <Box as="span" alignItems="Center" gap="100">
              <span className={replyCss.ThreadStreamingDot} aria-hidden="true" />
              <Text as="span" size="T200">
                streaming
              </Text>
            </Box>
          </Chip>
        )}
        {isUnread && (
          <Box as="span" className={css.UnreadWrap} alignItems="Center" gap="100">
            <span
              className={`${replyCss.ThreadUnreadDot} ${css.UnreadDot}`}
              role="img"
              aria-label="Unread messages"
            />
            <Text as="span" size="T200" priority="300">
              unread
            </Text>
          </Box>
        )}
      </Box>
    </button>
  );
}
