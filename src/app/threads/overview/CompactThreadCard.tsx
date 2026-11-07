import React, { memo, type ReactNode } from 'react';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { IconCalendarEvent } from '@tabler/icons-react';
import * as threadIndicatorCss from '../../messages/ThreadIndicator.css';
import { UserAvatar } from '../../avatars/UserAvatar';
import { useRelativeTime } from '../../i18n/useRelativeTime';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';
import * as css from './CompactRoomView.css';
import { FailedSendIndicator, PendingSendIndicator } from '../../ui/PendingSendIndicator';
import { ThreadStreamingDot } from '../ThreadStreamingDot';
import { ThreadTagPill } from '../tags/ThreadTagPill';
import { ownDirectionBlock } from '../../ui/directional';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { OverflowChip } from '../ThreadContextBanner.css';

export type CompactThreadCardProps = {
  viewModel: CompactThreadCardViewModel;
  onClick: (threadRootId: string, summaryText?: string) => void;
  /**
   * Shown in the card under the thread's summary, with controls of its own, such as a call's row:
   * the card then holds the button that opens the thread, beside it.
   */
  attachment?: ReactNode;
};

// As many whole tags as the thread banner shows, then a count of the rest.
const DESKTOP_MAX_TAGS = 3;
const MOBILE_MAX_TAGS = 2;

function CompactThreadCardBase({ viewModel, onClick, attachment }: CompactThreadCardProps) {
  const { t } = useTranslation();
  const maxTags =
    useScreenSizeContext() === ScreenSize.Mobile ? MOBILE_MAX_TAGS : DESKTOP_MAX_TAGS;
  const {
    id,
    titleText,
    displayTitleText,
    previewText,
    messageCount,
    messageCountLabel,
    messageCountText,
    attentionState,
    attentionStatusText,
    participants,
    tags,
    isResolved,
    resolvedByDisplayName,
    isUnread,
    isStreaming,
    hasPendingSend,
    hasFailedSend,
    scheduledDisplayText,
    scheduledTaskLabel,
    lastActivityTs,
    lastActivityTitle,
    primarySummaryText,
  } = viewModel;
  const relativeTime = useRelativeTime(lastActivityTs, 'compact');
  // A thread nobody has replied to shows no count, as the Threads view shows no chip under it.
  const hasReplies = messageCount > 0;
  const resolvedByLabel =
    isResolved && resolvedByDisplayName
      ? t('thread.resolvedBy', { name: resolvedByDisplayName })
      : undefined;
  const ariaLabel = [
    t('thread.aria.openThread', { title: titleText }),
    attentionStatusText,
    previewText,
    hasReplies ? messageCountLabel : undefined,
    isResolved
      ? resolvedByLabel ?? t('thread.aria.resolvedThread')
      : t('thread.aria.unresolvedThread'),
    isUnread ? t('thread.aria.unreadMessages') : undefined,
    isStreaming ? t('thread.aria.agentStreaming') : undefined,
    hasFailedSend ? t('thread.aria.messageFailed') : undefined,
    hasPendingSend ? t('thread.aria.messageSending') : undefined,
    scheduledTaskLabel,
    lastActivityTitle || relativeTime
      ? t('thread.aria.lastActivity', { time: lastActivityTitle || relativeTime })
      : undefined,
  ]
    .filter(Boolean)
    .join('. ');

  // Unread threads carry an accent edge and an accented time rather than a
  // dot, so no card reserves a leading gutter that most of them never use.
  const cardClassName = [css.Card, isResolved && css.CardResolved, isUnread && css.CardUnread]
    .filter(Boolean)
    .join(' ');

  const card = (
    <button
      className={attachment ? css.CardButton : cardClassName}
      type="button"
      onClick={() => onClick(id.threadRootId, primarySummaryText)}
      data-thread-root-id={id.threadRootId}
      data-attention-state={attentionState}
      data-thread-unread={isUnread ? 'true' : undefined}
      aria-label={ariaLabel}
    >
      <Box className={css.TitleRow}>
        <Text className={css.TitleText} size="B300" title={titleText} {...ownDirectionBlock}>
          {displayTitleText}
        </Text>
        {relativeTime && (
          <Text
            as="span"
            className={isUnread ? `${css.TimeText} ${css.TimeTextUnread}` : css.TimeText}
            size="T200"
            priority="300"
            title={lastActivityTitle}
          >
            {relativeTime}
          </Text>
        )}
      </Box>

      <Box className={css.MessagePreview} alignItems="Center">
        <Text
          className={css.MessageText}
          size="T200"
          priority="300"
          truncate
          {...ownDirectionBlock}
        >
          {previewText}
        </Text>
        {hasFailedSend ? <FailedSendIndicator /> : hasPendingSend && <PendingSendIndicator />}
      </Box>

      <Box className={css.MetadataRow} data-compact-card-metadata="true">
        {participants.length > 0 && (
          <Box className={css.Participants} alignItems="Center">
            {participants.map((participant, index) => (
              <Avatar
                key={participant.userId}
                className={`${css.ParticipantAvatar} ${threadIndicatorCss.ThreadParticipant}`}
                size="200"
                radii="400"
                title={participant.displayName}
                style={
                  index === 0
                    ? { zIndex: participants.length - index }
                    : {
                        marginInlineStart: '-0.375rem',
                        zIndex: participants.length - index,
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
        {resolvedByLabel && (
          <Text
            as="span"
            className={css.ResolutionByline}
            data-compact-card-resolution-byline="true"
            size="T200"
          >
            <Icon size="50" src={Icons.Check} aria-hidden="true" />
            <span className={css.ResolutionBylineLabel}>{resolvedByLabel}</span>
          </Text>
        )}
        {tags.slice(0, maxTags).map((tagName) => (
          <ThreadTagPill key={tagName} name={tagName} />
        ))}
        {tags.length > maxTags && (
          <span className={OverflowChip} title={tags.slice(maxTags).join(', ')}>
            +{tags.length - maxTags}
          </span>
        )}
        {isStreaming && (
          <Text as="span" className={css.StreamingStatus} size="T200" priority="300">
            <ThreadStreamingDot aria-hidden="true" />
            {t('mindroomUi.threads.compactThreadCard.streaming')}
          </Text>
        )}
        <span className={css.Stats}>
          {scheduledDisplayText && scheduledTaskLabel && (
            <Box
              as="span"
              className={`${css.ScheduledIndicator} ${threadIndicatorCss.ThreadScheduledIndicator}`}
              alignItems="Center"
              gap="100"
              role="img"
              aria-label={scheduledTaskLabel}
              title={scheduledTaskLabel}
            >
              <IconCalendarEvent
                size={12}
                stroke={1.8}
                className={threadIndicatorCss.ThreadScheduledIcon}
                aria-hidden="true"
              />
              <Text as="span" size="T200" priority="300" truncate>
                {scheduledDisplayText}
              </Text>
            </Box>
          )}
          {hasReplies && (
            <Text
              as="span"
              className={css.ReplyCount}
              size="T200"
              priority="300"
              title={messageCountLabel}
              data-compact-card-reply-count="true"
            >
              <Icon size="50" src={Icons.Thread} aria-hidden="true" />
              {messageCountText}
            </Text>
          )}
        </span>
      </Box>
    </button>
  );
  if (!attachment) return card;
  return (
    <div className={cardClassName}>
      {card}
      {attachment}
    </div>
  );
}

// Memoized: the compact overview re-renders on every thread-index refresh
// (each streaming edit anywhere in the room); with content-stable view models
// only the cards whose content changed re-render.
export const CompactThreadCard = memo(CompactThreadCardBase);
